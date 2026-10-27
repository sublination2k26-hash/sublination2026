-- A valid employee QR token authorizes one current-time attendance action.
-- No employee identity, salary, token list, or attendance history is returned.
create or replace function public.public_clock_attendance_qr(p_token uuid,p_action text)
returns void language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_log public.employee_attendance; v_schedule public.attendance_schedule; v_now timestamp := clock_timestamp() at time zone 'Asia/Manila'; v_time time(0);
begin
  if p_action is null or p_action not in ('am_in','am_out','pm_in','pm_out') then raise exception 'Select an AM or PM clock action.'; end if;
  select q.employee_id into v_employee from public.employee_attendance_qr q join public.profiles p on p.id=q.employee_id
    where q.token=p_token and p.active and p.role not in ('admin','cutting_sewing') for update of q;
  if not found then raise exception 'QR code is invalid, disabled, or belongs to an inactive employee.'; end if;
  v_time:=v_now::time(0);
  select * into strict v_schedule from public.attendance_schedule where id;
  lock table public.employee_attendance in share row exclusive mode;
  perform pg_advisory_xact_lock(7261027);
  select * into v_log from public.employee_attendance where employee_id=v_employee and work_date=v_now::date;
  if (p_action like 'am_%' and v_time>=coalesce(v_log.scheduled_pm_start,v_schedule.pm_start)) or (p_action like 'pm_%' and v_time<coalesce(v_log.scheduled_am_end,v_schedule.am_end)) then
    raise exception 'Select the clock action for the current session. Use Edit log to correct earlier times.';
  end if;
  if v_log.id is not null and v_log.attendance_method='hours' then raise exception 'This day has a legacy hours entry. Review it with Edit log first.'; end if;
  if (p_action='am_in' and v_log.am_in is not null) or (p_action='am_out' and v_log.am_out is not null)
    or (p_action='pm_in' and v_log.pm_in is not null) or (p_action='pm_out' and v_log.pm_out is not null) then
    raise exception 'This clock action is already recorded for today.';
  end if;
  if p_action='am_out' and v_log.am_in is null then raise exception 'Record AM time in first.'; end if;
  if p_action='pm_out' and v_log.pm_in is null then raise exception 'Record PM time in first.'; end if;
  if p_action='pm_in' and v_log.am_in is not null and v_log.am_out is null then raise exception 'Complete the AM time out first.'; end if;
  insert into public.employee_attendance(employee_id,work_date,hours,am_in,am_out,pm_in,pm_out,notes,recorded_by,attendance_method)
  values(v_employee,v_now::date,0,
    case when p_action='am_in' then v_time else v_log.am_in end,
    case when p_action='am_out' then v_time else v_log.am_out end,
    case when p_action='pm_in' then v_time else v_log.pm_in end,
    case when p_action='pm_out' then v_time else v_log.pm_out end,v_log.notes,null,'time_log')
  on conflict(employee_id,work_date) do update set am_in=excluded.am_in,am_out=excluded.am_out,pm_in=excluded.pm_in,pm_out=excluded.pm_out,recorded_by=null;
  return;
end $$;

revoke all on function public.public_clock_attendance_qr(uuid,text) from public;
grant execute on function public.public_clock_attendance_qr(uuid,text) to anon,authenticated;
