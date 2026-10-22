-- Keep customer contact details shared between order intake and the directory.
alter table public.customers add column if not exists facebook_account text;

create or replace function public.create_catalog_order_with_contact(
  p_customer_name text,
  p_phone text,
  p_product_id uuid,
  p_quantity integer,
  p_due_date date,
  p_deposit numeric,
  p_names text,
  p_notes text,
  p_facebook_account text
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_order_id uuid;
begin
  if not public.has_any_role(array['admin','front_desk']::public.app_role[]) then
    raise exception 'Only admin or front desk can create orders.';
  end if;

  v_order_id := public.create_catalog_order(
    p_customer_name,p_phone,p_product_id,p_quantity,p_due_date,p_deposit,p_names,p_notes
  );

  -- A blank value on a repeat order must not erase an existing account.
  if nullif(trim(p_facebook_account),'') is not null then
    update public.customers
    set facebook_account = trim(p_facebook_account)
    where id = (select customer_id from public.orders where id = v_order_id);
  end if;
  return v_order_id;
end;
$$;

revoke all on function public.create_catalog_order_with_contact(text,text,uuid,integer,date,numeric,text,text,text) from public;
grant execute on function public.create_catalog_order_with_contact(text,text,uuid,integer,date,numeric,text,text,text) to authenticated;
