-- 1. Create/invite the owner's user in Supabase Dashboard > Authentication > Users.
-- 2. Replace the email below and run this once in the Supabase SQL Editor.
-- 3. Sign in using that user's email and password.
insert into public.profiles (id, full_name, role, active)
select id, coalesce(raw_user_meta_data->>'full_name', 'Shop Owner'), 'admin', true
from auth.users
where email = 'ravenbuhay25@gmail.com'
on conflict (id) do update
set role = 'admin', active = true, updated_at = now();
