# Subli-nation Production Management System

Next.js application with Supabase Auth, PostgreSQL, Row Level Security, and private design-file storage integration. The admin can be assigned all seven roles' capabilities. The Supabase schema and RLS migration live in `supabase/migrations/`.

## Configure Supabase

1. Create a Supabase project.
2. In the Supabase SQL Editor, run `supabase/migrations/202610170001_initial_schema.sql`, then run `supabase/migrations/202610190002_dashboard_persistence.sql`, `supabase/migrations/202610190003_catalog_orders.sql`, `supabase/migrations/202610200001_admin_artist_artwork_uploads.sql`, `supabase/migrations/202610200002_return_defects_to_artist.sql`, `supabase/migrations/202610200003_return_defects_to_any_stage.sql`, `supabase/migrations/202610200004_production_notifications.sql`, `supabase/migrations/202610200005_defect_rework_workflow.sql`, `supabase/migrations/202610200006_defect_front_desk_return.sql`, `supabase/migrations/202610200007_employee_work_payroll.sql`, `supabase/migrations/202610200008_automatic_task_payroll_tracking.sql`, and `supabase/migrations/202610200009_front_desk_production_permissions.sql` in order.
3. In Supabase Authentication, create the owner's first user. Then replace `owner@example.com` in `supabase/bootstrap-admin.sql` with that email and run the bootstrap SQL once. This gives the owner the initial `admin` profile.
4. Copy `.env.example` to `.env.local` and fill in the project URL, publishable key, and secret key. Keep `SUPABASE_SECRET_KEY` server-side; never prefix it with `NEXT_PUBLIC_` or commit `.env.local`.
5. Add `http://localhost:3000/auth/callback` to Supabase Auth's allowed redirect URLs for local development. Set `NEXT_PUBLIC_SITE_URL` to the deployed app URL when deploying.
6. Run `npm install`, then `npm run dev`, and open `http://localhost:3000`.

## Personal loan reminders in Document Routing

Apply `supabase/migrations/20261029192517_document_routing_loans.sql` in the configured Supabase project's SQL Editor before opening **Document Routing → Loan reminders / Mga pautang**. This additive migration creates independent admin-only loan and payment tables. It does not change document disbursements or customer payments.

Apply `supabase/migrations/20261101035952_personal_loan_interest_modes.sql` after the original loan migration. Add the borrower's name, principal, dates, interest type, and customizable percentage. One-time interest is the default: PHP 50,000 at 12% gives PHP 6,000 interest and PHP 56,000 total repayment. Monthly mode charges PHP 6,000 each month instead; the preview labels principal plus first month's interest rather than promising a fixed total for an open-ended loan. The rate and mode are saved, with database validation that the calculated amount matches. Existing loans retain monthly terms and their saved amounts. Monthly interest stays fixed on the original principal without compounding. One-time interest can be paid early and remains owed after early principal payoff. Reminders use Manila dates; monthly due days 29-31 use the last day of shorter months. Reminders are displayed inside this page.

Record principal and interest separately; choose the due date covered by each interest payment. Partial payments are supported. Full principal repayment stops later monthly interest; earlier unpaid interest must still be settled. **Fully paid — Remove from active list** archives a settled loan, retaining history under **Archived / Paid**. Restore a loan before correcting an archived payment; **Undo payment** restores its balance and reminders.

Validation: `node --test tests/loan-tracking.test.cjs tests/loan-tracking-database.test.cjs` covers date calculations, partial payments, payoff, archive rules, payment bounds, retry IDs, and admin/anonymous access in an isolated PostgreSQL-compatible PGlite database. The configured live project's migration still needs to be applied if the CLI/connector has no project access.

## Artist activities, mentions, and replies

Apply `supabase/migrations/20261030081041_artist_activity_message_replies_mentions.sql` after the existing payroll/task attribution and team messages migrations. Refresh the app afterward. This migration must be applied to the same Supabase project configured in `.env.local`.

At the top of **Payroll**, **Artist / layout work tracking** shows existing layout tasks, the assigned/starting/completing employee, job order, product, quantity, status, and Philippine start/completion times. Filter by artist and work status, then use **Refresh artist work** to retrieve changes. This view reads existing production tasks and does not need the new migration. Unattributed tasks are labeled rather than assigned to a guessed employee.

After applying the migration, artist layout completions also create pending-review activity records in **Payroll → Sewing and artist work review queue**, including employee, order, item quantity, start/completion time, and rework. Admin reviews these records; approved records attach to newly created payrolls. Artist pay continues to come from approved attendance. Layout quantities do not create extra piece pay, and existing payroll snapshots are preserved. Only future status changes create ledger entries; historical work is not invented or backfilled.

**Team messages** automatically shows layout starts, completions, and returns for correction, attributed to the account performing the action. Choose **Mention an account**, find an active employee, and select their name to tag them. Recipients see **You were mentioned** in the shared conversation. Choose **Reply** on any message or activity post to compose a reply with its quoted context; older parents remain visible in replies even outside the currently loaded history. Mentions and replies stay in the shared conversation; no email or push notifications are sent.

