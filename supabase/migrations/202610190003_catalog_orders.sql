-- Create and edit job orders from the admin-managed active product catalog.
create or replace function public.create_catalog_order(
  p_customer_name text,
  p_phone text,
  p_product_id uuid,
  p_quantity integer,
  p_due_date date,
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
  v_product public.products%rowtype;
  v_total numeric(12,2);
  v_stage public.task_stage;
begin
  if not public.has_any_role(array['admin','front_desk']::public.app_role[]) then
    raise exception 'Only admin or front desk can create orders.';
  end if;
  if trim(coalesce(p_customer_name,'')) = '' or p_quantity < 1 then
    raise exception 'Customer name and a valid quantity are required.';
  end if;
  select * into v_product from public.products where id=p_product_id and active=true;
  if not found then raise exception 'Choose an active product from the catalog.'; end if;

  v_total := round(p_quantity * v_product.base_price, 2);
  if coalesce(p_deposit,0) < 0 or coalesce(p_deposit,0) > v_total then
    raise exception 'Deposit must be between zero and the order total.';
  end if;

  select id into v_customer_id from public.customers
  where lower(full_name)=lower(trim(p_customer_name))
    and coalesce(phone,'')=coalesce(nullif(trim(p_phone),''),'')
  order by created_at limit 1;
  if v_customer_id is null then
    insert into public.customers(full_name,phone,created_by)
    values(trim(p_customer_name),nullif(trim(p_phone),''),auth.uid()) returning id into v_customer_id;
  end if;

  insert into public.orders(customer_id,due_date,status,subtotal,total,notes,created_by)
  values(v_customer_id,p_due_date,'pending',v_total,v_total,nullif(trim(p_notes),''),auth.uid())
  returning id into v_order_id;
  insert into public.order_items(order_id,product_id,product_name,production_type,quantity,unit_price,customization,notes)
  values(v_order_id,v_product.id,v_product.name,v_product.production_type,p_quantity,v_product.base_price,
    jsonb_build_object('names',coalesce(p_names,'')),nullif(trim(p_notes),'')) returning id into v_item_id;

  foreach v_stage in array array['layout','printing','heat_press','cutting','sewing','qc']::public.task_stage[] loop
    if v_product.production_type <> 'print_only' or v_stage not in ('cutting','sewing') then
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
language plpgsql security invoker set search_path = public
as $$
declare
  v_customer_id uuid;
  v_item_id uuid;
  v_product public.products%rowtype;
  v_total numeric(12,2);
  v_paid numeric(12,2);
begin
  if public.current_app_role() <> 'admin' then raise exception 'Only admins can edit orders.'; end if;
  if trim(coalesce(p_customer_name,'')) = '' or p_quantity < 1 then
    raise exception 'Customer name and a valid quantity are required.';
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

grant execute on function public.create_catalog_order(text,text,uuid,integer,date,numeric,text,text) to authenticated;
grant execute on function public.update_catalog_order(uuid,text,text,uuid,integer,date,text,text) to authenticated;
