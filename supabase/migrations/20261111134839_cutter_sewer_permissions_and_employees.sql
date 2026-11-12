begin;
-- PL/pgSQL and quoted SQL function bodies retain their source text after an enum
-- rename. Update installed app functions, preserving signatures, ACLs, security
-- modes, and settings (including the latest payroll and attendance definitions).
do $$
declare v_function record;
begin
  for v_function in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','sewing_private','sewing_pay_private')
      and p.prokind='f' and strpos(p.prosrc,'''cutting_sewing''')>0
  loop
    execute replace(pg_get_functiondef(v_function.oid),'''cutting_sewing''','''sewer''');
  end loop;
end;
$$;

-- Cutters own cutting tasks; sewers own sewing tasks.
drop policy "roles update assigned stages" on public.production_tasks;
create policy "roles update assigned stages" on public.production_tasks for update to authenticated
using (
  public.current_app_role()='admin' or
  (stage='layout' and public.current_app_role()='artist') or
  (stage='printing' and public.current_app_role()='printing') or
  (stage='heat_press' and public.current_app_role()='heat_press') or
  (stage='cutting' and public.current_app_role()='cutter') or
  (stage='sewing' and public.current_app_role()='sewer') or
  (stage='qc' and public.current_app_role()='qc')
) with check (
  public.current_app_role()='admin' or
  (stage='layout' and public.current_app_role()='artist') or
  (stage='printing' and public.current_app_role()='printing') or
  (stage='heat_press' and public.current_app_role()='heat_press') or
  (stage='cutting' and public.current_app_role()='cutter') or
  (stage='sewing' and public.current_app_role()='sewer') or
  (stage='qc' and public.current_app_role()='qc')
);
drop policy if exists "production staff update corrections" on public.defects;
create policy "production staff update corrections" on public.defects for update to authenticated
using (public.has_any_role(array['admin','artist','printing','heat_press','cutter','sewer','qc']::public.app_role[]))
with check (public.has_any_role(array['admin','artist','printing','heat_press','cutter','sewer','qc']::public.app_role[]));

-- These two employees perform cutting; other former combined-role employees
-- remain sewers. Existing work records, assignments, and pay amounts are retained.
update public.profiles set role='cutter',updated_at=now()
where role='sewer' and lower(trim(full_name)) in ('intsik','maymay');

create or replace function public.notify_stage_return()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role public.app_role;
  v_order_number text;
  v_stage_label text;
begin
  if new.status <> 'returned_for_correction' or old.status = 'returned_for_correction' then
    return new;
  end if;

  v_target_role := case new.stage
    when 'layout' then 'artist'::public.app_role
    when 'printing' then 'printing'::public.app_role
    when 'heat_press' then 'heat_press'::public.app_role
    when 'cutting' then 'cutter'::public.app_role
    when 'sewing' then 'sewer'::public.app_role
    when 'qc' then 'qc'::public.app_role
  end;
  v_stage_label := case new.stage
    when 'layout' then 'Artist / Layout'
    when 'printing' then 'Printing'
    when 'heat_press' then 'Heat press'
    when 'cutting' then 'Cutting'
    when 'sewing' then 'Sewing'
    when 'qc' then 'Quality check'
  end;
  select order_number into v_order_number from public.orders where id=new.order_id;

  insert into public.notifications(recipient_id,order_id,title,message)
  select id,new.order_id,'Defect returned to '||v_stage_label,
    'Order '||v_order_number||' needs correction at '||v_stage_label||'.'
  from public.profiles
  where active and role in ('admin'::public.app_role,v_target_role);
  return new;
end;
$$;

notify pgrst,'reload schema';
commit;
