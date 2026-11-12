begin;
-- Keep a single RPC signature. Existing clients may still omit the custom Regular rate.
drop function public.approve_sewer_assignment_pay(uuid,text,numeric);
drop function sewing_monitor_private.approve_assignment_price(uuid,text,numeric);
create function sewing_monitor_private.approve_assignment_price(p_work uuid,p_mode text,p_promo_rate numeric default null,p_regular_rate numeric default null) returns void
language plpgsql security definer set search_path='' as $$
declare w public.employee_work_records%rowtype; a public.sewing_assignments%rowtype; v_basis text; v_rate numeric; v_garment text;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin' then raise exception 'Only admin can select the payroll price.'; end if;
  if p_mode is null or p_mode not in ('regular','promo') then raise exception 'Choose Regular or Promo price.'; end if;
  if p_mode='regular' and p_promo_rate is not null then raise exception 'A typed price is only allowed for Promo.'; end if;
  if p_mode='promo' and p_regular_rate is not null then raise exception 'A regular price is only allowed for Regular.'; end if;
  if p_regular_rate is not null and (p_regular_rate<0 or p_regular_rate>9999999999.99 or p_regular_rate='NaN'::numeric or round(p_regular_rate,2)<>p_regular_rate) then
    raise exception 'Enter a valid regular price per piece with at most two decimal places.';
  end if;
  perform pg_advisory_xact_lock(734221901);
  select * into w from public.employee_work_records where id=p_work for update;
  if not found or w.sewing_assignment_id is null then raise exception 'Choose an assignment-pay record.'; end if;
  select * into a from public.sewing_assignments where id=w.sewing_assignment_id for update;
  if w.payroll_run_id is not null then raise exception 'This pay is already included in payroll. Its saved rate is locked.'; end if;
  if w.status='approved' and a.payroll_price_confirmed and a.pricing_mode=p_mode and ((p_mode='regular' and (p_regular_rate is null or a.unit_rate=p_regular_rate)) or (p_mode='promo' and a.unit_rate=p_promo_rate)) then return; end if;
  if w.status<>'pending_review' then raise exception 'Only unreviewed assignment pay can be priced.'; end if;
  if not w.pay_eligible then raise exception 'This work is excluded from piece pay.'; end if;
  select salary_basis,piece_rate into v_basis,v_rate from public.employee_compensation where employee_id=w.employee_id;
  if v_basis is null then raise exception 'Configure the sewer pay settings first.'; end if;
  select i.customization->>'garment' into v_garment from public.production_tasks t join public.order_items i on i.id=t.order_item_id where t.id=w.task_id;
  if p_mode='promo' then
    if p_promo_rate is null or p_promo_rate<0 or p_promo_rate>9999999999.99 or p_promo_rate='NaN'::numeric or round(p_promo_rate,2)<>p_promo_rate then
      raise exception 'Enter a valid promo price per piece with at most two decimal places.';
    end if;
    v_rate:=p_promo_rate;
  else
    select coalesce(p_regular_rate,(select r.unit_rate from public.sewing_garment_rates r where r.employee_id=w.employee_id and r.garment=v_garment),v_rate,0) into v_rate;
  end if;
  if v_basis='fixed' then v_rate:=0; end if;
  update public.sewing_assignments set pricing_mode=p_mode,unit_rate=v_rate,payroll_price_confirmed=true where id=a.id;
  update public.employee_work_records set unit_rate=v_rate,status='approved',approved_by=auth.uid(),approved_at=now() where id=w.id;
  insert into public.sewing_encoding_audit(task_id,actor_id,action,before_value,after_value,reason)
  values(w.task_id,auth.uid(),'payroll price approved',jsonb_build_object('work_id',w.id,'pricing_mode',a.pricing_mode,'unit_rate',w.unit_rate),jsonb_build_object('work_id',w.id,'pricing_mode',p_mode,'unit_rate',v_rate),'Admin selected payroll price and approved assigned-piece pay');
end $$;
revoke all on function sewing_monitor_private.approve_assignment_price(uuid,text,numeric,numeric) from public,anon;
grant execute on function sewing_monitor_private.approve_assignment_price(uuid,text,numeric,numeric) to authenticated;
create function public.approve_sewer_assignment_pay(p_work uuid,p_mode text,p_promo_rate numeric default null,p_regular_rate numeric default null) returns void
language sql security invoker set search_path='' as $$select sewing_monitor_private.approve_assignment_price(p_work,p_mode,p_promo_rate,p_regular_rate)$$;
revoke all on function public.approve_sewer_assignment_pay(uuid,text,numeric,numeric) from public,anon;
grant execute on function public.approve_sewer_assignment_pay(uuid,text,numeric,numeric) to authenticated;

notify pgrst,'reload schema';
commit;
