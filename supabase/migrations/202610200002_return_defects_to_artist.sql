-- Route an order back to Layout and reopen downstream production after a defect.
create or replace function public.return_order_to_artist(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.current_app_role();
  v_order_status public.order_status;
begin
  if v_role is null then
    raise exception 'An active staff account is required.';
  end if;

  select status into v_order_status from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_order_status in ('released','cancelled') then
    raise exception 'Released or cancelled orders cannot be returned to Artist.';
  end if;

  update public.production_tasks
  set status = 'returned_for_correction', started_at = null, completed_at = null, updated_at = now()
  where order_id = p_order_id and stage = 'layout';
  if not found then raise exception 'This order has no Layout task.'; end if;

  update public.production_tasks
  set status = 'pending', started_at = null, completed_at = null, updated_at = now()
  where order_id = p_order_id and stage <> 'layout';

  update public.qc_inspections
  set status = 'pending', quantity_verified = false, sizes_verified = false,
      personalization_verified = false, print_quality_verified = false,
      condition_verified = false, inspected_at = null
  where order_id = p_order_id;

  update public.orders set status = 'in_production', updated_at = now() where id = p_order_id;
end;
$$;

revoke all on function public.return_order_to_artist(uuid) from public;
grant execute on function public.return_order_to_artist(uuid) to authenticated;