Validation: `node --test tests/artist-activity-messages.test.cjs tests/team-messages.test.cjs tests/sewing-assignments.test.cjs tests/attendance-database.test.cjs`.

## Accounts and permissions

- Sign in at `/login` with Supabase Auth.
- Admins can use **Employees** in the dashboard sidebar to create staff accounts with email and password without sending invitation emails, assign one of seven roles, update profiles, and deactivate/reactivate access. Existing login-ID accounts can still sign in with their IDs.
- Admin access is allowed by the RLS policies for every role's production stage and business functions.
- The secret key is used only in server actions to create employee auth accounts. Employee creation confirms the account directly and does not send an invitation email. Database access uses authenticated sessions and RLS.

## Customer payments and partial pickups

The dashboard's Customers table and Excel export show initial downpayments separately from total paid and remaining balance. Downpayment totals use payments recorded as `Initial down payment`; follow-up payments contribute to total paid.

Apply `supabase/migrations/20261029025401_order_piece_releases.sql` before using partial pickups. Open a ready-for-release order and use **Piece releases** to enter the quantity, recipient, and optional notes. Each pickup records the staff member and time. The order stays ready for release until all pieces have been handed over. Full payment and approved QC are required for every pickup; admins can record an exception reason for that pickup. Quantity edits and item additions/removals are blocked after the first pickup. Existing released orders are shown as fully handed over without inventing pickup history.

Apply `supabase/migrations/20261029030118_pickup_release_dates.sql` after the piece release migration to enable selectable pickup dates. Choose **Release all remaining** or **Choose quantity**, then enter the release date and recipient. Pickup history shows both the selected date and the actual recording timestamp. Existing pickup dates are preserved using Manila time.

Validation: `node --test tests/payment-tracking.test.cjs tests/piece-releases.test.cjs`.

## Payroll cash advances

Apply `supabase/migrations/20261029043232_automatic_employee_sss.sql` to enable **Automatic SSS per employee** in Payroll. Admin sets an employee share per payroll cutoff for each employee, including sewers. New payroll lines snapshot that setting and subtract it from net pay automatically. Unset settings deduct zero. Updating settings affects future payrolls only; existing drafts can be corrected using the period-specific SSS adjustment, and approved/paid totals remain unchanged. Payroll shows gross earnings, total SSS/cash advance deductions, and net pay for the selected period. This is a configured cutoff amount, not an automatic statutory contribution calculation or remittance.

Validation: `node --test tests/automatic-sss.test.cjs`.

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

Apply `supabase/migrations/20261028023512_qr_attendance_approval.sql` to require admin review for new QR scans. In **Attendance ? Daily Log Viewer**, select the date and approve or reject pending logs. Every later QR punch returns that day to pending approval. Payroll preparation requires all pending logs in its period to be reviewed and includes approved attendance only. Admin corrections through **Edit log** count as approval. Historical attendance remains approved.

The Daily Log Viewer filters by date and exports the selected day's attendance and pay to Excel. Payroll sums saved daily net pay for non-sewers, then applies payroll adjustments and cash advance recovery. Periods already in payroll are locked; use draft adjustments for corrections. Existing payroll snapshots and legacy hours are retained, and sewing output pay stays separate.

Validation: `node --test tests/attendance-database.test.cjs` runs the actual migration functions and RLS checks in an isolated PGlite PostgreSQL database; it does not modify the configured project. Run all tests with `node --test tests/*.test.cjs` and the production build with `npm run build`.

The login page offers a separate **Scan QR** card linking to `/scan-qr`, with no sign-in requirement. Camera selection, start/stop controls, QR image upload and USB input are supported. Counters cover successful scans during the current visit; employee records are not publicly readable. Uploaded images are decoded in the browser. System login remains required for workspace access.

SSS payroll deductions: apply `supabase/migrations/20261028063252_payroll_sss_deductions.sql`, then open **Payroll ? SSS deduction settings**. Choose a draft period and employee, enter the employee share for that period and an optional reference, and save. The deduction appears separately in the payroll breakdown and reduces net pay. Amounts are entered by the admin; this feature does not calculate an SSS contribution table. Approved and paid payroll amounts are locked; historical payroll starts with zero SSS deduction.
### Payslips

For employee access, also apply `supabase/migrations/20261028085057_employee_salary_info.sql` after the payslip migration. Every active non-admin role has **My Salary** in navigation (`/salary`). Employees can read their own pay settings, draft/approved/paid payroll breakdowns, deductions, and issued payslips. Draft amounts are provisional. Issued payslips are displayed separately and do not imply payment. Database policies prevent access to other employees' salary records and do not grant editing permissions.

Apply `supabase/migrations/20261028080216_employee_payslips.sql` after the existing migrations. In **Payroll → Manage Payslips**, choose **Issue New Payslip**, select an employee and pay period, and enter earnings and deductions. Position is filled automatically; there is no Department field. The database assigns the payslip number and calculates net pay. Issued records preserve employee details and amounts and cannot be edited from the app. One payslip is allowed per employee for the same period.

