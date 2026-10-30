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
  await assert.rejects(db.query('update personal_loans set archived_at=now() where id=$1',[loan.id]),/outstanding monthly interest/);
  await assert.rejects(insert(0,100,'2026-03-31','2026-04-01'),/valid monthly/);
  const last=(await insert(0,60,'2026-02-28','2026-04-01')).rows[0];
  await db.query('update personal_loans set archived_at=now() where id=$1',[loan.id]);
  assert.ok((await db.query('select archived_at from personal_loans where id=$1',[loan.id])).rows[0].archived_at);
  await assert.rejects(db.query('delete from personal_loan_payments where id=$1',[last.id]),/Restore/);
  await db.query('update personal_loans set archived_at=null where id=$1',[loan.id]);
  await db.query('delete from personal_loan_payments where id=$1',[last.id]);
  await assert.rejects(db.query('update personal_loans set archived_at=now() where id=$1',[loan.id]),/outstanding monthly interest/);
  for (const user of [2,3,null]) {
    await asUser(user);
    assert.equal((await db.query('select * from personal_loans')).rows.length,0);
    assert.equal((await db.query('select * from personal_loan_payments')).rows.length,0);
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
