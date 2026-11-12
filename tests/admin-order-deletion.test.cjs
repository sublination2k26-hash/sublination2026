const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('admin deletion backs up pickups and sewing links while retaining earned payroll', async t => {
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

  for (const file of ['20261106025346_order_permissions_and_deletion_backups.sql','20261107015515_paid_order_retention.sql'])
    await db.exec(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
  await db.query("select set_config('test.uid',$1,false)", [id(1)]);
  const customer=(await db.query("insert into customers(full_name) values('Delete test') returning id")).rows[0].id;
  const order=(await db.query('insert into orders(customer_id,total) values($1,1000) returning id',[customer])).rows[0].id;
  const item=(await db.query("insert into order_items(order_id,product_name,quantity,unit_price) values($1,'Jersey',10,100) returning id",[order])).rows[0].id;
  const task=(await db.query("insert into production_tasks(order_id,order_item_id,stage) values($1,$2,'sewing') returning id",[order,item])).rows[0].id;
  const assignment=randomUUID(), event=randomUUID();
  await db.query('insert into sewing_assignments(id,task_id,employee_id,quantity,assigned_by) values($1,$2,$3,10,$4)',[assignment,task,id(3),id(1)]);
  await db.query("insert into sewing_events(id,assignment_id,kind,quantity,recorded_by) values($1,$2,'completion',1,$3)",[event,assignment,id(3)]);
  const work=(await db.query("insert into employee_work_records(employee_id,order_id,task_id,role,activity,quantity,unit_rate,sewing_event_id) values($1,$2,$3,'cutting_sewing','Sewing batch completed',1,75,$4) returning id,unit_rate",[id(3),order,task,event])).rows[0];
  await db.query("update orders set status='ready_for_release' where id=$1",[order]);
  const payment=(await db.query("insert into payments(order_id,amount,received_at) values($1,1000,now()-interval '4 months') returning id",[order])).rows[0].id;
  await db.query("insert into order_releases(order_id,quantity,received_by,released_by,exception_reason,pickup_payment_id) values($1,1,'Customer',$2,'Admin approved test pickup',$3)",[order,id(1),payment]);
  // Reproduce the old FK / partial-release guard failure before applying the fix.
  await assert.rejects(db.query('delete from orders where id=$1',[order]),/foreign key|partial release/);
  assert.equal((await db.query('select * from deleted_order_backups')).rows.length,0,'failed delete rolls backup back');
  await db.exec(fs.readFileSync('supabase/migrations/20261110030344_admin_order_deletion_related_records.sql','utf8'));
  await assert.rejects(db.query('delete from order_items where id=$1',[item]),/partial release/);
  await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(name=>name.endsWith('_require_cancelled_order_before_deletion.sql')),'utf8'));
  await assert.rejects(db.query('delete from orders where id=$1',[order]),/Cancel the order first/);
  assert.equal((await db.query('select * from deleted_order_backups')).rows.length,0);
  await db.query("update orders set status='cancelled' where id=$1",[order]);
  assert.equal((await db.query('select count(*)::int as n from order_items where order_id=$1',[order])).rows[0].n,1,'cancellation preserves items');
  assert.equal((await db.query('select count(*)::int as n from order_releases where order_id=$1',[order])).rows[0].n,1,'cancellation preserves release history');
  await db.exec('set role authenticated');
  for(const staff of [2,3,5,6]) {
    await db.query("select set_config('test.uid',$1,false)",[id(staff)]);
    assert.equal((await db.query('delete from orders where id=$1 returning id',[order])).rows.length,0);
    assert.equal((await db.query('select * from deleted_order_backups')).rows.length,0);
  }
  await db.query("select set_config('test.uid',$1,false)",[id(1)]);
  assert.equal((await db.query('delete from orders where id=$1 returning id',[order])).rows.length,1);
  for(const table of ['orders','order_items','production_tasks','payments','order_releases'])
    assert.equal((await db.query(`select * from ${table}`)).rows.length,0,table+' removed');
  const backup=(await db.query('select * from deleted_order_backups')).rows[0];
  assert.equal(backup.deleted_by,id(1));
  assert.equal(backup.snapshot.orders.id,order);
  assert.equal(backup.snapshot.orders.status,'cancelled');
  assert.equal(backup.snapshot.order_releases[0].pickup_payment_id,payment);
  assert.equal(backup.snapshot.sewing_assignments[0].task_id,task);
  assert.equal(backup.snapshot.sewing_events[0].id,event);
  const saved=(await db.query('select * from employee_work_records where id=$1',[work.id])).rows[0];
  assert.equal(saved.order_id,null); assert.equal(saved.task_id,null);
  assert.equal(saved.sewing_event_id,event); assert.equal(Number(saved.unit_rate),Number(work.unit_rate));
  assert.equal((await db.query('select * from sewing_assignments where id=$1',[assignment])).rows[0].task_id,null);
  assert.equal((await db.query('select * from sewing_events where id=$1',[event])).rows.length,1);
  await assert.rejects(db.query('delete from deleted_order_backups'),/permission denied/);
  // Retention still applies with the new backup and FK changes installed.
  await db.exec('reset role');
  const recent=(await db.query('insert into orders(customer_id,total) values($1,500) returning id',[customer])).rows[0].id;
  await db.query('insert into payments(order_id,amount) values($1,500)',[recent]);
  await db.query("update orders set status='cancelled' where id=$1",[recent]);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('delete from orders where id=$1',[recent]),/at least 3 months/);
  assert.equal((await db.query('select * from orders where id=$1',[recent])).rows.length,1);
  assert.equal((await db.query('select * from deleted_order_backups')).rows.length,1,'retention failure creates no backup');
});
