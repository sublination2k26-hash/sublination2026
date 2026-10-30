-- Personal lending is independent of document disbursements and customer payments.
create table public.personal_loans (
  id uuid primary key default gen_random_uuid(),
  borrower_name text not null check (length(trim(borrower_name)) between 1 and 200),
  principal numeric(12,2) not null check (principal > 0 and principal <= 9999999999.99),
  start_date date not null check (start_date >= date '1900-01-01'),
  first_due_date date not null check (first_due_date > start_date),
  due_day integer not null check (due_day between 1 and 31),
  monthly_interest numeric(12,2) not null check (monthly_interest >= 0 and monthly_interest <= 9999999999.99),
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create table public.personal_loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.personal_loans(id),
  paid_on date not null,
  principal_amount numeric(12,2) not null default 0 check (principal_amount >= 0 and principal_amount <= 9999999999.99),
  interest_amount numeric(12,2) not null default 0 check (interest_amount >= 0 and interest_amount <= 9999999999.99),
  interest_due_date date,
  notes text not null default '' check (length(notes) <= 1000),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  check (principal_amount + interest_amount > 0),
  check ((interest_amount > 0 and interest_due_date is not null) or (interest_amount = 0 and interest_due_date is null))
);
create index personal_loan_payments_loan_date on public.personal_loan_payments(loan_id, paid_on, id);
alter table public.personal_loans enable row level security;
alter table public.personal_loan_payments enable row level security;
revoke all on public.personal_loans, public.personal_loan_payments from public, anon, authenticated;
grant select, insert on public.personal_loans to authenticated;
grant update(archived_at) on public.personal_loans to authenticated;
grant select, insert, delete on public.personal_loan_payments to authenticated;
create policy personal_loans_admin_read on public.personal_loans for select to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role);
create policy personal_loans_admin_insert on public.personal_loans for insert to authenticated
  with check ((select public.current_app_role()) = 'admin'::public.app_role);
create policy personal_loans_admin_update on public.personal_loans for update to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role)
  with check ((select public.current_app_role()) = 'admin'::public.app_role);
create policy personal_loan_payments_admin_read on public.personal_loan_payments for select to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role);
create policy personal_loan_payments_admin_insert on public.personal_loan_payments for insert to authenticated
  with check ((select public.current_app_role()) = 'admin'::public.app_role);
create policy personal_loan_payments_admin_delete on public.personal_loan_payments for delete to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role);

create function public.personal_loan_due(p_month date, p_day integer) returns date
language sql immutable security invoker set search_path = '' as $$
  select (date_trunc('month', p_month)::date +
    (least(p_day, extract(day from date_trunc('month', p_month) + interval '1 month - 1 day')::integer) - 1))::date
$$;

create function public.check_personal_loan() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare paid numeric; cutoff date; interest_due numeric; local_today date := (clock_timestamp() at time zone 'Asia/Manila')::date;
begin
  if tg_op = 'INSERT' then
    if new.start_date > local_today then raise exception 'Start date cannot be in the future.'; end if;
    if new.first_due_date <> public.personal_loan_due(new.first_due_date, new.due_day) then
      raise exception 'First due date must match the monthly due day.';
    end if;
    new.archived_at := null;
    new.created_by := auth.uid(); new.created_at := clock_timestamp();
    return new;
  end if;
  if new.archived_at is not null then
    select coalesce(sum(principal_amount),0), max(paid_on) filter (where principal_amount > 0)
      into paid, cutoff from public.personal_loan_payments where loan_id = old.id;
    if paid < old.principal then raise exception 'Pay the remaining principal before archiving.'; end if;
    select coalesce(sum(greatest(0, old.monthly_interest - coalesce((
      select sum(p.interest_amount) from public.personal_loan_payments p
      where p.loan_id = old.id and p.interest_due_date = public.personal_loan_due(m::date, old.due_day)
    ),0))),0) into interest_due
    from generate_series(date_trunc('month',old.first_due_date)::timestamp,
      date_trunc('month',cutoff)::timestamp, interval '1 month') m
    where public.personal_loan_due(m::date,old.due_day) between old.first_due_date and cutoff;
    if interest_due > 0 then raise exception 'Pay the outstanding monthly interest before archiving.'; end if;
    new.archived_at := clock_timestamp();
  end if;
  return new;
end;
$$;
create trigger check_personal_loan before insert or update on public.personal_loans
  for each row execute function public.check_personal_loan();

create function public.check_personal_loan_payment() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare loan public.personal_loans; paid numeric; interest_paid numeric; payoff date;
begin
  -- Serialize payments and archiving for the same loan to prevent overpayments.
  select * into loan from public.personal_loans where id = case when tg_op = 'DELETE' then old.loan_id else new.loan_id end for update;
  if not found then raise exception 'Loan not found.'; end if;
  -- Let the primary key reject a retried receipt before checking new balances.
  if tg_op = 'INSERT' and exists(select 1 from public.personal_loan_payments where id = new.id) then return new; end if;
  if loan.archived_at is not null then raise exception 'Restore the archived loan before changing payments.'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.paid_on < loan.start_date or new.paid_on > (clock_timestamp() at time zone 'Asia/Manila')::date then
    raise exception 'Payment date must be between the start date and today.';
  end if;
  select coalesce(sum(principal_amount),0), max(paid_on) filter (where principal_amount > 0)
    into paid, payoff from public.personal_loan_payments where loan_id = loan.id;
  if paid + new.principal_amount > loan.principal then raise exception 'Payment exceeds the remaining principal.'; end if;
  if new.interest_amount > 0 then
    if new.interest_due_date < loan.first_due_date or new.interest_due_date > new.paid_on
      or new.interest_due_date <> public.personal_loan_due(new.interest_due_date,loan.due_day)
      or (paid >= loan.principal and new.interest_due_date > payoff) then
      raise exception 'Choose a valid monthly interest due date on or before the payment date.';
    end if;
    select coalesce(sum(interest_amount),0) into interest_paid from public.personal_loan_payments
      where loan_id = loan.id and interest_due_date = new.interest_due_date;
    if interest_paid + new.interest_amount > loan.monthly_interest then raise exception 'Payment exceeds the unpaid interest for this month.'; end if;
  end if;
  new.created_by := auth.uid(); new.created_at := clock_timestamp();
  return new;
end;
$$;
create trigger check_personal_loan_payment before insert or delete on public.personal_loan_payments
  for each row execute function public.check_personal_loan_payment();
revoke all on function public.personal_loan_due(date,integer), public.check_personal_loan(), public.check_personal_loan_payment() from public, anon, authenticated;
grant execute on function public.personal_loan_due(date,integer), public.check_personal_loan(), public.check_personal_loan_payment() to authenticated;
