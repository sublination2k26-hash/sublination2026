-- Deleting an order is a separate action after cancellation.
-- Keep the existing retention, backup, and admin checks in place.
create function public.guard_cancelled_order_deletion() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin' then
    raise exception 'Only admin can delete orders.';
  end if;
  if old.status is distinct from 'cancelled' then
    raise exception 'Cancel the order first. Permanently delete it from the Cancelled folder.';
  end if;
  return old;
end;
$$;
revoke all on function public.guard_cancelled_order_deletion() from public,anon,authenticated;
create trigger a_guard_cancelled_order_deletion before delete on public.orders
  for each row execute function public.guard_cancelled_order_deletion();
notify pgrst,'reload schema';
