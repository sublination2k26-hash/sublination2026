-- Only sewing completions create new payroll work records.
-- Existing work records and payroll snapshots are preserved; all staff remain in payroll.
create or replace function public.record_completed_production_task()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_role public.app_role;
  v_quantity numeric(12,2) := 1;
  v_unit_rate numeric(12,2) := 0;
  v_is_rework boolean;
  v_label text;
begin
  if old.status='completed' or new.status<>'completed' or new.completed_by is null then return new; end if;

  select role into v_role from public.profiles where id=new.completed_by and active=true;
  if not found or v_role <> 'cutting_sewing' or new.stage <> 'sewing' then return new; end if;

  if new.order_item_id is not null then
    select quantity into v_quantity from public.order_items where id=new.order_item_id;
    v_quantity := coalesce(v_quantity,1);
  end if;
  select coalesce(piece_rate,0) into v_unit_rate from public.employee_compensation
  where employee_id=new.completed_by and salary_basis in ('piece','combined');
  v_unit_rate := coalesce(v_unit_rate,0);
  select exists(select 1 from public.employee_work_records where task_id=new.id) into v_is_rework;
  v_label := 'Sewing completed';

  insert into public.employee_work_records(
    employee_id,order_id,task_id,role,activity,quantity,unit_rate,work_date,
    started_at,completed_at,status,is_rework,pay_eligible,rework_reason,recorded_by
  ) values (
    new.completed_by,new.order_id,new.id,v_role,v_label,v_quantity,v_unit_rate,
    coalesce((new.completed_at at time zone 'Asia/Manila')::date,current_date),new.started_at,coalesce(new.completed_at,now()),
    'pending_review',v_is_rework,not v_is_rework,
    case when v_is_rework then 'Task was completed again after an earlier completion; review as rework.' else null end,
    new.completed_by
  );
  return new;
end $$;


-- Attendance-based earnings for non-sewers. Existing payroll snapshots are preserved.
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
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Only an active admin can prepare payroll.'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Payroll end date must be on or after the start date.'; end if;
  perform pg_advisory_xact_lock(7261027);
  lock table public.employee_attendance, public.employee_work_records in share row exclusive mode;
  if exists(select 1 from public.payroll_runs where period_start<=p_end and period_end>=p_start) then
    raise exception 'This period overlaps an existing payroll run.';
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
    select coalesce(sum(hours),0) into v_hours from public.employee_attendance
      where employee_id=v_employee.id and work_date between p_start and p_end and payroll_run_id is null
      and v_employee.role<>'cutting_sewing';
    if v_employee.pay_frequency='daily' then v_base:=v_employee.base_rate*v_workdays;
    elsif v_employee.pay_frequency='weekly' then v_base:=v_employee.base_rate*v_days/7;
    elsif v_employee.pay_frequency='semi_monthly' then v_base:=v_employee.base_rate*v_days/15;
    else v_base:=v_employee.base_rate*v_days/30; end if;
    if v_employee.role<>'cutting_sewing' then
      v_base:=v_employee.base_rate*v_hours/8 / case v_employee.pay_frequency
        when 'weekly' then 7 when 'semi_monthly' then 15 when 'monthly' then 30 else 1 end;
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


-- Prevent attendance being added to a period whose earnings are already snapshotted.
create or replace function public.guard_attendance_period()
returns trigger language plpgsql set search_path=public as $$
begin
  perform pg_advisory_xact_lock(7261027);
  if exists(select 1 from public.payroll_runs where new.work_date between period_start and period_end) then
    raise exception 'Attendance for an existing payroll period is locked. Use a payroll adjustment for corrections.';
  end if;
  return new;
end $$;
drop trigger if exists attendance_period_lock on public.employee_attendance;
create trigger attendance_period_lock before insert or update of employee_id,work_date,hours,notes on public.employee_attendance
for each row execute function public.guard_attendance_period();
