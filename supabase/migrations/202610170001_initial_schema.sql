-- Sublime Studio production management schema. Apply in Supabase SQL Editor or CLI.
create extension if not exists pgcrypto;

create type public.app_role as enum ('admin','front_desk','artist','printing','heat_press','cutting_sewing','qc');
create type public.order_status as enum ('pending','confirmed','in_production','quality_check','ready_for_release','released','cancelled');
create type public.task_stage as enum ('layout','printing','heat_press','cutting','sewing','qc');
create type public.task_status as enum ('pending','in_progress','completed','returned_for_correction','blocked');
create type public.payment_method as enum ('cash','gcash','bank_transfer','card','other');
create type public.qc_status as enum ('pending','approved','rejected','correction_required');

create sequence public.job_order_number_seq;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.app_role not null default 'front_desk',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  contact_channel text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  production_type text not null default 'full_garment' check (production_type in ('full_garment','print_only','service')),
  base_price numeric(12,2) not null check (base_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null default ('JO-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.job_order_number_seq')::text,4,'0')),
  customer_id uuid not null references public.customers(id),
  order_date date not null default current_date,
  due_date date,
  release_date timestamptz,
  status public.order_status not null default 'pending',
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  notes text,
  release_exception_by uuid references public.profiles(id),
  release_exception_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  product_name text not null,
  production_type text not null default 'full_garment' check (production_type in ('full_garment','print_only','service')),
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) generated always as (quantity * unit_price) stored,
  customization jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);
create table public.player_details (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  player_name text,
  jersey_number text,
  garment_size text not null,
  color text,
  notes text,
  created_at timestamptz not null default now()
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  method public.payment_method not null default 'cash',
  reference_number text,
  received_at timestamptz not null default now(),
  received_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);
create table public.job_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  instructions text,
  approved_design boolean not null default false,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id)
);
create table public.production_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  stage public.task_stage not null,
  status public.task_status not null default 'pending',
  assigned_to uuid references public.profiles(id),
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_item_id, stage)
);
create table public.design_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_kind text not null default 'artwork' check (file_kind in ('artwork','layout','proof','reference')),
  approved boolean not null default false,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.defects (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  task_id uuid references public.production_tasks(id) on delete set null,
  reported_by uuid references public.profiles(id),
  category text not null check (category in ('wrong_name','wrong_number','print_defect','damaged_fabric','wrong_size','missing_piece','other')),
  description text not null,
  correction_status public.task_status not null default 'pending',
  corrected_by uuid references public.profiles(id),
  corrected_at timestamptz,
  qc_verified_by uuid references public.profiles(id),
  qc_verified_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.qc_inspections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  inspected_by uuid references public.profiles(id),
  status public.qc_status not null default 'pending',
  quantity_verified boolean not null default false,
  sizes_verified boolean not null default false,
  personalization_verified boolean not null default false,
  print_quality_verified boolean not null default false,
  condition_verified boolean not null default false,
  notes text,
  inspected_at timestamptz not null default now()
);
create table public.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_table text not null,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index orders_customer_idx on public.orders(customer_id);
create index orders_status_due_idx on public.orders(status,due_date);
create index payments_order_idx on public.payments(order_id,received_at desc);
create index tasks_assignee_status_idx on public.production_tasks(assigned_to,status,stage);
create index defects_order_status_idx on public.defects(order_id,correction_status);
create index activity_entity_idx on public.activity_logs(entity_table,entity_id,created_at desc);

create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;
create or replace function public.has_any_role(allowed public.app_role[]) returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_app_role() = any(allowed), false) $$;
create or replace function public.log_row_change() returns trigger
language plpgsql security definer set search_path = public
as $$
declare old_json jsonb; new_json jsonb; entity_key text;
begin
  if tg_op <> 'INSERT' then old_json := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_json := to_jsonb(new); end if;
  entity_key := coalesce(new_json->>'id', old_json->>'id');
  insert into public.activity_logs(actor_id,action,entity_table,entity_id,old_data,new_data)
  values(auth.uid(),tg_op,tg_table_name,entity_key,old_json,new_json);
  return coalesce(new,old);
