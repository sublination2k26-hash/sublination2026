-- Shared dashboard persistence helpers. Safe to apply after the initial schema.
alter table public.payments drop constraint if exists payments_order_id_fkey;
alter table public.payments add constraint payments_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete cascade;

create or replace function public.guard_payment_total() returns trigger
language plpgsql set search_path = public
as $$
declare
  v_total numeric(12,2);
  v_paid numeric(12,2);
begin
  select total into v_total from public.orders where id=new.order_id;
  if v_total is null then raise exception 'Order not found.'; end if;
  select coalesce(sum(amount),0) into v_paid from public.payments
    where order_id=new.order_id and id is distinct from new.id;
  if new.amount <= 0 or v_paid + new.amount > v_total then
    raise exception 'Payment exceeds the remaining order balance.';
  end if;
  return new;
end;
$$;
drop trigger if exists payments_total_guard on public.payments;
create trigger payments_total_guard before insert or update of amount,order_id on public.payments
  for each row execute function public.guard_payment_total();

create or replace function public.create_dashboard_order(
  p_customer_name text,
  p_phone text,
  p_product_name text,
  p_production_type text,
  p_quantity integer,
  p_due_date date,
  p_unit_price numeric,
  p_deposit numeric,
  p_names text,
  p_notes text
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_total numeric(12,2);
  v_stage public.task_stage;
begin
  if not public.has_any_role(array['admin','front_desk']::public.app_role[]) then
    raise exception 'Only admin or front desk can create orders.';
  end if;
  if trim(coalesce(p_customer_name,'')) = '' or trim(coalesce(p_product_name,'')) = '' then
    raise exception 'Customer and product names are required.';
  end if;
  if p_quantity < 1 or p_unit_price < 0 or coalesce(p_deposit,0) < 0 then
    raise exception 'Quantity and prices are invalid.';
  end if;
  v_total := round(p_quantity * p_unit_price, 2);
  if coalesce(p_deposit,0) > v_total then raise exception 'Deposit cannot exceed the order total.'; end if;

  select id into v_customer_id from public.customers
  where lower(full_name) = lower(trim(p_customer_name))
    and coalesce(phone,'') = coalesce(nullif(trim(p_phone),''),'')
  order by created_at limit 1;
  if v_customer_id is null then
    insert into public.customers(full_name,phone,created_by)
    values(trim(p_customer_name),nullif(trim(p_phone),''),auth.uid()) returning id into v_customer_id;
  end if;

  insert into public.orders(customer_id,due_date,status,subtotal,total,notes,created_by)
  values(v_customer_id,p_due_date,'pending',v_total,v_total,nullif(trim(p_notes),''),auth.uid())
  returning id into v_order_id;
  insert into public.order_items(order_id,product_name,production_type,quantity,unit_price,customization,notes)
  values(v_order_id,trim(p_product_name),p_production_type,p_quantity,p_unit_price,
    jsonb_build_object('names',coalesce(p_names,'')),nullif(trim(p_notes),'')) returning id into v_item_id;

  foreach v_stage in array array['layout','printing','heat_press','cutting','sewing','qc']::public.task_stage[] loop
    if p_production_type <> 'print_only' or v_stage not in ('cutting','sewing') then
      insert into public.production_tasks(order_id,order_item_id,stage,status)
      values(v_order_id,v_item_id,v_stage,'pending');
    end if;
  end loop;

  if coalesce(p_deposit,0) > 0 then
    insert into public.payments(order_id,amount,method,notes,received_by)
    values(v_order_id,p_deposit,'cash','Initial down payment',auth.uid());
  end if;
  return v_order_id;
end;
$$;

create or replace function public.update_dashboard_order(
  p_order_id uuid,
  p_customer_name text,
  p_phone text,
  p_product_name text,
  p_production_type text,
  p_quantity integer,
  p_due_date date,
  p_unit_price numeric,
  p_names text,
  p_notes text
) returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_customer_id uuid;
  v_item_id uuid;
  v_total numeric(12,2);
  v_paid numeric(12,2);
begin
  if public.current_app_role() <> 'admin' then raise exception 'Only admins can edit orders.'; end if;
  if trim(coalesce(p_customer_name,'')) = '' or trim(coalesce(p_product_name,'')) = '' or p_quantity < 1 or p_unit_price < 0 then
    raise exception 'Order details are invalid.';
  end if;
  v_total := round(p_quantity * p_unit_price, 2);
  select customer_id into v_customer_id from public.orders where id = p_order_id;
  if v_customer_id is null then raise exception 'Order not found.'; end if;
  select coalesce(sum(amount),0) into v_paid from public.payments where order_id = p_order_id;
  if v_total < v_paid then raise exception 'Order total cannot be lower than payments already recorded.'; end if;
  update public.customers set full_name=trim(p_customer_name),phone=nullif(trim(p_phone),'') where id=v_customer_id;
  update public.orders set due_date=p_due_date,subtotal=v_total,total=v_total,notes=nullif(trim(p_notes),''),updated_at=now() where id=p_order_id;
  select id into v_item_id from public.order_items where order_id=p_order_id order by created_at limit 1;
  if v_item_id is null then raise exception 'Order item not found.'; end if;
  update public.order_items set product_name=trim(p_product_name),production_type=p_production_type,
    quantity=p_quantity,unit_price=p_unit_price,customization=jsonb_build_object('names',coalesce(p_names,'')),notes=nullif(trim(p_notes), '')
    where id=v_item_id;
end;
$$;

create or replace function public.approve_dashboard_qc(p_order_id uuid) returns void
language plpgsql security invoker set search_path = public
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
  update public.production_tasks set status='completed',completed_at=now(),updated_at=now() where id=v_task_id;
end;
$$;

grant execute on function public.create_dashboard_order(text,text,text,text,integer,date,numeric,numeric,text,text) to authenticated;
grant execute on function public.update_dashboard_order(uuid,text,text,text,text,integer,date,numeric,text,text) to authenticated;
grant execute on function public.approve_dashboard_qc(uuid) to authenticated;
