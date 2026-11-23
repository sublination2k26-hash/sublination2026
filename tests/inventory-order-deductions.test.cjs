const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

async function createDatabase(t) {
  const db = new PGlite();
  t.after(() => db.close());
  const admin = '00000000-0000-0000-0000-000000000001';
  const staff = '00000000-0000-0000-0000-000000000002';
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid',true),'')::uuid
    $$;
    create type public.app_role as enum ('admin','front_desk');
    create table public.profiles(id uuid primary key, role public.app_role, active boolean);
    create function public.current_app_role() returns public.app_role language sql stable security definer set search_path=''
      as $$ select role from public.profiles where id=auth.uid() and active $$;
    create type public.order_status as enum ('pending','in_production','cancelled');
    create type public.task_status as enum ('pending','in_progress','completed','returned_for_correction');
    create table public.products(id uuid primary key default gen_random_uuid(), name text not null);
    create table public.orders(
      id uuid primary key default gen_random_uuid(),
      order_number text unique not null,
      status public.order_status not null default 'pending'
    );
    create table public.order_items(
      id uuid primary key default gen_random_uuid(),
      order_id uuid not null references public.orders(id) on delete cascade,
      product_id uuid references public.products(id),
      quantity integer not null check (quantity > 0)
    );
    create table public.production_tasks(
      id uuid primary key default gen_random_uuid(),
      order_id uuid not null references public.orders(id) on delete cascade,
      status public.task_status not null default 'pending'
    );
    insert into auth.users values ('${admin}'),('${staff}');
    insert into profiles values ('${admin}','admin',true),('${staff}','front_desk',true);
  `);
  await db.query("select set_config('test.uid',$1,false)", [admin]);
  for (const migration of [
    'supabase/migrations/20261022071231_materials_inventory.sql',
    'supabase/migrations/202611230001_inventory_movement_dates.sql',
    'supabase/migrations/20261123160000_inventory_order_deductions.sql',
  ]) {
    await db.exec(fs.readFileSync(migration, 'utf8'));
  }
  await db.exec('grant usage on schema public to authenticated,anon;');
  const asUser = async id => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)", [id ?? '']);
    await db.exec('set role authenticated');
  };
  return { db, admin, staff, asUser };
}

async function createOrder(db, productId, quantity = 2) {
  const orderId = (await db.query(
    "insert into orders(order_number) values ('JO-TEST-1') returning id"
  )).rows[0].id;
  const itemId = (await db.query(
    'insert into order_items(order_id,product_id,quantity) values ($1,$2,$3) returning id',
    [orderId, productId, quantity],
  )).rows[0].id;
  const taskId = (await db.query(
    "insert into production_tasks(order_id,status) values ($1,'pending') returning id",
    [orderId],
  )).rows[0].id;
  return { orderId, itemId, taskId };
}

test('order production starts deduct recipe amounts once, then edits and cancellation reconcile stock', async t => {
  const { db, admin, asUser } = await createDatabase(t);
  const today = (await db.query("select (now() at time zone 'Asia/Manila')::date::text as date")).rows[0].date;
  const materialId = (await db.query(
    "select public.create_inventory_material('Test fabric','Fabric','meters',10,1,$1) as id",
    [today],
  )).rows[0].id;
  const productId = (await db.query(
    "insert into products(name) values ('Test jersey') returning id"
  )).rows[0].id;
  const { orderId, itemId, taskId } = await createOrder(db, productId);

  await asUser(admin);
  await db.query(
    'select public.save_product_material_recipe($1,$2::jsonb)',
    [productId, JSON.stringify([{ material_id: materialId, quantity_per_unit: 1.5 }])],
  );
  await db.exec('reset role');
  await db.query("update production_tasks set status='in_progress' where id=$1", [taskId]);
  assert.equal(Number((await db.query('select quantity from inventory_materials where id=$1', [materialId])).rows[0].quantity), 7);

  await asUser(admin);
  await db.query(
    'select public.save_product_material_recipe($1,$2::jsonb)',
    [productId, JSON.stringify([{ material_id: materialId, quantity_per_unit: 2 }])],
  );
  await db.exec('reset role');
  assert.equal(Number((await db.query('select quantity from inventory_materials where id=$1', [materialId])).rows[0].quantity), 6,
    'changing a recipe updates deductions for orders already in production');

  const secondTaskId = (await db.query(
    "insert into production_tasks(order_id,status) values ($1,'pending') returning id",
    [orderId],
  )).rows[0].id;
  await db.query("update production_tasks set status='completed' where id=$1", [secondTaskId]);
  assert.equal((await db.query("select count(*)::int as n from inventory_movements where source='order_deduction'")).rows[0].n, 2,
    'later production stages must not deduct the same order twice');

  await db.query('update order_items set quantity=3 where id=$1', [itemId]);
  assert.equal(Number((await db.query('select quantity from inventory_materials where id=$1', [materialId])).rows[0].quantity), 4);
  assert.equal(Number((await db.query('select sum(quantity) from inventory_order_consumptions where order_id=$1 and active', [orderId])).rows[0].sum), 6);
  await assert.rejects(db.query('update order_items set quantity=8 where id=$1', [itemId]), /Insufficient stock for order/);
  assert.equal(Number((await db.query('select quantity from inventory_materials where id=$1', [materialId])).rows[0].quantity), 4,
    'a failed order edit leaves stock and the saved quantity unchanged');
  assert.equal((await db.query('select quantity from order_items where id=$1', [itemId])).rows[0].quantity, 3);

  await db.query("update orders set status='cancelled' where id=$1", [orderId]);
  assert.equal(Number((await db.query('select quantity from inventory_materials where id=$1', [materialId])).rows[0].quantity), 10);
  assert.equal((await db.query('select count(*)::int as n from inventory_order_consumptions where order_id=$1 and active', [orderId])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int as n from inventory_movements where source='order_reversal' and order_id=$1", [orderId])).rows[0].n, 3);
});

test('insufficient stock rejects production start atomically and materials with history are archived', async t => {
  const { db, admin, staff, asUser } = await createDatabase(t);
  const today = (await db.query("select (now() at time zone 'Asia/Manila')::date::text as date")).rows[0].date;
  const materialId = (await db.query(
    "select public.create_inventory_material('Short stock','Fabric','meters',1,0,$1) as id",
    [today],
  )).rows[0].id;
  const productId = (await db.query(
    "insert into products(name) values ('Large order jersey') returning id"
  )).rows[0].id;
  const { orderId, taskId } = await createOrder(db, productId, 2);

  await asUser(admin);
  await db.query(
    'select public.save_product_material_recipe($1,$2::jsonb)',
    [productId, JSON.stringify([{ material_id: materialId, quantity_per_unit: 1 }])],
  );
  await db.exec('reset role');
  await assert.rejects(
    db.query("update production_tasks set status='in_progress' where id=$1", [taskId]),
    /Insufficient stock for order/,
  );
  assert.equal((await db.query('select status::text from production_tasks where id=$1', [taskId])).rows[0].status, 'pending');
  assert.equal(Number((await db.query('select quantity from inventory_materials where id=$1', [materialId])).rows[0].quantity), 1);
  assert.equal((await db.query('select count(*)::int as n from inventory_movements where source <> \'manual\'')).rows[0].n, 0);

  await asUser(staff);
  await assert.rejects(
    db.query('select public.save_product_material_recipe($1,$2::jsonb)', [productId, '[]']),
    /Only an active admin/,
  );
  await db.exec('reset role');
  await asUser(admin);
  const removed = await db.query('select public.remove_inventory_material($1) as result', [materialId]);
  assert.equal(removed.rows[0].result, 'archived');
  assert.ok((await db.query('select archived_at from inventory_materials where id=$1', [materialId])).rows[0].archived_at);
  await assert.rejects(
    db.query('select public.record_inventory_movement($1,\'stock_in\',1,$2)', [materialId, today]),
    /Material not found or archived/,
  );
  await db.query('select public.restore_inventory_material($1)', [materialId]);
  assert.equal((await db.query('select archived_at from inventory_materials where id=$1', [materialId])).rows[0].archived_at, null);

  await db.exec('reset role');
  await db.query("select set_config('test.uid',$1,false)", [admin]);
  const unusedId = (await db.query(
    "select public.create_inventory_material('Unused item','Tools','pcs',0,0,$1) as id",
    [today],
  )).rows[0].id;
  assert.equal((await db.query('select public.remove_inventory_material($1) as result', [unusedId])).rows[0].result, 'deleted');
  assert.equal((await db.query('select count(*)::int as n from inventory_materials where id=$1', [unusedId])).rows[0].n, 0);
});
