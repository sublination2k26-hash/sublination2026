-- Correct intake status for orders physically completed before encoding.
-- Keep task histories intact rather than recording fabricated production/QC work.
create function public.admin_mark_order_ready(p_order_id uuid,p_reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare v_order public.orders%rowtype;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin' then
    raise exception 'Only admins can mark previous orders ready for release.';
  end if;
  if nullif(trim(p_reason),'') is null or length(p_reason)>1000 then
    raise exception 'Enter a reason of up to 1000 characters.';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_order.status in ('released','cancelled') then
    raise exception 'Released or cancelled orders cannot be marked ready.';
  end if;
  if v_order.status='ready_for_release' then return; end if;
  update public.orders set status='ready_for_release',updated_at=now(),
    notes=concat_ws(E'\n',nullif(notes,''),'Admin marked ready for release (previous order): '||trim(p_reason))
    where id=p_order_id;
end;
$$;
revoke all on function public.admin_mark_order_ready(uuid,text) from public,anon;
grant execute on function public.admin_mark_order_ready(uuid,text) to authenticated;
notify pgrst,'reload schema';
