const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('loan ledger: admin-only access, bounded payments, monthly deadlines, settlement and archive', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    create type public.app_role as enum ('admin','front_desk');
    create table public.profiles(id uuid primary key,role public.app_role,active boolean);
    create function public.current_app_role() returns public.app_role language sql stable security definer set search_path='' as
      $$select role from public.profiles where id=auth.uid() and active$$;
    insert into profiles values ('00000000-0000-0000-0000-000000000001','admin',true),
      ('00000000-0000-0000-0000-000000000002','front_desk',true),
      ('00000000-0000-0000-0000-000000000003','admin',false);
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261029192517_document_routing_loans.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261101035952_personal_loan_interest_modes.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261123140000_personal_loan_daily_payoff_suppliers.sql','utf8'));
  const paymentSelect = fs.readFileSync('src/lib/loan-tracking.ts','utf8').match(/loanPaymentColumns = "([^"]+)"/)[1].split(',');
  const paymentSchema = await db.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name='personal_loan_payments'`);
  const paymentSchemaColumns = new Set(paymentSchema.rows.map(row => row.column_name));
  assert.ok(paymentSelect.every(column => paymentSchemaColumns.has(column)),
    'loan payment queries must only select columns in the payment table');
  const asUser = async (n,role='authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)", [n ? `00000000-0000-0000-0000-00000000000${n}` : '']);
    await db.exec(`set role ${role}`);
  };
  await asUser(1);
  const loan = (await db.query(`insert into personal_loans(borrower_name,principal,start_date,first_due_date,due_day,monthly_interest)
    values ('Ana',1000,'2026-01-31','2026-02-28',31,100) returning *`)).rows[0];
  assert.equal(loan.created_by,'00000000-0000-0000-0000-000000000001');
  await assert.rejects(db.query("update personal_loans set archived_at=now() where id=$1",[loan.id]),/remaining principal/);
  await assert.rejects(db.query("update personal_loans set principal=1 where id=$1",[loan.id]),/permission denied/);
  const insert = async (principal,interest,due=null,date='2026-03-10',id=null) => db.query(`
    insert into personal_loan_payments(id,loan_id,paid_on,principal_amount,interest_amount,interest_due_date)
    values (coalesce($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6) returning *`,[id,loan.id,date,principal,interest,due]);
  await assert.rejects(insert(1001,0),/remaining principal/);
  await assert.rejects(insert(-1,0),/check constraint/);
  await assert.rejects(insert(0,0),/check constraint/);
  await assert.rejects(insert(0,101,'2026-02-28'),/unpaid interest/);
  await assert.rejects(insert(0,100,'2026-02-27'),/valid monthly/);
  await assert.rejects(insert(0,100,'2026-03-31'),/valid monthly/);
  await assert.rejects(insert(1,0,null,'2099-01-01'),/Payment date/);
  await assert.rejects(insert(1,0,null,'2026-01-01'),/Payment date/);
  await assert.rejects(db.exec(`insert into personal_loans(borrower_name,principal,start_date,first_due_date,due_day,monthly_interest)
    values ('Bad',100,'2026-01-01','2026-02-27',31,10)`),/match the monthly/);
  const partial=(await insert(100,40,'2026-02-28')).rows[0];
  await assert.rejects(insert(0,61,'2026-02-28'),/unpaid interest/);
  await assert.rejects(insert(0,40,'2026-02-28','2026-03-10',partial.id),/duplicate key/);
  const payoff=(await insert(900,0)).rows[0];
  await assert.rejects(insert(900,0,null,'2026-03-10',payoff.id),/duplicate key/);
  await assert.rejects(db.query('update personal_loans set archived_at=now() where id=$1',[loan.id]),/outstanding interest/);
  await assert.rejects(insert(0,100,'2026-03-31','2026-04-01'),/valid monthly/);
  const last=(await insert(0,60,'2026-02-28','2026-04-01')).rows[0];
  await db.query("select record_personal_loan_payoff($1,'2026-04-01',$2)",[loan.id,'00000000-0000-0000-0000-000000000099']);
  await db.query('update personal_loans set archived_at=now() where id=$1',[loan.id]);
  assert.ok((await db.query('select archived_at from personal_loans where id=$1',[loan.id])).rows[0].archived_at);
  await assert.rejects(db.query('delete from personal_loan_payments where id=$1',[last.id]),/Restore/);
  await db.query('update personal_loans set archived_at=null where id=$1',[loan.id]);
  await db.query('delete from personal_loan_payments where id=$1',[last.id]);
  await assert.rejects(db.query('update personal_loans set archived_at=now() where id=$1',[loan.id]),/outstanding interest/);
  const once = (await db.query(`insert into personal_loans(borrower_name,principal,start_date,first_due_date,due_day,monthly_interest,interest_mode,interest_rate)
    values ('Once',50000,'2026-01-01','2026-02-01',1,6000,'one_time',12) returning *`)).rows[0];
  assert.equal(Number(once.monthly_interest),6000);
  await assert.rejects(db.exec(`insert into personal_loans(borrower_name,principal,start_date,first_due_date,due_day,monthly_interest,interest_mode,interest_rate)
    values ('Wrong',50000,'2026-01-01','2026-02-01',1,5000,'one_time',12)`),/check constraint/);
  await db.query(`insert into personal_loan_payments(loan_id,paid_on,principal_amount) values ($1,'2026-01-15',50000)`,[once.id]);
  await assert.rejects(db.query('update personal_loans set archived_at=now() where id=$1',[once.id]),/outstanding/);
  await assert.rejects(db.query(`insert into personal_loan_payments(loan_id,paid_on,interest_amount,interest_due_date) values ($1,'2026-03-01',6000,'2026-03-01')`,[once.id]),/one-time/);
  await db.query(`insert into personal_loan_payments(loan_id,paid_on,interest_amount,interest_due_date) values ($1,'2026-01-15',6000,'2026-02-01')`,[once.id]);
  await assert.rejects(db.query(`insert into personal_loan_payments(loan_id,paid_on,interest_amount,interest_due_date) values ($1,'2026-02-01',0.01,'2026-02-01')`,[once.id]),/unpaid interest/);
  await db.query('update personal_loans set archived_at=now() where id=$1',[once.id]);
  const payoffLoan=(await db.query(`insert into personal_loans(borrower_name,principal,start_date,first_due_date,due_day,monthly_interest,interest_mode,interest_rate,supplier)
    values ('Full Payoff',50000,'2026-01-31','2026-02-28',31,6000,'monthly',12,'MAGNUS') returning id,supplier`)).rows[0];
  assert.equal(payoffLoan.supplier,'MAGNUS');
  const requestId='00000000-0000-0000-0000-000000000098';
  await db.query("select record_personal_loan_payoff($1,'2026-03-05',$2)",[payoffLoan.id,requestId]);
  await db.query("select record_personal_loan_payoff($1,'2026-03-05',$2)",[payoffLoan.id,requestId]);
  const payoffTotals=(await db.query('select sum(principal_amount) as principal,sum(interest_amount) as interest from personal_loan_payments where loan_id=$1',[payoffLoan.id])).rows[0];
  assert.equal(Number(payoffTotals.principal),50000);assert.equal(Number(payoffTotals.interest),6000);
  assert.equal(Number((await db.query('select sum(amount) as amount from personal_loan_daily_interest_payments where loan_id=$1',[payoffLoan.id])).rows[0].amount),1000);
  assert.equal((await db.query('select count(*)::integer as count from personal_loan_payments where loan_id=$1',[payoffLoan.id])).rows[0].count,2,
    'retrying a full payoff does not duplicate its ledger entries');
  await db.query('update personal_loans set archived_at=now() where id=$1',[payoffLoan.id]);
  const supplierLoan=(await db.query(`insert into personal_loans(borrower_name,principal,start_date,first_due_date,due_day,monthly_interest,interest_mode,interest_rate,supplier)
    values ('Subli supplier',1000,'2026-01-01','2026-02-01',1,100,'one_time',10,'SUBLI-NATION') returning id,supplier`)).rows[0];
  assert.equal(supplierLoan.supplier,'SUBLI-NATION');
  for (const user of [2,3,null]) {
    await asUser(user);
    assert.equal((await db.query('select * from personal_loans')).rows.length,0);
    assert.equal((await db.query('select * from personal_loan_payments')).rows.length,0);
    assert.equal((await db.query('select * from personal_loan_daily_interest_payments')).rows.length,0);
    await assert.rejects(db.exec(`insert into personal_loans(borrower_name,principal,start_date,first_due_date,due_day,monthly_interest)
      values ('Blocked',100,'2026-01-01','2026-02-01',1,10)`),/row-level security/);
    await assert.rejects(insert(1,0),/Loan not found|row-level security/);
    assert.equal((await db.query('update personal_loans set archived_at=now() returning id')).rows.length,0);
    assert.equal((await db.query('delete from personal_loan_payments returning id')).rows.length,0);
  }
  await asUser(null,'anon');
  await assert.rejects(db.query('select * from personal_loans'),/permission denied/);
  await assert.rejects(db.query('select * from personal_loan_payments'),/permission denied/);
});
