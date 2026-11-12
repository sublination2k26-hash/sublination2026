begin;
alter table public.sewing_shared_garment_rates
 add column selected_mode text not null default 'regular' check(selected_mode in ('regular','promo')),
 add constraint selected_promo_needs_rate check(selected_mode<>'promo' or promo_rate is not null);

-- New claims use the admin's saved garment choice. Existing rates remain snapshotted.
do $migration$
declare definition text; needle text := 'where t.id=new.task_id;';
begin
 select pg_get_functiondef('sewing_monitor_private.assignment_pay()'::regprocedure) into definition;
 if strpos(definition,needle)=0 then raise exception 'Assignment rate lookup was not found.'; end if;
 definition:=replace(definition,needle,needle||$patch$
    select coalesce((select selected_mode from public.sewing_shared_garment_rates where garment=v_garment),'regular') into new.pricing_mode;
$patch$);
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
