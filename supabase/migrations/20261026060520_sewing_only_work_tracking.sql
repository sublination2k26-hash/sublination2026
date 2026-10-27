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
