begin;
-- Snapshot garment rates on new sewing work; never recalculate historical payroll.
create table public.sewing_garment_rates (
  employee_id uuid not null references public.profiles(id) on delete cascade,
  garment text not null check(length(trim(garment)) between 1 and 120),
  unit_rate numeric(12,2) not null check(unit_rate >= 0 and unit_rate <> 'NaN'::numeric),
  primary key(employee_id,garment)
);
alter table public.sewing_garment_rates enable row level security;
revoke all on public.sewing_garment_rates from public,anon,authenticated;
grant select,insert,update on public.sewing_garment_rates to authenticated;
create policy "admin manages sewing garment rates" on public.sewing_garment_rates for all to authenticated
using(public.current_app_role()='admin') with check(public.current_app_role()='admin' and exists(select 1 from public.profiles where id=employee_id and role='cutting_sewing' and active));
create policy "sewer reads own garment rates" on public.sewing_garment_rates for select to authenticated
using(employee_id=auth.uid() and public.current_app_role()='cutting_sewing');
create policy "sewer reads own output earnings" on public.employee_work_records for select to authenticated
using(employee_id=auth.uid() and public.current_app_role()='cutting_sewing');

create schema if not exists sewing_pay_private;
revoke all on schema sewing_pay_private from public,anon;
create function sewing_pay_private.snapshot_rate() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_garment text; v_rate numeric; v_basis text;
begin
  if new.role='cutting_sewing' and new.task_id is not null then
    select i.customization->>'garment' into v_garment from public.production_tasks t join public.order_items i on i.id=t.order_item_id where t.id=new.task_id;
    select salary_basis,piece_rate into v_basis,v_rate from public.employee_compensation where employee_id=new.employee_id;
    if v_basis in ('piece','combined') then
      select coalesce((select unit_rate from public.sewing_garment_rates where employee_id=new.employee_id and garment=v_garment),v_rate,0) into new.unit_rate;
    else new.unit_rate:=0;
    end if;
  end if;
  return new;
end $$;

alter table public.order_releases add column pickup_payment_id uuid references public.payments(id), add column pickup_request jsonb;
create function public.record_pickup(p_order_id uuid,p_quantity integer,p_release_on date,p_received_by text,p_notes text,p_exception text,p_amount numeric,p_method public.payment_method,p_request_id uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare v_request jsonb; v_previous public.order_releases%rowtype; v_payment uuid;
begin
  if auth.uid() is null or public.current_app_role() is null or public.current_app_role() not in ('admin','front_desk') then raise exception 'Only admin or front desk can record pickups.'; end if;
  if p_request_id is null or p_amount is null or p_amount<0 or p_amount='NaN'::numeric or round(p_amount,2)<>p_amount then raise exception 'Enter a valid payment amount.'; end if;
  perform 1 from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  v_request:=jsonb_build_object('order',p_order_id,'quantity',p_quantity,'date',p_release_on,'recipient',p_received_by,'notes',p_notes,'exception',p_exception,'amount',p_amount,'method',p_method,'actor',auth.uid());
  select * into v_previous from public.order_releases where id=p_request_id;
  if found then
    if v_previous.pickup_request is distinct from v_request then raise exception 'Request ID already used for a different pickup.'; end if;
    return p_request_id;
  end if;
  if p_amount>0 then
    v_payment:=public.record_customer_payment(p_order_id,p_amount,p_method,'payment',p_release_on,'Payment at pickup: '||coalesce(p_notes,''),p_request_id);
  end if;
  insert into public.order_releases(id,order_id,quantity,release_on,received_by,notes,exception_reason,released_by,pickup_payment_id,pickup_request)
  values(p_request_id,p_order_id,p_quantity,p_release_on,p_received_by,p_notes,p_exception,auth.uid(),v_payment,v_request);
  return p_request_id;
end $$;
revoke all on function public.record_pickup(uuid,integer,date,text,text,text,numeric,public.payment_method,uuid) from public,anon;
grant execute on function public.record_pickup(uuid,integer,date,text,text,text,numeric,public.payment_method,uuid) to authenticated;
notify pgrst,'reload schema';
revoke all on function sewing_pay_private.snapshot_rate() from public,anon,authenticated;
create trigger snapshot_sewing_garment_rate before insert on public.employee_work_records for each row execute function sewing_pay_private.snapshot_rate();

-- A partial pickup may leave an unpaid balance when cumulative payment covers
-- the cumulative released share of the order total (rounded up to cents).
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
  if (not v_qc or v_paid < ceil(v_order.total * (v_released + new.quantity) / v_total * 100) / 100) and not
    (public.current_app_role() = 'admin' and length(trim(new.exception_reason)) > 0) then
    raise exception 'Release blocked: approved QC and payment covering the released pieces are required. An admin may record an exception reason.';
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

commit;
