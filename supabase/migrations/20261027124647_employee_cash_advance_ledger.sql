-- Preserve old deductions as legacy amounts; never infer employee debts from them.
alter table public.payroll_lines add column legacy_cash_advance numeric(12,2) not null default 0;
-- Disable the draft-only trigger while copying historical approved/paid values.
alter table public.payroll_lines disable trigger payroll_lines_draft_adjustments;
update public.payroll_lines set legacy_cash_advance = cash_advance;
alter table public.payroll_lines enable trigger payroll_lines_draft_adjustments;

create table public.employee_cash_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0 and amount <= 9999999999.99),
  advance_date date not null,
  reference text not null check (length(trim(reference)) between 1 and 100),
  reason text not null default '' check (length(reason) <= 1000),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(employee_id, reference)
);
create table public.payroll_advance_recoveries (
  advance_id uuid not null references public.employee_cash_advances(id),
  payroll_line_id uuid not null references public.payroll_lines(id),
  amount numeric(12,2) not null check (amount > 0 and amount <= 9999999999.99),
  primary key(advance_id, payroll_line_id)
);
create index payroll_advance_recoveries_line on public.payroll_advance_recoveries(payroll_line_id);
alter table public.employee_cash_advances enable row level security;
alter table public.payroll_advance_recoveries enable row level security;
revoke all on public.employee_cash_advances, public.payroll_advance_recoveries from public, anon, authenticated;
grant select on public.employee_cash_advances, public.payroll_advance_recoveries to authenticated;
create policy advances_admin_read on public.employee_cash_advances for select to authenticated
  using ((select public.current_app_role())='admin'::public.app_role);
create policy recoveries_admin_read on public.payroll_advance_recoveries for select to authenticated
  using ((select public.current_app_role())='admin'::public.app_role);

-- Only these checked APIs write the ledger, so amounts and identities cannot be edited directly.
create function public.issue_employee_cash_advance(p_employee uuid,p_amount numeric,p_date date,p_reference text,p_reason text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then raise exception 'Only an active admin can issue advances.'; end if;
  if not exists(select 1 from public.profiles where id=p_employee and active and role <> 'admin') then raise exception 'Select an active employee.'; end if;
  insert into public.employee_cash_advances(employee_id,amount,advance_date,reference,reason,created_by)
    values(p_employee,p_amount,p_date,trim(p_reference),coalesce(trim(p_reason),''),auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.set_payroll_advance_recovery(p_line uuid,p_advance uuid,p_amount numeric)
returns void language plpgsql security definer set search_path='' as $$
declare v_run uuid; v_employee uuid; v_advance public.employee_cash_advances; v_used numeric; v_end date;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then raise exception 'Only an active admin can recover advances.'; end if;
  select payroll_run_id,employee_id into v_run,v_employee from public.payroll_lines where id=p_line;
  select period_end into v_end from public.payroll_runs where id=v_run and status='draft' for update;
  if not found then raise exception 'Select a draft payroll line.'; end if;
  select * into v_advance from public.employee_cash_advances where id=p_advance for update;
  if not found or v_advance.employee_id is distinct from v_employee then raise exception 'Advance must belong to the payroll employee.'; end if;
  if v_advance.advance_date > v_end then raise exception 'Advance was issued after this payroll period.'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 9999999999.99 or p_amount='NaN'::numeric then raise exception 'Enter a valid recovery amount.'; end if;
  select coalesce(sum(amount),0) into v_used from public.payroll_advance_recoveries where advance_id=p_advance and payroll_line_id<>p_line;
  if v_used+round(p_amount,2)>v_advance.amount then raise exception 'Recovery exceeds the available advance balance (including reservations in other payrolls).'; end if;
  delete from public.payroll_advance_recoveries where advance_id=p_advance and payroll_line_id=p_line;
  if round(p_amount,2)>0 then insert into public.payroll_advance_recoveries values(p_advance,p_line,round(p_amount,2)); end if;
  update public.payroll_lines set cash_advance=legacy_cash_advance+(select coalesce(sum(amount),0) from public.payroll_advance_recoveries where payroll_line_id=p_line) where id=p_line;
end $$;

create or replace function public.guard_payroll_line_adjustments()
returns trigger language plpgsql set search_path='' as $$
declare v_expected numeric;
begin
  perform 1 from public.payroll_runs where id=old.payroll_run_id and status='draft' for update;
  if not found then raise exception 'Only draft payroll lines can be adjusted.'; end if;
  if new.payroll_run_id is distinct from old.payroll_run_id or new.employee_id is distinct from old.employee_id then raise exception 'The payroll period and employee cannot be changed.'; end if;
  if new.legacy_cash_advance is distinct from old.legacy_cash_advance then raise exception 'Historical cash advance deductions are preserved.'; end if;
  select old.legacy_cash_advance+coalesce(sum(amount),0) into v_expected from public.payroll_advance_recoveries where payroll_line_id=old.id;
  if new.cash_advance is distinct from v_expected then raise exception 'Select individual advances in the cash advance ledger to change recovery.'; end if;
  new.total_pay := new.base_pay+new.production_pay+new.adjustments-new.cash_advance;
  return new;
end $$;
revoke all on function public.issue_employee_cash_advance(uuid,numeric,date,text,text),public.set_payroll_advance_recovery(uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.issue_employee_cash_advance(uuid,numeric,date,text,text),public.set_payroll_advance_recovery(uuid,uuid,numeric) to authenticated;