end $$;

create or replace function public.guard_order_release() returns trigger
language plpgsql security definer set search_path = public
as $$
declare paid numeric(12,2); qc_ok boolean; is_admin boolean;
begin
  if new.status = 'released' and (tg_op = 'INSERT' or old.status is distinct from 'released') then
    select coalesce(sum(amount),0) into paid from public.payments where order_id = new.id;
    select exists(select 1 from public.qc_inspections where order_id = new.id and status = 'approved'
      and quantity_verified and sizes_verified and personalization_verified and print_quality_verified and condition_verified)
      into qc_ok;
    is_admin := public.current_app_role() = 'admin';
    if (not qc_ok or paid < new.total) and not (is_admin and nullif(trim(new.release_exception_reason),'') is not null) then
      raise exception 'Release blocked: approved QC and full payment are required. An admin may record an exception reason.';
    end if;
    if (not qc_ok or paid < new.total) and is_admin then new.release_exception_by := auth.uid(); end if;
    new.release_date := coalesce(new.release_date,now());
  end if;
  return new;
end $$;
create trigger orders_release_guard before insert or update of status on public.orders for each row execute function public.guard_order_release();

do $$ declare t text; begin
  foreach t in array array['customers','products','orders','order_items','player_details','payments','job_orders','production_tasks','design_files','defects','qc_inspections'] loop
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.log_row_change()',t,t);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.player_details enable row level security;
alter table public.payments enable row level security;
alter table public.job_orders enable row level security;
alter table public.production_tasks enable row level security;
alter table public.design_files enable row level security;
alter table public.defects enable row level security;
alter table public.qc_inspections enable row level security;
alter table public.activity_logs enable row level security;

