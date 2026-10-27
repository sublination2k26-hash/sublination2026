create table public.attendance_schedule (
  id boolean primary key default true check (id),
  am_start time(0) not null default '08:00', am_end time(0) not null default '12:00',
  pm_start time(0) not null default '13:00', pm_end time(0) not null default '17:00',
  grace_minutes integer not null default 0 check (grace_minutes between 0 and 120),
  deduct_late boolean not null default true, deduct_undertime boolean not null default true,
  check (am_start<am_end and am_end<=pm_start and pm_start<pm_end)
);
insert into public.attendance_schedule(id) values(true);
alter table public.attendance_schedule enable row level security;
revoke all on public.attendance_schedule from anon,authenticated;
grant select,update on public.attendance_schedule to authenticated;
create policy "staff read schedule" on public.attendance_schedule for select to authenticated using (public.current_app_role() is not null);
create policy "admins update schedule" on public.attendance_schedule for update to authenticated
  using (public.current_app_role()='admin') with check (public.current_app_role()='admin');

-- Non-sewing employees clock AM/PM sessions; sewing output payroll remains separate.
create table public.employee_attendance_qr (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  payment_method text not null default 'Cash' check (length(trim(payment_method)) between 1 and 100),
  created_at timestamptz not null default now()
);
alter table public.employee_attendance_qr enable row level security;
revoke all on public.employee_attendance_qr from anon, authenticated;
grant select, delete on public.employee_attendance_qr to authenticated;
create policy "admins manage attendance QR" on public.employee_attendance_qr for all to authenticated
using (public.has_any_role(array['admin']::public.app_role[]))
with check (public.has_any_role(array['admin']::public.app_role[]));

alter table public.employee_attendance
  add column scheduled_am_start time(0), add column scheduled_am_end time(0),
  add column scheduled_pm_start time(0), add column scheduled_pm_end time(0),
  add column scheduled_minutes numeric(8,2) not null default 480 check (scheduled_minutes>0),
  add column paid_minutes numeric(8,2),
  add column scheduled_grace_minutes integer not null default 0,
  add column scheduled_deduct_late boolean not null default true,
  add column scheduled_deduct_undertime boolean not null default true,
  add column am_in time(0), add column am_out time(0),
  add column pm_in time(0), add column pm_out time(0),
  add column attendance_method text not null default 'hours' check (attendance_method in ('hours','time_log')),
  add column daily_rate_snapshot numeric(12,2) check (daily_rate_snapshot >= 0 and daily_rate_snapshot <> 'NaN'::numeric),
  add column deductions numeric(12,2) generated always as
    (case when daily_rate_snapshot is null then null else round(greatest(0,daily_rate_snapshot*(1-least(coalesce(paid_minutes,hours*60),scheduled_minutes)/scheduled_minutes)),2) end) stored,
  add column net_pay numeric(12,2) generated always as
    (case when daily_rate_snapshot is null then null else round(daily_rate_snapshot*least(coalesce(paid_minutes,hours*60),scheduled_minutes)/scheduled_minutes,2) end) stored,
  add constraint attendance_am_order check (am_out is null or (am_in is not null and am_out > am_in)),
  add constraint attendance_pm_order check (pm_out is null or (pm_in is not null and pm_out > pm_in)),
  add constraint attendance_sessions_order check (pm_in is null or am_out is null or pm_in >= am_out);
create index employee_attendance_date_idx on public.employee_attendance(work_date,employee_id);

