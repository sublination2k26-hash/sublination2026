begin;

-- Only the guarded RPC may delete payroll runs; other run changes use RPCs too.
drop policy if exists "admins manage payroll runs" on public.payroll_runs;
create policy "admins read payroll runs" on public.payroll_runs
  for select to authenticated
  using (public.has_any_role(array['admin']::public.app_role[]));

-- Preserve recorded attendance hours when a payroll link is assigned or cleared.
drop trigger if exists attendance_calculate_time on public.employee_attendance;
drop trigger if exists attendance_calculate_time_insert on public.employee_attendance;
drop trigger if exists attendance_calculate_time_update on public.employee_attendance;
create trigger attendance_calculate_time_insert
  before insert on public.employee_attendance
  for each row execute function public.calculate_attendance_time();
create trigger attendance_calculate_time_update
  before update on public.employee_attendance
  for each row
  when (old.payroll_run_id is not distinct from new.payroll_run_id)
  execute function public.calculate_attendance_time();

-- Only the delete-draft RPC can release records already linked to a run.
create or replace function public.guard_paid_payroll_records()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.payroll_run_id is not null then
    if tg_op = 'UPDATE'
      and new.payroll_run_id is null
      and pg_catalog.current_setting('app.deleting_draft_payroll_run', true) = old.payroll_run_id::text then
      return new;
    end if;
    raise exception 'This record is included in a payroll run and cannot be changed.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create or replace function public.delete_draft_payroll_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an active admin can delete a draft payroll run.';
  end if;

  perform 1 from public.payroll_runs
    where id = p_run_id and status = 'draft'
    for update;
  if not found then raise exception 'Only draft payroll runs can be deleted.'; end if;

  perform pg_catalog.set_config('app.deleting_draft_payroll_run', p_run_id::text, true);

  delete from public.payroll_advance_recoveries r
    using public.payroll_lines l
    where r.payroll_line_id = l.id and l.payroll_run_id = p_run_id;

  delete from public.payroll_runs where id = p_run_id and status = 'draft';
  if not found then raise exception 'Only draft payroll runs can be deleted.'; end if;

  -- Restore source rows after the run is gone so they can be included in a new draft.
  update public.employee_attendance set payroll_run_id = null where payroll_run_id = p_run_id;
  update public.employee_work_records set payroll_run_id = null where payroll_run_id = p_run_id;
end
$$;

revoke all on function public.delete_draft_payroll_run(uuid) from public, anon, authenticated;
grant execute on function public.delete_draft_payroll_run(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
