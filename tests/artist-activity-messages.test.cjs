const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('artist activities, payroll evidence, replies, mentions and account isolation', async t => {
  const db = new PGlite(); t.after(() => db.close());
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;`);
  await db.exec(fs.readFileSync('supabase/migrations/202610170001_initial_schema.sql','utf8')
    .replace('create extension if not exists pgcrypto;', '').split('-- Create a private storage bucket')[0]);
  for (const file of [
    '202610190002_dashboard_persistence.sql','202610190003_catalog_orders.sql',
    '20261022012741_customer_facebook_contact.sql','20261022084023_service_production_routes.sql',
    '202610200007_employee_work_payroll.sql','202610200008_automatic_task_payroll_tracking.sql',
    '20261022080555_team_messages.sql','20261026043803_payroll_cash_advance.sql',
    '20261026060520_sewing_only_work_tracking.sql','20261027023029_attendance_based_payroll.sql',
    '20261027023537_qr_time_attendance.sql','20261027031811_public_qr_attendance.sql',
    '20261027124647_employee_cash_advance_ledger.sql','20261027131046_payroll_overtime.sql',
    '20261028023512_qr_attendance_approval.sql','20261028063252_payroll_sss_deductions.sql',
    '20261029065538_sewer_assignments.sql','20261029074932_sewer_self_claim.sql',
    '20261030081041_artist_activity_message_replies_mentions.sql',
  ]) await db.exec(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
  // Baseline schema grants used by the app, without broadening protected message columns.
  await db.exec(`grant select,insert,update,delete on profiles,products,customers,payments,qc_inspections,orders,order_items,production_tasks,
    employee_compensation,employee_work_records,payroll_runs,payroll_lines,employee_attendance to authenticated;
    grant usage,select on all sequences in schema public to authenticated;`);
  for (const [n,role] of [[1,'admin'],[2,'artist'],[3,'artist'],[4,'cutting_sewing'],[5,'front_desk'],[6,'printing'],[7,'heat_press'],[8,'qc']]) {
    await db.query('insert into auth.users values ($1)',[id(n)]);
    await db.query('insert into profiles(id,full_name,role) values ($1,$2,$3)',[id(n),`Employee ${n}`,role]);
  }
  const asUser = async n => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)",[n ? id(n) : '']);
    await db.exec('set role authenticated');
  };
  const product=(await db.query("insert into products(name,category,production_type,production_service,base_price) values ('Jersey','Team jerseys','full_garment','full_garment',350) returning id")).rows[0].id;
  await asUser(1);
  const order=(await db.query("select create_catalog_order_with_contact('Artist activity test','',$1,5,current_date+7,0,'M 5','','') as id",[product])).rows[0].id;
  const task=(await db.query("select id from production_tasks where order_id=$1 and stage='layout'",[order])).rows[0].id;
  await asUser(2);
  await db.query("update production_tasks set status='in_progress',started_at=now(),started_by=auth.uid() where id=$1",[task]);
  assert.equal((await db.query('select * from team_messages')).rows.length,1);
  await db.query("update production_tasks set status='in_progress' where id=$1",[task]);
  assert.equal((await db.query('select * from team_messages')).rows.length,1,'same status does not duplicate activity');
  await db.query("update production_tasks set status='completed',completed_at=now(),completed_by=auth.uid() where id=$1",[task]);
  await asUser(1);
  let work=(await db.query("select * from employee_work_records where role='artist'")).rows;
  assert.equal(work.length,1);
  assert.equal(work[0].employee_id,id(2));
  assert.equal(Number(work[0].quantity),5);
  assert.equal(work[0].pay_eligible,false);
  assert.equal(Number(work[0].unit_rate),0);
  assert.equal(work[0].status,'pending_review');
  await db.query("update production_tasks set status='returned_for_correction',completed_by=null where id=$1",[task]);
  await asUser(3);
  await db.query("update production_tasks set status='completed',completed_at=now(),completed_by=auth.uid() where id=$1",[task]);
  await asUser(1);
  work=(await db.query("select * from employee_work_records where role='artist' order by created_at")).rows;
  assert.equal(work.length,2);
  assert.equal(work[1].employee_id,id(3));
  assert.equal(work[1].is_rework,true);
  assert.equal(work[1].pay_eligible,false);
  assert.equal((await db.query('select * from team_messages where activity_task_id=$1',[task])).rows.length,4);
  await db.query("update employee_work_records set status='approved' where id=$1",[work[0].id]);
  await db.query("insert into employee_compensation(employee_id,salary_basis,pay_frequency,base_rate) values ($1,'fixed','daily',500)",[id(2)]);
  const run=(await db.query('select create_payroll_run(current_date,current_date) as id')).rows[0].id;
  const line=(await db.query('select * from payroll_lines where payroll_run_id=$1',[run])).rows[0];
  assert.equal(Number(line.production_pay),0);
  assert.equal(Number(line.base_pay),0,'layout alone does not invent paid attendance');
  assert.equal((await db.query('select payroll_run_id from employee_work_records where id=$1',[work[0].id])).rows[0].payroll_run_id,run);
  assert.equal((await db.query('select payroll_run_id from employee_work_records where id=$1',[work[1].id])).rows[0].payroll_run_id,null);
  await assert.rejects(db.query("update employee_work_records set status='rejected' where id=$1",[work[0].id]),/included in a payroll/);
  await asUser(2);
  const parent=(await db.query("insert into team_messages(body) values ('Please review layout') returning id")).rows[0].id;
  await asUser(3);
  const mention=`@[Employee 2](${id(2)})`;
  const reply=(await db.query('insert into team_messages(body,reply_to_id,mentioned_user_ids) values ($1,$2,$3) returning *',[`${mention} ready for review`,parent,[id(2)]])).rows[0];
  assert.equal(reply.reply_to_id,parent);
  assert.deepEqual(reply.mentioned_user_ids,[id(2)]);
  assert.equal(reply.sender_id,id(3));
  for (const n of [1,2,3,4,5,6,7,8]) {
    await asUser(n);
    const sent=(await db.query('insert into team_messages(body,reply_to_id,mentioned_user_ids) values ($1,$2,$3) returning *',[
      `${mention} reply from account ${n}`,parent,[id(2)],
    ])).rows[0];
    assert.equal(sent.sender_id,id(n),'every active role can reply and mention');
    assert.equal(sent.reply_to_id,parent);
    assert.deepEqual(sent.mentioned_user_ids,[id(2)]);
  }
  await asUser(3);
  await assert.rejects(db.query("insert into team_messages(body,reply_to_id) values ('bad',999999)"),/existing message/);
  await assert.rejects(db.query("insert into team_messages(body,mentioned_user_ids) values ('bad',$1)",[[id(2)]]),/Mentions must/);
  await assert.rejects(db.query('insert into team_messages(body,activity_task_id) values ($1,$2)',['forged',task]),/permission denied/);
  await assert.rejects(db.query('insert into team_messages(body,sender_id) values ($1,$2)',['forged',id(2)]),/permission denied/);
  await assert.rejects(db.query("insert into employee_work_records(employee_id,role,activity) values ($1,'artist','fake')",[id(3)]),/row-level security/);
  await asUser(1);
  await db.query('update profiles set active=false where id=$1',[id(2)]);
  await asUser(3);
  await assert.rejects(db.query('insert into team_messages(body,mentioned_user_ids) values ($1,$2)',[mention,[id(2)]]),/Mentions must/);
  await asUser(2);
  assert.equal((await db.query('select * from team_messages')).rows.length,0);
  await assert.rejects(db.query("insert into team_messages(body) values ('inactive')"),/row-level security/);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select * from team_messages'),/permission denied/);
});
