-- All active sewers see the shared queue. Individual assignments/output stay private.
create function sewing_private.queue()
returns table(task_id uuid, available_quantity bigint, claimed_quantity bigint)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or public.current_app_role() is null or public.current_app_role() not in ('admin','front_desk','cutting_sewing') then
    raise exception 'An active sewing, admin or front desk account is required.';
  end if;
  return query
    select t.id, i.quantity::bigint-coalesce(a.quantity,0), coalesce(a.quantity,0)
    from public.production_tasks t
    join public.order_items i on i.id=t.order_item_id
    join public.orders o on o.id=t.order_id
    left join (select s.task_id,sum(s.quantity) as quantity from public.sewing_assignments s group by s.task_id) a on a.task_id=t.id
    where t.stage='sewing' and t.status<>'completed' and o.status not in ('released','cancelled','ready_for_release')
      and not exists(select 1 from public.employee_work_records w where w.task_id=t.id and w.sewing_event_id is null);
end $$;
revoke all on function sewing_private.queue() from public, anon;
grant execute on function sewing_private.queue() to authenticated;
create function public.get_sewing_queue()
returns table(task_id uuid, available_quantity bigint, claimed_quantity bigint)
language sql stable security invoker set search_path='' as $$ select * from sewing_private.queue(); $$;
revoke all on function public.get_sewing_queue() from public, anon;
grant execute on function public.get_sewing_queue() to authenticated;

create function sewing_private.claim(p_task_id uuid,p_quantity integer,p_notes text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_task public.production_tasks%rowtype;
  v_previous public.sewing_assignments%rowtype;
  v_quantity integer; v_claimed bigint;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'cutting_sewing' then raise exception 'Only an active sewer can claim pieces for themselves.'; end if;
  if p_request_id is null or p_quantity is null or p_quantity<1 or length(coalesce(p_notes,''))>1000 then
    raise exception 'Choose a positive whole quantity and valid request ID (notes: 1000 characters maximum).';
  end if;
  -- The same task lock is used by Front Desk assignments, handoffs and completions.
  select * into v_task from public.production_tasks where id=p_task_id for update;
  if not found or v_task.stage<>'sewing' or v_task.order_item_id is null then raise exception 'Choose a sewing task.'; end if;
  select * into v_previous from public.sewing_assignments where id=p_request_id;
  if found then
    if v_previous.task_id=p_task_id and v_previous.employee_id=auth.uid() and v_previous.assigned_by=auth.uid() and v_previous.quantity=p_quantity and v_previous.notes=coalesce(p_notes,'') then return v_previous.id; end if;
    raise exception 'Request ID already used for different details.';
  end if;
  if v_task.status='completed' or exists(select 1 from public.orders where id=v_task.order_id and status in ('released','cancelled','ready_for_release')) then
    raise exception 'This order is no longer accepting sewing claims.';
  end if;
  if exists(select 1 from public.employee_work_records where task_id=p_task_id and sewing_event_id is null) then
    raise exception 'Legacy sewing output cannot be claimed again.';
  end if;
  select quantity into v_quantity from public.order_items where id=v_task.order_item_id for update;
  select coalesce(sum(quantity),0) into v_claimed from public.sewing_assignments where task_id=p_task_id;
  if v_claimed+p_quantity>v_quantity then raise exception 'Not enough unclaimed pieces remain. Refresh the queue and choose the available quantity.'; end if;
  insert into public.sewing_assignments(id,task_id,employee_id,quantity,assigned_by,notes)
  values(p_request_id,p_task_id,auth.uid(),p_quantity,auth.uid(),coalesce(p_notes,''));
  return p_request_id;
end $$;
revoke all on function sewing_private.claim(uuid,integer,text,uuid) from public, anon;
grant execute on function sewing_private.claim(uuid,integer,text,uuid) to authenticated;
create function public.claim_sewing_pieces(p_task_id uuid,p_quantity integer,p_notes text,p_request_id uuid)
returns uuid language sql security invoker set search_path='' as $$
  select sewing_private.claim(p_task_id,p_quantity,p_notes,p_request_id);
$$;
revoke all on function public.claim_sewing_pieces(uuid,integer,text,uuid) from public, anon;
grant execute on function public.claim_sewing_pieces(uuid,integer,text,uuid) to authenticated;
