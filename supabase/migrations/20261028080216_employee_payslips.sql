-- Standalone issued salary snapshots. Payroll runs and attendance remain separate.
create table public.employee_payslips (
  id uuid primary key default gen_random_uuid(),
  payslip_no bigint generated always as identity unique,
  employee_id uuid not null references public.profiles(id),
  employee_name text not null,
  employee_role public.app_role not null,
  issue_date date not null,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  basic_pay numeric(12,2) not null,
  overtime_pay numeric(12,2) not null,
  bonus numeric(12,2) not null,
  backpay numeric(12,2) not null,
  sss numeric(12,2) not null,
  philhealth numeric(12,2) not null,
  pagibig numeric(12,2) not null,
  other_deductions numeric(12,2) not null,
  net_pay numeric(12,2) generated always as
    (basic_pay + overtime_pay + bonus + backpay - sss - philhealth - pagibig - other_deductions) stored,
  issued_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(employee_id, period_start, period_end),
  check (basic_pay >= 0 and basic_pay < 10000000000 and overtime_pay >= 0 and overtime_pay < 10000000000
    and bonus >= 0 and bonus < 10000000000 and backpay >= 0 and backpay < 10000000000
    and sss >= 0 and sss < 10000000000 and philhealth >= 0 and philhealth < 10000000000
    and pagibig >= 0 and pagibig < 10000000000 and other_deductions >= 0 and other_deductions < 10000000000),
  check (net_pay >= 0 and net_pay < 10000000000)
);
alter table public.employee_payslips enable row level security;
revoke all on public.employee_payslips from public, anon, authenticated;
grant select on public.employee_payslips to authenticated;
create policy "active admins read payslips" on public.employee_payslips for select to authenticated
  using (public.current_app_role() = 'admin');

create function public.issue_employee_payslip(p_employee uuid, p_issue_date date, p_start date, p_end date, p_amounts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_employee public.profiles;
  v_slip public.employee_payslips;
  v_key text;
  v_amount numeric;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'Only an active admin can issue payslips.';
  end if;
  if p_issue_date is null or p_issue_date > (now() at time zone 'Asia/Manila')::date
    or p_start is null or p_end is null or p_end < p_start then
    raise exception 'Choose valid issue and payroll dates.';
  end if;
  select * into v_employee from public.profiles where id = p_employee and active and role <> 'admin' for share;
  if not found then raise exception 'Choose an active employee.'; end if;
  if p_amounts is null or jsonb_typeof(p_amounts) <> 'object' then raise exception 'Enter valid payslip amounts.'; end if;
  foreach v_key in array array['basic_pay','overtime_pay','bonus','backpay','sss','philhealth','pagibig','other_deductions'] loop
    if jsonb_typeof(p_amounts -> v_key) is distinct from 'number' then
      raise exception 'Enter a number for %.', v_key;
    end if;
    v_amount := (p_amounts ->> v_key)::numeric;
    if v_amount < 0 or v_amount >= 10000000000 or v_amount <> round(v_amount, 2) then
      raise exception 'Enter a non-negative amount with at most two decimal places for %.', v_key;
    end if;
  end loop;
  insert into public.employee_payslips(employee_id, employee_name, employee_role, issue_date, period_start, period_end,
    basic_pay, overtime_pay, bonus, backpay, sss, philhealth, pagibig, other_deductions, issued_by)
  values (v_employee.id, v_employee.full_name, v_employee.role, p_issue_date, p_start, p_end,
    (p_amounts->>'basic_pay')::numeric, (p_amounts->>'overtime_pay')::numeric, (p_amounts->>'bonus')::numeric,
    (p_amounts->>'backpay')::numeric, (p_amounts->>'sss')::numeric, (p_amounts->>'philhealth')::numeric,
    (p_amounts->>'pagibig')::numeric, (p_amounts->>'other_deductions')::numeric, auth.uid()) returning * into v_slip;
  return to_jsonb(v_slip);
exception when unique_violation then
  raise exception 'A payslip already exists for this employee and period.';
end $$;
revoke all on function public.issue_employee_payslip(uuid,date,date,date,jsonb) from public, anon;
grant execute on function public.issue_employee_payslip(uuid,date,date,date,jsonb) to authenticated;
