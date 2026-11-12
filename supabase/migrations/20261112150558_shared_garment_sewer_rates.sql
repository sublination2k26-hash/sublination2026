begin;
create table public.sewing_shared_garment_rates (
 garment text primary key check(length(trim(garment)) between 1 and 120),
 unit_rate numeric(12,2) not null check(unit_rate>=0 and unit_rate<>'NaN'::numeric),
 promo_rate numeric(12,2) check(promo_rate>=0 and promo_rate<>'NaN'::numeric)
);
alter table public.sewing_shared_garment_rates enable row level security;
revoke all on public.sewing_shared_garment_rates from public,anon,authenticated;
grant select,insert,update on public.sewing_shared_garment_rates to authenticated;
create policy "staff reads shared garment rates" on public.sewing_shared_garment_rates for select to authenticated using(public.current_app_role() in ('admin','front_desk','sewer'));
create policy "admin inserts shared garment rates" on public.sewing_shared_garment_rates for insert to authenticated with check(public.current_app_role()='admin');
create policy "admin updates shared garment rates" on public.sewing_shared_garment_rates for update to authenticated using(public.current_app_role()='admin') with check(public.current_app_role()='admin');
-- Do not guess when employee rates disagree.
insert into public.sewing_shared_garment_rates(garment,unit_rate,promo_rate)
select garment,min(unit_rate),min(promo_rate) from public.sewing_garment_rates group by garment having count(distinct jsonb_build_array(unit_rate,promo_rate))=1;

do $migration$
declare definition text;
begin
 select pg_get_functiondef('sewing_monitor_private.assignment_pay()'::regprocedure) into definition;
 definition:=replace(definition,$old$if v_basis is null then raise exception 'Configure the sewer pay settings before assigning pieces.'; end if;$old$,
 $patch$if v_basis is null then
   insert into public.employee_compensation(employee_id,salary_basis,pay_frequency,piece_rate) values(new.employee_id,'piece','weekly',0) on conflict do nothing;
   select salary_basis into v_basis from public.employee_compensation where employee_id=new.employee_id;
 end if;$patch$);
 definition:=replace(definition,$old$select i.customization->>'garment'$old$,$patch$select coalesce(nullif(i.customization->>'garment',''),i.product_name)$patch$);
 definition:=replace(definition,'public.sewing_garment_rates where employee_id=new.employee_id and garment=v_garment','public.sewing_shared_garment_rates where garment=v_garment');
 definition:=replace(definition,'select coalesce((select unit_rate from public.sewing_shared_garment_rates where garment=v_garment),v_rate,0) into v_rate;','select unit_rate into v_rate from public.sewing_shared_garment_rates where garment=v_garment;');
 definition:=replace(definition,'    new.unit_rate:=case', $patch$    if v_rate is null then raise exception 'Set the shared garment price before assigning pieces.'; end if;
    new.unit_rate:=case$patch$);
 execute definition;
end $migration$;

create or replace function sewing_monitor_private.approve_assignment_price(p_work uuid,p_mode text,p_promo_rate numeric default null,p_regular_rate numeric default null) returns void
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
  if w.status='approved' and a.payroll_price_confirmed and a.pricing_mode=p_mode and ((p_mode='regular' and (p_regular_rate is null or a.unit_rate=p_regular_rate)) or (p_mode='promo' and (p_promo_rate is null or a.unit_rate=p_promo_rate))) then return; end if;
  if w.status<>'pending_review' then raise exception 'Only unreviewed assignment pay can be priced.'; end if;
  if not w.pay_eligible then raise exception 'This work is excluded from piece pay.'; end if;
  select salary_basis,piece_rate into v_basis,v_rate from public.employee_compensation where employee_id=w.employee_id;
  if v_basis is null then raise exception 'Configure the sewer pay settings first.'; end if;
  select coalesce(nullif(i.customization->>'garment',''),i.product_name) into v_garment from public.production_tasks t join public.order_items i on i.id=t.order_item_id where t.id=w.task_id;
  select case when p_mode='promo' then promo_rate else unit_rate end into v_rate from public.sewing_shared_garment_rates where garment=v_garment;
  if v_rate is null then raise exception 'Set the shared garment price first.'; end if;
  if (p_regular_rate is not null and p_regular_rate<>v_rate) or (p_promo_rate is not null and p_promo_rate<>v_rate) then raise exception 'Use the shared garment price.'; end if;
  if v_basis='fixed' then v_rate:=0; end if;
  update public.sewing_assignments set pricing_mode=p_mode,unit_rate=v_rate,payroll_price_confirmed=true where id=a.id;
  update public.employee_work_records set unit_rate=v_rate,status='approved',approved_by=auth.uid(),approved_at=now() where id=w.id;
  insert into public.sewing_encoding_audit(task_id,actor_id,action,before_value,after_value,reason)
  values(w.task_id,auth.uid(),'payroll price approved',jsonb_build_object('work_id',w.id,'pricing_mode',a.pricing_mode,'unit_rate',w.unit_rate),jsonb_build_object('work_id',w.id,'pricing_mode',p_mode,'unit_rate',v_rate),'Admin selected payroll price and approved assigned-piece pay');
