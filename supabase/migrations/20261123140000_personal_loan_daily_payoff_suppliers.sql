begin;

alter table public.personal_loans add column supplier text;
alter table public.personal_loans add constraint personal_loans_supplier_check
  check (supplier is null or supplier in ('MAGNUS', 'SUBLI-NATION'));
grant update (supplier) on public.personal_loans to authenticated;

create table public.personal_loan_daily_interest_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.personal_loans(id),
  paid_on date not null,
  amount numeric(12,2) not null check (amount > 0 and amount <= 9999999999.99),
  notes text not null default '' check (length(notes) <= 1000),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create index personal_loan_daily_payments_loan_date on public.personal_loan_daily_interest_payments(loan_id, paid_on, id);
alter table public.personal_loan_daily_interest_payments enable row level security;
revoke all on public.personal_loan_daily_interest_payments from public, anon, authenticated;
grant select, insert, delete on public.personal_loan_daily_interest_payments to authenticated;
create policy personal_loan_daily_payments_admin_read on public.personal_loan_daily_interest_payments for select to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role);
create policy personal_loan_daily_payments_admin_insert on public.personal_loan_daily_interest_payments for insert to authenticated
  with check ((select public.current_app_role()) = 'admin'::public.app_role);
create policy personal_loan_daily_payments_admin_delete on public.personal_loan_daily_interest_payments for delete to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role);

create or replace function public.personal_loan_daily_interest(p_loan_id uuid, p_as_of date) returns numeric
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_loan public.personal_loans%rowtype;
  v_anchor date;
begin
  if p_as_of is null then raise exception 'Choose a daily interest calculation date.'; end if;
  select * into v_loan from public.personal_loans where id = p_loan_id;
  if not found then raise exception 'Loan not found.'; end if;
  if v_loan.interest_mode = 'one_time' or v_loan.monthly_interest = 0 then return 0; end if;

  select max(public.personal_loan_due(m::date, v_loan.due_day)) into v_anchor
  from generate_series(date_trunc('month', v_loan.first_due_date)::timestamp,
    date_trunc('month', p_as_of)::timestamp, interval '1 month') m
  where public.personal_loan_due(m::date, v_loan.due_day) between v_loan.first_due_date and p_as_of;

  return round(v_loan.monthly_interest / 30 * greatest(0, p_as_of - coalesce(v_anchor, v_loan.start_date)), 2);
end;
$$;
revoke all on function public.personal_loan_daily_interest(uuid, date) from public, anon;
grant execute on function public.personal_loan_daily_interest(uuid, date) to authenticated;

create or replace function public.check_personal_loan_daily_payment() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_loan public.personal_loans%rowtype;
  v_principal_paid numeric;
  v_payoff_date date;
  v_interest_due numeric;
  v_daily_paid numeric;
  v_daily_due numeric;
begin
  select * into v_loan from public.personal_loans
  where id = case when tg_op = 'DELETE' then old.loan_id else new.loan_id end for update;
  if not found then raise exception 'Loan not found.'; end if;
  if tg_op = 'DELETE' then
    if v_loan.archived_at is not null then raise exception 'Restore the archived loan before changing payments.'; end if;
    return old;
  end if;
  if v_loan.archived_at is not null then raise exception 'Restore the archived loan before changing payments.'; end if;
  if new.paid_on < v_loan.start_date or new.paid_on > (clock_timestamp() at time zone 'Asia/Manila')::date then
    raise exception 'Payment date must be between the start date and today.';
  end if;

  select coalesce(sum(principal_amount), 0), max(paid_on) filter (where principal_amount > 0)
    into v_principal_paid, v_payoff_date
  from public.personal_loan_payments where loan_id = v_loan.id;
  if v_principal_paid < v_loan.principal then raise exception 'Pay the remaining principal before recording daily interest.'; end if;

  if v_loan.interest_mode = 'one_time' then
    select greatest(0, v_loan.monthly_interest - coalesce(sum(interest_amount), 0)) into v_interest_due
    from public.personal_loan_payments where loan_id = v_loan.id and interest_due_date = v_loan.first_due_date;
  else
    select coalesce(sum(greatest(0, v_loan.monthly_interest - coalesce((
      select sum(p.interest_amount) from public.personal_loan_payments p
      where p.loan_id = v_loan.id and p.interest_due_date = public.personal_loan_due(m::date, v_loan.due_day)
    ), 0))), 0) into v_interest_due
    from generate_series(date_trunc('month', v_loan.first_due_date)::timestamp,
      date_trunc('month', v_payoff_date)::timestamp, interval '1 month') m
    where public.personal_loan_due(m::date, v_loan.due_day) between v_loan.first_due_date and v_payoff_date;
  end if;
  if v_interest_due > 0 then raise exception 'Pay the outstanding scheduled interest before daily interest.'; end if;

  select coalesce(sum(amount), 0) into v_daily_paid
  from public.personal_loan_daily_interest_payments where loan_id = v_loan.id;
  v_daily_due := public.personal_loan_daily_interest(v_loan.id, v_payoff_date);
  if v_daily_paid + new.amount > v_daily_due then raise exception 'Payment exceeds the unpaid daily interest.'; end if;
  new.created_by := auth.uid();
  new.created_at := clock_timestamp();
  return new;
