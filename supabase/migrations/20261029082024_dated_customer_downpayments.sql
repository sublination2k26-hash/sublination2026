-- Each installment is its own payment row. Keep payment date separate from entry time.
-- Safe to run again in SQL Editor, including after a partially applied script.
begin;
alter table public.payments add column if not exists payment_on date, add column if not exists payment_kind text;
update public.payments set payment_on=coalesce(payment_on,(received_at at time zone 'Asia/Manila')::date),
  payment_kind=coalesce(payment_kind,case when notes='Initial down payment' then 'down_payment' else 'payment' end)
where payment_on is null or payment_kind is null;
alter table public.payments alter column payment_on set not null, alter column payment_kind set not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.payments'::regclass and conname='payments_kind_check') then
    alter table public.payments add constraint payments_kind_check check(payment_kind in ('down_payment','payment'));
  end if;
end $$;
create or replace function public.set_payment_details() returns trigger language plpgsql set search_path='' as $$
begin
  new.payment_on:=coalesce(new.payment_on,(new.received_at at time zone 'Asia/Manila')::date,(now() at time zone 'Asia/Manila')::date);
  new.payment_kind:=coalesce(new.payment_kind,case when new.notes='Initial down payment' then 'down_payment' else 'payment' end);
  if new.payment_on>(now() at time zone 'Asia/Manila')::date then raise exception 'Payment date cannot be in the future.'; end if;
  return new;
end $$;
revoke all on function public.set_payment_details() from public,anon,authenticated;
drop trigger if exists payments_details on public.payments;
create trigger payments_details before insert or update on public.payments for each row execute function public.set_payment_details();

-- Serialize all payment inserts/amount edits against the same order balance.
create or replace function public.guard_payment_total() returns trigger language plpgsql set search_path='' as $$
declare v_total numeric; v_paid numeric;
begin
  select total into v_total from public.orders where id=new.order_id for update;
  if v_total is null then raise exception 'Order not found.'; end if;
  select coalesce(sum(amount),0) into v_paid from public.payments where order_id=new.order_id and id is distinct from new.id;
  if new.amount='NaN'::numeric or new.amount<=0 or v_paid+new.amount>v_total then raise exception 'Payment exceeds the remaining order balance.'; end if;
  return new;
end $$;

create schema if not exists payments_private;
revoke all on schema payments_private from public,anon;
grant usage on schema payments_private to authenticated;
create or replace function payments_private.record_payment(p_order_id uuid,p_amount numeric,p_method public.payment_method,p_kind text,p_payment_on date,p_notes text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_previous public.payments%rowtype; v_status public.order_status;
begin
  if auth.uid() is null or public.current_app_role() is null or public.current_app_role() not in ('admin','front_desk') then raise exception 'Only admin or front desk can record payments.'; end if;
  if p_request_id is null or p_amount is null or p_amount<=0 or p_amount='NaN'::numeric or round(p_amount,2)<>p_amount or p_method is null or p_kind is null or p_kind not in ('down_payment','payment') or p_payment_on is null or length(coalesce(p_notes,''))>1000 then raise exception 'Enter a valid amount, payment type, date and method.'; end if;
  select status into v_status from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  select * into v_previous from public.payments where id=p_request_id;
  if found then
    if v_previous.order_id=p_order_id and v_previous.amount=p_amount and v_previous.method=p_method and v_previous.payment_kind=p_kind and v_previous.payment_on=p_payment_on and coalesce(v_previous.notes,'')=coalesce(p_notes,'') and v_previous.received_by=auth.uid() then return v_previous.id; end if;
    raise exception 'Request ID already used for a different payment.';
  end if;
  if v_status='cancelled' then raise exception 'Cannot record payment for a cancelled order.'; end if;
  insert into public.payments(id,order_id,amount,method,payment_kind,payment_on,notes,received_by)
  values(p_request_id,p_order_id,p_amount,p_method,p_kind,p_payment_on,coalesce(p_notes,''),auth.uid());
  return p_request_id;
end $$;
revoke all on function payments_private.record_payment(uuid,numeric,public.payment_method,text,date,text,uuid) from public,anon;
grant execute on function payments_private.record_payment(uuid,numeric,public.payment_method,text,date,text,uuid) to authenticated;
create or replace function public.record_customer_payment(p_order_id uuid,p_amount numeric,p_method public.payment_method,p_kind text,p_payment_on date,p_notes text,p_request_id uuid)
returns uuid language sql security invoker set search_path='' as $$ select payments_private.record_payment(p_order_id,p_amount,p_method,p_kind,p_payment_on,p_notes,p_request_id); $$;
revoke all on function public.record_customer_payment(uuid,numeric,public.payment_method,text,date,text,uuid) from public,anon;
grant execute on function public.record_customer_payment(uuid,numeric,public.payment_method,text,date,text,uuid) to authenticated;

-- Intake can record an initial deposit on its actual date without editing it afterwards.
create or replace function public.create_catalog_order_with_deposit_date(p_customer_name text,p_phone text,p_product_id uuid,p_quantity integer,p_due_date date,p_deposit numeric,p_names text,p_notes text,p_facebook_account text,p_deposit_date date)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  if coalesce(p_deposit,0)<0 or p_deposit='NaN'::numeric then raise exception 'Deposit must be a valid nonnegative amount.'; end if;
  v_id:=public.create_catalog_order_with_contact(p_customer_name,p_phone,p_product_id,p_quantity,p_due_date,0,p_names,p_notes,p_facebook_account);
  if coalesce(p_deposit,0)>0 then
    if p_deposit_date is null then raise exception 'Choose the down payment date.'; end if;
    insert into public.payments(order_id,amount,method,notes,received_by,payment_on,payment_kind)
    values(v_id,p_deposit,'cash','Initial down payment',auth.uid(),p_deposit_date,'down_payment');
  end if;
  return v_id;
end $$;
revoke all on function public.create_catalog_order_with_deposit_date(text,text,uuid,integer,date,numeric,text,text,text,date) from public,anon;
grant execute on function public.create_catalog_order_with_deposit_date(text,text,uuid,integer,date,numeric,text,text,text,date) to authenticated;
notify pgrst, 'reload schema';
commit;
