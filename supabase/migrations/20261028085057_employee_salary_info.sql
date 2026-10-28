-- Read-only salary information for all active non-admin employees.
grant select on public.payroll_lines, public.payroll_runs, public.employee_payslips to authenticated;
create policy "employees read own payroll lines" on public.payroll_lines for select to authenticated
  using (employee_id = (select auth.uid()) and public.current_app_role() <> 'admin');
create policy "employees read own payroll periods" on public.payroll_runs for select to authenticated
  using (public.current_app_role() <> 'admin' and exists (
    select 1 from public.payroll_lines l where l.payroll_run_id = payroll_runs.id and l.employee_id = (select auth.uid())
  ));
create policy "employees read own issued payslips" on public.employee_payslips for select to authenticated
  using (employee_id = (select auth.uid()) and public.current_app_role() <> 'admin');
