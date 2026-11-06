-- Protect player-list changes even when a client updates order_items directly.
create function public.guard_order_item_roster() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_status public.order_status;
  v_role public.app_role;
begin
  if new.customization->'roster' is not distinct from old.customization->'roster'
    and new.customization->'names' is not distinct from old.customization->'names' then
    return new;
  end if;
  v_role := public.current_app_role();
  if auth.uid() is null or v_role is null or v_role not in ('admin','front_desk') then
    raise exception 'Only admin or front desk can edit player lists.';
  end if;
  select status into v_status from public.orders where id=old.order_id for update;
  if v_status in ('released','cancelled') then
    raise exception 'Player lists cannot be changed for released or cancelled orders.';
  end if;
  perform 1 from public.production_tasks where order_id=old.order_id order by id for update;
  if v_role='front_desk' and exists (
    select 1 from public.production_tasks where order_id=old.order_id
      and (status <> 'pending' or started_at is not null or completed_at is not null)
  ) then
    raise exception 'Production has started. Ask an admin to review and save the player list.';
  end if;
  return new;
end;
$$;
create trigger guard_order_item_roster before update of customization on public.order_items
for each row execute function public.guard_order_item_roster();
revoke all on function public.guard_order_item_roster() from public,anon;

create function public.update_order_item_roster(p_item_id uuid,p_roster jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_quantity integer;
  v_order_id uuid;
  v_names text;
begin
  if auth.uid() is null or not coalesce(public.has_any_role(array['admin','front_desk']::public.app_role[]),false) then
    raise exception 'Only admin or front desk can edit player lists.';
  end if;
  select order_id into v_order_id from public.order_items where id=p_item_id;
  if not found then raise exception 'Order item not found.'; end if;
  perform 1 from public.orders where id=v_order_id for update;
  select quantity into v_quantity from public.order_items where id=p_item_id for update;
  if p_roster is null or jsonb_typeof(p_roster)<>'array' then
    raise exception 'Player list must be an array.';
  end if;
  if jsonb_array_length(p_roster)>v_quantity then
    raise exception 'Player count cannot exceed the item quantity.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_roster) r where
    jsonb_typeof(r)<>'object' or
    jsonb_typeof(r->'name') is distinct from 'string' or
    jsonb_typeof(r->'number') is distinct from 'string' or
    jsonb_typeof(r->'size') is distinct from 'string' or
    length(r->>'name')>120 or length(r->>'number')>30 or length(r->>'size')>30) then
    raise exception 'Each player must have text name, number and size fields within the allowed lengths.';
  end if;
  select coalesce(string_agg(concat_ws(' ',nullif(trim(r->>'name'),''),
    case when trim(r->>'number')<>'' then '#'||trim(r->>'number') end,
    nullif(trim(r->>'size'),'')),E'\n' order by n),'') into v_names
  from jsonb_array_elements(p_roster) with ordinality as players(r,n);
  update public.order_items set customization=coalesce(customization,'{}'::jsonb)
    ||jsonb_build_object('roster',p_roster,'names',v_names) where id=p_item_id;
end;
$$;
revoke all on function public.update_order_item_roster(uuid,jsonb) from public,anon;
grant execute on function public.update_order_item_roster(uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
