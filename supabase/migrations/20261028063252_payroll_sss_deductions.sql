-- Admin-entered employee SSS share for this payroll period. Historical totals stay unchanged.
alter table public.payroll_lines
  add column sss_deduction numeric(12,2) not null default 0
    check (sss_deduction >= 0 and sss_deduction <= 9999999999.99 and sss_deduction <> 'NaN'::numeric),
  add column sss_note text not null default '' check (length(sss_note) <= 1000);

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
  new.total_pay := new.base_pay+new.production_pay+round(new.overtime_hours*new.overtime_rate,2)+new.adjustments-new.cash_advance-new.sss_deduction;
  return new;
end $$;
