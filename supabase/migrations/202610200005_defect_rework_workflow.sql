-- Capture defect investigation, targeted rework, and a durable correction history.
alter table public.defects
  drop constraint if exists defects_category_check,
  add constraint defects_category_check check (category in (
    'wrong_name','wrong_number','print_defect','damaged_fabric','wrong_size','missing_piece','other',
    'design','printing','pressing','cutting','sewing','order_information','billing','material','customer_change'
  ));

alter table public.defects
  add column if not exists origin_stage public.task_stage,
  add column if not exists return_stage public.task_stage,
  add column if not exists return_destination text,
  add column if not exists required_action text,
  add column if not exists affected_component text,
  add column if not exists approval_to_resume boolean not null default false;

create table if not exists public.defect_history (
  id uuid primary key default gen_random_uuid(),
  defect_id uuid not null references public.defects(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  event text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.defect_history enable row level security;
create policy "staff read defect history" on public.defect_history for select to authenticated
  using (public.current_app_role() is not null);
create policy "staff record defect history" on public.defect_history for insert to authenticated
  with check (public.current_app_role() is not null);

create or replace function public.log_defect_history()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.defect_history(defect_id,actor_id,event,details)
    values(new.id,new.reported_by,'reported',jsonb_build_object('origin_stage',new.origin_stage,'return_stage',new.return_stage,'return_destination',new.return_destination,'required_action',new.required_action,'affected_component',new.affected_component));
  else
    if old.return_stage is distinct from new.return_stage or old.return_destination is distinct from new.return_destination then
      insert into public.defect_history(defect_id,actor_id,event,details)
      values(new.id,new.reported_by,'destination_changed',jsonb_build_object('from',coalesce(old.return_destination,old.return_stage::text),'to',coalesce(new.return_destination,new.return_stage::text)));
    end if;
    if old.correction_status is distinct from new.correction_status or old.approval_to_resume is distinct from new.approval_to_resume then
      insert into public.defect_history(defect_id,actor_id,event,details)
      values(new.id,coalesce(new.corrected_by,new.qc_verified_by),'status_changed',jsonb_build_object('from',old.correction_status,'to',new.correction_status,'approval_to_resume',new.approval_to_resume));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists defects_history_log on public.defects;
create trigger defects_history_log after insert or update on public.defects
for each row execute function public.log_defect_history();
