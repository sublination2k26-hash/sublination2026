create table public.inventory_materials (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  category text not null check (length(trim(category)) between 1 and 60),
  unit text not null check (length(trim(unit)) between 1 and 30),
  quantity numeric(12,3) not null default 0 check (quantity >= 0 and quantity <= 999999999.999),
  low_stock_level numeric(12,3) not null default 0 check (low_stock_level >= 0 and low_stock_level <= 999999999.999),
  updated_at timestamptz not null default now()
);
create unique index inventory_materials_name_unique on public.inventory_materials (lower(trim(name)));

alter table public.inventory_materials enable row level security;
revoke all on public.inventory_materials from anon, authenticated;
grant select, insert, update on public.inventory_materials to authenticated;

create policy inventory_admin_select on public.inventory_materials for select to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role);
create policy inventory_admin_insert on public.inventory_materials for insert to authenticated
  with check ((select public.current_app_role()) = 'admin'::public.app_role);
create policy inventory_admin_update on public.inventory_materials for update to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role)
  with check ((select public.current_app_role()) = 'admin'::public.app_role);

create function public.touch_inventory_material() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.touch_inventory_material() from public, anon;
grant execute on function public.touch_inventory_material() to authenticated;
create trigger inventory_material_updated before update on public.inventory_materials
  for each row execute function public.touch_inventory_material();

insert into public.inventory_materials (name,category,unit) values
  ('Ink - Blue','Ink','ml'),
  ('Ink - Magenta','Ink','ml'),
  ('Ink - Black','Ink','ml'),
  ('Ink - Yellow','Ink','ml'),
  ('Paper','Paper','rolls'),
  ('Fabric - 150gsm','Fabric','meters'),
  ('Fabric - 180gsm','Fabric','meters'),
  ('Fabric - Spandex','Fabric','meters'),
  ('Wipes','Cleaning','packs'),
  ('Cotton buds','Cleaning','packs'),
  ('Cleaning liquids','Cleaning','ml'),
  ('Short cord','Sewing','meters'),
  ('Garter','Sewing','meters'),
  ('Threads - White','Sewing','spools'),
  ('Threads - Black','Sewing','spools'),
  ('Threads - Colored','Sewing','spools'),
  ('Needles - Piping','Sewing','pcs'),
  ('Needles - Highspeed','Sewing','pcs'),
  ('Needles - Edging','Sewing','pcs'),
  ('Scissors','Tools','pcs');
