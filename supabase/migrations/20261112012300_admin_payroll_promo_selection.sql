begin;
alter table public.sewing_assignments add column payroll_price_confirmed boolean not null default false;
-- Preserve already-reviewed and historical payroll rates.
update public.sewing_assignments a set payroll_price_confirmed=true
where exists(select 1 from public.employee_work_records w where w.sewing_assignment_id=a.id and (w.status='approved' or w.payroll_run_id is not null));

-- Claiming/reserving pieces does not choose a promo rate. The regular price is
-- only a provisional estimate until an admin selects the payroll price.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('sewing_monitor_private.assignment_pay()'::regprocedure) into v_definition;
  v_definition:=replace(v_definition,$old$new.pricing_mode:=coalesce(nullif(current_setting('app.sewing_pricing_mode',true),''),'regular');$old$,$new$new.pricing_mode:='regular';new.payroll_price_confirmed:=false;$new$);
  execute v_definition;
  select pg_get_functiondef('sewing_monitor_private.assign_priced(uuid,uuid,integer,text,text,uuid)'::regprocedure) into v_definition;
  v_definition:=regexp_replace(v_definition,'begin',$new$begin
    if p_mode is distinct from 'regular' then raise exception 'Promo is selected by admin in Payroll Work review, not when assigning pieces.'; end if;
$new$,'i');
  -- Pricing may legitimately change after a claim: an idempotent claim retry
  -- must not fail just because payroll subsequently applied a promo rate.
  v_definition:=replace(v_definition,'if found and v_previous.pricing_mode is distinct from p_mode then','if false then');
  execute v_definition;
  select pg_get_functiondef('sewing_monitor_private.encode(uuid,uuid,integer,text,date,text)'::regprocedure) into v_definition;
  v_definition:=regexp_replace(v_definition,'begin',$new$begin
    if p_mode is distinct from 'regular' then raise exception 'Promo is selected by admin in Payroll Work review.'; end if;
$new$,'i');
  execute v_definition;
  select pg_get_functiondef('sewing_monitor_private.convert_assignment(uuid,text,text)'::regprocedure) into v_definition;
  v_definition:=regexp_replace(v_definition,'begin',$new$begin
    if p_mode is distinct from 'regular' then raise exception 'Convert the assignment first; admin selects Promo in Payroll Work review.'; end if;
$new$,'i');
  execute v_definition;
end;
$migration$;

create function sewing_monitor_private.approve_assignment_price(p_work uuid,p_mode text) returns void
language plpgsql security definer set search_path='' as $$
declare w public.employee_work_records%rowtype; a public.sewing_assignments%rowtype; v_basis text; v_rate numeric; v_garment text;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin' then raise exception 'Only admin can select the payroll price.'; end if;
  if p_mode is null or p_mode not in ('regular','promo') then raise exception 'Choose Regular or Promo price.'; end if;
  perform pg_advisory_xact_lock(734221901);
  select * into w from public.employee_work_records where id=p_work for update;
  if not found or w.sewing_assignment_id is null then raise exception 'Choose an assignment-pay record.'; end if;
  select * into a from public.sewing_assignments where id=w.sewing_assignment_id for update;
  if w.payroll_run_id is not null then raise exception 'This pay is already included in payroll. Its saved rate is locked.'; end if;
  if w.status='approved' and a.payroll_price_confirmed and a.pricing_mode=p_mode then return; end if;
  if w.status<>'pending_review' then raise exception 'Only unreviewed assignment pay can be priced.'; end if;
  if not w.pay_eligible then raise exception 'This work is excluded from piece pay.'; end if;
  select salary_basis,piece_rate into v_basis,v_rate from public.employee_compensation where employee_id=w.employee_id;
  if v_basis is null then raise exception 'Configure the sewer pay settings first.'; end if;
  select i.customization->>'garment' into v_garment from public.production_tasks t join public.order_items i on i.id=t.order_item_id where t.id=w.task_id;
  if p_mode='promo' then
    select r.promo_rate into v_rate from public.sewing_garment_rates r where r.employee_id=w.employee_id and r.garment=v_garment;
    if v_rate is null then raise exception 'Set a promo price for this sewer and garment in Payroll Sewing rates first.'; end if;
  else
    select coalesce((select r.unit_rate from public.sewing_garment_rates r where r.employee_id=w.employee_id and r.garment=v_garment),v_rate,0) into v_rate;
  end if;
  if v_basis='fixed' then v_rate:=0; end if;
  update public.sewing_assignments set pricing_mode=p_mode,unit_rate=v_rate,payroll_price_confirmed=true where id=a.id;
  update public.employee_work_records set unit_rate=v_rate,status='approved',approved_by=auth.uid(),approved_at=now() where id=w.id;
  insert into public.sewing_encoding_audit(task_id,actor_id,action,before_value,after_value,reason)
  values(w.task_id,auth.uid(),'payroll price approved',jsonb_build_object('work_id',w.id,'pricing_mode',a.pricing_mode,'unit_rate',w.unit_rate),jsonb_build_object('work_id',w.id,'pricing_mode',p_mode,'unit_rate',v_rate),'Admin selected payroll price and approved assigned-piece pay');
end $$;
revoke all on function sewing_monitor_private.approve_assignment_price(uuid,text) from public,anon;
grant execute on function sewing_monitor_private.approve_assignment_price(uuid,text) to authenticated;
create function public.approve_sewer_assignment_pay(p_work uuid,p_mode text) returns void
language sql security invoker set search_path='' as $$select sewing_monitor_private.approve_assignment_price(p_work,p_mode)$$;
revoke all on function public.approve_sewer_assignment_pay(uuid,text) from public,anon;
grant execute on function public.approve_sewer_assignment_pay(uuid,text) to authenticated;

create function sewing_monitor_private.require_payroll_price() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.sewing_assignment_id is not null and new.status='approved' and old.status is distinct from 'approved' and
    not exists(select 1 from public.sewing_assignments where id=new.sewing_assignment_id and payroll_price_confirmed) then
    raise exception 'Admin must select Regular or Promo in Payroll Work review before approving this assignment.';
  end if;
  return new;
end $$;
revoke all on function sewing_monitor_private.require_payroll_price() from public,anon,authenticated;
create trigger assignment_pay_requires_admin_price before update on public.employee_work_records for each row execute function sewing_monitor_private.require_payroll_price();
notify pgrst,'reload schema';
commit;
