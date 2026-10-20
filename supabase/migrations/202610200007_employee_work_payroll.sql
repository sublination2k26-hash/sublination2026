-- Employee work records and owner-reviewed payroll snapshots.
create table if not exists public.employee_compensation (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  salary_basis text not null default 'fixed' check (salary_basis in ('fixed','piece','combined')),
  pay_frequency text not null default 'monthly' check (pay_frequency in ('daily','weekly','semi_monthly','monthly')),
  base_rate numeric(12,2) not null default 0 check (base_rate >= 0),
  piece_rate numeric(12,2) not null default 0 check (piece_rate >= 0),
  currency text not null default 'PHP' check (currency='PHP'),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  work_date date not null,
  hours numeric(6,2) not null check (hours >= 0 and hours <= 24),
  notes text,
  payroll_run_id uuid,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(employee_id,work_date)
);

create table if not exists public.employee_work_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  order_id uuid references public.orders(id) on delete set null,
  task_id uuid references public.production_tasks(id) on delete set null,
  role public.app_role not null,
  activity text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_rate numeric(12,2) not null default 0 check (unit_rate >= 0),
  work_date date not null default current_date,
  started_at timestamptz,
  completed_at timestamptz,
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','rework')),
  is_rework boolean not null default false,
  pay_eligible boolean not null default true,
  rework_reason text,
  notes text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  payroll_run_id uuid,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  status text not null default 'draft' check (status in ('draft','approved','paid')),
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  paid_by uuid references public.profiles(id),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  role public.app_role not null,
  salary_basis text not null,
  pay_frequency text not null,
  base_pay numeric(12,2) not null default 0,
  approved_units numeric(12,2) not null default 0,
  production_pay numeric(12,2) not null default 0,
  attendance_hours numeric(12,2) not null default 0,
  adjustments numeric(12,2) not null default 0,
  adjustment_note text,
  total_pay numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(payroll_run_id,employee_id)
);

alter table public.payroll_lines add column if not exists role public.app_role;
update public.payroll_lines l set role=p.role from public.profiles p where p.id=l.employee_id and l.role is null;
alter table public.payroll_lines alter column role set not null;

alter table public.employee_compensation enable row level security;
alter table public.employee_attendance enable row level security;
alter table public.employee_work_records enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;

drop policy if exists "admins manage compensation" on public.employee_compensation;
create policy "admins manage compensation" on public.employee_compensation for all to authenticated using (public.has_any_role(array['admin']::public.app_role[])) with check (public.has_any_role(array['admin']::public.app_role[]));
drop policy if exists "admins manage attendance" on public.employee_attendance;
create policy "admins manage attendance" on public.employee_attendance for all to authenticated using (public.has_any_role(array['admin']::public.app_role[])) with check (public.has_any_role(array['admin']::public.app_role[]));
drop policy if exists "admins manage work records" on public.employee_work_records;
create policy "admins manage work records" on public.employee_work_records for all to authenticated using (public.has_any_role(array['admin']::public.app_role[])) with check (public.has_any_role(array['admin']::public.app_role[]));
drop policy if exists "admins manage payroll runs" on public.payroll_runs;
create policy "admins manage payroll runs" on public.payroll_runs for all to authenticated using (public.has_any_role(array['admin']::public.app_role[])) with check (public.has_any_role(array['admin']::public.app_role[]));
drop policy if exists "admins manage payroll lines" on public.payroll_lines;
create policy "admins manage payroll lines" on public.payroll_lines for all to authenticated using (public.has_any_role(array['admin']::public.app_role[])) with check (public.has_any_role(array['admin']::public.app_role[]));

create or replace function public.guard_paid_payroll_records()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.payroll_run_id is not null then raise exception 'This record is included in a payroll run and cannot be changed.'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists employee_attendance_payroll_lock on public.employee_attendance;
create trigger employee_attendance_payroll_lock before update or delete on public.employee_attendance for each row execute function public.guard_paid_payroll_records();
drop trigger if exists employee_work_payroll_lock on public.employee_work_records;
create trigger employee_work_payroll_lock before update or delete on public.employee_work_records for each row execute function public.guard_paid_payroll_records();

create or replace function public.guard_payroll_line_adjustments()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from public.payroll_runs where id=old.payroll_run_id and status='draft') then
    raise exception 'Only draft payroll lines can be adjusted.';
  end if;
  return new;
