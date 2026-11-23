begin;

alter table public.inventory_materials
  add column archived_at timestamptz;

alter table public.inventory_movements
  add column source text not null default 'manual'
    check (source in ('manual', 'order_deduction', 'order_reversal')),
  add column order_id uuid references public.orders(id) on delete set null,
  add column order_item_id uuid references public.order_items(id) on delete set null,
  add column order_number text;

create table public.product_material_recipes (
  product_id uuid not null references public.products(id) on delete cascade,
  material_id uuid not null references public.inventory_materials(id) on delete restrict,
  quantity_per_unit numeric(12,3) not null
    check (quantity_per_unit > 0 and quantity_per_unit <= 999999999.999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, material_id)
);

alter table public.product_material_recipes enable row level security;
revoke all on public.product_material_recipes from anon, authenticated;
grant select on public.product_material_recipes to authenticated;
create policy product_material_recipes_admin_select on public.product_material_recipes
  for select to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role);

create table public.inventory_order_deduction_state (
  order_id uuid primary key references public.orders(id) on delete cascade,
  order_number text not null,
  applied boolean not null default false,
  applied_at timestamptz,
  reversed_at timestamptz
);

create table public.inventory_order_consumptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  order_number text not null,
  order_item_id uuid references public.order_items(id) on delete set null,
  material_id uuid not null references public.inventory_materials(id) on delete restrict,
  quantity numeric(12,3) not null check (quantity > 0 and quantity <= 999999999.999),
  deduction_movement_id uuid references public.inventory_movements(id) on delete set null,
  reversal_movement_id uuid references public.inventory_movements(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  reversed_at timestamptz
);
create unique index inventory_order_consumptions_active_unique
  on public.inventory_order_consumptions(order_item_id, material_id)
  where active and order_item_id is not null;
create index inventory_order_consumptions_order_idx
  on public.inventory_order_consumptions(order_id, active);

alter table public.inventory_order_deduction_state enable row level security;
alter table public.inventory_order_consumptions enable row level security;
revoke all on public.inventory_order_deduction_state, public.inventory_order_consumptions
  from anon, authenticated;

create schema if not exists inventory_private;
revoke all on schema inventory_private from public, anon, authenticated;

