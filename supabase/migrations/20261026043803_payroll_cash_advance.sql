-- Cash advances are recovered explicitly per payroll period, separate from adjustments.
alter table public.payroll_lines
  add column cash_advance numeric(12,2) not null default 0
    check (cash_advance >= 0 and cash_advance <> 'NaN'::numeric),
  add column cash_advance_note text;

create or replace function public.guard_payroll_line_adjustments()
returns trigger language plpgsql set search_path=public as $$
begin
  -- Serialize edits against approval so an approved amount cannot change.
  perform 1 from public.payroll_runs
    where id=old.payroll_run_id and status='draft' for update;
  if not found then
    raise exception 'Only draft payroll lines can be adjusted.';
  end if;
  if new.payroll_run_id is distinct from old.payroll_run_id
    or new.employee_id is distinct from old.employee_id then
    raise exception 'The payroll period and employee cannot be changed.';
  end if;
  new.total_pay := new.base_pay + new.production_pay + new.adjustments - new.cash_advance;
  return new;
end $$;

comment on column public.payroll_lines.cash_advance is
  'Amount of cash advance recovered from this payroll period; no automatic balance carry-forward.';
