const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

test('paid orders retain three months of inventory history and only admins can delete',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;`);
  await db.exec(fs.readFileSync('supabase/migrations/202610170001_initial_schema.sql','utf8').replace('create extension if not exists pgcrypto;','').split('-- Create a private storage bucket')[0]);
  await db.exec(fs.readFileSync('supabase/migrations/202610190002_dashboard_persistence.sql','utf8'));
  await db.exec(`insert into auth.users values(auth.uid());insert into profiles(id,full_name,role) values(auth.uid(),'Admin','admin');`);
  await db.exec(fs.readFileSync('supabase/migrations/20261107015515_paid_order_retention.sql','utf8'));
  const customer=(await db.query("insert into customers(full_name) values('Team') returning id")).rows[0].id;
  const make=async(total,amount,age)=>{
    const id=(await db.query('insert into orders(customer_id,total) values($1,$2) returning id',[customer,total])).rows[0].id;
    if(amount)await db.query("insert into payments(order_id,amount,method,received_at) values($1,$2,'cash',now()-$3::interval)",[id,amount,age]);
    return id;
  };
  const recent=await make(500,500,'2 months');
  await assert.rejects(db.query('delete from orders where id=$1',[recent]),/at least 3 months/);
  assert.equal((await db.query('select id from orders where id=$1',[recent])).rows.length,1);
  const old=await make(500,500,'3 months 1 day');
  await db.query('delete from orders where id=$1',[old]);
  const partial=await make(500,100,'1 day');
  await db.query('delete from orders where id=$1',[partial]);
  const unpaid=await make(500,0,'0 days');
  await db.exec("update profiles set role='artist' where id=auth.uid()");
  await assert.rejects(db.query('delete from orders where id=$1',[unpaid]),/Only admin/);
});
