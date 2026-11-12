-- Keep existing prices and customization when an admin edits order details.
-- One RPC transaction owns the complete edit; clients must not restore stale JSON.
create or replace function public.update_catalog_order(
  p_order_id uuid, p_customer_name text, p_phone text, p_product_id uuid,
  p_quantity integer, p_due_date date, p_names text, p_notes text
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_product public.products%rowtype;
  v_count integer;
  v_price numeric(12,2);
  v_total numeric(12,2);
  v_paid numeric(12,2);
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin' then
    raise exception 'Only admins can edit orders.';
  end if;
  if nullif(trim(p_customer_name),'') is null or p_quantity is null or p_quantity < 1 then
    raise exception 'Customer name and a valid quantity are required.';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  select * into v_item from public.order_items where order_id=p_order_id
    order by coalesce((customization->>'intake_index')::integer,0),created_at,id limit 1 for update;
  if not found then raise exception 'Order item not found.'; end if;
  select count(*) into v_count from public.order_items where order_id=p_order_id;
  if v_count=1 then
    -- An archived product remains editable without selecting a different product.
    if p_product_id is not distinct from v_item.product_id then
      v_price := v_item.unit_price;
    else
      select * into v_product from public.products where id=p_product_id and active=true;
      if not found then raise exception 'Choose an active product from the catalog.'; end if;
      v_price := v_product.base_price;
    end if;
    v_total := round(p_quantity*v_price,2);
    select coalesce(sum(amount),0) into v_paid from public.payments where order_id=p_order_id;
    if v_total < v_paid then raise exception 'Order total cannot be lower than payments already recorded.'; end if;
    update public.order_items set
      product_id=case when v_product.id is null then v_item.product_id else v_product.id end,
      product_name=case when v_product.id is null then v_item.product_name else v_product.name end,
      production_type=case when v_product.id is null then v_item.production_type else v_product.production_type end,
      quantity=p_quantity,unit_price=v_price,
      customization=coalesce(customization,'{}'::jsonb)||jsonb_build_object('names',coalesce(p_names,'')),
      notes=nullif(trim(p_notes),'') where id=v_item.id;
  else
    v_total := v_order.total;
    update public.order_items set customization=coalesce(customization,'{}'::jsonb)||jsonb_build_object('names',coalesce(p_names,''))
      where id=v_item.id and coalesce(customization->>'names','') is distinct from coalesce(p_names,'');
  end if;
  update public.customers set full_name=trim(p_customer_name),phone=nullif(trim(p_phone),'')
    where id=v_order.customer_id;
  update public.orders set due_date=p_due_date,notes=nullif(trim(p_notes),''),updated_at=now(),
    subtotal=case when v_count=1 then v_total else subtotal end,total=v_total where id=p_order_id;
end;
$$;
revoke all on function public.update_catalog_order(uuid,text,text,uuid,integer,date,text,text) from public,anon;
grant execute on function public.update_catalog_order(uuid,text,text,uuid,integer,date,text,text) to authenticated;
notify pgrst,'reload schema';