end $$;
drop trigger if exists payroll_lines_draft_adjustments on public.payroll_lines;
create trigger payroll_lines_draft_adjustments before update on public.payroll_lines for each row execute function public.guard_payroll_line_adjustments();

create or replace function public.create_payroll_run(p_start date,p_end date)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_run_id uuid;
  v_employee record;
  v_days numeric;
  v_attendance numeric;
  v_units numeric;
  v_production numeric;
  v_base numeric;
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Only an active admin can prepare payroll.'; end if;
  if p_end < p_start then raise exception 'Payroll end date must be on or after the start date.'; end if;
  if exists(select 1 from public.payroll_runs where period_start<=p_end and period_end>=p_start) then
    raise exception 'This period overlaps an existing payroll run.';
  end if;
  v_days := (p_end-p_start)+1;
  insert into public.payroll_runs(period_start,period_end,created_by) values(p_start,p_end,auth.uid()) returning id into v_run_id;
  for v_employee in
    select p.id,p.role,c.salary_basis,c.pay_frequency,c.base_rate,c.piece_rate
    from public.profiles p join public.employee_compensation c on c.employee_id=p.id
    where p.active=true and p.role <> 'admin'
  loop
    select coalesce(sum(hours),0) into v_attendance
    from public.employee_attendance where employee_id=v_employee.id and work_date between p_start and p_end and payroll_run_id is null;
    select coalesce(sum(quantity),0),coalesce(sum(quantity*unit_rate),0) into v_units,v_production
    from public.employee_work_records where employee_id=v_employee.id and work_date between p_start and p_end and status='approved' and pay_eligible=true and payroll_run_id is null;
    if v_employee.pay_frequency='daily' then v_base:=v_employee.base_rate*v_attendance/8;
    elsif v_employee.pay_frequency='weekly' then v_base:=v_employee.base_rate*v_days/7;
    elsif v_employee.pay_frequency='semi_monthly' then v_base:=v_employee.base_rate*v_days/15;
    else v_base:=v_employee.base_rate*v_days/30; end if;
    if v_employee.salary_basis='piece' then v_base:=0; else v_base:=round(v_base,2); end if;
    if v_employee.salary_basis='fixed' then v_production:=0; else v_production:=round(v_production,2); end if;
    insert into public.payroll_lines(payroll_run_id,employee_id,role,salary_basis,pay_frequency,base_pay,approved_units,production_pay,attendance_hours,total_pay)
    values(v_run_id,v_employee.id,v_employee.role,v_employee.salary_basis,v_employee.pay_frequency,v_base,v_units,v_production,v_attendance,v_base+v_production);
  end loop;
  update public.employee_attendance a set payroll_run_id=v_run_id
  where a.work_date between p_start and p_end and a.payroll_run_id is null
    and exists(select 1 from public.employee_compensation c join public.profiles p on p.id=c.employee_id where c.employee_id=a.employee_id and p.active=true and p.role <> 'admin');
  update public.employee_work_records w set payroll_run_id=v_run_id
  where w.work_date between p_start and p_end and w.status='approved' and w.pay_eligible=true and w.payroll_run_id is null
    and exists(select 1 from public.employee_compensation c join public.profiles p on p.id=c.employee_id where c.employee_id=w.employee_id and p.active=true and p.role <> 'admin');
  return v_run_id;
end $$;

create or replace function public.approve_payroll_run(p_run_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Only an active admin can approve payroll.'; end if;
  update public.payroll_runs set status='approved',approved_by=auth.uid(),approved_at=now() where id=p_run_id and status='draft';
  if not found then raise exception 'Payroll run was not found or is not a draft.'; end if;
end $$;

create or replace function public.mark_payroll_run_paid(p_run_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Only an active admin can mark payroll paid.'; end if;
  update public.payroll_runs set status='paid',paid_by=auth.uid(),paid_at=now() where id=p_run_id and status='approved';
  if not found then raise exception 'Payroll must be approved before it can be marked paid.'; end if;
end $$;

revoke all on function public.create_payroll_run(date,date) from public;
revoke all on function public.approve_payroll_run(uuid) from public;
revoke all on function public.mark_payroll_run_paid(uuid) from public;
grant execute on function public.create_payroll_run(date,date) to authenticated;
grant execute on function public.approve_payroll_run(uuid) to authenticated;
grant execute on function public.mark_payroll_run_paid(uuid) to authenticated;
