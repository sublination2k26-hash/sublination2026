-- Requires employee work/payroll, automatic task attribution, and team messages.
-- Artist activities document work; attendance remains the source of artist pay.
create schema if not exists activity_private;
revoke all on schema activity_private from public, anon, authenticated;

alter table public.team_messages
  add column reply_to_id bigint references public.team_messages(id),
  add column mentioned_user_ids uuid[] not null default '{}',
  add column activity_task_id uuid references public.production_tasks(id) on delete set null;
create index team_messages_reply_idx on public.team_messages(reply_to_id);
create index team_messages_activity_idx on public.team_messages(activity_task_id);
grant insert (reply_to_id, mentioned_user_ids) on public.team_messages to authenticated;

create function activity_private.validate_message() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.reply_to_id is not null and not exists (
    select 1 from public.team_messages where id=new.reply_to_id and id<new.id
  ) then raise exception 'Choose an existing message to reply to.'; end if;
  if cardinality(new.mentioned_user_ids)>50 or exists (
    select 1 from unnest(new.mentioned_user_ids) as m(id)
    where m.id is null or not exists (
      select 1 from public.profiles p where p.id=m.id and p.active
        and position(('@[' || p.full_name || '](' || p.id::text || ')') in new.body)>0
    )
  ) then raise exception 'Mentions must refer to active accounts included in the message.'; end if;
  return new;
end $$;
revoke all on function activity_private.validate_message() from public, anon, authenticated;
create trigger team_message_validation before insert on public.team_messages
for each row execute function activity_private.validate_message();

-- Privileged only to write the protected work ledger and system activity columns.
-- Not exposed as an RPC; records always use the current authenticated actor.
create function activity_private.track_layout() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role := public.current_app_role();
  v_name text;
  v_order text;
  v_rework boolean;
begin
  if v_actor is null or v_role is null or new.stage<>'layout' or old.status=new.status then return new; end if;
  if new.status not in ('in_progress','completed','returned_for_correction') then return new; end if;
  -- Routing can auto-complete earlier stages with attribution intentionally cleared.
  if new.status='completed' and new.completed_by is distinct from v_actor then return new; end if;
  if new.status='in_progress' and new.started_by is distinct from v_actor then return new; end if;
  select full_name into v_name from public.profiles where id=v_actor and active;
  select order_number into v_order from public.orders where id=new.order_id;
  if new.status='completed' and v_role='artist' then
    select exists(select 1 from public.employee_work_records where task_id=new.id and role='artist') into v_rework;
    insert into public.employee_work_records(
      employee_id,order_id,task_id,role,activity,quantity,unit_rate,work_date,
      started_at,completed_at,status,is_rework,pay_eligible,rework_reason,recorded_by,notes
    ) values (
      v_actor,new.order_id,new.id,'artist','Design / layout completed',
      coalesce((select quantity from public.order_items where id=new.order_item_id),1),0,
      (coalesce(new.completed_at,clock_timestamp()) at time zone 'Asia/Manila')::date,
      new.started_at,coalesce(new.completed_at,clock_timestamp()),'pending_review',v_rework,false,
      case when v_rework then 'Layout completed again after an earlier completion.' end,v_actor,
      'Activity tracking only. Artist earnings come from approved attendance.'
    );
  end if;
  insert into public.team_messages(sender_id,body,activity_task_id)
  values(v_actor,left(coalesce(v_name,'Staff member'),200) || ' — ' || coalesce(v_order,'Order') || ': Layout ' ||
    case new.status when 'in_progress' then 'started.' when 'completed' then 'completed.'
      else 'returned for correction.' end,new.id);
  return new;
end $$;
revoke all on function activity_private.track_layout() from public, anon, authenticated;
create trigger layout_activity_tracking after update of status on public.production_tasks
for each row when (old.status is distinct from new.status) execute function activity_private.track_layout();

-- Link reviewed artist records to new payrolls without changing earnings or old snapshots.
create function activity_private.attach_artist_work() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin' or new.role<>'artist' then return new; end if;
  update public.employee_work_records w set payroll_run_id=new.payroll_run_id
  from public.payroll_runs r
  where r.id=new.payroll_run_id and r.status='draft' and w.employee_id=new.employee_id
    and w.role='artist' and w.activity='Design / layout completed' and w.status='approved'
    and w.payroll_run_id is null and w.work_date between r.period_start and r.period_end;
  return new;
end $$;
revoke all on function activity_private.attach_artist_work() from public, anon, authenticated;
create trigger payroll_artist_work after insert on public.payroll_lines
for each row execute function activity_private.attach_artist_work();

notify pgrst, 'reload schema';
