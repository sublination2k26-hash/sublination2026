begin;

alter table public.personal_loans
  add column repayment_frequency text,
  add column installment_count integer,
  add constraint personal_loan_repayment_schedule_check check (
    (repayment_frequency is null and installment_count is null)
    or (repayment_frequency in ('daily', 'weekly', 'monthly')
      and installment_count between 1 and 1000
      and interest_mode = 'monthly')
  );

create table public.personal_loan_installment_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  loan_id uuid not null references public.personal_loans(id) on delete cascade,
  paid_on date not null,
  installment_due_date date,
  installment_number integer check (installment_number > 0),
  principal_amount numeric(12,2) not null default 0 check (principal_amount >= 0),
  interest_amount numeric(12,2) not null default 0 check (interest_amount >= 0),
  daily_interest_amount numeric(12,2) not null default 0 check (daily_interest_amount >= 0),
  notes text not null default '' check (length(notes) <= 1000),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  check (principal_amount + interest_amount + daily_interest_amount > 0),
  check (installment_due_date is not null or installment_number is null)
);
create index personal_loan_installment_payments_loan_due
  on public.personal_loan_installment_payments(loan_id, installment_due_date, paid_on, id);
alter table public.personal_loan_installment_payments enable row level security;
revoke all on public.personal_loan_installment_payments from public, anon, authenticated;
grant select on public.personal_loan_installment_payments to authenticated;
create policy personal_loan_installments_admin_read on public.personal_loan_installment_payments
  for select to authenticated using ((select public.current_app_role()) = 'admin'::public.app_role);

create function public.personal_loan_installment_due(
  p_first_due date, p_due_day integer, p_frequency text, p_index integer
) returns date
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_index < 0 then raise exception 'Installment index cannot be negative.'; end if;
  if p_frequency = 'daily' then return p_first_due + p_index; end if;
  if p_frequency = 'weekly' then return p_first_due + p_index * 7; end if;
  if p_frequency = 'monthly' then
    return public.personal_loan_due(
      (date_trunc('month', p_first_due)::date + make_interval(months => p_index))::date,
      p_due_day
    );
  end if;
  raise exception 'Choose a daily, weekly, or monthly repayment frequency.';
end;
$$;

create function public.personal_loan_installment_principal(
  p_principal numeric, p_count integer, p_index integer
) returns numeric
language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_cents bigint;
  v_base bigint;
  v_remainder bigint;
begin
  if p_count < 1 or p_index < 0 or p_index >= p_count then
    raise exception 'Invalid installment number.';
  end if;
  v_cents := round(p_principal * 100)::bigint;
  v_base := v_cents / p_count;
  v_remainder := mod(v_cents, p_count);
  return (v_base + case when p_index < v_remainder then 1 else 0 end) / 100.0;
end;
$$;

create function public.personal_loan_installment_interest(
  p_monthly_interest numeric, p_frequency text
) returns numeric
language sql immutable security invoker set search_path = '' as $$
  select round(p_monthly_interest * case p_frequency
    when 'daily' then 1.0 / 30
    when 'weekly' then 7.0 / 30
    when 'monthly' then 1.0
    else null
  end, 2)
$$;

create function public.personal_loan_scheduled_interest(p_loan_id uuid, p_as_of date)
returns numeric
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_loan public.personal_loans%rowtype;
  v_due date;
  v_total numeric := 0;
  v_index integer;
begin
  select * into v_loan from public.personal_loans where id = p_loan_id;
  if not found or v_loan.repayment_frequency is null then return 0; end if;
  for v_index in 0..v_loan.installment_count - 1 loop
    v_due := public.personal_loan_installment_due(
      v_loan.first_due_date, v_loan.due_day, v_loan.repayment_frequency, v_index
    );
    exit when v_due > p_as_of;
    v_total := v_total + public.personal_loan_installment_interest(
      v_loan.monthly_interest, v_loan.repayment_frequency
    );
  end loop;
  return v_total;
end;
$$;

create function public.personal_loan_scheduled_daily_interest(p_loan_id uuid, p_as_of date)
returns numeric
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_loan public.personal_loans%rowtype;
  v_anchor date;
  v_due date;
  v_index integer;
