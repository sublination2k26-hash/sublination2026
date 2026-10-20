-- Allow staff to route a reported defect back to a selected production stage.
drop function if exists public.return_order_to_artist(uuid);

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
  set status='completed', started_at=coalesce(started_at,now()), completed_at=coalesce(completed_at,now()), updated_at=now()
  where order_id=p_order_id and stage < p_stage;

  update public.production_tasks
  set status='returned_for_correction', started_at=null, completed_at=null, updated_at=now()
  where order_id=p_order_id and stage=p_stage;
  if not found then raise exception 'The selected stage is not part of this order.'; end if;

  update public.production_tasks
  set status='pending', started_at=null, completed_at=null, updated_at=now()
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