-- Calculates paid minutes within each scheduled session; lunch and overtime are excluded.
create or replace function public.calculate_attendance_time()
returns trigger language plpgsql set search_path=public as $$
declare v_rate numeric; v_frequency text; v_role public.app_role; v_schedule public.attendance_schedule;
begin
  if new.am_in is not null or new.am_out is not null or new.pm_in is not null or new.pm_out is not null then
    new.attendance_method := 'time_log';
  end if;
  if tg_op='UPDATE' and old.attendance_method='time_log' then new.attendance_method := 'time_log'; end if;
  if new.attendance_method='time_log' then
    select p.role,c.base_rate,c.pay_frequency into v_role,v_rate,v_frequency
      from public.profiles p left join public.employee_compensation c on c.employee_id=p.id
      where p.id=new.employee_id and p.active;
    if v_role is null or v_role in ('admin','cutting_sewing') then raise exception 'Time attendance is for active non-sewing employees only.'; end if;
    if tg_op='UPDATE' and old.daily_rate_snapshot is not null then
      new.daily_rate_snapshot:=old.daily_rate_snapshot;
    else
      if v_rate is null or v_frequency<>'daily' then raise exception 'Configure the employee daily salary first in QR Management.'; end if;
      new.daily_rate_snapshot:=v_rate;
    end if;
    if tg_op='UPDATE' and old.scheduled_am_start is not null then
      new.scheduled_am_start:=old.scheduled_am_start; new.scheduled_am_end:=old.scheduled_am_end;
      new.scheduled_pm_start:=old.scheduled_pm_start; new.scheduled_pm_end:=old.scheduled_pm_end;
      new.scheduled_minutes:=old.scheduled_minutes;
      new.scheduled_grace_minutes:=old.scheduled_grace_minutes;
      new.scheduled_deduct_late:=old.scheduled_deduct_late; new.scheduled_deduct_undertime:=old.scheduled_deduct_undertime;
    else
      select * into strict v_schedule from public.attendance_schedule where id;
      new.scheduled_grace_minutes:=v_schedule.grace_minutes;
      new.scheduled_deduct_late:=v_schedule.deduct_late; new.scheduled_deduct_undertime:=v_schedule.deduct_undertime;
      new.scheduled_am_start:=v_schedule.am_start; new.scheduled_am_end:=v_schedule.am_end;
      new.scheduled_pm_start:=v_schedule.pm_start; new.scheduled_pm_end:=v_schedule.pm_end;
      new.scheduled_minutes:=extract(epoch from ((v_schedule.am_end-v_schedule.am_start)+(v_schedule.pm_end-v_schedule.pm_start)))/60;
    end if;
    new.paid_minutes:=(
      case when new.am_in is not null and new.am_out is not null and new.am_out>new.scheduled_am_start and new.am_in<new.scheduled_am_end
        then greatest(0,extract(epoch from ((case when new.scheduled_deduct_undertime then least(new.am_out,new.scheduled_am_end) else new.scheduled_am_end end)
          -(case when not new.scheduled_deduct_late or extract(epoch from (new.am_in-new.scheduled_am_start))<=new.scheduled_grace_minutes*60
            then new.scheduled_am_start else greatest(new.am_in,new.scheduled_am_start) end)))/60) else 0 end
      + case when new.pm_in is not null and new.pm_out is not null and new.pm_out>new.scheduled_pm_start and new.pm_in<new.scheduled_pm_end
        then greatest(0,extract(epoch from ((case when new.scheduled_deduct_undertime then least(new.pm_out,new.scheduled_pm_end) else new.scheduled_pm_end end)
          -(case when not new.scheduled_deduct_late or extract(epoch from (new.pm_in-new.scheduled_pm_start))<=new.scheduled_grace_minutes*60
            then new.scheduled_pm_start else greatest(new.pm_in,new.scheduled_pm_start) end)))/60) else 0 end
    );
    new.hours:=round(new.paid_minutes/60,2);
  end if;
  return new;
end $$;
create trigger attendance_calculate_time before insert or update on public.employee_attendance
for each row execute function public.calculate_attendance_time();

-- All writers and payroll creation take the table lock before the shared advisory lock.
-- This also prevents a late attendance insert from racing with payroll snapshots.
create or replace function public.guard_attendance_period()
returns trigger language plpgsql set search_path=public as $$
begin
  perform pg_advisory_xact_lock(7261027);
  if exists(select 1 from public.payroll_runs where new.work_date between period_start and period_end) then
    raise exception 'Attendance for an existing payroll period is locked. Use a payroll adjustment for corrections.';
  end if;
  return new;
end $$;

