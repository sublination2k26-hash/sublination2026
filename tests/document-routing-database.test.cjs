const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('document routing: admin access, preserved history, dates, money and concurrent edits', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create type public.app_role as enum ('admin','front_desk');
    create table public.profiles(id uuid primary key, role public.app_role, active boolean);
    create function public.current_app_role() returns public.app_role language sql stable security definer set search_path='' as
      $$ select role from public.profiles where id=auth.uid() and active $$;
    insert into profiles values ('00000000-0000-0000-0000-000000000001','admin',true),
      ('00000000-0000-0000-0000-000000000002','front_desk',true),
      ('00000000-0000-0000-0000-000000000003','admin',false);
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261027064919_document_routing.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261027121810_document_cash_advance.sql', 'utf8'));
  const actAs = async (id, role = 'authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)", [id ? `00000000-0000-0000-0000-00000000000${id}` : '']);
    await db.exec(`set role ${role}`);
  };
  await actAs(1);
  const record = (await db.query(`insert into routing_documents(pr_number,title,request_date,amount,gross_amount,tax_deduction)
    values ('PR-001','Office supplies','2026-10-01',1000,1000,50) returning *,updated_at::text as version`)).rows[0];
  assert.equal(Number(record.net_amount), 950);
  assert.equal(Number(record.cash_advance_balance), 0);
  await assert.rejects(db.query('update routing_documents set cash_advance_amount=500 where id=$1', [record.id]), /document_cash_advance_details/);
  await db.query(`update routing_documents set cash_advance_amount=500,cash_advance_date='2026-10-02',
    cash_advance_recipient='Purchasing officer',cash_advance_reference='CA-001',cash_advance_liquidated=125.25 where id=$1`, [record.id]);
  let advance = (await db.query('select * from routing_documents where id=$1', [record.id])).rows[0];
  assert.equal(Number(advance.cash_advance_balance), 374.75);
  assert.equal(Number(advance.net_amount), 950);
  await assert.rejects(db.query('update routing_documents set cash_advance_liquidated=501 where id=$1', [record.id]), /check constraint/);
  await assert.rejects(db.query('update routing_documents set cash_advance_amount=-1 where id=$1', [record.id]), /check constraint/);
  await assert.rejects(db.query("update routing_documents set cash_advance_date='2026-09-30' where id=$1", [record.id]), /document_cash_advance_details/);
  await db.query('update routing_documents set cash_advance_liquidated=500 where id=$1', [record.id]);
  advance = (await db.query('select * from routing_documents where id=$1', [record.id])).rows[0];
  assert.equal(Number(advance.cash_advance_balance), 0);
  await assert.rejects(db.exec("insert into routing_documents(pr_number,title,request_date) values (' pr-001 ','Duplicate','2026-10-01')"), /unique/);
  await assert.rejects(db.query('update routing_documents set tax_deduction=1001 where id=$1', [record.id]), /check constraint/);
  await assert.rejects(db.query("update routing_documents set released_date='2026-10-02' where id=$1", [record.id]), /routing_release_details/);
  await db.query("update routing_documents set released_date='2026-10-02',cheque_number='CH-001',released_to='Supplier' where id=$1", [record.id]);
  const stale = await db.query("update routing_documents set title='Stale edit' where id=$1 and updated_at=$2 returning id", [record.id, record.version]);
  assert.equal(stale.rows.length, 0);
  for (const stage of ['P.R.', 'BAC', 'GSO BODEGA', 'INSPECTOR', 'BAC']) {
    await db.query("insert into document_routing_entries(document_id,stage,received_date,created_by) values ($1,$2,'2026-10-01','00000000-0000-0000-0000-000000000002')", [record.id, stage]);
  }
  const history = (await db.query('select * from document_routing_entries order by created_at')).rows;
  assert.equal(history.length, 5);
  assert.equal(history[4].stage, 'BAC');
  assert.ok(history.every(row => row.created_by.endsWith('1')));
  await assert.rejects(db.query("insert into document_routing_entries(document_id,stage,received_date,forwarded_date) values ($1,'BAC','2026-10-02','2026-10-01')", [record.id]), /check constraint/);
  await assert.rejects(db.exec('delete from document_routing_entries'), /permission denied/);
  await assert.rejects(db.exec("update document_routing_entries set remarks='Changed'"), /permission denied/);
  await assert.rejects(db.exec('delete from routing_documents'), /permission denied/);
  for (const id of [2, 3, null]) {
    await actAs(id);
    assert.equal((await db.query('select * from routing_documents')).rows.length, 0);
    assert.equal((await db.query('select * from document_routing_entries')).rows.length, 0);
    assert.equal((await db.query("update routing_documents set title='Blocked' returning id")).rows.length, 0);
    assert.equal((await db.query('update routing_documents set cash_advance_liquidated=0 returning id')).rows.length, 0);
    await assert.rejects(db.query("insert into routing_documents(pr_number,title,request_date) values ('X','Blocked','2026-10-01')"), /row-level security/);
    await assert.rejects(db.query("insert into document_routing_entries(document_id,stage,received_date) values ($1,'BAC','2026-10-01')", [record.id]), /row-level security/);
  }
  await actAs(null, 'anon');
  await assert.rejects(db.exec('select * from routing_documents'), /permission denied/);
  await assert.rejects(db.exec('select * from document_routing_entries'), /permission denied/);
});


test('routing office rename preserves existing entry history and accepts ADMIN', async t => {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create table public.document_routing_entries(id integer primary key,stage text constraint document_routing_entries_stage_check check(stage in ('BADMIN','GSO')),created_at timestamptz,remarks text);
    insert into public.document_routing_entries values(1,'BADMIN','2026-10-01','Saved history'),(2,'GSO','2026-10-02','Other office');`);
  await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(name=>name.endsWith('_rename_routing_badmin_to_admin.sql')),'utf8'));
  const entries=(await db.query('select * from document_routing_entries order by id')).rows;
  assert.equal(entries[0].stage,'ADMIN');assert.equal(entries[0].remarks,'Saved history');
  assert.equal(entries[0].created_at.toISOString(),'2026-10-01T00:00:00.000Z');assert.equal(entries[1].stage,'GSO');
  await db.exec("insert into document_routing_entries(id,stage) values(3,'ADMIN')");
  await assert.rejects(db.exec("insert into document_routing_entries(id,stage) values(4,'BADMIN')"),/check constraint/);
});