begin
  select * into v_loan from public.personal_loans where id = p_loan_id;
  if not found or v_loan.repayment_frequency is null or v_loan.monthly_interest <= 0 then return 0; end if;
  v_anchor := v_loan.start_date;
  for v_index in 0..v_loan.installment_count - 1 loop
    v_due := public.personal_loan_installment_due(
      v_loan.first_due_date, v_loan.due_day, v_loan.repayment_frequency, v_index
    );
    exit when v_due > p_as_of;
    v_anchor := v_due;
  end loop;
  return round(v_loan.monthly_interest / 30 * greatest(0, p_as_of - v_anchor), 2);
end;
$$;

create or replace function public.check_personal_loan() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_paid numeric;
  v_cutoff date;
  v_interest_due numeric;
  v_interest_paid numeric;
  v_daily_due numeric;
  v_daily_paid numeric;
  v_due date;
  v_index integer;
  local_today date := (clock_timestamp() at time zone 'Asia/Manila')::date;
begin
  if tg_op = 'INSERT' then
    if new.start_date > local_today then raise exception 'Start date cannot be in the future.'; end if;
    if (new.repayment_frequency is null or new.repayment_frequency = 'monthly')
      and new.first_due_date <> public.personal_loan_due(new.first_due_date, new.due_day) then
      raise exception 'First due date must match the monthly due day.';
    end if;
    new.archived_at := null;
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
    return new;
  end if;
  if new.archived_at is not null then
    if old.repayment_frequency is not null then
      select coalesce(sum(principal_amount), 0), max(paid_on) filter (where principal_amount > 0)
        into v_paid, v_cutoff
      from public.personal_loan_installment_payments where loan_id = old.id;
      if v_paid < old.principal then raise exception 'Pay the remaining principal before archiving.'; end if;
      v_interest_due := public.personal_loan_scheduled_interest(old.id, v_cutoff);
      select coalesce(sum(interest_amount), 0) into v_interest_paid
        from public.personal_loan_installment_payments
        where loan_id = old.id and installment_due_date <= v_cutoff;
      if v_interest_paid < v_interest_due then raise exception 'Pay the outstanding scheduled interest before archiving.'; end if;
      v_daily_due := public.personal_loan_scheduled_daily_interest(old.id, v_cutoff);
      select coalesce(sum(daily_interest_amount), 0) into v_daily_paid
        from public.personal_loan_installment_payments where loan_id = old.id;
      if v_daily_paid < v_daily_due then raise exception 'Pay the outstanding daily interest before archiving.'; end if;
    else
      select coalesce(sum(principal_amount), 0), max(paid_on) filter (where principal_amount > 0)
        into v_paid, v_cutoff from public.personal_loan_payments where loan_id = old.id;
      if v_paid < old.principal then raise exception 'Pay the remaining principal before archiving.'; end if;
      if old.interest_mode = 'one_time' then
        select greatest(0, old.monthly_interest - coalesce(sum(interest_amount), 0)) into v_interest_due
          from public.personal_loan_payments where loan_id = old.id and interest_due_date = old.first_due_date;
      else
        select coalesce(sum(greatest(0, old.monthly_interest - coalesce((
          select sum(p.interest_amount) from public.personal_loan_payments p
          where p.loan_id = old.id and p.interest_due_date = public.personal_loan_due(m::date, old.due_day)
        ), 0))), 0) into v_interest_due
        from generate_series(date_trunc('month', old.first_due_date)::timestamp,
          date_trunc('month', v_cutoff)::timestamp, interval '1 month') m
        where public.personal_loan_due(m::date, old.due_day) between old.first_due_date and v_cutoff;
      end if;
      if v_interest_due > 0 then raise exception 'Pay the outstanding interest before archiving.'; end if;
      select coalesce(sum(amount), 0) into v_daily_paid
        from public.personal_loan_daily_interest_payments where loan_id = old.id;
      v_daily_due := public.personal_loan_daily_interest(old.id, v_cutoff);
      if v_daily_paid < v_daily_due then raise exception 'Pay the outstanding daily interest before archiving.'; end if;
    end if;
    new.archived_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function public.check_personal_loan() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_paid numeric;
  v_cutoff date;
  v_interest_due numeric;
  v_interest_paid numeric;
  v_daily_due numeric;
  v_daily_paid numeric;
