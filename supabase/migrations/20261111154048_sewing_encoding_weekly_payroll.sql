begin;
alter table public.sewing_garment_rates add column promo_rate numeric(12,2)
  check (promo_rate>=0 and promo_rate<>'NaN'::numeric);
create table public.sewing_payroll_settings (
  id boolean primary key default true check(id),
  week_starts_on integer not null default 1 check(week_starts_on between 0 and 6)
);
insert into public.sewing_payroll_settings values(true,1);
alter table public.sewing_payroll_settings enable row level security;
revoke all on public.sewing_payroll_settings from public,anon,authenticated;
grant select,update on public.sewing_payroll_settings to authenticated;
create policy sewing_week_read on public.sewing_payroll_settings for select to authenticated using(public.current_app_role() in ('admin','front_desk','sewer'));
create policy sewing_week_update on public.sewing_payroll_settings for update to authenticated using(public.current_app_role()='admin') with check(public.current_app_role()='admin');
create table public.sewing_encodings (
  id uuid primary key,
  assignment_id uuid not null references public.sewing_assignments(id),
  task_id uuid references public.production_tasks(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  employee_id uuid not null references public.profiles(id),
  quantity integer not null check(quantity>0),
  pricing_mode text not null check(pricing_mode in ('regular','promo')),
  unit_rate numeric(12,2) not null check(unit_rate>=0 and unit_rate<>'NaN'::numeric),
  work_date date not null,
  notes text not null default '' check(length(notes)<=1000),
  status text not null default 'pending' check(status in ('pending','posted','void')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  review_reason text not null default '',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz
);
create index sewing_encodings_task on public.sewing_encodings(task_id,status);
create index sewing_encodings_week on public.sewing_encodings(work_date,status);
create index sewing_encodings_employee on public.sewing_encodings(employee_id,work_date);
create index sewing_encodings_assignment on public.sewing_encodings(assignment_id);
create table public.sewing_payroll_controls (
  task_id uuid primary key references public.production_tasks(id) on delete cascade,
  paused boolean not null default false,
  reason text not null check(length(trim(reason)) between 1 and 1000),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table public.sewing_encoding_audit (
  id bigint generated always as identity primary key,
  encoding_id uuid references public.sewing_encodings(id),
  task_id uuid references public.production_tasks(id) on delete set null,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  before_value jsonb,
  after_value jsonb,
  reason text not null,
  created_at timestamptz not null default now()
);
create index sewing_encoding_audit_encoding on public.sewing_encoding_audit(encoding_id);
create index sewing_encoding_audit_task on public.sewing_encoding_audit(task_id,created_at);
alter table public.sewing_encodings enable row level security;
alter table public.sewing_payroll_controls enable row level security;
alter table public.sewing_encoding_audit enable row level security;
revoke all on public.sewing_encodings,public.sewing_payroll_controls,public.sewing_encoding_audit from public,anon,authenticated;
grant select on public.sewing_encodings,public.sewing_payroll_controls,public.sewing_encoding_audit to authenticated;
create policy sewing_encodings_read on public.sewing_encodings for select to authenticated
using(public.current_app_role() in ('admin','front_desk') or (public.current_app_role()='sewer' and employee_id=auth.uid()));
create policy sewing_controls_read on public.sewing_payroll_controls for select to authenticated
using(public.current_app_role() in ('admin','front_desk') or exists(select 1 from public.sewing_assignments a where a.task_id=sewing_payroll_controls.task_id and a.employee_id=auth.uid() and public.current_app_role()='sewer'));
create policy sewing_encoding_audit_read on public.sewing_encoding_audit for select to authenticated using(public.current_app_role()='admin');
alter table public.employee_work_records add column sewing_encoding_id uuid unique references public.sewing_encodings(id);
create schema if not exists sewing_monitor_private;
revoke all on schema sewing_monitor_private from public,anon;
grant usage on schema sewing_monitor_private to authenticated;

-- A review queue retains over-encoding rather than losing the warning on rejection.
create function sewing_monitor_private.encode(p_id uuid,p_assignment uuid,p_quantity integer,p_mode text,p_date date,p_notes text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.sewing_assignments%rowtype; e public.sewing_encodings%rowtype; v_rate numeric; v_basis text; v_garment text; v_task public.production_tasks%rowtype;
begin
  if auth.uid() is null or public.current_app_role() not in ('admin','front_desk','sewer') or public.current_app_role() is null then raise exception 'An active sewing or office account is required.'; end if;
  perform pg_advisory_xact_lock(734221901);
  if p_id is null or p_quantity is null or p_quantity<1 or p_quantity>1000000 or p_date is null or p_date>(now() at time zone 'Asia/Manila')::date or p_mode is null or p_mode not in ('regular','promo') or length(coalesce(p_notes,''))>1000 then raise exception 'Enter a valid quantity, rate option, date and notes.'; end if;
  select * into a from public.sewing_assignments where id=p_assignment;
  if not found then raise exception 'Assignment not found.'; end if;
  if public.current_app_role()='sewer' and a.employee_id<>auth.uid() then raise exception 'Encode only your own assignments.'; end if;
  select * into v_task from public.production_tasks where id=a.task_id for update;
  if not found then raise exception 'This assignment no longer has a production job.'; end if;
  select * into e from public.sewing_encodings where id=p_id;
  if found then
    if e.created_by=auth.uid() and e.assignment_id=p_assignment and e.quantity=p_quantity and e.pricing_mode=p_mode and e.work_date=p_date and e.notes=coalesce(p_notes,'') then return e.id; end if;
    raise exception 'Request ID already used for different encoding details.';
  end if;
  if exists(select 1 from public.orders where id=v_task.order_id and status in ('cancelled','released','ready_for_release')) then raise exception 'This order is no longer accepting sewing output.'; end if;
  if exists(select 1 from public.payroll_runs where p_date between period_start and period_end) then raise exception 'This date already belongs to a payroll run. Use payroll adjustments for closed periods.'; end if;
  if not exists(select 1 from public.profiles where id=a.employee_id and active and role='sewer') then raise exception 'Choose an active sewer assignment.'; end if;
  select salary_basis,piece_rate into v_basis,v_rate from public.employee_compensation where employee_id=a.employee_id;
  if v_basis is null then raise exception 'Configure the sewer pay settings before encoding.'; end if;
  select customization->>'garment' into v_garment from public.order_items where id=v_task.order_item_id;
  if p_mode='promo' then
    select promo_rate into v_rate from public.sewing_garment_rates where employee_id=a.employee_id and garment=v_garment;
    if v_rate is null then raise exception 'Set a promo price for this sewer and garment first.'; end if;
  else
    select coalesce((select unit_rate from public.sewing_garment_rates where employee_id=a.employee_id and garment=v_garment),v_rate,0) into v_rate;
  end if;
  if v_basis='fixed' then v_rate:=0; end if;
  insert into public.sewing_encodings(id,assignment_id,task_id,order_id,employee_id,quantity,pricing_mode,unit_rate,work_date,notes,created_by)
  values(p_id,p_assignment,a.task_id,v_task.order_id,a.employee_id,p_quantity,p_mode,v_rate,p_date,coalesce(p_notes,''),auth.uid());
  insert into public.sewing_encoding_audit(encoding_id,task_id,actor_id,action,after_value,reason)
  values(p_id,a.task_id,auth.uid(),'encoded',jsonb_build_object('quantity',p_quantity,'pricing_mode',p_mode,'unit_rate',v_rate),'Output submitted for review');
  return p_id;
end $$;
create function public.encode_sewing_output(p_id uuid,p_assignment uuid,p_quantity integer,p_mode text,p_date date,p_notes text) returns uuid
language sql security invoker set search_path='' as $$select sewing_monitor_private.encode(p_id,p_assignment,p_quantity,p_mode,p_date,p_notes)$$;

create function sewing_monitor_private.review(p_id uuid,p_action text,p_quantity integer,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.sewing_encodings%rowtype; a public.sewing_assignments%rowtype; t public.production_tasks%rowtype; v_target integer; v_done bigint; v_handed bigint; v_encoded bigint; v_basis text; v_rate numeric;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin' then raise exception 'Only admin can review sewing output.'; end if;
  perform pg_advisory_xact_lock(734221901);
  select * into e from public.sewing_encodings where id=p_id;
  if not found then raise exception 'Encoding not found.'; end if;
  select * into t from public.production_tasks where id=e.task_id for update;
  if not found and p_action is distinct from 'void' then raise exception 'This encoding belongs to an archived job. Void it with a reason instead.'; end if;
  if e.status='posted' and p_action='post' then return; end if;
  if e.status<>'pending' then raise exception 'Only pending encodings can be changed. Posted payroll history is preserved.'; end if;
  if p_action is null or p_action not in ('correct','void','post') then raise exception 'Invalid review action.'; end if;
  if p_action in ('correct','void') and (nullif(trim(p_reason),'') is null or length(p_reason)>1000) then raise exception 'Enter a correction or void reason (up to 1000 characters).'; end if;
  if p_action='correct' then
    if p_quantity is null or p_quantity<1 or p_quantity>1000000 then raise exception 'Enter a positive whole quantity.'; end if;
    update public.sewing_encodings set quantity=p_quantity,review_reason=trim(p_reason),reviewed_by=auth.uid(),reviewed_at=now() where id=e.id;
  elsif p_action='void' then
    update public.sewing_encodings set status='void',review_reason=trim(p_reason),reviewed_by=auth.uid(),reviewed_at=now() where id=e.id;
  else
    if exists(select 1 from public.sewing_payroll_controls where task_id=e.task_id and paused) then raise exception 'Automatic computation is paused for this team/job.'; end if;
    if exists(select 1 from public.payroll_runs where e.work_date between period_start and period_end) then raise exception 'The encoding date already belongs to a payroll run.'; end if;
    if exists(select 1 from public.orders where id=t.order_id and status in ('cancelled','released','ready_for_release')) then raise exception 'This order is no longer accepting output.'; end if;
    if exists(select 1 from public.production_tasks where order_item_id=t.order_item_id and stage<'sewing' and status<>'completed') then raise exception 'Finish the earlier production stages before approving output.'; end if;
    select * into a from public.sewing_assignments where id=e.assignment_id;
    select quantity into v_target from public.order_items where id=t.order_item_id for update;
    select coalesce(sum(se.quantity),0) into v_done from public.sewing_events se join public.sewing_assignments sa on sa.id=se.assignment_id where sa.task_id=e.task_id and se.kind='completion';
    select coalesce(sum(quantity),0) into v_encoded from public.sewing_encodings where task_id=e.task_id and status='pending';
    if v_done+v_encoded>v_target then raise exception 'Team quantity is over-encoded. Correct the discrepancy before posting any output.'; end if;
    select coalesce(sum(quantity) filter(where kind='completion'),0),coalesce(sum(quantity) filter(where kind='handoff'),0) into v_done,v_handed from public.sewing_events where assignment_id=e.assignment_id;
    select coalesce(sum(quantity),0) into v_encoded from public.sewing_encodings where assignment_id=e.assignment_id and status='pending';
    if v_done+v_encoded>a.quantity then raise exception 'This sewer has encoded more than their assigned quantity.'; end if;
    if v_done+e.quantity>v_handed then raise exception 'Output exceeds pieces handed over by Front Desk.'; end if;
    select salary_basis into v_basis from public.employee_compensation where employee_id=e.employee_id;
    if v_basis not in ('fixed','piece','combined') or v_basis is null then raise exception 'Configure the sewer pay settings.'; end if;
    if not exists(select 1 from public.profiles where id=e.employee_id and role='sewer' and active) then raise exception 'The sewer account is inactive or has changed role.'; end if;
    v_rate:=case when v_basis='fixed' then 0 else e.unit_rate end;
    update public.sewing_encodings set status='posted',reviewed_by=auth.uid(),reviewed_at=now() where id=e.id;
    insert into public.sewing_events(id,assignment_id,kind,quantity,recorded_by,notes)
    values(e.id,e.assignment_id,'completion',e.quantity,e.employee_id,e.notes);
    insert into public.employee_work_records(employee_id,order_id,task_id,role,activity,quantity,unit_rate,work_date,started_at,completed_at,status,pay_eligible,approved_by,approved_at,recorded_by,notes,sewing_event_id,sewing_encoding_id)
    values(e.employee_id,t.order_id,t.id,'sewer','Sewing batch completed',e.quantity,v_rate,e.work_date,coalesce(t.started_at,now()),now(),'approved',not exists(select 1 from public.orders where id=t.order_id and notes like '[SEWING EXAMPLE]%'),auth.uid(),now(),e.created_by,e.notes,e.id,e.id);
    select coalesce(sum(se.quantity),0) into v_done from public.sewing_events se join public.sewing_assignments sa on sa.id=se.assignment_id where sa.task_id=e.task_id and se.kind='completion';
    update public.production_tasks set status=case when v_done=v_target then 'completed'::public.task_status else 'in_progress'::public.task_status end,started_at=coalesce(started_at,now()),started_by=coalesce(started_by,e.employee_id),completed_at=case when v_done=v_target then now() else null end,completed_by=null,updated_at=now() where id=t.id;
  end if;
  insert into public.sewing_encoding_audit(encoding_id,task_id,actor_id,action,before_value,after_value,reason)
  select e.id,e.task_id,auth.uid(),p_action,to_jsonb(e),to_jsonb(n),coalesce(p_reason,'') from public.sewing_encodings n where n.id=e.id;
end $$;
create function public.review_sewing_encoding(p_id uuid,p_action text,p_quantity integer,p_reason text) returns void
language sql security invoker set search_path='' as $$select sewing_monitor_private.review(p_id,p_action,p_quantity,p_reason)$$;

create function sewing_monitor_private.pause(p_task uuid,p_paused boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin' then raise exception 'Only admin can pause computation.'; end if;
  perform pg_advisory_xact_lock(734221901);
  perform 1 from public.production_tasks where id=p_task and stage='sewing' for update;
  if not found or nullif(trim(p_reason),'') is null or length(p_reason)>1000 or p_paused is null then raise exception 'Choose a sewing job and enter a reason.'; end if;
  insert into public.sewing_payroll_controls(task_id,paused,reason,updated_by) values(p_task,p_paused,trim(p_reason),auth.uid())
  on conflict(task_id) do update set paused=excluded.paused,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
  insert into public.sewing_encoding_audit(task_id,actor_id,action,after_value,reason) values(p_task,auth.uid(),'computation',jsonb_build_object('paused',p_paused),trim(p_reason));
end $$;
create function public.pause_sewing_computation(p_task uuid,p_paused boolean,p_reason text) returns void
language sql security invoker set search_path='' as $$select sewing_monitor_private.pause(p_task,p_paused,p_reason)$$;

-- Preserve the selected regular/promo snapshot when a reviewed encoding posts.
create or replace function sewing_pay_private.snapshot_rate() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_garment text; v_rate numeric; v_basis text; e public.sewing_encodings%rowtype;
begin
  if new.role='sewer' and new.task_id is not null then
    select salary_basis,piece_rate into v_basis,v_rate from public.employee_compensation where employee_id=new.employee_id;
    if new.sewing_encoding_id is not null then
      select * into e from public.sewing_encodings where id=new.sewing_encoding_id and status='posted' and employee_id=new.employee_id and task_id=new.task_id and quantity=new.quantity;
      if not found then raise exception 'A posted encoding is required for the selected rate.'; end if;
      new.unit_rate:=case when v_basis='fixed' then 0 else e.unit_rate end;
    elsif v_basis in ('piece','combined') then
      select i.customization->>'garment' into v_garment from public.production_tasks t join public.order_items i on i.id=t.order_item_id where t.id=new.task_id;
      select coalesce((select unit_rate from public.sewing_garment_rates where employee_id=new.employee_id and garment=v_garment),v_rate,0) into new.unit_rate;
    else new.unit_rate:=0; end if;
  end if;
  return new;
end $$;

-- Assignment completions use a different activity label from legacy sewing.
-- Include BOTH labels in new payroll totals and record reservation; otherwise
-- batch output is omitted and can remain available for duplicate payroll.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.create_payroll_run(date,date)'::regprocedure) into v_definition;
  v_definition:=regexp_replace(v_definition,$pattern$activity[[:space:]]*=[[:space:]]*'Sewing completed'$pattern$,$replacement$activity in ('Sewing completed','Sewing batch completed')$replacement$,'g');
  if strpos(v_definition,'Sewing batch completed')=0 then raise exception 'Review the installed payroll function before adding sewing batch output.'; end if;
  execute v_definition;
end;
$migration$;

-- Block payroll snapshots and approval/payment while this cutoff has unresolved
-- encodings or paused jobs. The advisory lock serializes encoding with payroll.
create function sewing_monitor_private.guard_payroll() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(734221901);
  if tg_op='INSERT' or new.status in ('approved','paid') then
    if exists(
      select 1 from public.production_tasks t join public.order_items i on i.id=t.order_item_id
      where t.stage='sewing' and (
        exists(select 1 from public.employee_work_records w where w.task_id=t.id and w.work_date between new.period_start and new.period_end)
        or exists(select 1 from public.sewing_encodings e where e.task_id=t.id and e.status<>'void' and e.work_date between new.period_start and new.period_end)
      ) and (
        coalesce((select sum(se.quantity) from public.sewing_events se join public.sewing_assignments a on a.id=se.assignment_id where a.task_id=t.id and se.kind='completion'),0)
          +coalesce((select sum(e.quantity) from public.sewing_encodings e where e.task_id=t.id and e.status='pending'),0)>i.quantity
        or exists(select 1 from public.sewing_assignments a where a.task_id=t.id and
          coalesce((select sum(se.quantity) from public.sewing_events se where se.assignment_id=a.id and se.kind='completion'),0)
          +coalesce((select sum(e.quantity) from public.sewing_encodings e where e.assignment_id=a.id and e.status='pending'),0)>a.quantity)
      )
    ) then raise exception 'Resolve over-encoded sewing jobs before preparing or approving payroll, including encodings from other weeks.'; end if;
    if exists(select 1 from public.sewing_encodings where status='pending' and work_date between new.period_start and new.period_end) then raise exception 'Review or correct pending sewing encodings for this payroll period first.'; end if;
    if exists(select 1 from public.sewing_payroll_controls c where c.paused and (exists(select 1 from public.sewing_encodings e where e.task_id=c.task_id and e.status<>'void' and e.work_date between new.period_start and new.period_end) or exists(select 1 from public.employee_work_records w where w.task_id=c.task_id and w.work_date between new.period_start and new.period_end))) then raise exception 'Sewing computation is paused for a job in this payroll period.'; end if;
  end if;
  return new;
end $$;
create trigger sewing_payroll_review_guard before insert or update on public.payroll_runs for each row execute function sewing_monitor_private.guard_payroll();
revoke all on function sewing_monitor_private.encode(uuid,uuid,integer,text,date,text),sewing_monitor_private.review(uuid,text,integer,text),sewing_monitor_private.pause(uuid,boolean,text),sewing_monitor_private.guard_payroll() from public,anon,authenticated;
grant execute on function sewing_monitor_private.encode(uuid,uuid,integer,text,date,text),sewing_monitor_private.review(uuid,text,integer,text),sewing_monitor_private.pause(uuid,boolean,text) to authenticated;
revoke all on function public.encode_sewing_output(uuid,uuid,integer,text,date,text),public.review_sewing_encoding(uuid,text,integer,text),public.pause_sewing_computation(uuid,boolean,text) from public,anon;
grant execute on function public.encode_sewing_output(uuid,uuid,integer,text,date,text),public.review_sewing_encoding(uuid,text,integer,text),public.pause_sewing_computation(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