create or replace function public.save_attendance_qr(p_employee_id uuid,p_daily_rate numeric,p_payment_method text default 'Cash',p_rotate boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_token uuid;
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Only an active admin can manage employee QR codes.'; end if;
  if not exists(select 1 from public.profiles where id=p_employee_id and active and role not in ('admin','cutting_sewing')) then raise exception 'Choose an active non-sewing employee.'; end if;
  if p_daily_rate is null or p_daily_rate<0 or p_daily_rate='NaN'::numeric or p_daily_rate>9999999999.99 then raise exception 'Enter a valid daily salary.'; end if;
  if p_payment_method is null or length(trim(p_payment_method)) not between 1 and 100 then raise exception 'Enter a payment method.'; end if;
  insert into public.employee_compensation(employee_id,salary_basis,pay_frequency,base_rate,piece_rate,updated_by)
    values(p_employee_id,'fixed','daily',p_daily_rate,0,auth.uid())
    on conflict(employee_id) do update set salary_basis='fixed',pay_frequency='daily',base_rate=excluded.base_rate,piece_rate=0,updated_by=auth.uid(),updated_at=now();
  insert into public.employee_attendance_qr(employee_id,payment_method) values(p_employee_id,trim(p_payment_method))
    on conflict(employee_id) do update set payment_method=excluded.payment_method,
      token=case when p_rotate then gen_random_uuid() else employee_attendance_qr.token end
    returning token into v_token;
  return v_token;
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
      notes=excluded.notes,attendance_method='time_log',recorded_by=auth.uid();
end $$;

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
  insert into public.employee_attendance(employee_id,work_date,hours,am_in,am_out,pm_in,pm_out,notes,recorded_by,attendance_method)
  values(v_employee,v_now::date,0,
    case when p_action='am_in' then v_time else v_log.am_in end,
    case when p_action='am_out' then v_time else v_log.am_out end,
    case when p_action='pm_in' then v_time else v_log.pm_in end,
    case when p_action='pm_out' then v_time else v_log.pm_out end,v_log.notes,auth.uid(),'time_log')
  on conflict(employee_id,work_date) do update set am_in=excluded.am_in,am_out=excluded.am_out,pm_in=excluded.pm_in,pm_out=excluded.pm_out,recorded_by=auth.uid();
  select id into v_employee from public.employee_attendance where employee_id=v_employee and work_date=v_now::date;
  return v_employee;
end $$;

revoke all on function public.save_attendance_qr(uuid,numeric,text,boolean) from public,anon;
revoke all on function public.save_attendance_log(uuid,date,time,time,time,time,text) from public,anon;
revoke all on function public.clock_attendance_qr(uuid,text) from public,anon;
grant execute on function public.save_attendance_qr(uuid,numeric,text,boolean) to authenticated;
grant execute on function public.save_attendance_log(uuid,date,time,time,time,time,text) to authenticated;
grant execute on function public.clock_attendance_qr(uuid,text) to authenticated;

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
    where a.work_date between p_start and p_end and a.payroll_run_id is null and p.active
      and p.role not in ('admin','cutting_sewing') and a.attendance_method='time_log'
      and ((a.am_in is not null and a.am_out is null) or (a.pm_in is not null and a.pm_out is null))) then
    raise exception 'Complete or correct open attendance sessions before creating payroll.';
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
      and v_employee.role<>'cutting_sewing';
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
    where a.work_date between p_start and p_end and a.payroll_run_id is null
      and exists(select 1 from public.employee_compensation c join public.profiles p on p.id=c.employee_id
        where c.employee_id=a.employee_id and p.active and p.role not in ('admin','cutting_sewing'));
  return v_run_id;
end $$;

revoke all on function public.create_payroll_run(date,date) from public;
grant execute on function public.create_payroll_run(date,date) to authenticated;



create policy "employees read own QR" on public.employee_attendance_qr for select to authenticated
  using (employee_id=auth.uid() and public.current_app_role() is not null);
create policy "employees read own attendance" on public.employee_attendance for select to authenticated
  using (employee_id=auth.uid() and public.current_app_role() is not null);
create policy "employees read own compensation" on public.employee_compensation for select to authenticated
  using (employee_id=auth.uid() and public.current_app_role() is not null);
grant select on public.employee_compensation,public.employee_attendance to authenticated;
