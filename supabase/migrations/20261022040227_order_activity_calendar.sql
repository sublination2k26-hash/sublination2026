-- Staff can read a limited, order-scoped projection of the existing immutable audit.
-- Keep the complete audit log restricted to admins.
create or replace function public.get_order_activity_calendar(p_order_id uuid)
returns table (
  id bigint, occurred_at timestamptz, actor_name text, assignee_name text,
  entity_table text, entity_id text, action text, old_state jsonb, new_state jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or public.current_app_role() is null then
    raise exception 'An active staff account is required.';
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'Order not found.';
  end if;

  return query
  select a.id, a.created_at, coalesce(p.full_name, 'System'), assigned.full_name,
    a.entity_table, a.entity_id, a.action,
    (select jsonb_object_agg(j.key,j.value) from jsonb_each(a.old_data) j
      where j.key = any(array['stage','status','completed_by','assigned_to','correction_status','description','origin_stage','return_stage','return_destination','approval_to_resume','required_action','affected_component'])),
    (select jsonb_object_agg(j.key,j.value) from jsonb_each(a.new_data) j
      where j.key = any(array['stage','status','completed_by','assigned_to','correction_status','description','origin_stage','return_stage','return_destination','approval_to_resume','required_action','affected_component']))
  from public.activity_logs a
  left join public.profiles p on p.id = a.actor_id
  left join public.profiles assigned on assigned.id::text = coalesce(a.new_data->>'assigned_to',a.old_data->>'assigned_to')
  where (a.entity_table = 'orders' and a.entity_id = p_order_id::text)
     or (a.entity_table = any(array['production_tasks','defects','qc_inspections','order_items','payments','design_files','job_orders','player_details'])
       and coalesce(a.new_data->>'order_id',a.old_data->>'order_id') = p_order_id::text)
  order by a.created_at, a.id;
end;
$$;

revoke all on function public.get_order_activity_calendar(uuid) from public, anon;
grant execute on function public.get_order_activity_calendar(uuid) to authenticated;