end;
$$;
create trigger check_personal_loan_daily_payment
  before insert or delete on public.personal_loan_daily_interest_payments
  for each row execute function public.check_personal_loan_daily_payment();
revoke all on function public.check_personal_loan_daily_payment() from public, anon, authenticated;
grant execute on function public.check_personal_loan_daily_payment() to authenticated;

create or replace function public.check_personal_loan() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  paid numeric;
  cutoff date;
  interest_due numeric;
  daily_paid numeric;
  daily_due numeric;
  local_today date := (clock_timestamp() at time zone 'Asia/Manila')::date;
begin
  if tg_op = 'INSERT' then
    if new.start_date > local_today then raise exception 'Start date cannot be in the future.'; end if;
    if new.first_due_date <> public.personal_loan_due(new.first_due_date, new.due_day) then
      raise exception 'First due date must match the monthly due day.';
    end if;
    new.archived_at := null;
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
    return new;
  end if;
  if new.archived_at is not null then
    select coalesce(sum(principal_amount), 0), max(paid_on) filter (where principal_amount > 0)
      into paid, cutoff from public.personal_loan_payments where loan_id = old.id;
    if paid < old.principal then raise exception 'Pay the remaining principal before archiving.'; end if;
    if old.interest_mode = 'one_time' then
      select greatest(0, old.monthly_interest - coalesce(sum(interest_amount), 0)) into interest_due
        from public.personal_loan_payments where loan_id = old.id and interest_due_date = old.first_due_date;
    else
      select coalesce(sum(greatest(0, old.monthly_interest - coalesce((
        select sum(p.interest_amount) from public.personal_loan_payments p
        where p.loan_id = old.id and p.interest_due_date = public.personal_loan_due(m::date, old.due_day)
      ), 0))), 0) into interest_due
      from generate_series(date_trunc('month', old.first_due_date)::timestamp,
        date_trunc('month', cutoff)::timestamp, interval '1 month') m
      where public.personal_loan_due(m::date, old.due_day) between old.first_due_date and cutoff;
    end if;
    if interest_due > 0 then raise exception 'Pay the outstanding interest before archiving.'; end if;
    select coalesce(sum(amount), 0) into daily_paid
      from public.personal_loan_daily_interest_payments where loan_id = old.id;
    daily_due := public.personal_loan_daily_interest(old.id, cutoff);
    if daily_paid < daily_due then raise exception 'Pay the outstanding daily interest before archiving.'; end if;
    new.archived_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function public.record_personal_loan_payoff(
  p_loan_id uuid, p_paid_on date, p_request_id uuid
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_loan public.personal_loans%rowtype;
  v_existing_loan uuid;
  v_existing_notes text;
  v_principal_paid numeric;
  v_remaining numeric;
  v_cutoff date;
  v_payoff_date date;
  v_due date;
  v_interest_paid numeric;
  v_interest_due numeric;
  v_daily_paid numeric;
  v_daily_due numeric;
  v_marker_saved boolean := false;
  v_payment_id uuid;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an active admin can record loan payments.';
  end if;
  if p_request_id is null or p_paid_on is null then raise exception 'Choose a payment date and retry.'; end if;

  select loan_id, notes into v_existing_loan, v_existing_notes
  from public.personal_loan_payments where id = p_request_id;
  if not found then
    select loan_id, notes into v_existing_loan, v_existing_notes
    from public.personal_loan_daily_interest_payments where id = p_request_id;
  end if;
  if found then
    if v_existing_loan = p_loan_id and v_existing_notes = 'Full payoff' then return p_request_id; end if;
    raise exception 'Request ID already used for a different payment.';
  end if;

  select * into v_loan from public.personal_loans where id = p_loan_id for update;
  if not found then raise exception 'Loan not found.'; end if;
  if v_loan.archived_at is not null then raise exception 'Restore the loan before recording a payment.'; end if;
  if p_paid_on < v_loan.start_date or p_paid_on > (clock_timestamp() at time zone 'Asia/Manila')::date then
    raise exception 'Payment date must be between the start date and today.';
  end if;

  select coalesce(sum(principal_amount), 0), max(paid_on) filter (where principal_amount > 0)
    into v_principal_paid, v_payoff_date
  from public.personal_loan_payments where loan_id = v_loan.id;
  v_remaining := greatest(0, v_loan.principal - v_principal_paid);
  v_cutoff := case when v_remaining = 0 then coalesce(v_payoff_date, p_paid_on) else p_paid_on end;

  select coalesce(sum(amount), 0) into v_daily_paid
  from public.personal_loan_daily_interest_payments where loan_id = v_loan.id;
  v_daily_due := greatest(0, public.personal_loan_daily_interest(v_loan.id, v_cutoff) - v_daily_paid);

  if v_loan.interest_mode = 'one_time' then
    select coalesce(sum(interest_amount), 0) into v_interest_paid
    from public.personal_loan_payments where loan_id = v_loan.id and interest_due_date = v_loan.first_due_date;
    v_interest_due := greatest(0, v_loan.monthly_interest - v_interest_paid);
    if v_interest_due > 0 then
      v_payment_id := case when v_remaining = 0 and v_daily_due = 0 and not v_marker_saved then p_request_id else gen_random_uuid() end;
      insert into public.personal_loan_payments(id, loan_id, paid_on, interest_amount, interest_due_date, notes)
      values (v_payment_id, v_loan.id, p_paid_on, v_interest_due, v_loan.first_due_date, 'Full payoff');
      v_marker_saved := v_payment_id = p_request_id;
    end if;
  else
    for v_due in
      select public.personal_loan_due(m::date, v_loan.due_day)
      from generate_series(date_trunc('month', v_loan.first_due_date)::timestamp,
        date_trunc('month', v_cutoff)::timestamp, interval '1 month') m
      where public.personal_loan_due(m::date, v_loan.due_day) between v_loan.first_due_date and v_cutoff
      order by 1
    loop
      select coalesce(sum(interest_amount), 0) into v_interest_paid
      from public.personal_loan_payments where loan_id = v_loan.id and interest_due_date = v_due;
      v_interest_due := greatest(0, v_loan.monthly_interest - v_interest_paid);
      if v_interest_due > 0 then
        v_payment_id := case when v_remaining = 0 and v_daily_due = 0 and not v_marker_saved then p_request_id else gen_random_uuid() end;
        insert into public.personal_loan_payments(id, loan_id, paid_on, interest_amount, interest_due_date, notes)
        values (v_payment_id, v_loan.id, p_paid_on, v_interest_due, v_due, 'Full payoff');
        v_marker_saved := v_payment_id = p_request_id;
      end if;
    end loop;
  end if;

  if v_remaining > 0 then
    v_payment_id := case when v_daily_due = 0 then p_request_id else gen_random_uuid() end;
    insert into public.personal_loan_payments(id, loan_id, paid_on, principal_amount, notes)
    values (v_payment_id, v_loan.id, p_paid_on, v_remaining, 'Full payoff');
    v_marker_saved := v_payment_id = p_request_id;
  end if;
  if v_daily_due > 0 then
    insert into public.personal_loan_daily_interest_payments(id, loan_id, paid_on, amount, notes)
    values (p_request_id, v_loan.id, p_paid_on, v_daily_due, 'Full payoff');
    v_marker_saved := true;
  end if;

  if not v_marker_saved then raise exception 'This loan is already fully paid.'; end if;
  return p_request_id;
end;
$$;
revoke all on function public.record_personal_loan_payoff(uuid, date, uuid) from public, anon;
grant execute on function public.record_personal_loan_payoff(uuid, date, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
