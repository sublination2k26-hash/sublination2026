-- Early assignments reserve pieces; handoffs wait for upstream production.
create schema if not exists sewing_private;
revoke all on schema sewing_private from public, anon;
grant usage on schema sewing_private to authenticated;
-- Existing task histories keep the legacy behavior until explicitly assigned.
alter table public.production_tasks add column sewing_tracking boolean not null default false;
alter table public.production_tasks alter column sewing_tracking set default true;

create table public.sewing_assignments (
  id uuid primary key,
  task_id uuid not null references public.production_tasks(id) on delete restrict,
  employee_id uuid not null references public.profiles(id),
  quantity integer not null check (quantity > 0),
  assigned_by uuid not null references public.profiles(id),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index sewing_assignments_task_idx on public.sewing_assignments(task_id);
create index sewing_assignments_employee_idx on public.sewing_assignments(employee_id);
create index sewing_assignments_actor_idx on public.sewing_assignments(assigned_by);
create table public.sewing_events (
  id uuid primary key,
  assignment_id uuid not null references public.sewing_assignments(id) on delete restrict,
  kind text not null check (kind in ('handoff','completion','rework')),
  quantity integer not null check (quantity > 0),
  recorded_by uuid not null references public.profiles(id),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index sewing_events_assignment_idx on public.sewing_events(assignment_id);
create index sewing_events_actor_idx on public.sewing_events(recorded_by);
alter table public.sewing_assignments enable row level security;
alter table public.sewing_events enable row level security;
revoke all on public.sewing_assignments, public.sewing_events from anon, authenticated;
grant select on public.sewing_assignments, public.sewing_events to authenticated;
create policy "read own sewing assignments" on public.sewing_assignments for select to authenticated
using (public.current_app_role() in ('admin','front_desk') or (employee_id=auth.uid() and public.current_app_role()='cutting_sewing'));
create policy "read own sewing events" on public.sewing_events for select to authenticated
using (exists(select 1 from public.sewing_assignments a where a.id=assignment_id));

alter table public.employee_work_records add column sewing_event_id uuid unique references public.sewing_events(id);

-- This narrow RPC owns the atomic handoff/output/payroll transaction. No direct writes.
create function sewing_private.record_action(
  p_action text, p_task_id uuid, p_assignment_id uuid, p_employee_id uuid,
  p_quantity integer, p_notes text, p_request_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_role public.app_role := public.current_app_role();
  v_task public.production_tasks%rowtype;
  v_assignment public.sewing_assignments%rowtype;
  v_event public.sewing_events%rowtype;
  v_total integer; v_assigned bigint; v_handed bigint; v_completed bigint;
  v_rate numeric := 0;
begin
  if auth.uid() is null or v_role is null then raise exception 'An active staff account is required.'; end if;
  if p_request_id is null or p_quantity is null or p_quantity < 1 or length(coalesce(p_notes,''))>1000 then
    raise exception 'A positive whole quantity and request ID are required (notes: 1000 characters maximum).';
  end if;
  if p_action is null or p_action not in ('assign','handoff','completion','rework') then raise exception 'Invalid sewing action.'; end if;
  select * into v_task from public.production_tasks where id=p_task_id for update;
  if not found or v_task.stage <> 'sewing' or v_task.order_item_id is null then raise exception 'Choose a sewing task.'; end if;
  if p_action in ('assign','handoff') and v_role not in ('admin','front_desk') then raise exception 'Only admin or front desk can assign or hand over pieces.'; end if;
  if p_action in ('completion','rework') and v_role <> 'cutting_sewing' then raise exception 'Only the assigned sewer can record output.'; end if;

  if p_action='assign' then
    select * into v_assignment from public.sewing_assignments where id=p_request_id;
    if found then
      if v_assignment.task_id=p_task_id and v_assignment.employee_id=p_employee_id and v_assignment.quantity=p_quantity and v_assignment.assigned_by=auth.uid() and v_assignment.notes=coalesce(p_notes,'') then return v_assignment.id; end if;
      raise exception 'Request ID already used for different details.';
    end if;
  else
    select * into v_assignment from public.sewing_assignments where id=p_assignment_id and task_id=p_task_id;
    if not found then raise exception 'Assignment not found.'; end if;
    if p_action in ('completion','rework') and v_assignment.employee_id<>auth.uid() then raise exception 'Record only your own sewing output.'; end if;
    select * into v_event from public.sewing_events where id=p_request_id;
    if found then
      if v_event.assignment_id=p_assignment_id and v_event.kind=p_action and v_event.quantity=p_quantity and v_event.recorded_by=auth.uid() and v_event.notes=coalesce(p_notes,'') then return v_event.id; end if;
      raise exception 'Request ID already used for different details.';
    end if;
  end if;
  if exists(select 1 from public.orders where id=v_task.order_id and status in ('released','cancelled','ready_for_release')) then
    raise exception 'This order is no longer accepting sewing work.';
  end if;
  if p_action='assign' then
    if v_task.status='completed' or exists(select 1 from public.employee_work_records where task_id=p_task_id and sewing_event_id is null) then
      raise exception 'Cannot add assignments to completed sewing or legacy output records.';
    end if;
    if not exists(select 1 from public.profiles where id=p_employee_id and active and role='cutting_sewing') then raise exception 'Choose an active sewer.'; end if;
    select quantity into v_total from public.order_items where id=v_task.order_item_id for update;
    select coalesce(sum(quantity),0) into v_assigned from public.sewing_assignments where task_id=p_task_id;
    if v_assigned+p_quantity>v_total then raise exception 'Assigned pieces cannot exceed the order item quantity.'; end if;
    insert into public.sewing_assignments(id,task_id,employee_id,quantity,assigned_by,notes)
    values(p_request_id,p_task_id,p_employee_id,p_quantity,auth.uid(),coalesce(p_notes,''));
    return p_request_id;
  end if;
  if exists(select 1 from public.production_tasks where order_item_id=v_task.order_item_id and stage<'sewing' and status<>'completed') then
    raise exception 'Waiting for materials: finish the earlier production stages first.';
  end if;
  if v_task.status='completed' and p_action<>'rework' then raise exception 'Sewing is already completed.'; end if;
  select coalesce(sum(quantity) filter(where kind='handoff'),0),coalesce(sum(quantity) filter(where kind='completion'),0)
  into v_handed,v_completed from public.sewing_events where assignment_id=p_assignment_id;
  if p_action='handoff' and v_handed+p_quantity>v_assignment.quantity then raise exception 'Handoff exceeds assigned pieces.'; end if;
  if p_action='completion' and v_completed+p_quantity>v_handed then raise exception 'Output exceeds pieces handed over by Front Desk.'; end if;
  if p_action='rework' and (p_quantity>v_completed or trim(coalesce(p_notes,''))='') then raise exception 'Rework needs a reason and cannot exceed previously completed pieces.'; end if;
  insert into public.sewing_events(id,assignment_id,kind,quantity,recorded_by,notes)
  values(p_request_id,p_assignment_id,p_action,p_quantity,auth.uid(),coalesce(p_notes,''));
  if p_action in ('completion','rework') then
    select coalesce(piece_rate,0) into v_rate from public.employee_compensation where employee_id=auth.uid() and salary_basis in ('piece','combined');
    insert into public.employee_work_records(employee_id,order_id,task_id,role,activity,quantity,unit_rate,work_date,started_at,completed_at,status,is_rework,pay_eligible,rework_reason,recorded_by,notes,sewing_event_id)
    values(auth.uid(),v_task.order_id,p_task_id,'cutting_sewing',case when p_action='rework' then 'Sewing rework' else 'Sewing batch completed' end,
      p_quantity,coalesce(v_rate,0),(now() at time zone 'Asia/Manila')::date,coalesce(v_task.started_at,now()),now(),'pending_review',p_action='rework',p_action<>'rework' and not exists(select 1 from public.orders where id=v_task.order_id and notes like '[SEWING EXAMPLE]%'),
      case when p_action='rework' then p_notes else null end,auth.uid(),coalesce(p_notes,''),p_request_id);
    select quantity into v_total from public.order_items where id=v_task.order_item_id;
    select coalesce(sum(e.quantity),0) into v_completed from public.sewing_events e join public.sewing_assignments a on a.id=e.assignment_id where a.task_id=p_task_id and e.kind='completion';
    if p_action='completion' then
    update public.production_tasks set status=case when v_completed=v_total then 'completed'::public.task_status else 'in_progress'::public.task_status end,
      started_at=coalesce(started_at,now()),started_by=coalesce(started_by,auth.uid()),completed_by=null,
      completed_at=case when v_completed=v_total then now() else null end,updated_at=now() where id=p_task_id;
    end if;
  end if;
  return p_request_id;
end $$;
revoke all on function sewing_private.record_action(text,uuid,uuid,uuid,integer,text,uuid) from public, anon;
grant execute on function sewing_private.record_action(text,uuid,uuid,uuid,integer,text,uuid) to authenticated;
create function public.record_sewing_action(p_action text,p_task_id uuid,p_assignment_id uuid,p_employee_id uuid,p_quantity integer,p_notes text,p_request_id uuid)
returns uuid language sql security invoker set search_path='' as $$
  select sewing_private.record_action(p_action,p_task_id,p_assignment_id,p_employee_id,p_quantity,p_notes,p_request_id);
$$;
revoke all on function public.record_sewing_action(text,uuid,uuid,uuid,integer,text,uuid) from public, anon;
grant execute on function public.record_sewing_action(text,uuid,uuid,uuid,integer,text,uuid) to authenticated;

-- Guard generic stage buttons/API calls too, rather than relying on the screen.
create function sewing_private.guard_task() returns trigger language plpgsql security definer set search_path='' as $$
declare v_qty integer; v_done bigint;
begin
  if old.sewing_tracking and not new.sewing_tracking then raise exception 'Sewing tracking cannot be disabled.'; end if;
  if old.stage='sewing' and (old.sewing_tracking or exists(select 1 from public.sewing_assignments where task_id=old.id)) then
    if new.order_item_id is distinct from old.order_item_id or new.order_id<>old.order_id or new.stage<>old.stage then raise exception 'Assigned sewing task identity cannot be changed.'; end if;
    if new.status in ('in_progress','completed') and old.status is distinct from new.status then
      if exists(select 1 from public.production_tasks where order_item_id=new.order_item_id and stage<'sewing' and status<>'completed') then raise exception 'Finish the earlier production stages first.'; end if;
      if new.status='in_progress' and not exists(select 1 from public.sewing_events e join public.sewing_assignments a on a.id=e.assignment_id where a.task_id=new.id and e.kind='handoff') then
        raise exception 'Front Desk must assign and hand over pieces before sewing starts.';
      end if;
      if new.status='completed' then
        select quantity into v_qty from public.order_items where id=new.order_item_id;
        select coalesce(sum(e.quantity),0) into v_done from public.sewing_events e join public.sewing_assignments a on a.id=e.assignment_id where a.task_id=new.id and e.kind='completion';
        if v_done<>v_qty then raise exception 'Record every assigned sewer output before completing Sewing.'; end if;
      end if;
    end if;
    -- Batch events already created the payroll records; generic completion must not duplicate them.
    new.completed_by:=null;
  end if;
  if new.stage='qc' and new.status='completed' and old.status<>'completed'
    and exists(select 1 from public.production_tasks t where t.order_id=new.order_id and t.stage='sewing' and t.status<>'completed'
      and (t.sewing_tracking or exists(select 1 from public.sewing_assignments a where a.task_id=t.id))) then
    raise exception 'Finish all assigned sewing pieces before QC approval.';
  end if;
  return new;
end $$;
revoke all on function sewing_private.guard_task() from public, anon, authenticated;
create trigger assigned_sewing_guard before update on public.production_tasks for each row execute function sewing_private.guard_task();

create function sewing_private.guard_item() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.quantity<>old.quantity or new.order_id<>old.order_id or new.product_id is distinct from old.product_id or new.production_type<>old.production_type)
    and exists(select 1 from public.production_tasks t join public.sewing_assignments a on a.task_id=t.id where t.order_item_id=old.id) then
    raise exception 'Assigned order item quantity and product cannot be changed.';
  end if;
  return new;
end $$;
revoke all on function sewing_private.guard_item() from public, anon, authenticated;
create trigger assigned_sewing_item_guard before update on public.order_items for each row execute function sewing_private.guard_item();

-- Explicitly labeled sample, created once per workspace. Real users are never fabricated.
create function public.create_sewing_example_order() returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null or public.current_app_role() is null or public.current_app_role() not in ('admin','front_desk') then raise exception 'Only admin or front desk can create the example.'; end if;
  perform pg_advisory_xact_lock(291065538);
  select id into v_id from public.orders where notes like '[SEWING EXAMPLE]%' order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  return public.create_dashboard_order('EXAMPLE - Barangay Eagles jerseys','','Example jersey','full_garment',24,(now() at time zone 'Asia/Manila')::date+7,350,0,
    'Example sizes: S 6, M 8, L 6, XL 4. Names and numbers to follow.',
    '[SEWING EXAMPLE] Training order: 24 jerseys. Assign 10, 8 and 6 to your actual sewers, or choose another split. Complete Layout, Printing, Heat Press and Cutting, then hand over materials. Example records are real order records; do not approve their output for payroll.');
end $$;
revoke all on function public.create_sewing_example_order() from public, anon;
grant execute on function public.create_sewing_example_order() to authenticated;
