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

## Payroll cash advances

### Additional overtime pay

Apply `supabase/migrations/20261027131046_payroll_overtime.sql` after the employee cash advance ledger migration. In Payroll's **Overtime settings** section, select a draft payroll period and employee, enter overtime hours, hourly rate and optional date/reason, then click **Save overtime**. The payroll table displays the saved overtime amount and links back to these settings. Overtime pay is hours multiplied by the entered rate, rounded to centavos, and added to base pay, production pay and adjustments before cash advance deductions. Enter the full applicable overtime hourly rate; the app does not apply a multiplier or infer overtime from QR time logs. Saved overtime is retained when advance recoveries change. Approved/paid payrolls are locked and historical rows start with zero overtime.

For individual employee advances, apply `supabase/migrations/20261027124647_employee_cash_advance_ledger.sql` after the payroll cash advance migration. Payroll now has **Employee cash advances**: record each employee's amount, date, reference and reason, then select a draft payroll period and save a recovery amount for each advance. Enter zero to remove a draft reservation. The database prevents recovering another employee's advance, recovering more than the available balance across payrolls, or changing an approved/paid recovery. Paid payrolls reduce unpaid balances; draft/approved payrolls reserve amounts. The ledger shows recovery history, unpaid balance, reserved deductions and available balance. Previously saved deductions remain as legacy payroll amounts and are not automatically treated as new employee debts. Advance issuance records are retained, not overwritten. Document Routing no longer has cash advance controls; any previously applied document advance columns/data are retained without deletion.

Apply `supabase/migrations/20261026043803_payroll_cash_advance.sql` after the existing payroll migrations, followed by the individual ledger migration above. Approved and paid periods remain locked.

## Document routing (admin only)

Apply `supabase/migrations/20261027064919_document_routing.sql` in the configured Supabase project's SQL Editor after the initial schema. Open **Document Routing** in the admin sidebar (`/document-routing`). This is an independent section and does not change inventory stock, payroll, orders, or production.

Create a document with its unique PR number, optional PO number, description, payee, request date and amount. Open a document to edit details, record cheque/BIR references, gross payment, tax deduction and release details. Net payment is calculated as gross minus tax. A release date requires a cheque number, recipient/signature reference and positive gross payment; it cannot precede the request date.

Add dated office updates through PR, PO, COA, BAC, GSO, BADMIN, GSO BODEGA, INSPECTOR, NUMBERING, CHECKING, ACCOUNTING, ASSESSORS and CHEQUE RELEASE. The last recorded entry is the current stage; stages may repeat for returns or corrections. Earlier entries cannot be edited or deleted. Office dates and initials are manually recorded; signature references are text, not digital signatures. Payment release and office routing are recorded separately. Search by PR/PO, description or payee and filter by stage. Only active admins can read or write these records, enforced by database RLS as well as the page guard.

Validation: `node --test tests/document-routing-database.test.cjs` verifies the migration, admin isolation, immutable routing entries, financial constraints and stale-edit protection in an isolated database.


## Materials inventory

Apply `supabase/migrations/20261022071231_materials_inventory.sql` in the configured project's SQL Editor, then open **Inventory** from the admin sidebar (`/inventory`). The migration adds 20 starter supplies at zero stock. Admins can add materials, edit names, categories and units, record current quantities, and set low-stock levels. Quantities support three decimal places. Stock edits detect concurrent changes; reload before retrying a conflicting edit. Inventory access is restricted to active admins through both the page and database policies.

## Shared dashboard data

Orders, order items, customers, payments, production tasks, defects, and QC inspections are stored in Supabase and protected by the database RLS policies. Employee accounts are managed through Supabase Auth and `profiles`.

The dashboard previously stored demo records in browser local storage. Those old records are not copied automatically into Supabase; review them separately before importing anything into the live database. New and updated records are written to the shared Supabase project after both migrations above have been applied.

## Team messages

Apply `supabase/migrations/20261022080555_team_messages.sql` in the configured project's SQL Editor. All active employees and admins can open **Messages** from the sidebar at `/messages`. The shared chat refreshes every four seconds, shows sender names and Philippine timestamps, and loads older history on demand. Messages are limited to 2,000 characters. Database policies restrict reading and sending to active staff, and senders are assigned from the authenticated session.

