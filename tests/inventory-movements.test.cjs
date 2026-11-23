const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('inventory stock-ins and deductions are dated, atomic, and admin-only', async t => {
  const db = new PGlite(); t.after(() => db.close());
  const admin = '00000000-0000-0000-0000-000000000001';
  const staff = '00000000-0000-0000-0000-000000000002';
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    create type public.app_role as enum ('admin','front_desk');
    create table public.profiles(id uuid primary key, role public.app_role, active boolean);
    create function public.current_app_role() returns public.app_role language sql stable security definer set search_path=''
      as $$ select role from public.profiles where id=auth.uid() and active $$;
    insert into auth.users values ('${admin}'),('${staff}');
    insert into profiles values ('${admin}','admin',true),('${staff}','front_desk',true);
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261022071231_materials_inventory.sql', 'utf8'));
  const legacy = (await db.query(`insert into inventory_materials(name,category,unit,quantity,updated_at)
    values ('Legacy fabric','Fabric','meters',6,'2026-10-01T04:00:00Z') returning id`)).rows[0].id;
  await db.exec(fs.readFileSync('supabase/migrations/202611230001_inventory_movement_dates.sql', 'utf8'));
  await db.exec('grant usage on schema public to authenticated,anon;');
  const asUser = async id => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)", [id ?? '']);
    await db.exec('set role authenticated');
  };
  await asUser(admin);
  const today = (await db.query("select (now() at time zone 'Asia/Manila')::date::text as date")).rows[0].date;
  const earlier = (await db.query("select ((now() at time zone 'Asia/Manila')::date-2)::text as date")).rows[0].date;
  assert.deepEqual((await db.query('select movement_type,quantity,movement_date::text from inventory_movements where material_id=$1', [legacy])).rows
    .map(row => [row.movement_type, Number(row.quantity), row.movement_date]), [['stock_in', 6, '2026-10-01']]);
  const created = await db.query(`select public.create_inventory_material('Test fabric','Fabric','meters',10,2,$1) as id`, [earlier]);
  const materialId = created.rows[0].id;
  assert.equal(Number((await db.query('select quantity from inventory_materials where id=$1', [materialId])).rows[0].quantity), 10);
  let history = (await db.query('select movement_type,quantity,movement_date::text from inventory_movements where material_id=$1', [materialId])).rows;
  assert.deepEqual(history.map(row => [row.movement_type, Number(row.quantity), row.movement_date]), [['stock_in', 10, earlier]]);

  await db.query("select record_inventory_movement($1,'stock_in',4,$2)", [materialId, today]);
  await db.query("select record_inventory_movement($1,'deduction',3,$2)", [materialId, earlier]);
  assert.equal(Number((await db.query('select quantity from inventory_materials where id=$1', [materialId])).rows[0].quantity), 11);
  await assert.rejects(db.query("select record_inventory_movement($1,'deduction',12,$2)", [materialId, today]), /exceeds the available stock/);
  await assert.rejects(db.query("select record_inventory_movement($1,'deduction',0,$2)", [materialId, today]), /valid movement/);
  await assert.rejects(db.query("select record_inventory_movement($1,'stock_in',1,$2)", [materialId, '2999-01-01']), /cannot be in the future/);
  const countBeforeInvalidCreate = (await db.query('select count(*)::integer as count from inventory_materials')).rows[0].count;
  await assert.rejects(db.query("select create_inventory_material('Future stock','Fabric','meters',2,1,'2999-01-01')"), /cannot be in the future/);
  assert.equal((await db.query('select count(*)::integer as count from inventory_materials')).rows[0].count, countBeforeInvalidCreate,
    'a failed opening-stock date rolls back the new material');
  history = (await db.query('select movement_type,quantity,movement_date::text from inventory_movements where material_id=$1 order by created_at', [materialId])).rows;
  assert.deepEqual(history.map(row => [row.movement_type, Number(row.quantity), row.movement_date]), [
    ['stock_in', 10, earlier], ['stock_in', 4, today], ['deduction', 3, earlier],
  ]);
  assert.equal((await db.query('select count(*)::integer as count from inventory_movements where material_id=$1', [materialId])).rows[0].count, 3,
    'a failed deduction leaves both stock and the ledger unchanged');
  await assert.rejects(db.query("insert into inventory_materials(name,category,unit,quantity) values('Unlogged','Tools','pcs',5)"), /permission denied/);
  await assert.rejects(db.query("update inventory_materials set quantity=999 where id=$1", [materialId]), /permission denied/);

  await asUser(staff);
  assert.equal((await db.query('select * from inventory_movements')).rows.length, 0);
  await assert.rejects(db.query("select record_inventory_movement($1,'stock_in',1,$2)", [materialId, today]), /Only an active admin/);
  await assert.rejects(db.query("select create_inventory_material('Blocked','Tools','pcs',0,0,$1)", [today]), /Only an active admin/);
});