create policy "staff read profiles" on public.profiles for select to authenticated using (public.current_app_role() is not null);
create policy "admins manage profiles" on public.profiles for all to authenticated using (public.has_any_role(array['admin']::public.app_role[])) with check (public.has_any_role(array['admin']::public.app_role[]));
create policy "staff read customers" on public.customers for select to authenticated using (public.current_app_role() is not null);
create policy "front desk manages customers" on public.customers for all to authenticated using (public.has_any_role(array['admin','front_desk']::public.app_role[])) with check (public.has_any_role(array['admin','front_desk']::public.app_role[]));
create policy "staff read products" on public.products for select to authenticated using (public.current_app_role() is not null);
create policy "admin manages products" on public.products for all to authenticated using (public.has_any_role(array['admin']::public.app_role[])) with check (public.has_any_role(array['admin']::public.app_role[]));
create policy "staff read orders" on public.orders for select to authenticated using (public.current_app_role() is not null);
create policy "front desk creates orders" on public.orders for insert to authenticated with check (public.has_any_role(array['admin','front_desk']::public.app_role[]));
create policy "front desk updates orders" on public.orders for update to authenticated using (public.has_any_role(array['admin','front_desk']::public.app_role[])) with check (public.has_any_role(array['admin','front_desk']::public.app_role[]));
create policy "admins delete orders" on public.orders for delete to authenticated using (public.has_any_role(array['admin']::public.app_role[]));
create policy "staff read items" on public.order_items for select to authenticated using (public.current_app_role() is not null);
create policy "front desk manages items" on public.order_items for all to authenticated using (public.has_any_role(array['admin','front_desk']::public.app_role[])) with check (public.has_any_role(array['admin','front_desk']::public.app_role[]));
create policy "staff read player details" on public.player_details for select to authenticated using (public.current_app_role() is not null);
create policy "front desk manages player details" on public.player_details for all to authenticated using (public.has_any_role(array['admin','front_desk']::public.app_role[])) with check (public.has_any_role(array['admin','front_desk']::public.app_role[]));
create policy "staff read payments" on public.payments for select to authenticated using (public.current_app_role() is not null);
create policy "front desk records payments" on public.payments for insert to authenticated with check (public.has_any_role(array['admin','front_desk']::public.app_role[]));
create policy "admins correct payments" on public.payments for update to authenticated using (public.has_any_role(array['admin']::public.app_role[])) with check (public.has_any_role(array['admin']::public.app_role[]));
create policy "staff read job orders" on public.job_orders for select to authenticated using (public.current_app_role() is not null);
create policy "front desk manages job orders" on public.job_orders for all to authenticated using (public.has_any_role(array['admin','front_desk']::public.app_role[])) with check (public.has_any_role(array['admin','front_desk']::public.app_role[]));
create policy "staff read tasks" on public.production_tasks for select to authenticated using (public.current_app_role() is not null);
create policy "roles update assigned stages" on public.production_tasks for update to authenticated using (
  public.has_any_role(array['admin']::public.app_role[]) or
  (stage = 'layout' and public.has_any_role(array['artist']::public.app_role[])) or
  (stage = 'printing' and public.has_any_role(array['printing']::public.app_role[])) or
  (stage = 'heat_press' and public.has_any_role(array['heat_press']::public.app_role[])) or
  (stage in ('cutting','sewing') and public.has_any_role(array['cutting_sewing']::public.app_role[])) or
  (stage = 'qc' and public.has_any_role(array['qc']::public.app_role[]))
) with check (
  public.has_any_role(array['admin']::public.app_role[]) or
  (stage = 'layout' and public.has_any_role(array['artist']::public.app_role[])) or
  (stage = 'printing' and public.has_any_role(array['printing']::public.app_role[])) or
  (stage = 'heat_press' and public.has_any_role(array['heat_press']::public.app_role[])) or
  (stage in ('cutting','sewing') and public.has_any_role(array['cutting_sewing']::public.app_role[])) or
  (stage = 'qc' and public.has_any_role(array['qc']::public.app_role[]))
);
create policy "admin and desk create tasks" on public.production_tasks for insert to authenticated with check (public.has_any_role(array['admin','front_desk']::public.app_role[]));
create policy "staff read design files" on public.design_files for select to authenticated using (public.current_app_role() is not null);
create policy "designers upload files" on public.design_files for insert to authenticated with check (public.has_any_role(array['admin','front_desk','artist']::public.app_role[]));
create policy "admin and designer update files" on public.design_files for update to authenticated using (public.has_any_role(array['admin','artist']::public.app_role[])) with check (public.has_any_role(array['admin','artist']::public.app_role[]));
create policy "staff read defects" on public.defects for select to authenticated using (public.current_app_role() is not null);
create policy "staff report defects" on public.defects for insert to authenticated with check (public.current_app_role() is not null);
create policy "staff update corrections" on public.defects for update to authenticated using (public.current_app_role() is not null) with check (public.current_app_role() is not null);
create policy "staff read QC" on public.qc_inspections for select to authenticated using (public.current_app_role() is not null);
create policy "QC records inspections" on public.qc_inspections for insert to authenticated with check (public.has_any_role(array['admin','qc']::public.app_role[]));
create policy "QC updates inspections" on public.qc_inspections for update to authenticated using (public.has_any_role(array['admin','qc']::public.app_role[])) with check (public.has_any_role(array['admin','qc']::public.app_role[]));
create policy "admins read audit log" on public.activity_logs for select to authenticated using (public.has_any_role(array['admin']::public.app_role[]));

-- Create a private storage bucket for artwork and approved layouts. Storage object policies
-- should be scoped to this bucket and authenticated users with an active staff profile.
insert into storage.buckets (id,name,public) values ('design-files','design-files',false) on conflict (id) do nothing;
create policy "staff read design storage" on storage.objects for select to authenticated using (bucket_id = 'design-files' and public.current_app_role() is not null);
create policy "designers upload design storage" on storage.objects for insert to authenticated with check (bucket_id = 'design-files' and public.has_any_role(array['admin','front_desk','artist']::public.app_role[]));
create policy "designers update design storage" on storage.objects for update to authenticated using (bucket_id = 'design-files' and public.has_any_role(array['admin','artist']::public.app_role[])) with check (bucket_id = 'design-files' and public.has_any_role(array['admin','artist']::public.app_role[]));

