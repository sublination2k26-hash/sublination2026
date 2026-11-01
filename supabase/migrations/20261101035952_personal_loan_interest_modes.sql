-- Existing loans retain monthly terms and their saved peso interest.
-- monthly_interest stores the fixed charge per selected interest period.
alter table public.personal_loans
  add column interest_mode text not null default 'monthly' check (interest_mode in ('one_time','monthly')),
  add column interest_rate numeric(12,2) check (interest_rate >= 0);
alter table public.personal_loans add constraint personal_loan_rate_matches_amount
  check (interest_rate is null or monthly_interest = round(principal * interest_rate / 100, 2));

create or replace function public.check_personal_loan() returns trigger
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
    if old.interest_mode = 'one_time' then
      select greatest(0, old.monthly_interest - coalesce(sum(interest_amount),0)) into interest_due
        from public.personal_loan_payments where loan_id = old.id and interest_due_date = old.first_due_date;
    else
    select coalesce(sum(greatest(0, old.monthly_interest - coalesce((
      select sum(p.interest_amount) from public.personal_loan_payments p
      where p.loan_id = old.id and p.interest_due_date = public.personal_loan_due(m::date, old.due_day)
    ),0))),0) into interest_due
    from generate_series(date_trunc('month',old.first_due_date)::timestamp,
      date_trunc('month',cutoff)::timestamp, interval '1 month') m
    where public.personal_loan_due(m::date,old.due_day) between old.first_due_date and cutoff;
    end if;
    if interest_due > 0 then raise exception 'Pay the outstanding interest before archiving.'; end if;
    new.archived_at := clock_timestamp();
  end if;
  return new;
end;
$$;
create or replace function public.check_personal_loan_payment() returns trigger
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
    if loan.interest_mode = 'one_time' then
      if new.interest_due_date <> loan.first_due_date then
        raise exception 'Choose the one-time interest due date.';
      end if;
    else
    if new.interest_due_date < loan.first_due_date or new.interest_due_date > new.paid_on
      or new.interest_due_date <> public.personal_loan_due(new.interest_due_date,loan.due_day)
      or (paid >= loan.principal and new.interest_due_date > payoff) then
      raise exception 'Choose a valid monthly interest due date on or before the payment date.';
    end if;
    end if;
    select coalesce(sum(interest_amount),0) into interest_paid from public.personal_loan_payments
      where loan_id = loan.id and interest_due_date = new.interest_due_date;
    if interest_paid + new.interest_amount > loan.monthly_interest then raise exception 'Payment exceeds the unpaid interest for this due date.'; end if;
  end if;
  new.created_by := auth.uid(); new.created_at := clock_timestamp();
  return new;
end;
$$;
