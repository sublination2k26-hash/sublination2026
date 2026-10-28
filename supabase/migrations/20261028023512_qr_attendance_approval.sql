-- Existing attendance remains approved, preserving historical payroll.
alter table public.employee_attendance
  add column approval_status text not null default 'approved' check (approval_status in ('pending','approved','rejected')),
  add column reviewed_by uuid references public.profiles(id),
  add column reviewed_at timestamptz;

create or replace function public.review_attendance_log(p_log_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Only an active admin can review attendance.'; end if;
  if p_status is null or p_status not in ('approved','rejected') then raise exception 'Choose approve or reject.'; end if;
  lock table public.employee_attendance in share row exclusive mode;
  perform pg_advisory_xact_lock(7261027);
  update public.employee_attendance set approval_status=p_status,reviewed_by=auth.uid(),reviewed_at=now()
    where id=p_log_id and approval_status='pending' and payroll_run_id is null;
  if not found then raise exception 'Attendance is no longer pending or is locked in payroll. Refresh the logs.'; end if;
end $$;
revoke all on function public.review_attendance_log(uuid,text) from public,anon;
grant execute on function public.review_attendance_log(uuid,text) to authenticated;


create or replace function public.clock_attendance_qr(p_token uuid,p_action text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_log public.employee_attendance; v_schedule public.attendance_schedule; v_actor public.app_role; v_now timestamp := clock_timestamp() at time zone 'Asia/Manila'; v_time time(0);
begin
  v_actor:=public.current_app_role();
  if v_actor is null or v_actor='cutting_sewing' then raise exception 'An active attendance employee account is required.'; end if;
  if p_action is null or p_action not in ('am_in','am_out','pm_in','pm_out') then raise exception 'Select an AM or PM clock action.'; end if;
  select q.employee_id into v_employee from public.employee_attendance_qr q join public.profiles p on p.id=q.employee_id
    where q.token=p_token and (v_actor='admin' or q.employee_id=auth.uid()) and p.active and p.role not in ('admin','cutting_sewing') for update of q;
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
  insert into public.employee_attendance(employee_id,work_date,hours,am_in,am_out,pm_in,pm_out,notes,recorded_by,attendance_method,approval_status)
  values(v_employee,v_now::date,0,
    case when p_action='am_in' then v_time else v_log.am_in end,
    case when p_action='am_out' then v_time else v_log.am_out end,
    case when p_action='pm_in' then v_time else v_log.pm_in end,
    case when p_action='pm_out' then v_time else v_log.pm_out end,v_log.notes,auth.uid(),'time_log','pending')
  on conflict(employee_id,work_date) do update set approval_status='pending',reviewed_by=null,reviewed_at=null,am_in=excluded.am_in,am_out=excluded.am_out,pm_in=excluded.pm_in,pm_out=excluded.pm_out,recorded_by=auth.uid();
  select id into v_employee from public.employee_attendance where employee_id=v_employee and work_date=v_now::date;
  return v_employee;
end $$;

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
  insert into public.employee_attendance(employee_id,work_date,hours,am_in,am_out,pm_in,pm_out,notes,recorded_by,attendance_method,approval_status)
  values(v_employee,v_now::date,0,
    case when p_action='am_in' then v_time else v_log.am_in end,
    case when p_action='am_out' then v_time else v_log.am_out end,
    case when p_action='pm_in' then v_time else v_log.pm_in end,
    case when p_action='pm_out' then v_time else v_log.pm_out end,v_log.notes,null,'time_log','pending')
  on conflict(employee_id,work_date) do update set approval_status='pending',reviewed_by=null,reviewed_at=null,am_in=excluded.am_in,am_out=excluded.am_out,pm_in=excluded.pm_in,pm_out=excluded.pm_out,recorded_by=null;
  return;
end $$;

create or replace function public.save_attendance_log(p_employee_id uuid,p_work_date date,p_am_in time,p_am_out time,p_pm_in time,p_pm_out time,p_notes text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Only an active admin can record attendance.'; end if;
  if p_work_date is null or p_work_date > (now() at time zone 'Asia/Manila')::date then raise exception 'Choose today or an earlier work date.'; end if;
  lock table public.employee_attendance in share row exclusive mode;
  perform pg_advisory_xact_lock(7261027);
  insert into public.employee_attendance(employee_id,work_date,hours,am_in,am_out,pm_in,pm_out,notes,recorded_by,attendance_method)
    values(p_employee_id,p_work_date,0,p_am_in,p_am_out,p_pm_in,p_pm_out,p_notes,auth.uid(),'time_log')
    on conflict(employee_id,work_date) do update set
      am_in=excluded.am_in,am_out=excluded.am_out,pm_in=excluded.pm_in,pm_out=excluded.pm_out,
      notes=excluded.notes,attendance_method='time_log',recorded_by=auth.uid(),
      approval_status='approved',reviewed_by=auth.uid(),reviewed_at=now();
end $$;

create or replace function public.create_payroll_run(p_start date,p_end date)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_run_id uuid;
  v_employee record;
  v_days numeric;
  v_workdays numeric;
  v_units numeric;
  v_production numeric;
  v_base numeric;
  v_hours numeric;
  v_attendance_pay numeric;
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Only an active admin can prepare payroll.'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Payroll end date must be on or after the start date.'; end if;
  lock table public.employee_attendance, public.employee_work_records in share row exclusive mode;
  perform pg_advisory_xact_lock(7261027);
  if exists(select 1 from public.payroll_runs where period_start<=p_end and period_end>=p_start) then
    raise exception 'This period overlaps an existing payroll run.';
  end if;
  if exists(select 1 from public.employee_attendance a join public.profiles p on p.id=a.employee_id
    join public.employee_compensation c on c.employee_id=p.id
    where a.work_date between p_start and p_end and a.payroll_run_id is null and a.approval_status='approved' and p.active
      and p.role not in ('admin','cutting_sewing') and a.attendance_method='time_log'
      and ((a.am_in is not null and a.am_out is null) or (a.pm_in is not null and a.pm_out is null))) then
    raise exception 'Complete or correct open attendance sessions before creating payroll.';
  end if;
  if exists(select 1 from public.employee_attendance a join public.profiles p on p.id=a.employee_id
    join public.employee_compensation c on c.employee_id=p.id
    where a.work_date between p_start and p_end and a.approval_status='pending'
      and p.active and p.role not in ('admin','cutting_sewing')) then
    raise exception 'Review pending QR attendance before creating payroll.';
  end if;
  v_days := (p_end-p_start)+1;
  insert into public.payroll_runs(period_start,period_end,created_by) values(p_start,p_end,auth.uid()) returning id into v_run_id;
  for v_employee in
    select p.id,p.role,case when p.role='cutting_sewing' then c.salary_basis else 'fixed' end as salary_basis,c.pay_frequency,c.base_rate
    from public.profiles p join public.employee_compensation c on c.employee_id=p.id
    where p.active=true and p.role<>'admin'
  loop
    select coalesce(sum(quantity) filter (where pay_eligible),0),
           coalesce(sum(quantity*unit_rate) filter (where pay_eligible),0),
           count(distinct work_date)
      into v_units,v_production,v_workdays
    from public.employee_work_records
    where employee_id=v_employee.id and work_date between p_start and p_end
      and status='approved' and payroll_run_id is null
      and v_employee.role='cutting_sewing' and role='cutting_sewing'
      and activity='Sewing completed';
    select coalesce(sum(hours),0),coalesce(sum(case when daily_rate_snapshot is not null then net_pay
      else round(v_employee.base_rate*hours/8 / case v_employee.pay_frequency
        when 'weekly' then 7 when 'semi_monthly' then 15 when 'monthly' then 30 else 1 end,2) end),0)
      into v_hours,v_attendance_pay from public.employee_attendance
      where employee_id=v_employee.id and work_date between p_start and p_end and payroll_run_id is null
      and approval_status='approved' and v_employee.role<>'cutting_sewing';
    if v_employee.pay_frequency='daily' then v_base:=v_employee.base_rate*v_workdays;
    elsif v_employee.pay_frequency='weekly' then v_base:=v_employee.base_rate*v_days/7;
    elsif v_employee.pay_frequency='semi_monthly' then v_base:=v_employee.base_rate*v_days/15;
    else v_base:=v_employee.base_rate*v_days/30; end if;
    if v_employee.role<>'cutting_sewing' then
      v_base:=v_attendance_pay;
    end if;
    if v_employee.salary_basis='piece' then v_base:=0; else v_base:=round(v_base,2); end if;
    if v_employee.salary_basis='fixed' then v_production:=0; else v_production:=round(v_production,2); end if;
    insert into public.payroll_lines(payroll_run_id,employee_id,role,salary_basis,pay_frequency,base_pay,approved_units,production_pay,attendance_hours,total_pay)
    values(v_run_id,v_employee.id,v_employee.role,v_employee.salary_basis,v_employee.pay_frequency,v_base,v_units,v_production,v_hours,v_base+v_production);
  end loop;
  update public.employee_work_records w set payroll_run_id=v_run_id
  where w.role='cutting_sewing' and w.activity='Sewing completed' and w.work_date between p_start and p_end and w.status='approved' and w.payroll_run_id is null
    and exists(select 1 from public.employee_compensation c join public.profiles p on p.id=c.employee_id
      where c.employee_id=w.employee_id and p.active=true and p.role='cutting_sewing');
  update public.employee_attendance a set payroll_run_id=v_run_id
    where a.work_date between p_start and p_end and a.payroll_run_id is null and a.approval_status='approved'
      and exists(select 1 from public.employee_compensation c join public.profiles p on p.id=c.employee_id
        where c.employee_id=a.employee_id and p.active and p.role not in ('admin','cutting_sewing'));
  return v_run_id;
end $$;
