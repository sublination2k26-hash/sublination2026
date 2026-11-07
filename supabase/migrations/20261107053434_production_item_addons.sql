-- Quantity-based add-ons work for any production item; personalization is optional.
-- Definer creates only a new linked order at the saved price, never edits old billing.
create function private.add_production_items(p_item_id uuid,p_quantity integer,p_roster jsonb,p_due_date date,p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := public.current_app_role();
  v_source public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_source_id uuid; v_item_id uuid; v_request jsonb; v_saved jsonb; v_names text;
  v_stage public.task_stage;
begin
  if auth.uid() is null or v_role is null or v_role not in ('admin','front_desk','artist') then
    raise exception 'Only admin, front desk or artist can add production items.';
  end if;
  if p_request_id is null or p_quantity is null or p_quantity not between 1 and 10000 then
    raise exception 'A request ID and quantity between 1 and 10000 are required.';
  end if;
  if p_due_date is null then raise exception 'Choose the add-on due date.'; end if;
  if p_roster is null or jsonb_typeof(p_roster)<>'array' then raise exception 'Personalization must be an array, or an empty array when not needed.'; end if;
  if jsonb_array_length(p_roster)>p_quantity then raise exception 'Personalized rows cannot exceed the additional quantity.'; end if;
  if exists(select 1 from jsonb_array_elements(p_roster) r where jsonb_typeof(r)<>'object'
    or jsonb_typeof(r->'name') is distinct from 'string' or length(r->>'name')>120
    or jsonb_typeof(r->'number') is distinct from 'string' or length(r->>'number')>30
    or jsonb_typeof(r->'size') is distinct from 'string' or length(r->>'size')>30
    or (r - array['name','number','size']) <> '{}'::jsonb) then
    raise exception 'Personalization accepts text name, number and size fields only.';
  end if;
  select order_id into v_source_id from public.order_items where id=p_item_id;
  if not found then raise exception 'Source item not found.'; end if;
  select * into v_source from public.orders where id=v_source_id for update;
  if not found then raise exception 'Source order not found.'; end if;
  select * into v_item from public.order_items where id=p_item_id for update;
  if not found then raise exception 'Source item not found.'; end if;
  v_request := jsonb_build_object('actor',auth.uid(),'source_item_id',p_item_id,'quantity',p_quantity,'members',p_roster,'due_date',p_due_date);
  select customization->'production_addon_request' into v_saved from public.order_items where order_id=p_request_id;
  if found then
    if v_saved is distinct from v_request then raise exception 'Request ID was already used for a different addition.'; end if;
    return p_request_id;
  end if;
  if v_source.status='cancelled' then raise exception 'Cannot add items to a cancelled order.'; end if;
  if not exists(select 1 from public.production_tasks where order_item_id=p_item_id) then
    raise exception 'Source item has no production route. Ask an admin to review it.';
  end if;
  select coalesce(string_agg(concat_ws(' ',nullif(trim(r->>'name'),''),
    case when trim(r->>'number')<>'' then '#'||trim(r->>'number') end,nullif(trim(r->>'size'),'')),E'\n' order by n),'') into v_names
    from jsonb_array_elements(p_roster) with ordinality players(r,n);
  insert into public.orders(id,customer_id,due_date,status,subtotal,total,notes,created_by)
    values(p_request_id,v_source.customer_id,p_due_date,'pending',p_quantity*v_item.unit_price,p_quantity*v_item.unit_price,
      'Additional production items for '||v_source.order_number||'. Prepare a new layout using the source order as reference.',auth.uid());
  insert into public.order_items(order_id,product_id,product_name,production_type,quantity,unit_price,customization,notes)
    values(p_request_id,v_item.product_id,v_item.product_name,v_item.production_type,p_quantity,v_item.unit_price,
      (v_item.customization - array['member_additions','payment_due_date','team_addon_request','production_addon_request']) || jsonb_build_object('intake_index',0,
      'roster',p_roster,'names',v_names,'team_source_order_id',v_source.id,'team_source_order_number',v_source.order_number,
      'team_root_order_number',coalesce(v_item.customization->>'team_root_order_number',v_item.customization->>'team_source_order_number',v_source.order_number),
      'production_addon_request',v_request),v_item.notes) returning id into v_item_id;
  for v_stage in select distinct stage from public.production_tasks where order_item_id=p_item_id loop
    insert into public.production_tasks(order_id,order_item_id,stage,status) values(p_request_id,v_item_id,v_stage,'pending');
  end loop;
  return p_request_id;
end;
$$;
revoke all on function private.add_production_items(uuid,integer,jsonb,date,uuid) from public,anon,authenticated;
grant execute on function private.add_production_items(uuid,integer,jsonb,date,uuid) to authenticated;

create function public.add_production_items(p_item_id uuid,p_quantity integer,p_roster jsonb,p_due_date date,p_request_id uuid) returns uuid
language sql security invoker set search_path = '' as $$
  select private.add_production_items(p_item_id,p_quantity,p_roster,p_due_date,p_request_id);
$$;
revoke all on function public.add_production_items(uuid,integer,jsonb,date,uuid) from public,anon;
grant execute on function public.add_production_items(uuid,integer,jsonb,date,uuid) to authenticated;
notify pgrst, 'reload schema';
