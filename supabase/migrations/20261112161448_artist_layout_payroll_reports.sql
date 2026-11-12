begin;
create table public.artist_layout_pay_settings (
 singleton boolean primary key default true check(singleton),
 unit_rate numeric(12,2) not null default 150 check(unit_rate>=0 and unit_rate<10000000000 and unit_rate<>'NaN'::numeric)
);
insert into public.artist_layout_pay_settings(singleton,unit_rate) values(true,150);
alter table public.artist_layout_pay_settings enable row level security;
revoke all on public.artist_layout_pay_settings from public,anon,authenticated;
grant select,update on public.artist_layout_pay_settings to authenticated;
create policy "admin reads artist price" on public.artist_layout_pay_settings for select to authenticated using(public.current_app_role()='admin');
create policy "admin edits artist price" on public.artist_layout_pay_settings for update to authenticated using(public.current_app_role()='admin') with check(public.current_app_role()='admin');

create table public.artist_layout_payroll_records (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.profiles(id),
 employee_name text not null,
 period_start date not null,
 period_end date not null check(period_end>=period_start),
 layout_count integer not null check(layout_count>0),
 unit_rate numeric(12,2) not null check(unit_rate>=0 and unit_rate<10000000000),
 total_pay numeric(12,2) not null check(total_pay>=0 and total_pay<10000000000),
 payslip_id uuid not null unique references public.employee_payslips(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(employee_id,period_start,period_end),
 check(total_pay=layout_count*unit_rate)
);
create table public.artist_layout_payroll_items (
 id uuid primary key default gen_random_uuid(),
 record_id uuid not null references public.artist_layout_payroll_records(id),
 task_id uuid unique references public.production_tasks(id) on delete set null,
 task_reference uuid not null unique,
 order_number text not null,
 team_name text not null,
 garment text not null,
 completed_at timestamptz not null
);
create index artist_layout_payroll_records_date_idx on public.artist_layout_payroll_records(period_start,employee_id);
create index artist_layout_payroll_items_record_idx on public.artist_layout_payroll_items(record_id);
alter table public.artist_layout_payroll_records enable row level security;
alter table public.artist_layout_payroll_items enable row level security;
revoke all on public.artist_layout_payroll_records,public.artist_layout_payroll_items from public,anon,authenticated;
grant select on public.artist_layout_payroll_records,public.artist_layout_payroll_items to authenticated;
create policy "admin reads artist payroll" on public.artist_layout_payroll_records for select to authenticated using(public.current_app_role()='admin');
create policy "admin reads artist payroll items" on public.artist_layout_payroll_items for select to authenticated using(public.current_app_role()='admin');

create schema if not exists artist_pay_private;
revoke all on schema artist_pay_private from public,anon;
grant usage on schema artist_pay_private to authenticated;
create function artist_pay_private.create_record(p_employee uuid,p_start date,p_end date,p_expected_rate numeric,p_expected_tasks uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_rate numeric; v_count integer; v_total numeric; v_record uuid; v_slip jsonb; v_tasks uuid[];
begin
 if auth.uid() is null or public.current_app_role() is distinct from 'admin' then raise exception 'Only admin can save artist payroll.'; end if;
 if p_start is null or p_end is null or p_end<p_start then raise exception 'Choose a valid cutoff.'; end if;
 if p_expected_rate is null or p_expected_tasks is null then raise exception 'Refresh and review the layout price and tasks first.'; end if;
 perform pg_advisory_xact_lock(734221903);
 if not exists(select 1 from public.profiles where id=p_employee and role='artist' and active) then raise exception 'Choose an active artist employee.'; end if;
 select unit_rate into v_rate from public.artist_layout_pay_settings where singleton for share;
 if v_rate is distinct from p_expected_rate then raise exception 'The artist price changed. Refresh and review the total first.'; end if;
 -- Lock eligible source rows until their immutable report snapshots are saved.
 perform t.id from public.production_tasks t join public.orders o on o.id=t.order_id
 where t.stage='layout' and t.status='completed' and t.completed_by=p_employee
 and (t.completed_at at time zone 'Asia/Manila')::date between p_start and p_end
 and coalesce(o.notes,'') not like '[SEWING EXAMPLE]%'
 and not exists(select 1 from public.artist_layout_payroll_items i where i.task_reference=t.id)
 order by t.id for update of t;
 select array_agg(t.id order by t.id) into v_tasks from public.production_tasks t join public.orders o on o.id=t.order_id
 where t.stage='layout' and t.status='completed' and t.completed_by=p_employee
 and (t.completed_at at time zone 'Asia/Manila')::date between p_start and p_end
 and coalesce(o.notes,'') not like '[SEWING EXAMPLE]%'
 and not exists(select 1 from public.artist_layout_payroll_items i where i.task_reference=t.id);
 v_count:=coalesce(cardinality(v_tasks),0);
 if v_count=0 then raise exception 'No unrecorded completed layouts for this artist and cutoff.'; end if;
 if v_tasks is distinct from (select array_agg(id order by id) from unnest(p_expected_tasks) id) then raise exception 'The completed layouts changed. Refresh and review before saving.'; end if;
 v_total:=v_count*v_rate;
 v_slip:=public.issue_employee_payslip(p_employee,(now() at time zone 'Asia/Manila')::date,p_start,p_end,
 jsonb_build_object('basic_pay',v_total,'overtime_pay',0,'bonus',0,'backpay',0,'sss',0,'philhealth',0,'pagibig',0,'other_deductions',0));
 insert into public.artist_layout_payroll_records(employee_id,employee_name,period_start,period_end,layout_count,unit_rate,total_pay,payslip_id,created_by)
 select p_employee,full_name,p_start,p_end,v_count,v_rate,v_total,(v_slip->>'id')::uuid,auth.uid() from public.profiles where id=p_employee returning id into v_record;
 insert into public.artist_layout_payroll_items(record_id,task_id,task_reference,order_number,team_name,garment,completed_at)
 select v_record,t.id,t.id,o.order_number,coalesce(c.full_name,'Team unavailable'),coalesce(i.product_name,'Layout / design'),t.completed_at
 from public.production_tasks t join public.orders o on o.id=t.order_id left join public.customers c on c.id=o.customer_id left join public.order_items i on i.id=t.order_item_id
 where t.id=any(v_tasks);
 return v_record;
end $$;
revoke all on function artist_pay_private.create_record(uuid,date,date,numeric,uuid[]) from public,anon;
grant execute on function artist_pay_private.create_record(uuid,date,date,numeric,uuid[]) to authenticated;
create function public.create_artist_layout_payroll(p_employee uuid,p_start date,p_end date,p_expected_rate numeric,p_expected_tasks uuid[]) returns uuid
language sql security invoker set search_path='' as $$select artist_pay_private.create_record(p_employee,p_start,p_end,p_expected_rate,p_expected_tasks)$$;
revoke all on function public.create_artist_layout_payroll(uuid,date,date,numeric,uuid[]) from public,anon;
grant execute on function public.create_artist_layout_payroll(uuid,date,date,numeric,uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