Use **PDF** on an issued record to download its payslip. Payslips are standalone salary records, not proof of payment, and do not update payroll runs or cash advance balances. Backpay is entered manually after review; there is no automatic approved-backpay system. SSS, PhilHealth, and Pag-IBIG amounts are manually entered employee deductions.

### Sewer assignments and Front Desk handoffs

Apply `supabase/migrations/20261029065538_sewer_assignments.sql` after the earlier migrations, then apply `supabase/migrations/20261029074932_sewer_self_claim.sql`. Skip migrations already applied. Open **Sewing assignments** (`/sewing`) as Admin, Front Desk, or Cutting / Sewing staff. Order details also link to the order's sewing assignments.

Every active sewing order appears automatically in all sewers' shared queue, including its instructions, upstream stage status, and total unclaimed quantity. Each sewer enters how many pieces they want and clicks **Assign to me**. The authenticated sewer is both the assignee and assignment recorder; they cannot claim for another account. Claims and Front Desk reservations share a database task lock, preventing the combined quantity from exceeding the order item. A stale balance is rejected if another sewer has already taken the pieces. Claiming reserves pieces and does not record a handoff, completion, or payroll output. Individual assignment rows and output histories remain private to their sewer, Admin, and Front Desk; only aggregate availability is shared.

Finish the item's Layout, Printing, Heat Press, and Cutting tasks (only stages included in the order apply), then Front Desk records partial or full materials handoffs. Each sewer records their own partial completions up to the pieces handed over. Refresh retrieves other staff's latest changes.

The new-order form describes the **Automatic shared sewing queue**; no sewer selection is required. An optional Front Desk reservation can still reserve pieces for an employee, leaving the rest available for self-claim. Assignment retries reuse their original request IDs without duplicating the order or previously saved assignments. Saving a sewing order opens that order in **Sewing assignments**. Sewer screens refresh every 15 seconds while visible and when their window receives focus; manual Refresh remains available. Existing open sewing orders also enter the shared queue unless they have legacy output already recorded. Print-only services do not enter sewing queues.

Admin and Front Desk see all assignments, unassigned pieces, handed-over pieces, completed output, quantities still awaiting handoff, and quantities ready to sew. Handoffs and completions retain their actor, time, notes, and quantities. New sewing tasks require assignment/handoff/output tracking; pre-existing tasks retain their original behavior until assigned. Assigned item quantities/products and task identities are locked to preserve reconciliation. Assigned tasks cannot be deleted while their assignment history exists.

Each output batch creates one pending-review payroll work record with that sewer's configured rate. Completing all pieces automatically completes the Sewing task without creating another full-order output record; QC is still separate. Rework has a separate action and does not increase the completed count or earn piece pay by default. After rework, the existing production completion action can close a returned Sewing stage. Payroll snapshots are unchanged.

**Create example order** creates or reopens one clearly labeled sample: **24 Barangay Eagles jerseys**, full production route, example sizes, and a suggested 10/8/6 split. Actual sewer accounts can claim their own quantities; the example does not invent employee accounts or mark upstream work finished. Example output starts excluded from piece pay. It is a real, labeled order in the workspace, so it appears in order lists and reports.

Validation: `node --test tests/sewing-assignments.test.cjs` exercises the migration in isolated PostgreSQL (PGlite), including RLS, handoff gates, separate employee quantities/rates, retry handling, QC gating, and example creation. This does not apply the migration to the configured Supabase project.

In **Sewing assignments → Sewing details & reports**, filter by job order and optionally by sewer. The report shows each assignment's sewer, assigning staff member/date, quantities assigned/handed over/completed/remaining, rework, and last output recorder/date. **Excel — quantities** exports the quantity breakdown and instructions; **Excel — full history** exports each assignment, handoff, completion, and rework entry with its recorder, Philippine timestamp, notes, and record IDs. **Print sewing details** opens an A4 landscape report with the quantity summary and complete assignment histories (also usable as Save as PDF). Excel files have landscape print setup and repeating headers. Sewer accounts report only their own assignments under the existing database policies. These reports show recorded output, not payroll or QC approval. No additional SQL migration is needed for reporting.

### Dated customer down payments

Apply `supabase/migrations/20261029082024_dated_customer_downpayments.sql` for dated installment tracking. When creating an order, enter the initial **Down payment date**. For every later installment, open the order → **Add payment**, choose **Down payment / installment**, and enter its own date, amount, method, and receipt note. Each installment inserts a separate payment row; earlier entries stay intact. The date received is separate from the timestamp when staff entered the record. Existing receipt dates are backfilled using Philippine time, and existing initial deposits retain their down-payment classification. Other historical payments keep their previous generic classification.

Open **Customers → Payment history** for all receipts from that customer's orders, or **Payments** to filter across customers. The history lists every dated entry in chronological order (for example October 11, 20, and 26), and displays total down payments, total paid, and remaining balance. **Export Excel** exports each receipt separately with its payment type, date, amount, reference, and entry timestamp. Repeated saves reuse the receipt request ID, and database balance checks prevent overpayment. No existing receipts are merged or deleted. Tests: `node --test tests/dated-customer-payments.test.cjs tests/payment-tracking.test.cjs`.
