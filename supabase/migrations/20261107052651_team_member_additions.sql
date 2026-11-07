-- Staff can append team members without gaining general order or payment writes.
create or replace function public.guard_order_item_roster() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_role public.app_role := public.current_app_role();
  v_status public.order_status;
  v_old jsonb := coalesce(old.customization->'roster','[]'::jsonb);
  v_new jsonb := coalesce(new.customization->'roster','[]'::jsonb);
begin
  if v_new is not distinct from v_old and new.customization->'names' is not distinct from old.customization->'names' then return new; end if;
  if auth.uid() is null or v_role is null or v_role not in ('admin','front_desk','artist') then
    raise exception 'Only admin, front desk or artist can update player lists.';
  end if;
  select status into v_status from public.orders where id=old.order_id for update;
  if v_status in ('released','cancelled') then raise exception 'Player lists cannot be changed for released or cancelled orders.'; end if;
  -- Preserve the existing front-desk intake exception for newly created items.
  if v_role='admin' or (v_role='front_desk' and not (old.customization ? 'intake_index') and
    exists(select 1 from public.order_items i where i.id=old.id and i.xmin::text=pg_current_xact_id()::text)) then return new; end if;
  if jsonb_typeof(v_new)<>'array' or jsonb_array_length(v_new)<jsonb_array_length(v_old) or jsonb_array_length(v_new)>old.quantity then
    raise exception 'Append players within the ordered quantity; use an add-on order for extra pieces.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_old) with ordinality o(r,i)
    left join jsonb_array_elements(v_new) with ordinality n(r,i) using(i)
    where case when v_role='artist' then n.r is distinct from o.r
      else (n.r - 'name' || jsonb_build_object('number',coalesce(n.r->>'number',''),'size',coalesce(n.r->>'size','')))
        is distinct from (o.r - 'name' || jsonb_build_object('number',coalesce(o.r->>'number',''),'size',coalesce(o.r->>'size',''))) end
  ) then raise exception 'Existing members must be preserved. Front desk can correct names only.'; end if;
  return new;
end;
$$;

