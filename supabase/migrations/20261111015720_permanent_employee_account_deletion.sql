begin;
-- Historical profiles identify work and payroll; login accounts are deleted independently.
alter table public.profiles add column auth_deleted_at timestamptz;
alter table public.profiles drop constraint profiles_id_fkey;

create function private.archive_deleted_employee_login() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set active = false, auth_deleted_at = now(), updated_at = now() where id = old.id;
  return old;
end;
$$;
revoke all on function private.archive_deleted_employee_login() from public, anon, authenticated;
create trigger archive_deleted_employee_login before delete on auth.users
for each row execute function private.archive_deleted_employee_login();

notify pgrst, 'reload schema';
commit;
