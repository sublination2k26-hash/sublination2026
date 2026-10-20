-- Capture the authenticated employee who completes a production task.
alter table public.production_tasks
  add column if not exists started_by uuid references public.profiles(id),
  add column if not exists completed_by uuid references public.profiles(id);

-- Payroll output is task-based. Legacy attendance data and old payroll snapshots
-- remain stored, but this workflow no longer reads or records attendance hours.

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
  if not found or v_role='admin' then return new; end if;

  if new.order_item_id is not null then
    select quantity into v_quantity from public.order_items where id=new.order_item_id;
    v_quantity := coalesce(v_quantity,1);
  end if;
  select coalesce(piece_rate,0) into v_unit_rate from public.employee_compensation
  where employee_id=new.completed_by and salary_basis in ('piece','combined');
  v_unit_rate := coalesce(v_unit_rate,0);
  select exists(select 1 from public.employee_work_records where task_id=new.id) into v_is_rework;
  v_label := case new.stage
    when 'layout' then 'Design / layout completed'
    when 'printing' then 'Printing completed'
    when 'heat_press' then 'Heat pressing completed'
    when 'cutting' then 'Cutting completed'
    when 'sewing' then 'Sewing completed'
    when 'qc' then 'Quality inspection completed'
  end;

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

drop trigger if exists production_task_work_record on public.production_tasks;
create trigger production_task_work_record after update of status on public.production_tasks
for each row when (new.status='completed' and old.status is distinct from new.status)
execute function public.record_completed_production_task();

-- The QC stage is completed by this RPC, so record its authenticated actor too.
create or replace function public.approve_dashboard_qc(p_order_id uuid) returns void
language plpgsql security invoker set search_path=public
as $$
declare
  v_qc_id uuid;
  v_task_id uuid;
begin
  if not public.has_any_role(array['admin','qc']::public.app_role[]) then raise exception 'Only QC or admin can approve an inspection.'; end if;
  select id into v_qc_id from public.qc_inspections where order_id=p_order_id
    and quantity_verified and sizes_verified and personalization_verified and print_quality_verified and condition_verified
    order by inspected_at desc limit 1;
  if v_qc_id is null then raise exception 'Complete all five QC checks before approval.'; end if;
  if exists(select 1 from public.defects where order_id=p_order_id and correction_status <> 'completed') then
    raise exception 'Resolve all reported defects before QC approval.';
  end if;
  select id into v_task_id from public.production_tasks where order_id=p_order_id and stage='qc' and status <> 'completed' limit 1;
  if v_task_id is null then raise exception 'No active QC task is attached to this order.'; end if;
  update public.qc_inspections set status='approved',inspected_by=auth.uid(),inspected_at=now() where id=v_qc_id;
  update public.production_tasks
  set status='completed',started_at=coalesce(started_at,now()),started_by=coalesce(started_by,auth.uid()),
      completed_by=auth.uid(),completed_at=now(),updated_at=now()
  where id=v_task_id;
end;
$$;

-- Replace payroll calculation with task output and configured salary only.
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
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Only an active admin can prepare payroll.'; end if;
  if p_end < p_start then raise exception 'Payroll end date must be on or after the start date.'; end if;
  if exists(select 1 from public.payroll_runs where period_start<=p_end and period_end>=p_start) then
    raise exception 'This period overlaps an existing payroll run.';
  end if;
  v_days := (p_end-p_start)+1;
  insert into public.payroll_runs(period_start,period_end,created_by) values(p_start,p_end,auth.uid()) returning id into v_run_id;
  for v_employee in
    select p.id,p.role,c.salary_basis,c.pay_frequency,c.base_rate
    from public.profiles p join public.employee_compensation c on c.employee_id=p.id
    where p.active=true and p.role<>'admin'
  loop
    select coalesce(sum(quantity) filter (where pay_eligible),0),
           coalesce(sum(quantity*unit_rate) filter (where pay_eligible),0),
           count(distinct work_date)
      into v_units,v_production,v_workdays
    from public.employee_work_records
    where employee_id=v_employee.id and work_date between p_start and p_end
      and status='approved' and payroll_run_id is null;
    if v_employee.pay_frequency='daily' then v_base:=v_employee.base_rate*v_workdays;
    elsif v_employee.pay_frequency='weekly' then v_base:=v_employee.base_rate*v_days/7;
    elsif v_employee.pay_frequency='semi_monthly' then v_base:=v_employee.base_rate*v_days/15;
    else v_base:=v_employee.base_rate*v_days/30; end if;
    if v_employee.salary_basis='piece' then v_base:=0; else v_base:=round(v_base,2); end if;
    if v_employee.salary_basis='fixed' then v_production:=0; else v_production:=round(v_production,2); end if;
    insert into public.payroll_lines(payroll_run_id,employee_id,role,salary_basis,pay_frequency,base_pay,approved_units,production_pay,total_pay)
    values(v_run_id,v_employee.id,v_employee.role,v_employee.salary_basis,v_employee.pay_frequency,v_base,v_units,v_production,v_base+v_production);
  end loop;
  update public.employee_work_records w set payroll_run_id=v_run_id
  where w.work_date between p_start and p_end and w.status='approved' and w.payroll_run_id is null
    and exists(select 1 from public.employee_compensation c join public.profiles p on p.id=c.employee_id
      where c.employee_id=w.employee_id and p.active=true and p.role<>'admin');
  return v_run_id;
end $$;

grant execute on function public.create_payroll_run(date,date) to authenticated;

-- Defect routing resets task attribution so routing itself cannot create a
-- false completion record; the employee is captured when they complete it again.
create or replace function public.return_order_to_stage(
  p_order_id uuid,
  p_stage public.task_stage
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.current_app_role();
  v_order_status public.order_status;
begin
  if v_role is null then raise exception 'An active staff account is required.'; end if;
  select status into v_order_status from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_order_status in ('released','cancelled') then
    raise exception 'Released or cancelled orders cannot be returned to production.';
  end if;

  update public.production_tasks
  set status='completed', started_at=coalesce(started_at,now()), completed_at=coalesce(completed_at,now()),
      started_by=null, completed_by=null, updated_at=now()
  where order_id=p_order_id and stage < p_stage;

  update public.production_tasks
  set status='returned_for_correction', started_at=null, completed_at=null,
      started_by=null, completed_by=null, updated_at=now()
  where order_id=p_order_id and stage=p_stage;
  if not found then raise exception 'The selected stage is not part of this order.'; end if;

  update public.production_tasks
  set status='pending', started_at=null, completed_at=null,
      started_by=null, completed_by=null, updated_at=now()
  where order_id=p_order_id and stage > p_stage;

  update public.qc_inspections
  set status='pending', quantity_verified=false, sizes_verified=false,
      personalization_verified=false, print_quality_verified=false,
      condition_verified=false, inspected_at=now()
  where order_id=p_order_id;

  update public.orders
  set status=case when p_stage='qc' then 'quality_check'::public.order_status else 'in_production'::public.order_status end,
      updated_at=now()
  where id=p_order_id;
end;
$$;

revoke all on function public.return_order_to_stage(uuid,public.task_stage) from public;
grant execute on function public.return_order_to_stage(uuid,public.task_stage) to authenticated;
