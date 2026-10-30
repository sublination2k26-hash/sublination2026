-- Pickup date is separate from the immutable time the record was entered.
alter table public.order_releases add column release_on date;
update public.order_releases set release_on = (released_at at time zone 'Asia/Manila')::date;
alter table public.order_releases alter column release_on set default ((now() at time zone 'Asia/Manila')::date), alter column release_on set not null;

create or replace function public.guard_piece_release() returns trigger
language plpgsql set search_path = '' as $$
declare v_order public.orders; v_total bigint; v_released bigint; v_paid numeric; v_qc boolean;
begin
  if auth.uid() is null or public.current_app_role() is null or public.current_app_role() not in ('admin','front_desk') then
    raise exception 'Only admin or front desk can release pieces.';
  end if;
  select * into v_order from public.orders where id = new.order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_order.status in ('released','cancelled') then raise exception 'This order is already released or cancelled.'; end if;
  if v_order.status <> 'ready_for_release' then raise exception 'The order must be ready for release.'; end if;
  select coalesce(sum(quantity),0) into v_total from public.order_items where order_id = new.order_id;
  select coalesce(sum(quantity),0) into v_released from public.order_releases where order_id = new.order_id;
  if new.quantity is null or new.quantity <= 0 or new.quantity > v_total - v_released then
    raise exception 'Release quantity exceeds the remaining pieces or is invalid.';
  end if;
  select coalesce(sum(amount),0) into v_paid from public.payments where order_id = new.order_id;
  select exists(select 1 from public.qc_inspections where order_id = new.order_id and status = 'approved'
    and quantity_verified and sizes_verified and personalization_verified and print_quality_verified and condition_verified) into v_qc;
  if (not v_qc or v_paid < v_order.total) and not
    (public.current_app_role() = 'admin' and length(trim(new.exception_reason)) > 0) then
    raise exception 'Release blocked: approved QC and full payment are required. An admin may record an exception reason.';
  end if;
  if new.release_on is null or not isfinite(new.release_on) then raise exception 'Enter a valid release date.'; end if;
  new.released_by := auth.uid();
  new.released_at := now();
  if v_released + new.quantity = v_total then
    update public.orders set status = 'released', release_date = new.release_on::timestamp at time zone 'Asia/Manila', updated_at = now(),
      release_exception_reason = nullif(trim(new.exception_reason),''),
      release_exception_by = case when not v_qc or v_paid < v_order.total then auth.uid() else null end
      where id = new.order_id;
  end if;
  return new;
end $$;
