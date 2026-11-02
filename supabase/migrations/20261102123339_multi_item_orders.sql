-- Save all line items, their production routes and one deposit atomically.
create function public.create_catalog_order_items(
  p_customer_name text, p_phone text, p_facebook_account text, p_items jsonb,
  p_due_date date, p_payment_due_date date, p_deposit numeric,
  p_deposit_date date, p_notes text
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_order_id uuid; v_item_id uuid; v_item jsonb; v_index integer := 0;
  v_product public.products%rowtype; v_quantity integer;
  v_service text; v_stage public.task_stage; v_total numeric(12,2);
begin
  if auth.uid() is null or not coalesce(public.has_any_role(array['admin','front_desk']::public.app_role[]),false) then
    raise exception 'Only admin or front desk can create orders.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Add at least one order item.';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Add between 1 and 100 order items.';
  end if;
  if p_deposit is null or p_deposit < 0 or p_deposit = 'NaN'::numeric or round(p_deposit,2) <> p_deposit then
    raise exception 'Deposit must be a valid nonnegative amount.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'quantity','') !~ '^[1-9][0-9]*$' then
      raise exception 'Every item requires a positive whole quantity.';
    end if;
    v_quantity := (v_item->>'quantity')::integer;
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and active;
    if not found then raise exception 'Choose an active product for every item.'; end if;
    v_service := coalesce(v_product.production_service,case when v_product.production_type='print_only' then 'subcon_press' else 'full_garment' end);
    if v_index = 0 then
      v_order_id := public.create_catalog_order_with_contact(p_customer_name,p_phone,v_product.id,v_quantity,
        p_due_date,0,coalesce(v_item->>'names',''),p_notes,p_facebook_account);
      select id into v_item_id from public.order_items where order_id=v_order_id;
    else
      insert into public.order_items(order_id,product_id,product_name,production_type,quantity,unit_price,notes)
      values(v_order_id,v_product.id,v_product.name,v_product.production_type,v_quantity,v_product.base_price,nullif(v_item->>'notes',''))
      returning id into v_item_id;
      foreach v_stage in array public.service_production_stages(v_service) loop
        insert into public.production_tasks(order_id,order_item_id,stage,status)
        values(v_order_id,v_item_id,v_stage,'pending');
      end loop;
    end if;
    update public.order_items set customization = customization || jsonb_build_object(
      'intake_index',v_index,'garment',coalesce(v_item->>'garment',''),
      'names',coalesce(v_item->>'names',''),'roster',coalesce(v_item->'roster','[]'::jsonb),
      'production_service',v_service,'payment_due_date',p_payment_due_date)
      where id=v_item_id;
    v_index := v_index + 1;
  end loop;
  select sum(line_total) into v_total from public.order_items where order_id=v_order_id;
  update public.orders set subtotal=v_total,total=v_total where id=v_order_id;
  if p_deposit > v_total then raise exception 'Deposit exceeds the order total.'; end if;
  if p_deposit > 0 then
    if p_deposit_date is null then raise exception 'Choose the down payment date.'; end if;
    insert into public.payments(order_id,amount,method,notes,received_by,payment_on,payment_kind)
    values(v_order_id,p_deposit,'cash','Initial down payment',auth.uid(),p_deposit_date,'down_payment');
  end if;
  return v_order_id;
end;
$$;
revoke all on function public.create_catalog_order_items(text,text,text,jsonb,date,date,numeric,date,text) from public,anon;
grant execute on function public.create_catalog_order_items(text,text,text,jsonb,date,date,numeric,date,text) to authenticated;

create or replace function public.update_catalog_order(
  p_order_id uuid,
  p_customer_name text,
  p_phone text,
  p_product_id uuid,
  p_quantity integer,
  p_due_date date,
  p_names text,
  p_notes text
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_item_id uuid;
  v_product public.products%rowtype;
  v_total numeric(12,2);
  v_paid numeric(12,2);
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Only admins can edit orders.'; end if;
  if trim(coalesce(p_customer_name,'')) = '' or p_quantity < 1 then
    raise exception 'Customer name and a valid quantity are required.';
  end if;
  -- General edits to a mixed order preserve its saved line prices and quantities.
  perform 1 from public.orders where id=p_order_id for update;
  if (select count(*) from public.order_items where order_id=p_order_id) > 1 then
    update public.customers set full_name=trim(p_customer_name),phone=nullif(trim(p_phone),'')
      where id=(select customer_id from public.orders where id=p_order_id);
    update public.orders set due_date=p_due_date,notes=nullif(trim(p_notes),''),updated_at=now()
      where id=p_order_id;
    return;
  end if;
  select * into v_product from public.products where id=p_product_id and active=true;
  if not found then raise exception 'Choose an active product from the catalog.'; end if;
  v_total := round(p_quantity * v_product.base_price,2);
  select customer_id into v_customer_id from public.orders where id=p_order_id;
  if v_customer_id is null then raise exception 'Order not found.'; end if;
  select coalesce(sum(amount),0) into v_paid from public.payments where order_id=p_order_id;
  if v_total < v_paid then raise exception 'Order total cannot be lower than payments already recorded.'; end if;
  update public.customers set full_name=trim(p_customer_name),phone=nullif(trim(p_phone),'') where id=v_customer_id;
  update public.orders set due_date=p_due_date,subtotal=v_total,total=v_total,notes=nullif(trim(p_notes),''),updated_at=now() where id=p_order_id;
  select id into v_item_id from public.order_items where order_id=p_order_id order by created_at limit 1;
  if v_item_id is null then raise exception 'Order item not found.'; end if;
  update public.order_items set product_id=v_product.id,product_name=v_product.name,production_type=v_product.production_type,
    quantity=p_quantity,unit_price=v_product.base_price,customization=jsonb_build_object('names',coalesce(p_names,'')),
    notes=nullif(trim(p_notes), '') where id=v_item_id;
end;
$$;


create or replace function public.approve_dashboard_qc(p_order_id uuid) returns void
language plpgsql security invoker set search_path=''
as $$
declare
  v_qc_id uuid;
  v_task_id uuid;
begin
  if not coalesce(public.has_any_role(array['admin','qc']::public.app_role[]),false) then raise exception 'Only QC or admin can approve an inspection.'; end if;
  perform 1 from public.orders where id=p_order_id for update;
  if exists(select 1 from public.production_tasks where order_id=p_order_id and stage <> 'qc' and status <> 'completed') then
    raise exception 'Complete production for all order items before QC approval.';
  end if;
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
  where order_id=p_order_id and stage='qc' and status <> 'completed';
end;
$$;


revoke all on function public.update_catalog_order(uuid,text,text,uuid,integer,date,text,text),
  public.approve_dashboard_qc(uuid) from public,anon;
grant execute on function public.update_catalog_order(uuid,text,text,uuid,integer,date,text,text),
  public.approve_dashboard_qc(uuid) to authenticated;

notify pgrst, 'reload schema';
