-- Keep settled orders available for inventory review for three calendar months.
-- This guards API deletes too; expiration permits manual deletion, never automatic deletion.
create function public.guard_paid_order_retention() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_paid numeric;
  v_last_payment timestamptz;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin' then
    raise exception 'Only admin can delete orders.';
  end if;
  select coalesce(sum(amount),0),max(received_at)
    into v_paid,v_last_payment from public.payments where order_id=old.id;
  if v_paid >= old.total and now() <
      ((coalesce(v_last_payment,old.created_at) at time zone 'Asia/Manila') + interval '3 months') at time zone 'Asia/Manila' then
    raise exception 'Keep fully paid orders for at least 3 months after the final payment for inventory reference.';
  end if;
  return old;
end;
$$;
revoke all on function public.guard_paid_order_retention() from public,anon,authenticated;
create trigger a_guard_paid_order_retention before delete on public.orders
  for each row execute function public.guard_paid_order_retention();
notify pgrst, 'reload schema';
