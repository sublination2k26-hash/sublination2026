begin;
-- Existing assignments retain their historical completion-pay basis. New claims
-- snapshot their agreed price and create exactly one assignment-pay work record.
alter table public.sewing_assignments add column pay_on_assignment boolean not null default false,
  add column pricing_mode text not null default 'regular' check(pricing_mode in ('regular','promo')),
  add column unit_rate numeric(12,2) not null default 0 check(unit_rate>=0 and unit_rate<>'NaN'::numeric);
alter table public.sewing_assignments alter column pay_on_assignment set default true;
alter table public.employee_work_records add column sewing_assignment_id uuid unique references public.sewing_assignments(id);

create function sewing_monitor_private.assignment_pay() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_rate numeric; v_basis text; v_garment text; v_order uuid; v_date date;
begin
  if not new.pay_on_assignment then return new; end if;
  perform pg_advisory_xact_lock(734221901);
  if tg_when='BEFORE' then
    new.pricing_mode:=coalesce(nullif(current_setting('app.sewing_pricing_mode',true),''),'regular');
    if new.pricing_mode not in ('regular','promo') then raise exception 'Choose Regular or Promo price.'; end if;
    select salary_basis,piece_rate into v_basis,v_rate from public.employee_compensation where employee_id=new.employee_id;
    if v_basis is null then raise exception 'Configure the sewer pay settings before assigning pieces.'; end if;
    select i.customization->>'garment' into v_garment from public.production_tasks t join public.order_items i on i.id=t.order_item_id where t.id=new.task_id;
    if new.pricing_mode='promo' then
      select promo_rate into v_rate from public.sewing_garment_rates where employee_id=new.employee_id and garment=v_garment;
      if v_rate is null then raise exception 'Set a promo price for this sewer and garment first.'; end if;
    else
      select coalesce((select unit_rate from public.sewing_garment_rates where employee_id=new.employee_id and garment=v_garment),v_rate,0) into v_rate;
    end if;
    new.unit_rate:=case when v_basis='fixed' then 0 else v_rate end;
    v_date:=(new.created_at at time zone 'Asia/Manila')::date;
    if exists(select 1 from public.payroll_runs where v_date between period_start and period_end) then raise exception 'This assignment date already belongs to a payroll run. Resolve the cutoff before assigning more payable work.'; end if;
  else
    select order_id into v_order from public.production_tasks where id=new.task_id;
    insert into public.employee_work_records(employee_id,order_id,task_id,role,activity,quantity,unit_rate,work_date,status,pay_eligible,recorded_by,notes,sewing_assignment_id)
    values(new.employee_id,v_order,new.task_id,'sewer','Sewing assigned',new.quantity,new.unit_rate,(new.created_at at time zone 'Asia/Manila')::date,'pending_review',not exists(select 1 from public.orders where id=v_order and notes like '[SEWING EXAMPLE]%'),new.assigned_by,new.notes,new.id);
  end if;
  return new;
end $$;
revoke all on function sewing_monitor_private.assignment_pay() from public,anon,authenticated;
create trigger assignment_pay_snapshot before insert on public.sewing_assignments for each row execute function sewing_monitor_private.assignment_pay();
create trigger assignment_pay_record after insert on public.sewing_assignments for each row execute function sewing_monitor_private.assignment_pay();

