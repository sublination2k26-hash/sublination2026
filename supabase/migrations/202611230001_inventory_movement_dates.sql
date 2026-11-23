begin;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.inventory_materials(id) on delete restrict,
  movement_type text not null check (movement_type in ('stock_in', 'deduction')),
  quantity numeric(12,3) not null check (quantity > 0 and quantity <= 999999999.999),
  movement_date date not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index inventory_movements_date_idx on public.inventory_movements (movement_date desc, created_at desc);
create index inventory_movements_material_idx on public.inventory_movements (material_id, movement_date desc, created_at desc);

alter table public.inventory_movements enable row level security;
revoke all on public.inventory_movements from anon, authenticated;
grant select on public.inventory_movements to authenticated;
create policy inventory_movements_admin_select on public.inventory_movements for select to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role);

-- Preserve existing stock as a dated opening balance before quantity edits are routed through the ledger.
insert into public.inventory_movements (material_id, movement_type, quantity, movement_date)
select id, 'stock_in', quantity, (updated_at at time zone 'Asia/Manila')::date
from public.inventory_materials
where quantity > 0;

revoke insert, update on public.inventory_materials from authenticated;
grant update (name, category, unit, low_stock_level) on public.inventory_materials to authenticated;

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

  select quantity into v_quantity from public.inventory_materials where id = p_material_id for update;
  if not found then raise exception 'Material not found.'; end if;
  if p_movement_type = 'deduction' and p_quantity > v_quantity then
    raise exception 'Deduction exceeds the available stock.';
  end if;

  v_new_quantity := case when p_movement_type = 'stock_in' then v_quantity + p_quantity else v_quantity - p_quantity end;
  if v_new_quantity > 999999999.999 then raise exception 'Stock quantity exceeds the maximum allowed value.'; end if;

  update public.inventory_materials set quantity = v_new_quantity where id = p_material_id;
  insert into public.inventory_movements (material_id, movement_type, quantity, movement_date, created_by)
  values (p_material_id, p_movement_type, p_quantity, p_movement_date, auth.uid())
  returning id into v_movement_id;
  return v_movement_id;
end;
$$;
revoke all on function public.record_inventory_movement(uuid, text, numeric, date) from public, anon;
grant execute on function public.record_inventory_movement(uuid, text, numeric, date) to authenticated;

create or replace function public.create_inventory_material(
  p_name text,
  p_category text,
  p_unit text,
  p_quantity numeric,
  p_low_stock_level numeric,
  p_stock_date date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_material_id uuid;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an active admin can add inventory materials.';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120
    or p_category is null or length(trim(p_category)) not between 1 and 60
    or p_unit is null or length(trim(p_unit)) not between 1 and 30
    or p_quantity is null or p_quantity = 'NaN'::numeric or p_quantity < 0 or p_quantity > 999999999.999
    or round(p_quantity, 3) <> p_quantity
    or p_low_stock_level is null or p_low_stock_level = 'NaN'::numeric
    or p_low_stock_level < 0 or p_low_stock_level > 999999999.999
    or round(p_low_stock_level, 3) <> p_low_stock_level then
    raise exception 'Enter a valid material, stock quantity and low-stock level.';
  end if;
  if p_quantity > 0 and p_stock_date is null then raise exception 'Choose the stock-in date.'; end if;

  insert into public.inventory_materials (name, category, unit, quantity, low_stock_level)
  values (trim(p_name), trim(p_category), trim(p_unit), 0, p_low_stock_level)
  returning id into v_material_id;

  if p_quantity > 0 then
    perform public.record_inventory_movement(v_material_id, 'stock_in', p_quantity, p_stock_date);
  end if;
  return v_material_id;
end;
$$;
revoke all on function public.create_inventory_material(text, text, text, numeric, numeric, date) from public, anon;
grant execute on function public.create_inventory_material(text, text, text, numeric, numeric, date) to authenticated;

notify pgrst, 'reload schema';
commit;
