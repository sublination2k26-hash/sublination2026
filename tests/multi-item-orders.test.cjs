const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

test('mixed item intake: one total and deposit, per-item routes, admin/front desk access and atomic rollback',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;`);
  await db.exec(fs.readFileSync('supabase/migrations/202610170001_initial_schema.sql','utf8').replace('create extension if not exists pgcrypto;','').split('-- Create a private storage bucket')[0]);
  await db.exec('alter table production_tasks add column started_by uuid, add column completed_by uuid;');
  for(const file of ['202610190002_dashboard_persistence.sql','202610190003_catalog_orders.sql','20261022012741_customer_facebook_contact.sql','20261022084023_service_production_routes.sql','20261029082024_dated_customer_downpayments.sql','20261102123339_multi_item_orders.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  for(const [n,role] of [[1,'admin'],[2,'front_desk'],[3,'artist']]){
    await db.query('insert into auth.users values($1)',[id(n)]);
    await db.query('insert into profiles(id,full_name,role) values($1,$2,$3)',[id(n),'Staff '+n,role]);
  }
  await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated;grant usage,select on all sequences in schema public to authenticated;');
  const shirt=(await db.query("insert into products(name,category,production_type,production_service,base_price) values('T-shirt','Shirts','full_garment','full_garment',320) returning id")).rows[0].id;
  const hoodie=(await db.query("insert into products(name,category,production_type,production_service,base_price) values('Hoodie','Hoodies','print_only','subcon_print',500) returning id")).rows[0].id;
  const items=[{product_id:shirt,quantity:8,garment:'T-shirt',names:'Team',roster:[{name:'A',size:'M'}]},{product_id:hoodie,quantity:1,garment:'Hoodie',notes:'XL'}];
  const actAs=async n=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');};
  const create=(lines=items,deposit=1000)=>db.query("select create_catalog_order_items('Mixed customer','','Facebook',$1::jsonb,current_date+7,current_date+8,$2,current_date,'Mixed order') as id",[JSON.stringify(lines),deposit]);
  for(const n of [1,2]){
    await actAs(n);
    const order=(await create()).rows[0].id;
    const header=(await db.query('select total,subtotal from orders where id=$1',[order])).rows[0];
    assert.equal(Number(header.total),3060);assert.equal(Number(header.subtotal),3060);
    const lines=(await db.query("select *,customization->>'intake_index' as idx from order_items where order_id=$1 order by idx",[order])).rows;
    assert.deepEqual(lines.map(l=>[l.product_name,l.quantity,Number(l.line_total)]),[['T-shirt',8,2560],['Hoodie',1,500]]);
    assert.equal(lines[1].notes,'XL');assert.equal(lines[0].customization.roster[0].size,'M');
    const routes=(await db.query('select order_item_id,stage from production_tasks where order_id=$1',[order])).rows;
    assert.equal(routes.filter(r=>r.order_item_id===lines[0].id).length,6);
    assert.deepEqual(routes.filter(r=>r.order_item_id===lines[1].id).map(r=>r.stage).sort(),['layout','printing','qc']);
    const payments=(await db.query('select amount,payment_kind from payments where order_id=$1',[order])).rows;
    assert.equal(payments.length,1);assert.equal(Number(payments[0].amount),1000);assert.equal(payments[0].payment_kind,'down_payment');
    if(n===1) await db.query("insert into qc_inspections(order_id,quantity_verified,sizes_verified,personalization_verified,print_quality_verified,condition_verified) values($1,true,true,true,true,true)",[order]);
    if(n===1){
      await assert.rejects(db.query('select approve_dashboard_qc($1)',[order]),/Complete production for all/);
      await db.query("update production_tasks set status='completed' where order_id=$1 and stage<>'qc'",[order]);
      await db.query('select approve_dashboard_qc($1)',[order]);
      assert.equal((await db.query("select count(*)::int as n from production_tasks where order_id=$1 and status<>'completed'",[order])).rows[0].n,0);

      await db.query("select update_catalog_order($1,'Edited','',$2,9,current_date+9,'Team','Updated notes')",[order,shirt]);
      assert.equal(Number((await db.query('select total from orders where id=$1',[order])).rows[0].total),3060);
      assert.deepEqual((await db.query('select quantity from order_items where order_id=$1 order by quantity',[order])).rows.map(r=>r.quantity),[1,8]);
    }
  }
  const counts=async()=> (await db.query('select (select count(*) from orders)::int as orders,(select count(*) from order_items)::int as items,(select count(*) from production_tasks)::int as tasks,(select count(*) from payments)::int as payments')).rows[0];
  const before=await counts();
  await assert.rejects(create([...items,{product_id:hoodie,quantity:0}]),/positive whole quantity/);
  await assert.rejects(create(items,3061),/exceeds/);
  await assert.rejects(create([]),/between 1 and 100/);
  await assert.rejects(create([{...items[0],quantity:1.5}]),/positive whole quantity/);
  assert.deepEqual(await counts(),before);
  const single=(await create([items[0]],0)).rows[0].id;
  assert.equal(Number((await db.query('select total from orders where id=$1',[single])).rows[0].total),2560);
  await actAs(3);await assert.rejects(create(),/Only admin or front desk/);
  await actAs(null);await assert.rejects(create(),/Only admin or front desk/);
});