begin
  if tg_op = 'INSERT' then
    if new.start_date > (clock_timestamp() at time zone 'Asia/Manila')::date then
      raise exception 'Start date cannot be in the future.';
    end if;
    if (new.repayment_frequency is null or new.repayment_frequency = 'monthly')
      and new.first_due_date <> public.personal_loan_due(new.first_due_date, new.due_day) then
      raise exception 'First due date must match the monthly due day.';
    end if;
    new.archived_at := null;
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
    return new;
  end if;
  if new.archived_at is not null then
    if old.repayment_frequency is not null then
      select coalesce(sum(principal_amount), 0), max(paid_on) filter (where principal_amount > 0)
        into v_paid, v_cutoff
      from public.personal_loan_installment_payments where loan_id = old.id;
      if v_paid < old.principal then raise exception 'Pay the remaining principal before archiving.'; end if;
      v_interest_due := public.personal_loan_scheduled_interest(old.id, v_cutoff);
      select coalesce(sum(interest_amount), 0) into v_interest_paid
        from public.personal_loan_installment_payments
        where loan_id = old.id and installment_due_date <= v_cutoff;
      if v_interest_paid < v_interest_due then raise exception 'Pay the outstanding scheduled interest before archiving.'; end if;
      v_daily_due := public.personal_loan_scheduled_daily_interest(old.id, v_cutoff);
      select coalesce(sum(daily_interest_amount), 0) into v_daily_paid
        from public.personal_loan_installment_payments where loan_id = old.id;
      if v_daily_paid < v_daily_due then raise exception 'Pay the outstanding daily interest before archiving.'; end if;
    else
      select coalesce(sum(principal_amount), 0), max(paid_on) filter (where principal_amount > 0)
        into v_paid, v_cutoff from public.personal_loan_payments where loan_id = old.id;
      if v_paid < old.principal then raise exception 'Pay the remaining principal before archiving.'; end if;
      if old.interest_mode = 'one_time' then
        select greatest(0, old.monthly_interest - coalesce(sum(interest_amount), 0)) into v_interest_due
          from public.personal_loan_payments where loan_id = old.id and interest_due_date = old.first_due_date;
      else
        select coalesce(sum(greatest(0, old.monthly_interest - coalesce((
          select sum(p.interest_amount) from public.personal_loan_payments p
          where p.loan_id = old.id and p.interest_due_date = public.personal_loan_due(m::date, old.due_day)
        ), 0))), 0) into v_interest_due
        from generate_series(date_trunc('month', old.first_due_date)::timestamp,
          date_trunc('month', v_cutoff)::timestamp, interval '1 month') m
        where public.personal_loan_due(m::date, old.due_day) between old.first_due_date and v_cutoff;
      end if;
      if v_interest_due > 0 then raise exception 'Pay the outstanding interest before archiving.'; end if;
      select coalesce(sum(amount), 0) into v_daily_paid
        from public.personal_loan_daily_interest_payments where loan_id = old.id;
      v_daily_due := public.personal_loan_daily_interest(old.id, v_cutoff);
      if v_daily_paid < v_daily_due then raise exception 'Pay the outstanding daily interest before archiving.'; end if;
    end if;
    new.archived_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create function public.record_personal_loan_installment_payment(
  p_loan_id uuid, p_due_date date, p_paid_on date, p_principal_amount numeric,
  p_interest_amount numeric, p_notes text, p_request_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_loan public.personal_loans%rowtype;
  v_existing public.personal_loan_installment_payments%rowtype;
  v_index integer;
  v_principal_due numeric;
  v_interest_due numeric;
  v_principal_paid_for_due numeric;
  v_interest_paid_for_due numeric;
  v_principal_paid_total numeric;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an active admin can record loan payments.';
  end if;
  if p_request_id is null or p_due_date is null or p_paid_on is null then raise exception 'Choose an installment date and retry.'; end if;
  select * into v_loan from public.personal_loans where id = p_loan_id for update;
  if not found then raise exception 'Loan not found.'; end if;
  if v_loan.repayment_frequency is null then raise exception 'This loan does not use scheduled installments.'; end if;
  if v_loan.archived_at is not null then raise exception 'Restore the loan before recording a payment.'; end if;
  select * into v_existing from public.personal_loan_installment_payments where request_id = p_request_id;
  if found then
    if v_existing.loan_id = p_loan_id and v_existing.installment_due_date = p_due_date
      and v_existing.paid_on = p_paid_on then return v_existing.id; end if;
    raise exception 'Request ID already used for a different payment.';
  end if;
  if p_paid_on < v_loan.start_date or p_paid_on > (clock_timestamp() at time zone 'Asia/Manila')::date
    or p_due_date > p_paid_on then raise exception 'Payment date must be on or after the installment due date and not in the future.'; end if;

  select s.i into v_index
  from generate_series(0, v_loan.installment_count - 1) as s(i)
  where public.personal_loan_installment_due(v_loan.first_due_date, v_loan.due_day, v_loan.repayment_frequency, s.i) = p_due_date;
  if v_index is null then raise exception 'Choose a valid installment due date.'; end if;
  v_principal_due := public.personal_loan_installment_principal(v_loan.principal, v_loan.installment_count, v_index);
  v_interest_due := public.personal_loan_installment_interest(v_loan.monthly_interest, v_loan.repayment_frequency);
  select coalesce(sum(principal_amount), 0), coalesce(sum(interest_amount), 0)
    into v_principal_paid_for_due, v_interest_paid_for_due
  from public.personal_loan_installment_payments
  where loan_id = v_loan.id and installment_due_date = p_due_date;
  select coalesce(sum(principal_amount), 0) into v_principal_paid_total
    from public.personal_loan_installment_payments where loan_id = v_loan.id;
  if p_principal_amount <= 0 and p_interest_amount <= 0 then raise exception 'Enter a payment amount.'; end if;
  if v_principal_paid_for_due + p_principal_amount > v_principal_due
    or v_principal_paid_total + p_principal_amount > v_loan.principal then
    raise exception 'Payment exceeds the unpaid principal for this installment.';
  end if;
  if v_interest_paid_for_due + p_interest_amount > v_interest_due then
    raise exception 'Payment exceeds the unpaid interest for this installment.';
  end if;
  insert into public.personal_loan_installment_payments(
    id, request_id, loan_id, paid_on, installment_due_date, installment_number,
    principal_amount, interest_amount, notes, created_by, created_at
  ) values (
    p_request_id, p_request_id, v_loan.id, p_paid_on, p_due_date, v_index + 1,
    p_principal_amount, p_interest_amount, coalesce(p_notes, ''), auth.uid(), clock_timestamp()
  );
  return p_request_id;
end;
$$;

create function public.delete_personal_loan_installment_payment(p_payment_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_loan_id uuid;
  v_archived_at timestamptz;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an active admin can remove loan payments.';
  end if;
  select loan_id into v_loan_id from public.personal_loan_installment_payments where id = p_payment_id;
  if not found then raise exception 'Payment not found.'; end if;
  select archived_at into v_archived_at from public.personal_loans where id = v_loan_id for update;
  if v_archived_at is not null then raise exception 'Restore the loan before changing payments.'; end if;
  delete from public.personal_loan_installment_payments where id = p_payment_id;
  if not found then raise exception 'Payment not found.'; end if;
end;
$$;

create function public.record_personal_loan_scheduled_payoff(
  p_loan_id uuid, p_paid_on date, p_request_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_loan public.personal_loans%rowtype;
  v_existing_loan uuid;
  v_existing_notes text;
  v_principal_paid numeric;
  v_remaining numeric;
  v_cutoff date;
  v_payoff_date date;
  v_due date;
  v_interest_due numeric;
  v_interest_paid numeric;
  v_daily_due numeric;
  v_daily_paid numeric;
  v_marker_saved boolean := false;
  v_index integer;
  v_request_id uuid;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an active admin can record loan payments.';
  end if;
  if p_request_id is null or p_paid_on is null then raise exception 'Choose a payment date and retry.'; end if;
  select * into v_loan from public.personal_loans where id = p_loan_id for update;
  if not found then raise exception 'Loan not found.'; end if;
  if v_loan.repayment_frequency is null then raise exception 'This loan does not use scheduled installments.'; end if;
  if v_loan.archived_at is not null then raise exception 'Restore the loan before recording a payment.'; end if;
  select loan_id, notes into v_existing_loan, v_existing_notes
    from public.personal_loan_installment_payments where request_id = p_request_id;
  if found then
    if v_existing_loan = p_loan_id and v_existing_notes = 'Full payoff' then return p_request_id; end if;
    raise exception 'Request ID already used for a different payment.';
  end if;
  if p_paid_on < v_loan.start_date or p_paid_on > (clock_timestamp() at time zone 'Asia/Manila')::date then
    raise exception 'Payment date must be between the start date and today.';
  end if;

  select coalesce(sum(principal_amount), 0), max(paid_on) filter (where principal_amount > 0)
    into v_principal_paid, v_payoff_date
  from public.personal_loan_installment_payments where loan_id = v_loan.id;
  v_remaining := greatest(0, v_loan.principal - v_principal_paid);
  v_cutoff := case when v_remaining = 0 then coalesce(v_payoff_date, p_paid_on) else p_paid_on end;

  for v_index in 0..v_loan.installment_count - 1 loop
    v_due := public.personal_loan_installment_due(
      v_loan.first_due_date, v_loan.due_day, v_loan.repayment_frequency, v_index
    );
    exit when v_due > v_cutoff;
    v_interest_due := public.personal_loan_installment_interest(
      v_loan.monthly_interest, v_loan.repayment_frequency
    );
    select coalesce(sum(interest_amount), 0) into v_interest_paid
      from public.personal_loan_installment_payments
      where loan_id = v_loan.id and installment_due_date = v_due;
    v_interest_due := greatest(0, v_interest_due - v_interest_paid);
    if v_interest_due > 0 then
      v_request_id := case when v_marker_saved then null else p_request_id end;
      insert into public.personal_loan_installment_payments(
        request_id, loan_id, paid_on, installment_due_date, installment_number,
        interest_amount, notes, created_by
      ) values (v_request_id, v_loan.id, p_paid_on, v_due, v_index + 1,
        v_interest_due, 'Full payoff', auth.uid());
      v_marker_saved := true;
    end if;
  end loop;

  select coalesce(sum(daily_interest_amount), 0) into v_daily_paid
    from public.personal_loan_installment_payments where loan_id = v_loan.id;
  v_daily_due := greatest(0, public.personal_loan_scheduled_daily_interest(v_loan.id, v_cutoff) - v_daily_paid);
  if v_remaining > 0 then
    v_request_id := case when v_marker_saved then null else p_request_id end;
    insert into public.personal_loan_installment_payments(
      request_id, loan_id, paid_on, principal_amount, notes, created_by
    ) values (v_request_id, v_loan.id, p_paid_on, v_remaining, 'Full payoff', auth.uid());
    v_marker_saved := true;
  end if;
  if v_daily_due > 0 then
    v_request_id := case when v_marker_saved then null else p_request_id end;
    insert into public.personal_loan_installment_payments(
      request_id, loan_id, paid_on, daily_interest_amount, notes, created_by
    ) values (v_request_id, v_loan.id, p_paid_on, v_daily_due, 'Full payoff', auth.uid());
    v_marker_saved := true;
  end if;
  if not v_marker_saved then raise exception 'This loan is already fully paid.'; end if;
  return p_request_id;
end;
$$;

revoke all on function public.personal_loan_installment_due(date,integer,text,integer),
  public.personal_loan_installment_principal(numeric,integer,integer),
  public.personal_loan_installment_interest(numeric,text),
  public.personal_loan_scheduled_interest(uuid,date),
  public.personal_loan_scheduled_daily_interest(uuid,date),
  public.record_personal_loan_installment_payment(uuid,date,date,numeric,numeric,text,uuid),
  public.delete_personal_loan_installment_payment(uuid),
  public.record_personal_loan_scheduled_payoff(uuid,date,uuid) from public, anon;
revoke all on function public.check_personal_loan() from public, anon;
grant execute on function public.personal_loan_installment_due(date,integer,text,integer),
  public.personal_loan_installment_principal(numeric,integer,integer),
  public.personal_loan_installment_interest(numeric,text),
  public.personal_loan_scheduled_interest(uuid,date),
  public.personal_loan_scheduled_daily_interest(uuid,date),
  public.record_personal_loan_installment_payment(uuid,date,date,numeric,numeric,text,uuid),
  public.delete_personal_loan_installment_payment(uuid),
  public.record_personal_loan_scheduled_payoff(uuid,date,uuid) to authenticated;
grant execute on function public.check_personal_loan() to authenticated;

notify pgrst, 'reload schema';
commit;
