-- Recurring employee share per payroll cutoff; existing payroll snapshots are unchanged.
create table public.employee_sss_settings (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null default 0 check (amount >= 0 and amount <= 9999999999.99 and amount <> 'NaN'::numeric),
  note text not null default '' check (length(note) <= 1000)
);
alter table public.employee_sss_settings enable row level security;
revoke all on public.employee_sss_settings from anon, authenticated;
grant select, insert, update on public.employee_sss_settings to authenticated;
create policy "admin reads recurring SSS" on public.employee_sss_settings for select to authenticated
using (public.current_app_role() = 'admin');
create policy "admin sets recurring SSS" on public.employee_sss_settings for insert to authenticated
with check (public.current_app_role() = 'admin');
create policy "admin updates recurring SSS" on public.employee_sss_settings for update to authenticated
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create function public.apply_employee_sss_to_payroll() returns trigger
language plpgsql set search_path = '' as $$
declare v_amount numeric; v_note text;
begin
  select amount, note into v_amount, v_note from public.employee_sss_settings where employee_id = new.employee_id;
  new.sss_deduction := coalesce(v_amount, 0);
  new.sss_note := coalesce(v_note, '');
  new.total_pay := new.base_pay + new.production_pay + round(new.overtime_hours * new.overtime_rate, 2)
    + new.adjustments - new.cash_advance - new.sss_deduction;
  return new;
end $$;
create trigger payroll_line_automatic_sss before insert on public.payroll_lines
for each row execute function public.apply_employee_sss_to_payroll();
