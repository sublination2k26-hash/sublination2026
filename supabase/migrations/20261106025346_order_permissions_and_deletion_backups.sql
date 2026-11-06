-- Protect player-list changes even when a client updates order_items directly.
create or replace function public.guard_order_item_roster() returns trigger
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
  if v_role='front_desk' and not (not (old.customization ? 'intake_index') and exists(select 1 from public.order_items i where i.id=old.id and i.xmin::text=pg_current_xact_id()::text)) then
    if jsonb_array_length(coalesce(new.customization->'roster','[]'::jsonb)) <>
       jsonb_array_length(coalesce(old.customization->'roster','[]'::jsonb)) or exists (
      select 1 from jsonb_array_elements(coalesce(new.customization->'roster','[]'::jsonb)) with ordinality n(r,i)
      full join jsonb_array_elements(coalesce(old.customization->'roster','[]'::jsonb)) with ordinality o(r,i) using(i)
      where (n.r - 'name' || jsonb_build_object('number',coalesce(n.r->>'number',''),'size',coalesce(n.r->>'size','')))
        is distinct from (o.r - 'name' || jsonb_build_object('number',coalesce(o.r->>'number',''),'size',coalesce(o.r->>'size','')))
    ) then raise exception 'Front desk can edit member names only.'; end if;
  end if;
  return new;
end;
$$;

-- Prevent direct API changes to existing quantities/prices, including generated totals.
create function public.guard_order_amounts() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if public.current_app_role()='front_desk' then
    if tg_table_name='orders' then
      if new.total=(select sum(line_total) from public.order_items where order_id=old.id) and new.subtotal=new.total and new.discount=old.discount and exists(select 1 from public.orders o where o.id=old.id and o.xmin::text=pg_current_xact_id()::text) then return new; end if;
      if (new.subtotal,new.discount,new.total) is distinct from (old.subtotal,old.discount,old.total) then
        raise exception 'Only admin can change order amounts.';
      end if;
    else
      if (new.order_id,new.product_id,new.quantity,new.unit_price) is distinct from
         (old.order_id,old.product_id,old.quantity,old.unit_price) then
        raise exception 'Only admin can change item quantities or amounts.';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_order_amounts before update on public.orders for each row execute function public.guard_order_amounts();
create trigger guard_item_amounts before update on public.order_items for each row execute function public.guard_order_amounts();
create policy "admin deletes items" on public.order_items for delete to authenticated using(public.current_app_role()='admin');
drop policy "front desk manages items" on public.order_items;
create policy "desk inserts items" on public.order_items for insert to authenticated with check(public.current_app_role()='admin' or (public.current_app_role()='front_desk' and exists(select 1 from public.orders o where o.id=order_id and o.created_at>=transaction_timestamp() and o.xmin::text=pg_current_xact_id()::text)));
create policy "desk updates items" on public.order_items for update to authenticated using(public.has_any_role(array['admin','front_desk']::public.app_role[])) with check(public.has_any_role(array['admin','front_desk']::public.app_role[]));

create table public.deleted_order_backups (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  order_number text not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid not null,
  snapshot jsonb not null
);
alter table public.deleted_order_backups enable row level security;
revoke all on public.deleted_order_backups from anon,authenticated;
grant select on public.deleted_order_backups to authenticated;
create policy "admin reads deleted orders" on public.deleted_order_backups for select to authenticated using(public.current_app_role()='admin');
create schema if not exists private;
-- Definer is required to write the immutable backup and capture all child rows
-- before cascading deletion. No client can invoke this trigger directly.
create function private.backup_deleted_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_snapshot jsonb; v_table record; v_rows jsonb;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin' then
    raise exception 'Only admin can delete orders.';
  end if;
  v_snapshot := jsonb_build_object('orders',to_jsonb(old));
  -- Include all current and future tables linked by order_id, plus players.
  for v_table in select table_name from information_schema.columns
    where table_schema='public' and column_name='order_id' and table_name<>'deleted_order_backups'
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where order_id=$1',v_table.table_name) into v_rows using old.id;
    v_snapshot := v_snapshot || jsonb_build_object(v_table.table_name,v_rows);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into v_rows from public.player_details p
    join public.order_items i on i.id=p.order_item_id where i.order_id=old.id;
  v_snapshot := v_snapshot || jsonb_build_object('player_details',v_rows,'customer',
    (select to_jsonb(c) from public.customers c where c.id=old.customer_id));
  insert into public.deleted_order_backups(order_id,order_number,deleted_by,snapshot)
    values(old.id,old.order_number,auth.uid(),v_snapshot);
  return old;
end;
$$;
revoke all on function private.backup_deleted_order() from public,anon,authenticated;
create trigger backup_deleted_order before delete on public.orders for each row execute function private.backup_deleted_order();
notify pgrst, 'reload schema';
