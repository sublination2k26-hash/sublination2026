const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');

test('front desk and artist add team members with fixed prices, fresh production and safe retries',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;`);
  await db.exec(fs.readFileSync('supabase/migrations/202610170001_initial_schema.sql','utf8').replace('create extension if not exists pgcrypto;','').split('-- Create a private storage bucket')[0]);
  await db.exec('alter table production_tasks add column started_by uuid, add column completed_by uuid;');
  for(const file of ['202610190002_dashboard_persistence.sql','202610190003_catalog_orders.sql','20261022012741_customer_facebook_contact.sql','20261022084023_service_production_routes.sql','20261029082024_dated_customer_downpayments.sql','20261102123339_multi_item_orders.sql','20261104100040_edit_player_rosters.sql','20261106025346_order_permissions_and_deletion_backups.sql','20261107052651_team_member_additions.sql','20261107053434_production_item_addons.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  for(const [n,role] of [[1,'admin'],[2,'front_desk'],[3,'artist'],[4,'printing']]){
    await db.query('insert into auth.users values($1)',[id(n)]);
    await db.query('insert into profiles(id,full_name,role) values($1,$2,$3)',[id(n),'Staff '+n,role]);
  }
  await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated;grant usage,select on all sequences in schema public to authenticated;');
  const product=(await db.query("insert into products(name,category,production_type,production_service,base_price) values('Jersey','Team','full_garment','full_garment',500) returning id")).rows[0].id;
  const actAs=async n=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');};
  await actAs(2);
  const originalMembers=[{name:'Original',number:'7',size:'M'}];
  const source=(await db.query("select create_catalog_order_items('Team','','',$1::jsonb,current_date+7,null,0,current_date,'') as id",[JSON.stringify([{product_id:product,quantity:3,roster:originalMembers,names:'Original #7 M'}])])).rows[0].id;
  const item=(await db.query('select * from order_items where order_id=$1',[source])).rows[0];
  const add=(members,extra=false,request=randomUUID())=>db.query('select add_team_members($1,$2::jsonb,$3,current_date+10,$4) as id',[item.id,JSON.stringify(members),extra,request]);
  const member=n=>({name:'Added '+n,number:String(n),size:'L'});
  await actAs(3);
  const retry=randomUUID();await add([member(8)],false,retry);await add([member(8)],false,retry);
  let saved=(await db.query('select * from order_items where id=$1',[item.id])).rows[0];
  assert.deepEqual(saved.customization.roster,[...originalMembers,member(8)]);
  assert.equal(saved.quantity,3);assert.equal(Number(saved.unit_price),500);
  await assert.rejects(add([member(9)],false,retry),/different addition/);
  await assert.rejects(add([member(9),member(10)]),/exceeds the ordered quantity/);
  await assert.rejects(add([{name:'Bad',number:2,size:'M'}]),/text number/);
  await assert.rejects(add([{...member(9),unit_price:1}]),/text number/);
  await actAs(2);await add([member(9)]);
  saved=(await db.query('select * from order_items where id=$1',[item.id])).rows[0];
  assert.equal(saved.customization.roster.length,3);
  await assert.rejects(db.query('select update_order_item_roster($1,$2::jsonb)',[item.id,JSON.stringify([member(99)])]),/Append players/);
  await actAs(1);
  await db.query("update production_tasks set status='completed' where order_id=$1",[source]);
  await db.query("insert into payments(order_id,amount,method) values($1,1500,'cash')",[source]);
  await db.query("insert into qc_inspections(order_id,status,quantity_verified,sizes_verified,personalization_verified,print_quality_verified,condition_verified) values($1,'approved',true,true,true,true,true)",[source]);
  await db.query("update orders set status='released' where id=$1",[source]);
  const sourceBefore=(await db.query('select * from orders where id=$1',[source])).rows[0];
  for(const staff of [2,3]){
    await actAs(staff);
    const request=randomUUID();const addon=(await add([member(staff)],true,request)).rows[0].id;
    assert.equal((await add([member(staff)],true,request)).rows[0].id,addon);
    const header=(await db.query('select * from orders where id=$1',[addon])).rows[0];
    assert.equal(header.customer_id,sourceBefore.customer_id);assert.equal(Number(header.total),500);assert.equal(header.created_by,id(staff));
    const line=(await db.query('select * from order_items where order_id=$1',[addon])).rows[0];
    assert.equal(line.quantity,1);assert.equal(Number(line.unit_price),500);assert.equal(line.customization.team_source_order_id,source);
    const tasks=(await db.query('select stage,status from production_tasks where order_id=$1',[addon])).rows;
    assert.equal(tasks.length,6);assert.ok(tasks.every(task=>task.status==='pending'));
    assert.equal((await db.query('select count(*)::int n from payments where order_id=$1',[addon])).rows[0].n,0);
    await assert.rejects(add([member(99)],true,request),/different addition/);
  }
  // Returning customers can order quantities without jersey/player details.
  const addItems=(quantity,roster=[],request=randomUUID())=>db.query('select add_production_items($1,$2,$3::jsonb,current_date+10,$4) as id',[item.id,quantity,JSON.stringify(roster),request]);
  for(const staff of [2,3]){
    await actAs(staff);
    const request=randomUUID();const addon=(await addItems(4,[],request)).rows[0].id;
    assert.equal((await addItems(4,[],request)).rows[0].id,addon);
    const header=(await db.query('select * from orders where id=$1',[addon])).rows[0];
    const line=(await db.query('select * from order_items where order_id=$1',[addon])).rows[0];
    assert.equal(header.customer_id,sourceBefore.customer_id);assert.equal(Number(header.total),2000);
    assert.equal(line.quantity,4);assert.equal(Number(line.unit_price),500);assert.deepEqual(line.customization.roster,[]);
    assert.equal(line.customization.team_root_order_number,sourceBefore.order_number);
    assert.equal((await db.query('select count(*)::int n from production_tasks where order_id=$1 and status=\'pending\'',[addon])).rows[0].n,6);
    assert.equal((await db.query('select count(*)::int n from payments where order_id=$1',[addon])).rows[0].n,0);
    assert.equal((await db.query('delete from order_items where id=$1 returning id',[line.id])).rows.length,0);
    assert.equal((await db.query('delete from orders where id=$1 returning id',[addon])).rows.length,0);
    assert.equal((await db.query('select id from order_items where id=$1',[line.id])).rows.length,1);
    assert.equal((await db.query('select id from orders where id=$1',[addon])).rows.length,1);
    await assert.rejects(addItems(5,[],request),/different addition/);
    await assert.rejects(addItems(0),/quantity between/);
    await assert.rejects(addItems(1,[member(11),member(12)]),/cannot exceed/);
    const personalized=(await addItems(2,[member(20)])).rows[0].id;
    const details=(await db.query('select customization from order_items where order_id=$1',[personalized])).rows[0].customization;
    assert.equal(details.roster.length,1);assert.equal(details.names,'Added 20 #20 L');
  }
  await actAs(4);await assert.rejects(addItems(2),/Only admin/);
  await actAs(0);await assert.rejects(addItems(2),/Only admin/);
  await actAs(3);
  await db.query('update order_items set unit_price=1 where id=$1',[item.id]);
  assert.equal(Number((await db.query('select unit_price from order_items where id=$1',[item.id])).rows[0].unit_price),500);
  await assert.rejects(db.query("insert into payments(order_id,amount,method) values($1,1,'cash')",[source]),/row-level security|exceed|Order not found/i);
  await assert.rejects(add([member(10)]),/Production is complete/);
  await actAs(1);assert.deepEqual((await db.query('select * from orders where id=$1',[source])).rows[0],sourceBefore);
  await db.query("update orders set status='cancelled' where id=$1",[source]);
  await assert.rejects(add([member(10)],true),/cancelled/);
  await actAs(4);await assert.rejects(add([member(10)],true),/Only admin/);
  await actAs(0);await assert.rejects(add([member(10)],true),/Only admin/);
});
