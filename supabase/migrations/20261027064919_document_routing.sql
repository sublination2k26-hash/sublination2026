-- Independent document register: no inventory, payroll or production side effects.
create table public.routing_documents (
  id uuid primary key default gen_random_uuid(),
  pr_number text not null check (length(trim(pr_number)) between 1 and 100),
  po_number text not null default '' check (length(po_number) <= 100),
  title text not null check (length(trim(title)) between 1 and 300),
  payee text not null default '' check (length(payee) <= 200),
  request_date date not null,
  amount numeric(12,2) not null default 0 check (amount >= 0 and amount <= 9999999999.99),
  cheque_number text not null default '' check (length(cheque_number) <= 100),
  bir_reference text not null default '' check (length(bir_reference) <= 100),
  gross_amount numeric(12,2) not null default 0 check (gross_amount >= 0 and gross_amount <= 9999999999.99),
  tax_deduction numeric(12,2) not null default 0 check (tax_deduction >= 0 and tax_deduction <= gross_amount),
  net_amount numeric(12,2) generated always as (gross_amount - tax_deduction) stored,
  released_date date,
  released_to text not null default '' check (length(released_to) <= 200),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint routing_release_details check (released_date is null or
    (released_date >= request_date and length(trim(cheque_number)) > 0
      and length(trim(released_to)) > 0 and gross_amount > 0))
);
create unique index routing_documents_pr_unique on public.routing_documents(lower(trim(pr_number)));

create table public.document_routing_entries (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.routing_documents(id),
  stage text not null check (stage in ('P.R.', 'P.O.', 'COA', 'BAC', 'GSO', 'BADMIN', 'GSO BODEGA', 'INSPECTOR', 'NUMBERING', 'CHECKING', 'ACCOUNTING', 'ASSESSORS', 'CHEQUE RELEASE')),
  received_date date not null,
  forwarded_date date check (forwarded_date >= received_date),
  handled_by text not null default '' check (length(handled_by) <= 200),
  remarks text not null default '' check (length(remarks) <= 2000),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create index document_routing_entries_document on public.document_routing_entries(document_id, created_at);

alter table public.routing_documents enable row level security;
alter table public.document_routing_entries enable row level security;
revoke all on public.routing_documents, public.document_routing_entries from public, anon, authenticated;
grant select, insert, update on public.routing_documents to authenticated;
grant select, insert on public.document_routing_entries to authenticated;

create policy routing_documents_admin_read on public.routing_documents for select to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role);
create policy routing_documents_admin_insert on public.routing_documents for insert to authenticated
  with check ((select public.current_app_role()) = 'admin'::public.app_role);
create policy routing_documents_admin_update on public.routing_documents for update to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role)
  with check ((select public.current_app_role()) = 'admin'::public.app_role);
create policy routing_entries_admin_read on public.document_routing_entries for select to authenticated
  using ((select public.current_app_role()) = 'admin'::public.app_role);
create policy routing_entries_admin_insert on public.document_routing_entries for insert to authenticated
  with check ((select public.current_app_role()) = 'admin'::public.app_role);

create function public.stamp_routing_document() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  else
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
  end if;
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger stamp_routing_document before insert or update on public.routing_documents
  for each row execute function public.stamp_routing_document();

create function public.stamp_routing_entry() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.created_by := auth.uid();
  new.created_at := clock_timestamp();
  return new;
end;
$$;
create trigger stamp_routing_entry before insert on public.document_routing_entries
  for each row execute function public.stamp_routing_entry();
revoke all on function public.stamp_routing_document(), public.stamp_routing_entry() from public, anon, authenticated;
grant execute on function public.stamp_routing_document(), public.stamp_routing_entry() to authenticated;