-- A retry must use the original selected price; rate changes never reprice it.
create function sewing_monitor_private.assign_priced(p_task uuid,p_employee uuid,p_quantity integer,p_mode text,p_notes text,p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_previous public.sewing_assignments%rowtype; v_id uuid; v_setting text;
begin
  if auth.uid() is null or public.current_app_role() is null or public.current_app_role() not in ('admin','front_desk','sewer') then raise exception 'An active sewing or office account is required.'; end if;
  if public.current_app_role()='sewer' and p_employee is distinct from auth.uid() then raise exception 'Claim only pieces for yourself.'; end if;
  if p_mode is null or p_mode not in ('regular','promo') then raise exception 'Choose Regular or Promo price.'; end if;
  perform pg_advisory_xact_lock(734221901);
  select * into v_previous from public.sewing_assignments where id=p_id;
  if found and v_previous.pricing_mode is distinct from p_mode then raise exception 'Request ID already used for another price option.'; end if;
  v_setting:=current_setting('app.sewing_pricing_mode',true);
  perform set_config('app.sewing_pricing_mode',p_mode,true);
  if public.current_app_role()='sewer' then
    v_id:=sewing_private.claim(p_task,p_quantity,p_notes,p_id);
  else
    v_id:=sewing_private.record_action('assign',p_task,null,p_employee,p_quantity,p_notes,p_id);
  end if;
  perform set_config('app.sewing_pricing_mode',coalesce(v_setting,'regular'),true);
  return v_id;
end $$;
revoke all on function sewing_monitor_private.assign_priced(uuid,uuid,integer,text,text,uuid) from public,anon;
grant execute on function sewing_monitor_private.assign_priced(uuid,uuid,integer,text,text,uuid) to authenticated;
create function public.assign_priced_sewing_pieces(p_task uuid,p_employee uuid,p_quantity integer,p_mode text,p_notes text,p_id uuid) returns uuid
language sql security invoker set search_path='' as $$ select sewing_monitor_private.assign_priced(p_task,p_employee,p_quantity,p_mode,p_notes,p_id) $$;
revoke all on function public.assign_priced_sewing_pieces(uuid,uuid,integer,text,text,uuid) from public,anon;
grant execute on function public.assign_priced_sewing_pieces(uuid,uuid,integer,text,text,uuid) to authenticated;

-- Assignment records are not legacy output and must not hide the shared queue
-- or prevent a second sewer from claiming the remaining pieces.
do $migration$
declare v_function regprocedure; v_definition text;
begin
  foreach v_function in array array['sewing_private.claim(uuid,integer,text,uuid)'::regprocedure,'sewing_private.record_action(text,uuid,uuid,uuid,integer,text,uuid)'::regprocedure,'sewing_private.queue()'::regprocedure]
  loop
    v_definition:=pg_get_functiondef(v_function);
    v_definition:=replace(v_definition,'sewing_event_id is null','sewing_event_id is null and sewing_assignment_id is null');
    if v_function<>'sewing_private.queue()'::regprocedure then
      v_definition:=regexp_replace(v_definition,'begin','begin PERFORM pg_advisory_xact_lock(734221901);','i');
    end if;
    execute v_definition;
  end loop;
  select pg_get_functiondef('sewing_monitor_private.encode(uuid,uuid,integer,text,date,text)'::regprocedure) into v_definition;
  v_definition:=replace(v_definition,'if exists(select 1 from public.payroll_runs where p_date between period_start and period_end)', 'if not a.pay_on_assignment and exists(select 1 from public.payroll_runs where p_date between period_start and period_end)');
  execute v_definition;
  select pg_get_functiondef('sewing_monitor_private.review(uuid,text,integer,text)'::regprocedure) into v_definition;
  v_definition:=replace(v_definition,'if exists(select 1 from public.payroll_runs where e.work_date between period_start and period_end)', 'if not exists(select 1 from public.sewing_assignments where id=e.assignment_id and pay_on_assignment) and exists(select 1 from public.payroll_runs where e.work_date between period_start and period_end)');
  execute v_definition;
  select pg_get_functiondef('public.create_payroll_run(date,date)'::regprocedure) into v_definition;
  v_definition:=replace(v_definition,$old$('Sewing completed','Sewing batch completed')$old$,$new$('Sewing completed','Sewing batch completed','Sewing assigned')$new$);
  if strpos(v_definition,'Sewing assigned')=0 then raise exception 'Apply the weekly sewing payroll migration first.'; end if;
  execute v_definition;
end;
$migration$;

create or replace function sewing_pay_private.snapshot_rate() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_garment text; v_rate numeric; v_basis text; e public.sewing_encodings%rowtype; v_assignment public.sewing_assignments%rowtype;
begin
  if new.sewing_assignment_id is not null then
    select * into v_assignment from public.sewing_assignments where id=new.sewing_assignment_id and pay_on_assignment and employee_id=new.employee_id and task_id=new.task_id and quantity=new.quantity;
    if not found then raise exception 'A matching assignment is required for assignment pay.'; end if;
    new.unit_rate:=v_assignment.unit_rate;
    return new;
  end if;
  if exists(select 1 from public.sewing_assignments a join public.sewing_events se on se.assignment_id=a.id where a.pay_on_assignment and se.id=new.sewing_event_id)
    or (new.sewing_event_id is null and exists(select 1 from public.sewing_assignments a where a.task_id=new.task_id and a.pay_on_assignment)) then
    new.pay_eligible:=false;new.unit_rate:=0;return new;
  end if;
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


create or replace function sewing_monitor_private.guard_payroll() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(734221901);
  if tg_op='INSERT' or new.status in ('approved','paid') then
    if exists(select 1 from public.employee_work_records where sewing_assignment_id is not null and status='pending_review' and pay_eligible and work_date between new.period_start and new.period_end) then raise exception 'Review assignment pay in Payroll Work review before preparing payroll.'; end if;
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
    if exists(select 1 from public.sewing_encodings e join public.sewing_assignments a on a.id=e.assignment_id where e.status='pending' and not a.pay_on_assignment and e.work_date between new.period_start and new.period_end) then raise exception 'Review or correct pending sewing encodings for this payroll period first.'; end if;
    if exists(select 1 from public.sewing_payroll_controls c where c.paused and (exists(select 1 from public.sewing_encodings e where e.task_id=c.task_id and e.status<>'void' and e.work_date between new.period_start and new.period_end) or exists(select 1 from public.employee_work_records w where w.task_id=c.task_id and w.work_date between new.period_start and new.period_end))) then raise exception 'Sewing computation is paused for a job in this payroll period.'; end if;
  end if;
  return new;
end $$;

-- An owner can explicitly convert an existing unpaid assignment after checking
-- its agreed price. Paid/reserved work and existing payroll cutoffs are locked.
create function sewing_monitor_private.convert_assignment(p_assignment uuid,p_mode text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.sewing_assignments%rowtype; v_rate numeric; v_basis text; v_garment text; v_order uuid; v_before jsonb; v_date date;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin' then raise exception 'Only admin can change an existing assignment pay basis.'; end if;
  if nullif(trim(p_reason),'') is null or length(p_reason)>1000 or p_mode is null or p_mode not in ('regular','promo') then raise exception 'Choose a price and enter a conversion reason.'; end if;
  perform pg_advisory_xact_lock(734221901);
  select * into a from public.sewing_assignments where id=p_assignment;
  if not found then raise exception 'Assignment not found.'; end if;
  perform 1 from public.production_tasks where id=a.task_id for update;
  if not found then raise exception 'Archived assignments cannot be converted.'; end if;
  if a.pay_on_assignment then return a.id; end if;
  v_before:=to_jsonb(a);
  v_date:=(a.created_at at time zone 'Asia/Manila')::date;
  if exists(select 1 from public.payroll_runs where v_date between period_start and period_end) or
    exists(select 1 from public.employee_work_records w left join public.sewing_events se on se.id=w.sewing_event_id where w.task_id=a.task_id and
      (w.sewing_event_id is null or se.assignment_id=a.id) and (w.payroll_run_id is not null or w.sewing_event_id is null)) then
    raise exception 'Existing payroll or legacy output locks this assignment. Use payroll adjustments for historical corrections.';
  end if;
  if not exists(select 1 from public.profiles where id=a.employee_id and active and role='sewer') then raise exception 'This assignment needs an active sewer.'; end if;
  select c.salary_basis,c.piece_rate into v_basis,v_rate from public.employee_compensation c where c.employee_id=a.employee_id;
  if v_basis is null then raise exception 'Configure the sewer pay settings first.'; end if;
  select i.customization->>'garment',t.order_id into v_garment,v_order from public.production_tasks t join public.order_items i on i.id=t.order_item_id where t.id=a.task_id;
  if p_mode='promo' then
    select r.promo_rate into v_rate from public.sewing_garment_rates r where r.employee_id=a.employee_id and r.garment=v_garment;
    if v_rate is null then raise exception 'Set the promo price first.'; end if;
  else
    select coalesce((select r.unit_rate from public.sewing_garment_rates r where r.employee_id=a.employee_id and r.garment=v_garment),v_rate,0) into v_rate;
  end if;
  if v_basis='fixed' then v_rate:=0; end if;
  update public.employee_work_records w set pay_eligible=false
    where w.sewing_event_id in (select se.id from public.sewing_events se where se.assignment_id=a.id) and w.payroll_run_id is null;
  update public.sewing_assignments set pay_on_assignment=true,pricing_mode=p_mode,unit_rate=v_rate where id=a.id;
  insert into public.employee_work_records(employee_id,order_id,task_id,role,activity,quantity,unit_rate,work_date,status,pay_eligible,recorded_by,notes,sewing_assignment_id)
  values(a.employee_id,v_order,a.task_id,'sewer','Sewing assigned',a.quantity,v_rate,v_date,'pending_review',not exists(select 1 from public.orders where id=v_order and notes like '[SEWING EXAMPLE]%'),auth.uid(),trim(p_reason),a.id);
  insert into public.sewing_encoding_audit(task_id,actor_id,action,before_value,after_value,reason)
    values(a.task_id,auth.uid(),'assignment pay conversion',v_before,jsonb_build_object('assignment_id',a.id,'pricing_mode',p_mode,'unit_rate',v_rate),trim(p_reason));
  return a.id;
end $$;
revoke all on function sewing_monitor_private.convert_assignment(uuid,text,text) from public,anon;
grant execute on function sewing_monitor_private.convert_assignment(uuid,text,text) to authenticated;
create function public.convert_sewing_assignment_pay(p_assignment uuid,p_mode text,p_reason text) returns uuid
language sql security invoker set search_path='' as $$select sewing_monitor_private.convert_assignment(p_assignment,p_mode,p_reason)$$;
revoke all on function public.convert_sewing_assignment_pay(uuid,text,text) from public,anon;
grant execute on function public.convert_sewing_assignment_pay(uuid,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