create schema if not exists private;
-- Definer is limited to validated appends or a new order at the saved item price.
-- Artist RLS remains unchanged: artists cannot directly insert orders or edit money.
create function private.add_team_members(p_item_id uuid,p_members jsonb,p_extra_pieces boolean,p_due_date date,p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := public.current_app_role();
  v_source public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_order_id uuid; v_item_id uuid; v_old_roster jsonb; v_roster jsonb; v_names text;
  v_request jsonb; v_saved jsonb; v_count integer; v_stage public.task_stage;
begin
  if auth.uid() is null or v_role is null or v_role not in ('admin','front_desk','artist') then
    raise exception 'Only admin, front desk or artist can add team members.';
  end if;
  if p_request_id is null or p_extra_pieces is null then raise exception 'A request ID and addition type are required.'; end if;
  if p_members is null or jsonb_typeof(p_members)<>'array' then raise exception 'Members must be an array.'; end if;
  v_count := jsonb_array_length(p_members);
  if v_count not between 1 and 500 then raise exception 'Add between 1 and 500 members.'; end if;
  if exists(select 1 from jsonb_array_elements(p_members) r where jsonb_typeof(r)<>'object'
    or jsonb_typeof(r->'name') is distinct from 'string' or length(trim(r->>'name'))=0 or length(r->>'name')>120
    or jsonb_typeof(r->'number') is distinct from 'string' or length(r->>'number')>30
    or jsonb_typeof(r->'size') is distinct from 'string' or length(r->>'size')>30
    or (r - array['name','number','size']) <> '{}'::jsonb) then
    raise exception 'Each member needs a name and text number/size fields within the allowed lengths.';
  end if;
  select order_id into v_order_id from public.order_items where id=p_item_id;
  if not found then raise exception 'Source item not found.'; end if;
  select * into v_source from public.orders where id=v_order_id for update;
  select * into v_item from public.order_items where id=p_item_id for update;
  v_request := jsonb_build_object('actor',auth.uid(),'members',p_members,'extra_pieces',p_extra_pieces,'due_date',p_due_date);
  if p_extra_pieces then
    select customization->'team_addon_request' into v_saved from public.order_items where order_id=p_request_id;
    if found then
      if v_saved is distinct from (v_request || jsonb_build_object('source_item_id',p_item_id)) then raise exception 'Request ID was already used for a different addition.'; end if;
      return p_request_id;
    end if;
  else
    v_saved := v_item.customization->'member_additions'->p_request_id::text;
    if v_saved is not null then
      if v_saved is distinct from v_request then raise exception 'Request ID was already used for a different addition.'; end if;
      return v_source.id;
    end if;
  end if;
  if v_source.status='cancelled' then raise exception 'Cannot add members to a cancelled team order.'; end if;
  if p_extra_pieces then
    if p_due_date is null then raise exception 'Choose the add-on due date.'; end if;
    if not exists(select 1 from public.production_tasks where order_item_id=p_item_id) then raise exception 'Source item has no production route. Ask an admin to review it.'; end if;
    v_roster := p_members;
  else
    if v_source.status in ('released','ready_for_release') then raise exception 'Production is complete. Create an add-on order for new members.'; end if;
    v_old_roster := coalesce(v_item.customization->'roster','[]'::jsonb);
    if jsonb_typeof(v_old_roster)<>'array' then raise exception 'Ask an admin to review the existing player list.'; end if;
    if jsonb_array_length(v_old_roster)=0 and trim(coalesce(v_item.customization->>'names',''))<>'' then
      raise exception 'Ask an admin to convert the existing text player list before appending members.';
    end if;
    v_roster := v_old_roster || p_members;
    if jsonb_array_length(v_roster)>v_item.quantity then raise exception 'Player count exceeds the ordered quantity. Choose extra pieces to create an add-on order.'; end if;
  end if;
  select coalesce(string_agg(concat_ws(' ',nullif(trim(r->>'name'),''),
    case when trim(r->>'number')<>'' then '#'||trim(r->>'number') end,nullif(trim(r->>'size'),'')),E'\n' order by n),'') into v_names
    from jsonb_array_elements(v_roster) with ordinality players(r,n);
  if not p_extra_pieces then
    update public.order_items set customization=customization || jsonb_build_object('roster',v_roster,'names',v_names,
      'member_additions',coalesce(customization->'member_additions','{}'::jsonb) || jsonb_build_object(p_request_id::text,v_request)) where id=p_item_id;
    return v_source.id;
  end if;
  insert into public.orders(id,customer_id,due_date,status,subtotal,total,notes,created_by)
    values(p_request_id,v_source.customer_id,p_due_date,'pending',v_count*v_item.unit_price,v_count*v_item.unit_price,
      'Additional members for '||v_source.order_number||'. Prepare a new layout using the source order as reference.',auth.uid());
  insert into public.order_items(order_id,product_id,product_name,production_type,quantity,unit_price,customization,notes)
    values(p_request_id,v_item.product_id,v_item.product_name,v_item.production_type,v_count,v_item.unit_price,
      (v_item.customization - array['member_additions','payment_due_date','team_addon_request']) || jsonb_build_object('intake_index',0,
      'roster',v_roster,'names',v_names,'team_source_order_id',v_source.id,'team_source_order_number',v_source.order_number,
      'team_root_order_number',coalesce(v_item.customization->>'team_root_order_number',v_item.customization->>'team_source_order_number',v_source.order_number),
      'team_addon_request',v_request || jsonb_build_object('source_item_id',p_item_id)),v_item.notes) returning id into v_item_id;
  for v_stage in select distinct stage from public.production_tasks where order_item_id=p_item_id loop
    insert into public.production_tasks(order_id,order_item_id,stage,status) values(p_request_id,v_item_id,v_stage,'pending');
  end loop;
  return p_request_id;
end;
$$;
revoke all on function private.add_team_members(uuid,jsonb,boolean,date,uuid) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.add_team_members(uuid,jsonb,boolean,date,uuid) to authenticated;

create function public.add_team_members(p_item_id uuid,p_members jsonb,p_extra_pieces boolean,p_due_date date,p_request_id uuid) returns uuid
language sql security invoker set search_path = '' as $$
  select private.add_team_members(p_item_id,p_members,p_extra_pieces,p_due_date,p_request_id);
$$;
revoke all on function public.add_team_members(uuid,jsonb,boolean,date,uuid) from public,anon;
grant execute on function public.add_team_members(uuid,jsonb,boolean,date,uuid) to authenticated;
notify pgrst, 'reload schema';
