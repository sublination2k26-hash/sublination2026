-- Service-specific routing applies to new orders; preserve existing task histories.
alter table public.products add column production_service text
  check (production_service in ('full_garment','subcon_print','subcon_press','subcon_sewing'));
update public.products set production_service = case
  when category like 'Sub-con print only - %' then 'subcon_print'
  when category like 'Sub-con print & press - %' then 'subcon_press'
  when category like 'Sub-con with sewing - %' then 'subcon_sewing'
  when production_type = 'print_only' then 'subcon_press'
  else 'full_garment'
end;

create function public.service_production_stages(p_service text) returns public.task_stage[]
language sql immutable security invoker set search_path = '' as $$
  select case p_service
    when 'subcon_print' then array['layout','printing','qc']::public.task_stage[]
    when 'subcon_press' then array['layout','printing','heat_press','qc']::public.task_stage[]
    when 'subcon_sewing' then array['layout','cutting','sewing','qc']::public.task_stage[]
    else array['layout','printing','heat_press','cutting','sewing','qc']::public.task_stage[]
  end;
$$;
revoke all on function public.service_production_stages(text) from public, anon;
grant execute on function public.service_production_stages(text) to authenticated;

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
  v_service text;
begin
  if not public.has_any_role(array['admin','front_desk']::public.app_role[]) then
    raise exception 'Only admin or front desk can create orders.';
  end if;
  if trim(coalesce(p_customer_name,'')) = '' or p_quantity < 1 then
    raise exception 'Customer name and a valid quantity are required.';
  end if;
  select * into v_product from public.products where id=p_product_id and active=true;
  if not found then raise exception 'Choose an active product from the catalog.'; end if;

  v_service := coalesce(v_product.production_service, case when v_product.production_type = 'print_only' then 'subcon_press' else 'full_garment' end);
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
    jsonb_build_object('names',coalesce(p_names,''),'production_service',v_service),nullif(trim(p_notes),'')) returning id into v_item_id;

  foreach v_stage in array public.service_production_stages(v_service) loop
    insert into public.production_tasks(order_id,order_item_id,stage,status)
    values(v_order_id,v_item_id,v_stage,'pending');
  end loop;
  if coalesce(p_deposit,0) > 0 then
    insert into public.payments(order_id,amount,method,notes,received_by)
    values(v_order_id,p_deposit,'cash','Initial down payment',auth.uid());
  end if;
  return v_order_id;
end;
$$;


revoke all on function public.create_catalog_order(text,text,uuid,integer,date,numeric,text,text) from public, anon;
grant execute on function public.create_catalog_order(text,text,uuid,integer,date,numeric,text,text) to authenticated;