create function inventory_private.restore_order_consumption(p_order_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_consumption record;
  v_stock numeric(12,3);
  v_movement_id uuid;
begin
  for v_consumption in
    select id, order_id, order_number, order_item_id, material_id, quantity
    from public.inventory_order_consumptions
    where order_id = p_order_id and active
    order by material_id, id
    for update
  loop
    select quantity into v_stock
    from public.inventory_materials
    where id = v_consumption.material_id
    for update;
    if not found then
      raise exception 'Cannot restore inventory for order %: material no longer exists.', v_consumption.order_number;
    end if;
    if v_stock + v_consumption.quantity > 999999999.999 then
      raise exception 'Restoring inventory for order % exceeds the maximum stock quantity.', v_consumption.order_number;
    end if;

    update public.inventory_materials
    set quantity = v_stock + v_consumption.quantity
    where id = v_consumption.material_id;

    insert into public.inventory_movements(
      material_id, movement_type, quantity, movement_date, created_by,
      source, order_id, order_item_id, order_number
    ) values (
      v_consumption.material_id, 'stock_in', v_consumption.quantity,
      (now() at time zone 'Asia/Manila')::date, auth.uid(),
      'order_reversal', v_consumption.order_id, v_consumption.order_item_id,
      v_consumption.order_number
    ) returning id into v_movement_id;

    update public.inventory_order_consumptions
    set active = false, reversed_at = now(), reversal_movement_id = v_movement_id
    where id = v_consumption.id;
  end loop;
end;
$$;

create function inventory_private.apply_order_consumption(p_order_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_order_number text;
  v_recipe record;
  v_stock numeric(12,3);
  v_movement_id uuid;
begin
  select order_number into v_order_number
  from public.orders
  where id = p_order_id and status::text <> 'cancelled';
  if not found then return; end if;

  if exists (
    select 1
    from public.order_items oi
    join public.product_material_recipes r on r.product_id = oi.product_id
    join public.inventory_materials m on m.id = r.material_id
    where oi.order_id = p_order_id and m.archived_at is not null
  ) then
    raise exception 'Order % has a product recipe using an archived material. Update the recipe before production.', v_order_number;
  end if;

  for v_recipe in
    select oi.id as order_item_id, r.material_id,
      (r.quantity_per_unit * oi.quantity)::numeric(12,3) as required_quantity
    from public.order_items oi
    join public.product_material_recipes r on r.product_id = oi.product_id
    where oi.order_id = p_order_id
    order by r.material_id, oi.id
  loop
    select quantity into v_stock
    from public.inventory_materials
    where id = v_recipe.material_id and archived_at is null
    for update;
    if not found then
      raise exception 'Order % requires an unavailable or archived material.', v_order_number;
    end if;
    if v_recipe.required_quantity > v_stock then
      raise exception 'Insufficient stock for order %: required %, available %.',
        v_order_number, v_recipe.required_quantity, v_stock;
    end if;

    update public.inventory_materials
    set quantity = v_stock - v_recipe.required_quantity
    where id = v_recipe.material_id;

    insert into public.inventory_movements(
      material_id, movement_type, quantity, movement_date, created_by,
      source, order_id, order_item_id, order_number
    ) values (
      v_recipe.material_id, 'deduction', v_recipe.required_quantity,
      (now() at time zone 'Asia/Manila')::date, auth.uid(),
      'order_deduction', p_order_id, v_recipe.order_item_id, v_order_number
    ) returning id into v_movement_id;

    insert into public.inventory_order_consumptions(
      order_id, order_number, order_item_id, material_id, quantity, deduction_movement_id
    ) values (
      p_order_id, v_order_number, v_recipe.order_item_id, v_recipe.material_id,
      v_recipe.required_quantity, v_movement_id
    );
  end loop;
end;
$$;

create function inventory_private.start_order_consumption(p_order_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_order_number text;
  v_status text;
  v_applied boolean;
begin
  select order_number, status::text into v_order_number, v_status
  from public.orders
  where id = p_order_id
  for update;
  if not found or v_status = 'cancelled' then return; end if;

  insert into public.inventory_order_deduction_state(order_id, order_number)
  values (p_order_id, v_order_number)
  on conflict (order_id) do nothing;

  select applied into v_applied
  from public.inventory_order_deduction_state
  where order_id = p_order_id
  for update;
  if v_applied then return; end if;

  perform inventory_private.apply_order_consumption(p_order_id);
  update public.inventory_order_deduction_state
  set order_number = v_order_number, applied = true, applied_at = now(), reversed_at = null
  where order_id = p_order_id;
end;
$$;

create function inventory_private.sync_order_consumption(p_order_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_applied boolean;
  v_order_number text;
begin
  select order_number, status::text into v_order_number, v_status
  from public.orders
  where id = p_order_id
  for update;
  if not found then return; end if;

  select applied into v_applied
  from public.inventory_order_deduction_state
  where order_id = p_order_id
  for update;
  if not found or not v_applied then return; end if;

  perform inventory_private.restore_order_consumption(p_order_id);
  if v_status = 'cancelled' then
    update public.inventory_order_deduction_state
    set applied = false, reversed_at = now()
    where order_id = p_order_id;
    return;
  end if;

  perform inventory_private.apply_order_consumption(p_order_id);
  update public.inventory_order_deduction_state
  set order_number = v_order_number, applied = true
  where order_id = p_order_id;
end;
$$;

create function inventory_private.on_production_task_start()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status::text in ('in_progress', 'completed')
    and old.status is distinct from new.status then
    perform inventory_private.start_order_consumption(new.order_id);
  end if;
  return new;
end;
$$;
create trigger inventory_deduct_on_production_start
after update of status on public.production_tasks
for each row when (old.status is distinct from new.status)
execute function inventory_private.on_production_task_start();

create function inventory_private.on_order_item_change()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    perform inventory_private.sync_order_consumption(old.order_id);
    perform inventory_private.sync_order_consumption(new.order_id);
  elsif tg_op = 'DELETE' then
    perform inventory_private.sync_order_consumption(old.order_id);
  else
    perform inventory_private.sync_order_consumption(new.order_id);
  end if;
  return null;
end;
$$;
create trigger inventory_order_item_inserted
after insert on public.order_items
for each row execute function inventory_private.on_order_item_change();
create trigger inventory_order_item_updated
after update of order_id, product_id, quantity on public.order_items
for each row
when (old.order_id is distinct from new.order_id
  or old.product_id is distinct from new.product_id
  or old.quantity is distinct from new.quantity)
execute function inventory_private.on_order_item_change();
create trigger inventory_order_item_deleted
after delete on public.order_items
for each row execute function inventory_private.on_order_item_change();

create function inventory_private.on_order_cancelled()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform inventory_private.sync_order_consumption(new.id);
  return new;
end;
$$;
create trigger inventory_restore_on_order_cancel
after update of status on public.orders
for each row
when (new.status::text = 'cancelled' and old.status is distinct from new.status)
execute function inventory_private.on_order_cancelled();

create function inventory_private.on_order_deleted()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform inventory_private.restore_order_consumption(old.id);
  update public.inventory_order_deduction_state
  set applied = false, reversed_at = now()
  where order_id = old.id and applied;
  return old;
end;
$$;
create trigger inventory_restore_before_order_delete
before delete on public.orders
for each row execute function inventory_private.on_order_deleted();

create function public.save_product_material_recipe(p_product_id uuid, p_recipe jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_material_id uuid;
  v_quantity numeric;
  v_order_id uuid;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an active admin can save product material recipes.';
  end if;
  if p_product_id is null or p_recipe is null or jsonb_typeof(p_recipe) <> 'array'
    or jsonb_array_length(p_recipe) > 50 then
    raise exception 'Choose a product and provide no more than 50 material recipe lines.';
  end if;

  perform 1 from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found.'; end if;

  for v_item in select value from jsonb_array_elements(p_recipe) loop
    if coalesce(v_item->>'material_id', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or coalesce(v_item->>'quantity_per_unit', '') !~ '^[0-9]+(\.[0-9]{1,3})?$' then
      raise exception 'Every recipe line requires a valid material and quantity (up to 3 decimal places).';
    end if;
    v_material_id := (v_item->>'material_id')::uuid;
    v_quantity := (v_item->>'quantity_per_unit')::numeric;
    if v_quantity <= 0 or v_quantity > 999999999.999 then
      raise exception 'Recipe quantities must be positive and within the supported stock limit.';
    end if;
    if not exists (
      select 1 from public.inventory_materials
      where id = v_material_id and archived_at is null
    ) then
      raise exception 'Choose an active inventory material for every recipe line.';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_recipe) as line(value)
    group by (line.value->>'material_id')::uuid
    having count(*) > 1
  ) then
    raise exception 'A material can appear only once in a product recipe.';
  end if;

  delete from public.product_material_recipes where product_id = p_product_id;
  for v_item in select value from jsonb_array_elements(p_recipe) loop
    insert into public.product_material_recipes(product_id, material_id, quantity_per_unit)
    values (
      p_product_id,
      (v_item->>'material_id')::uuid,
      (v_item->>'quantity_per_unit')::numeric
    );
  end loop;

  for v_order_id in
    select distinct oi.order_id
    from public.order_items oi
    join public.inventory_order_deduction_state s on s.order_id = oi.order_id and s.applied
    where oi.product_id = p_product_id
    order by oi.order_id
  loop
    perform inventory_private.sync_order_consumption(v_order_id);
  end loop;
end;
$$;
revoke all on function public.save_product_material_recipe(uuid, jsonb) from public, anon;
grant execute on function public.save_product_material_recipe(uuid, jsonb) to authenticated;

create function public.remove_inventory_material(p_material_id uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_archived boolean;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an active admin can remove inventory materials.';
  end if;

  perform 1 from public.inventory_materials where id = p_material_id for update;
  if not found then raise exception 'Material not found.'; end if;

  select archived_at is not null into v_archived
  from public.inventory_materials where id = p_material_id;
  if v_archived then return 'archived'; end if;

  if exists (select 1 from public.inventory_movements where material_id = p_material_id)
    or exists (select 1 from public.product_material_recipes where material_id = p_material_id) then
    update public.inventory_materials set archived_at = now() where id = p_material_id;
    return 'archived';
  end if;

  delete from public.inventory_materials where id = p_material_id;
  return 'deleted';
end;
$$;
revoke all on function public.remove_inventory_material(uuid) from public, anon;
grant execute on function public.remove_inventory_material(uuid) to authenticated;

create function public.restore_inventory_material(p_material_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an active admin can restore inventory materials.';
  end if;
  update public.inventory_materials set archived_at = null where id = p_material_id;
  if not found then raise exception 'Material not found.'; end if;
end;
$$;
revoke all on function public.restore_inventory_material(uuid) from public, anon;
grant execute on function public.restore_inventory_material(uuid) to authenticated;

create or replace function public.record_inventory_movement(
  p_material_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_movement_date date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_quantity numeric;
  v_new_quantity numeric;
  v_movement_id uuid;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an active admin can change inventory stock.';
  end if;
  if p_material_id is null or p_movement_type not in ('stock_in', 'deduction')
    or p_quantity is null or p_quantity = 'NaN'::numeric or p_quantity <= 0
    or p_quantity > 999999999.999 or round(p_quantity, 3) <> p_quantity
    or p_movement_date is null then
    raise exception 'Enter a valid movement type, quantity and date.';
  end if;
  if p_movement_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'Movement date cannot be in the future.';
  end if;

  select quantity into v_quantity from public.inventory_materials
  where id = p_material_id and archived_at is null for update;
  if not found then raise exception 'Material not found or archived.'; end if;
  if p_movement_type = 'deduction' and p_quantity > v_quantity then
    raise exception 'Deduction exceeds the available stock.';
  end if;

  v_new_quantity := case when p_movement_type = 'stock_in'
    then v_quantity + p_quantity else v_quantity - p_quantity end;
  if v_new_quantity > 999999999.999 then
    raise exception 'Stock quantity exceeds the maximum allowed value.';
  end if;

  update public.inventory_materials set quantity = v_new_quantity where id = p_material_id;
  insert into public.inventory_movements (material_id, movement_type, quantity, movement_date, created_by)
  values (p_material_id, p_movement_type, p_quantity, p_movement_date, auth.uid())
  returning id into v_movement_id;
  return v_movement_id;
end;
$$;
revoke all on function public.record_inventory_movement(uuid, text, numeric, date) from public, anon;
grant execute on function public.record_inventory_movement(uuid, text, numeric, date) to authenticated;

notify pgrst, 'reload schema';
commit;
