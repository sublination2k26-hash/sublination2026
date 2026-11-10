-- Keep admin-only deletion and paid-order retention. Backups run before cascades.
-- Release history belongs to the deleted order and is captured by the backup.
alter table public.order_releases drop constraint order_releases_order_id_fkey;
alter table public.order_releases add constraint order_releases_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete cascade;
-- Payment and release cascades may run in either order.
alter table public.order_releases drop constraint order_releases_pickup_payment_id_fkey;
alter table public.order_releases add constraint order_releases_pickup_payment_id_fkey
  foreign key (pickup_payment_id) references public.payments(id) on delete set null;

-- Retain sewing events and earned payroll, as employee_work_records already does.
alter table public.sewing_assignments alter column task_id drop not null;
alter table public.sewing_assignments drop constraint sewing_assignments_task_id_fkey;
alter table public.sewing_assignments add constraint sewing_assignments_task_id_fkey
  foreign key (task_id) references public.production_tasks(id) on delete set null;

create or replace function public.guard_released_item_quantity() returns trigger
language plpgsql set search_path = '' as $$
declare v_order_id uuid;
begin
  v_order_id := case when tg_op = 'INSERT' then new.order_id else old.order_id end;
  perform 1 from public.orders where id = v_order_id for update;
  -- A missing parent means this is the parent's ON DELETE CASCADE.
  -- Direct item deletion on an existing order must remain blocked after pickup.
  if tg_op = 'DELETE' and not found then return old; end if;
  if exists(select 1 from public.order_releases where order_id = v_order_id) then
    if tg_op <> 'UPDATE' then raise exception 'Items cannot be added or removed after a partial release.'; end if;
    if new.quantity is distinct from old.quantity or new.order_id is distinct from old.order_id then
      raise exception 'Released order quantities cannot be changed.';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.order_id is distinct from old.order_id then
    perform 1 from public.orders where id = new.order_id for update;
    if exists(select 1 from public.order_releases where order_id = new.order_id) then
      raise exception 'Items cannot be moved into a partially released order.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function private.backup_deleted_order() returns trigger
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
  -- Preserve the original task links before sewing history is detached.
  select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into v_rows
    from public.sewing_assignments a join public.production_tasks t on t.id=a.task_id where t.order_id=old.id;
  v_snapshot := v_snapshot || jsonb_build_object('sewing_assignments',v_rows);
  select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) into v_rows
    from public.sewing_events e join public.sewing_assignments a on a.id=e.assignment_id
    join public.production_tasks t on t.id=a.task_id where t.order_id=old.id;
  v_snapshot := v_snapshot || jsonb_build_object('sewing_events',v_rows);
  insert into public.deleted_order_backups(order_id,order_number,deleted_by,snapshot)
    values(old.id,old.order_number,auth.uid(),v_snapshot);
  return old;
end;
$$;
revoke all on function private.backup_deleted_order() from public,anon,authenticated;
notify pgrst, 'reload schema';
