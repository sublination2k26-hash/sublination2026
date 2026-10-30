-- Each pickup records the number of pieces handed over. Existing releases remain unchanged.
create table public.order_releases (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  received_by text not null check (length(trim(received_by)) between 1 and 200),
  notes text not null default '' check (length(notes) <= 1000),
  exception_reason text not null default '' check (length(exception_reason) <= 1000),
  released_by uuid not null references public.profiles(id),
  released_at timestamptz not null default now()
);
create index order_releases_order_idx on public.order_releases(order_id);
alter table public.order_releases enable row level security;
revoke all on public.order_releases from anon, authenticated;
grant select, insert on public.order_releases to authenticated;
create policy "staff read release history" on public.order_releases for select to authenticated
using (public.current_app_role() is not null);
create policy "front desk records releases" on public.order_releases for insert to authenticated
with check (public.current_app_role() in ('admin','front_desk') and released_by = auth.uid());

create function public.guard_piece_release() returns trigger
language plpgsql set search_path = '' as $$
declare v_order public.orders; v_total bigint; v_released bigint; v_paid numeric; v_qc boolean;
begin
  if auth.uid() is null or public.current_app_role() is null or public.current_app_role() not in ('admin','front_desk') then
    raise exception 'Only admin or front desk can release pieces.';
  end if;
  select * into v_order from public.orders where id = new.order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_order.status in ('released','cancelled') then raise exception 'This order is already released or cancelled.'; end if;
  if v_order.status <> 'ready_for_release' then raise exception 'The order must be ready for release.'; end if;
  select coalesce(sum(quantity),0) into v_total from public.order_items where order_id = new.order_id;
  select coalesce(sum(quantity),0) into v_released from public.order_releases where order_id = new.order_id;
  if new.quantity is null or new.quantity <= 0 or new.quantity > v_total - v_released then
    raise exception 'Release quantity exceeds the remaining pieces or is invalid.';
  end if;
  select coalesce(sum(amount),0) into v_paid from public.payments where order_id = new.order_id;
  select exists(select 1 from public.qc_inspections where order_id = new.order_id and status = 'approved'
    and quantity_verified and sizes_verified and personalization_verified and print_quality_verified and condition_verified) into v_qc;
  if (not v_qc or v_paid < v_order.total) and not
    (public.current_app_role() = 'admin' and length(trim(new.exception_reason)) > 0) then
    raise exception 'Release blocked: approved QC and full payment are required. An admin may record an exception reason.';
  end if;
  new.released_by := auth.uid();
  new.released_at := now();
  if v_released + new.quantity = v_total then
    update public.orders set status = 'released', release_date = now(), updated_at = now(),
      release_exception_reason = nullif(trim(new.exception_reason),''),
      release_exception_by = case when not v_qc or v_paid < v_order.total then auth.uid() else null end
      where id = new.order_id;
  end if;
  return new;
end $$;
create trigger order_piece_release_guard before insert on public.order_releases
for each row execute function public.guard_piece_release();

-- Keep the quantity used for release accounting stable after the first pickup.
create function public.guard_released_item_quantity() returns trigger
language plpgsql set search_path = '' as $$
declare v_order_id uuid;
begin
  v_order_id := case when tg_op = 'INSERT' then new.order_id else old.order_id end;
  perform 1 from public.orders where id = v_order_id for update;
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
create trigger released_item_quantity_guard before insert or update or delete on public.order_items
for each row execute function public.guard_released_item_quantity();

create function public.check_piece_release_completion() returns trigger
language plpgsql set search_path = '' as $$
declare v_released bigint; v_total bigint;
begin
  if new.status = 'released' then
    select coalesce(sum(quantity),0) into v_released from public.order_releases where order_id = new.id;
    select coalesce(sum(quantity),0) into v_total from public.order_items where order_id = new.id;
    if v_released > 0 and v_released <> v_total then
      raise exception 'Release the remaining pieces before completing this order.';
    end if;
  end if;
  return null;
end $$;
create constraint trigger piece_release_completion after update on public.orders
deferrable initially deferred for each row execute function public.check_piece_release_completion();
