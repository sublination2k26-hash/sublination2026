const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('garment pay snapshots and atomic payment-covered partial pickups', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated, anon;`);
  const initial = fs.readFileSync('supabase/migrations/202610170001_initial_schema.sql', 'utf8')
    .replace('create extension if not exists pgcrypto;', '').split('-- Create a private storage bucket')[0];
  await db.exec(initial);
  for (const file of ['202610190002_dashboard_persistence.sql', '202610190003_catalog_orders.sql', '20261022012741_customer_facebook_contact.sql', '20261022084023_service_production_routes.sql', '202610200007_employee_work_payroll.sql', '202610200008_automatic_task_payroll_tracking.sql', '20261026060520_sewing_only_work_tracking.sql']) {
    await db.exec(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.exec(`grant select,insert,update,delete on all tables in schema public to authenticated;
    grant usage,select on all sequences in schema public to authenticated;`);
  for (const [n, role] of [[1,'admin'],[2,'front_desk'],[3,'cutting_sewing'],[4,'cutting_sewing'],[5,'artist'],[6,'qc']]) {
    await db.query('insert into auth.users values ($1)', [id(n)]);
    await db.query('insert into profiles(id,full_name,role) values ($1,$2,$3)', [id(n), `Employee ${n}`, role]);
  }
  await db.query("insert into employee_compensation(employee_id,salary_basis,piece_rate) values ($1,'piece',30),($2,'combined',40)", [id(3),id(4)]);
  await db.exec(fs.readFileSync('supabase/migrations/20261029065538_sewer_assignments.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261029074932_sewer_self_claim.sql', 'utf8'));
  for (const file of ['20261029025401_order_piece_releases.sql','20261029030118_pickup_release_dates.sql','20261029082024_dated_customer_downpayments.sql','20261109124219_sewing_garment_rates_partial_pickups.sql']) await db.exec(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
  const asUser = async n => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)", [id(n)]);
    await db.exec('set role authenticated');
  };
  await asUser(1);
  await db.query("insert into sewing_garment_rates values ($1,'Jersey',75),($1,'T-shirt',40)", [id(3)]);
  await asUser(3);
  assert.equal((await db.query('select * from sewing_garment_rates')).rows.length,2);
  assert.equal((await db.query("update sewing_garment_rates set unit_rate=100 returning *")).rows.length,0,'sewer cannot change pay rates');
  assert.equal(Number((await db.query("select unit_rate from sewing_garment_rates where garment='Jersey'")).rows[0].unit_rate),75);
  await asUser(4);
  assert.equal((await db.query('select * from sewing_garment_rates')).rows.length,0);
  await asUser(1);
  const product=(await db.query("insert into products(name,category,production_type,production_service,base_price) values ('Jersey','Team jerseys','full_garment','full_garment',100) returning id")).rows[0].id;
  const order=(await db.query("select create_catalog_order_with_contact('Team','',$1,10,current_date+7,0,'','','') as id",[product])).rows[0].id;
  const task=(await db.query("select id,order_item_id from production_tasks where order_id=$1 and stage='sewing'",[order])).rows[0];
  await db.query("update order_items set customization=jsonb_build_object('garment','Jersey') where id=$1",[task.order_item_id]);
  const work=async()=> (await db.query("insert into employee_work_records(employee_id,role,activity,task_id,quantity,unit_rate) values ($1,'cutting_sewing','Sewing batch completed',$2,2,999) returning id,unit_rate",[id(3),task.id])).rows[0];
  const first=await work(); assert.equal(Number(first.unit_rate),75);
  await db.query("update sewing_garment_rates set unit_rate=80 where employee_id=$1 and garment='Jersey'",[id(3)]);
  assert.equal(Number((await work()).unit_rate),80);
  assert.equal(Number((await db.query('select unit_rate from employee_work_records where id=$1',[first.id])).rows[0].unit_rate),75);
  await db.query("update orders set status='ready_for_release' where id=$1",[order]);
  await db.query("insert into qc_inspections(order_id,inspected_by,status,quantity_verified,sizes_verified,personalization_verified,print_quality_verified,condition_verified) values ($1,$2,'approved',true,true,true,true,true)",[order,id(1)]);
  await asUser(2);
  const pickup=(quantity,amount,request=randomUUID())=>db.query("select record_pickup($1,$2,current_date,'Client','Left remaining pieces here','',$3,'cash',$4)",[order,quantity,amount,request]);
  await assert.rejects(pickup(4,300), /covering the released pieces/);
  assert.equal(Number((await db.query('select count(*) as n from payments where order_id=$1',[order])).rows[0].n),0,'payment rolls back with blocked pickup');
  const request=randomUUID(); await pickup(4,400,request); await pickup(4,400,request);
  assert.equal(Number((await db.query('select sum(quantity) as n from order_releases where order_id=$1',[order])).rows[0].n),4,'retry does not release twice');
  assert.equal(Number((await db.query('select sum(amount) as n from payments where order_id=$1',[order])).rows[0].n),400,'retry does not collect twice');
  await assert.rejects(pickup(5,400,request),/different pickup/);
  await assert.rejects(pickup(1,0),/covering the released pieces/);
  await pickup(6,600);
  assert.equal((await db.query('select status from orders where id=$1',[order])).rows[0].status,'released');
});