end $$;

do $shared_paths$
declare f record; definition text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('sewing_pay_private','sewing_monitor_private') and p.prosrc like '%public.sewing_garment_rates%' loop
  select pg_get_functiondef(f.oid) into definition;
  definition:=replace(definition,'public.sewing_garment_rates where employee_id=a.employee_id and garment=v_garment','public.sewing_shared_garment_rates where garment=v_garment');
  definition:=replace(definition,'public.sewing_garment_rates where employee_id=new.employee_id and garment=v_garment','public.sewing_shared_garment_rates where garment=v_garment');
  execute definition;
 end loop;
end $shared_paths$;

-- Keep the original sample creator private; the public entry point also assigns pieces.
alter function public.create_sewing_example_order() set schema sewing_monitor_private;
alter function sewing_monitor_private.create_sewing_example_order() rename to unassigned_example_order;
revoke all on function sewing_monitor_private.unassigned_example_order() from public,anon,authenticated;
-- The private implementation checks the caller before creating sample records.
create function sewing_monitor_private.assigned_example_order() returns uuid
language plpgsql security definer set search_path='' as $$
declare v_order uuid; v_task uuid; v_employee uuid;
begin
 if auth.uid() is null or public.current_app_role() is distinct from 'admin' then raise exception 'Only admin can create the assigned example.'; end if;
 perform pg_advisory_xact_lock(291065538);
 select p.id into v_employee from public.profiles p left join public.employee_compensation c on c.employee_id=p.id where p.role='sewer' and p.active and (c.salary_basis is null or c.salary_basis<>'fixed') order by p.full_name,p.id limit 1;
 if v_employee is null then raise exception 'Add an active sewer with piece pay before creating the sample.'; end if;
 v_order:=sewing_monitor_private.unassigned_example_order();
 select id into v_task from public.production_tasks where order_id=v_order and stage='sewing' order by id limit 1;
 if v_task is null then raise exception 'The sample needs a sewing task.'; end if;
 update public.order_items set customization=coalesce(customization,'{}'::jsonb)||jsonb_build_object('garment','EXAMPLE Jersey') where id=(select order_item_id from public.production_tasks where id=v_task);
 insert into public.sewing_shared_garment_rates(garment,unit_rate,promo_rate) values('EXAMPLE Jersey',50,40) on conflict do nothing;
 if not exists(select 1 from public.sewing_assignments where task_id=v_task) then
  insert into public.sewing_assignments(id,task_id,employee_id,quantity,assigned_by,notes,pay_on_assignment,unit_rate) values(gen_random_uuid(),v_task,v_employee,10,auth.uid(),'EXAMPLE: 10 pieces. Regular PHP 50 = PHP 500; Promo PHP 40 = PHP 400. Excluded from payroll.',false,50);
 end if;
 return v_order;
end $$;
revoke all on function sewing_monitor_private.assigned_example_order() from public,anon;
grant execute on function sewing_monitor_private.assigned_example_order() to authenticated;
create function public.create_sewing_example_order() returns uuid
language sql security invoker set search_path='' as $$select sewing_monitor_private.assigned_example_order()$$;
revoke all on function public.create_sewing_example_order() from public,anon;
grant execute on function public.create_sewing_example_order() to authenticated;
notify pgrst,'reload schema';
commit;
