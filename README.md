# Subli-nation Production Management System

Next.js application with Supabase Auth, PostgreSQL, Row Level Security, and private design-file storage integration. The admin can be assigned all seven roles' capabilities. The Supabase schema and RLS migration live in `supabase/migrations/`.

## Configure Supabase

1. Create a Supabase project.
2. In the Supabase SQL Editor, run `supabase/migrations/202610170001_initial_schema.sql`, then run `supabase/migrations/202610190002_dashboard_persistence.sql`, `supabase/migrations/202610190003_catalog_orders.sql`, `supabase/migrations/202610200001_admin_artist_artwork_uploads.sql`, `supabase/migrations/202610200002_return_defects_to_artist.sql`, `supabase/migrations/202610200003_return_defects_to_any_stage.sql`, `supabase/migrations/202610200004_production_notifications.sql`, `supabase/migrations/202610200005_defect_rework_workflow.sql`, `supabase/migrations/202610200006_defect_front_desk_return.sql`, `supabase/migrations/202610200007_employee_work_payroll.sql`, `supabase/migrations/202610200008_automatic_task_payroll_tracking.sql`, and `supabase/migrations/202610200009_front_desk_production_permissions.sql` in order.
3. In Supabase Authentication, create the owner's first user. Then replace `owner@example.com` in `supabase/bootstrap-admin.sql` with that email and run the bootstrap SQL once. This gives the owner the initial `admin` profile.
4. Copy `.env.example` to `.env.local` and fill in the project URL, publishable key, and secret key. Keep `SUPABASE_SECRET_KEY` server-side; never prefix it with `NEXT_PUBLIC_` or commit `.env.local`.
5. Add `http://localhost:3000/auth/callback` to Supabase Auth's allowed redirect URLs for local development. Set `NEXT_PUBLIC_SITE_URL` to the deployed app URL when deploying.
6. Run `npm install`, then `npm run dev`, and open `http://localhost:3000`.

## Accounts and permissions

- Sign in at `/login` with Supabase Auth.
- Admins can use **Employees** in the dashboard sidebar to create staff accounts with email and password without sending invitation emails, assign one of seven roles, update profiles, and deactivate/reactivate access. Existing login-ID accounts can still sign in with their IDs.
- Admin access is allowed by the RLS policies for every role's production stage and business functions.
- The secret key is used only in server actions to create employee auth accounts. Employee creation confirms the account directly and does not send an invitation email. Database access uses authenticated sessions and RLS.

## Shared dashboard data

Orders, order items, customers, payments, production tasks, defects, and QC inspections are stored in Supabase and protected by the database RLS policies. Employee accounts are managed through Supabase Auth and `profiles`.

The dashboard previously stored demo records in browser local storage. Those old records are not copied automatically into Supabase; review them separately before importing anything into the live database. New and updated records are written to the shared Supabase project after both migrations above have been applied.
