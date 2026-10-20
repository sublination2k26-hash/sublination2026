create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_recipient_created_idx on public.notifications(recipient_id,created_at desc);
alter table public.notifications enable row level security;
create policy "staff read own notifications" on public.notifications
  for select to authenticated using (recipient_id=auth.uid());
create policy "staff mark own notifications read" on public.notifications
  for update to authenticated using (recipient_id=auth.uid()) with check (recipient_id=auth.uid());

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
    when 'cutting' then 'cutting_sewing'::public.app_role
    when 'sewing' then 'cutting_sewing'::public.app_role
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

drop trigger if exists production_stage_return_notification on public.production_tasks;
create trigger production_stage_return_notification
after update of status on public.production_tasks
for each row execute function public.notify_stage_return();
