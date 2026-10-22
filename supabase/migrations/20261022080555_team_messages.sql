create table public.team_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index team_messages_sender_idx on public.team_messages(sender_id);
alter table public.team_messages enable row level security;
revoke all on public.team_messages from anon, authenticated;
grant select on public.team_messages to authenticated;
grant insert (body) on public.team_messages to authenticated;
grant usage on sequence public.team_messages_id_seq to authenticated;
create policy team_messages_staff_read on public.team_messages for select to authenticated
  using ((select public.current_app_role()) is not null);
create policy team_messages_staff_send on public.team_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and (select public.current_app_role()) is not null);