## Service production routes

Apply `supabase/migrations/20261022084023_service_production_routes.sql` before adding new products. New orders follow their selected product's service: full garment uses layout, printing, heat press, cutting, sewing and QC; sub-con print only uses layout, printing and QC; sub-con print and press adds heat press; sub-con with sewing uses layout, cutting, sewing and QC. Existing order task histories are preserved. New products store an explicit service, and new orders snapshot it with their production instructions.

## Sewing work tracking

Apply `supabase/migrations/20261026060520_sewing_only_work_tracking.sql`. Only sewing tasks completed by an active Cutter / Sewer create new payroll work records. All staff remain eligible for payroll, and all production stages continue to track order progress. Historical work records and payroll snapshots are preserved. Non-sewing staff use the attendance workflow below for daily pay.

## Attendance payroll

Apply `supabase/migrations/20261027023029_attendance_based_payroll.sql` after the cash advance migration. Non-sewing employees use attendance hours (8 hours per day); weekly, semi-monthly, and monthly base rates are converted using 7, 15, and 30 day equivalents. No attendance means zero base pay. Apply the QR time attendance migration below for the current time-log interface, and record attendance in Time In & Out before creating a draft. Dates already included in payroll are locked; correct existing drafts through adjustments. Only sewing records appear in the work review queue and count toward new output pay. Existing payroll snapshots are preserved.

## Time In & Out and employee QR salary

Apply these pending migrations in order in the configured Supabase project (skip any already applied):

1. `supabase/migrations/20261026043803_payroll_cash_advance.sql`
2. `supabase/migrations/20261026060520_sewing_only_work_tracking.sql`
3. `supabase/migrations/20261027023029_attendance_based_payroll.sql`
4. `supabase/migrations/20261027023537_qr_time_attendance.sql`

Open **Time In & Out** (`/attendance`). Admins manage **QR Management**, select an existing non-sewing employee, and enter their daily salary and payment method. View/download each QR as a PNG for printing or display on another screen. Disable removes the QR credential, preserving attendance and pay settings; generating it again issues a new QR.

Employees open **Scan QR** (`/scan-qr`) separately from system login. Choose AM in/out or PM in/out and scan an issued employee QR code, upload its image, or use a USB scanner. Apply `supabase/migrations/20261027031811_public_qr_attendance.sql` after the QR time attendance migration to enable scanning without login. The QR token authorizes only a current-time attendance action and returns no employee identity, salary, or history. Disabled codes, inactive employees, duplicate actions, invalid sequences, and locked payroll periods are rejected. Admins still sign in to manage salaries, schedules, codes, and corrections.

Admins can customize AM/PM work hours, late-arrival grace minutes, and whether late arrivals and early departures reduce pay. Defaults are 8 AM?12 PM and 1 PM?5 PM, zero grace, with proportional deductions. Grace applies per session; once exceeded, all late minutes are deducted. Missing sessions earn zero, lunch and overtime are excluded, and wages use exact paid minutes before rounding to centavos. Daily salary, schedule, grace, and deduction rules are saved with each day's log and preserved when settings change. The displayed hours are credited paid hours. Incomplete rows show provisional pay and must be completed/corrected before creating payroll.

The Daily Log Viewer filters by date and exports the selected day's attendance and pay to Excel. Payroll sums saved daily net pay for non-sewers, then applies payroll adjustments and cash advance recovery. Periods already in payroll are locked; use draft adjustments for corrections. Existing payroll snapshots and legacy hours are retained, and sewing output pay stays separate.

Validation: `node --test tests/attendance-database.test.cjs` runs the actual migration functions and RLS checks in an isolated PGlite PostgreSQL database; it does not modify the configured project. Run all tests with `node --test tests/*.test.cjs` and the production build with `npm run build`.

The login page offers a separate **Scan QR** card linking to `/scan-qr`, with no sign-in requirement. Camera selection, start/stop controls, QR image upload and USB input are supported. Counters cover successful scans during the current visit; employee records are not publicly readable. Uploaded images are decoded in the browser. System login remains required for workspace access.
