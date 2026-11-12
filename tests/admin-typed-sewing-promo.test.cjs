const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');

test('admin types promo prices without preset rates and approved pay remains locked',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  grant usage on schema auth to authenticated,anon;`);
 const migration=name=>db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610170001_initial_schema.sql','utf8').replace('create extension if not exists pgcrypto;','').split('-- Create a private storage bucket')[0]);
 for(const name of ['202610190002_dashboard_persistence.sql','202610190003_catalog_orders.sql','20261022012741_customer_facebook_contact.sql','20261022084023_service_production_routes.sql','202610200004_production_notifications.sql','202610200009_front_desk_production_permissions.sql','202610200007_employee_work_payroll.sql','202610200008_automatic_task_payroll_tracking.sql','20261026043803_payroll_cash_advance.sql','20261026060520_sewing_only_work_tracking.sql','20261027023029_attendance_based_payroll.sql','20261027023537_qr_time_attendance.sql','20261027031811_public_qr_attendance.sql','20261027124647_employee_cash_advance_ledger.sql','20261027131046_payroll_overtime.sql','20261028023512_qr_attendance_approval.sql','20261028063252_payroll_sss_deductions.sql','20261028080216_employee_payslips.sql','20261028085057_employee_salary_info.sql','20261029065538_sewer_assignments.sql','20261029074932_sewer_self_claim.sql','20261029025401_order_piece_releases.sql','20261029030118_pickup_release_dates.sql','20261029082024_dated_customer_downpayments.sql','20261109124219_sewing_garment_rates_partial_pickups.sql'])await migration(name);
 for(const [n,name,role] of [[1,'Owner','admin'],[2,'Front desk','front_desk'],[3,'intsik','cutting_sewing'],[4,'maymay','cutting_sewing'],[5,'brian','cutting_sewing'],[6,'reymond','cutting_sewing']]){
  await db.query('insert into auth.users values($1)',[id(n)]);await db.query('insert into profiles(id,full_name,role) values($1,$2,$3)',[id(n),name,role]);
 }
 await db.query("insert into employee_compensation(employee_id,salary_basis,piece_rate) values($1,'piece',35)",[id(5)]);
 await db.query("insert into employee_work_records(employee_id,role,activity,quantity,unit_rate) values($1,'cutting_sewing','Sewing completed',2,35)",[id(5)]);
 const before=(await db.query('select id,employee_id,quantity,unit_rate from employee_work_records')).rows;
 const files=fs.readdirSync('supabase/migrations');
 await migration(files.find(name=>name.endsWith('_split_cutter_sewer_roles.sql')));
 await migration(files.find(name=>name.endsWith('_cutter_sewer_permissions_and_employees.sql')));
 assert.deepEqual((await db.query('select full_name,role from profiles where id<>$1 and id<>$2 order by full_name',[id(1),id(2)])).rows,[{full_name:'brian',role:'sewer'},{full_name:'intsik',role:'cutter'},{full_name:'maymay',role:'cutter'},{full_name:'reymond',role:'sewer'}]);
 assert.deepEqual((await db.query('select id,employee_id,quantity,unit_rate from employee_work_records')).rows,before);
 assert.equal((await db.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','sewing_private','sewing_pay_private') and strpos(p.prosrc,'''cutting_sewing''')>0")).rows[0].n,0);
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated;grant usage,select on all sequences in schema public to authenticated;');
 const as=async n=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[id(n)]);await db.exec('set role authenticated');};
 await migration(files.find(name=>name.endsWith('_sewing_encoding_weekly_payroll.sql')));
 await as(1);
 const customer=(await db.query("insert into customers(full_name) values('Team') returning id")).rows[0].id;
 const order=(await db.query('insert into orders(customer_id) values($1) returning id',[customer])).rows[0].id;
 const item=(await db.query("insert into order_items(order_id,product_name,quantity,unit_price) values($1,'Jersey',50,300) returning id",[order])).rows[0].id;
 const cutting=(await db.query("insert into production_tasks(order_id,order_item_id,stage) values($1,$2,'cutting') returning id",[order,item])).rows[0].id;
 const sewing=(await db.query("insert into production_tasks(order_id,order_item_id,stage) values($1,$2,'sewing') returning id",[order,item])).rows[0].id;

 await db.query("update production_tasks set status='completed' where id=$1",[cutting]);
 await db.query("insert into employee_compensation(employee_id,salary_basis,piece_rate) values($1,'piece',50) on conflict(employee_id) do update set piece_rate=50",[id(6)]);
 for(const employee of [id(5),id(6)])await db.query("insert into sewing_garment_rates(employee_id,garment,unit_rate,promo_rate) values($1,'Jersey',50,40)",[employee]);
 await db.query("update order_items set customization='{\"garment\":\"Jersey\"}' where id=$1",[item]);
 const action=(kind,assignment,employee,qty,rid)=>db.query('select record_sewing_action($1,$2,$3,$4,$5,$6,$7)',[kind,sewing,assignment,employee,qty,'',rid]);

 await db.exec('reset role');
 const oldOrder=(await db.query('insert into orders(customer_id) values($1) returning id',[customer])).rows[0].id;
 const oldItem=(await db.query("insert into order_items(order_id,product_name,quantity,unit_price,customization) values($1,'Jersey',2,300,'{\"garment\":\"Jersey\"}') returning id",[oldOrder])).rows[0].id;
 const oldTask=(await db.query("insert into production_tasks(order_id,order_item_id,stage) values($1,$2,'sewing') returning id",[oldOrder,oldItem])).rows[0].id;
 await db.query("insert into sewing_assignments(id,task_id,employee_id,quantity,assigned_by,created_at) values($1,$2,$3,2,$4,now()-interval '8 days')",[id(78),oldTask,id(5),id(1)]);
 await migration(files.find(name=>name.endsWith('_sewer_pay_from_assigned_pieces.sql')));
 await as(1);

 await db.exec('reset role');await migration(files.find(name=>name.endsWith('_admin_payroll_promo_selection.sql')));
 await migration(files.find(name=>name.endsWith('_admin_typed_sewing_promo_price.sql')));
 const claim=(employee,qty,rid,mode='regular')=>db.query('select assign_priced_sewing_pieces($1,$2,$3,$4,$5,$6)',[sewing,id(employee),qty,mode,'Claim pieces',id(rid)]);
 await as(5);await assert.rejects(claim(5,20,80,'promo'),/Promo is selected by admin/);await claim(5,20,80);
 await as(6);await claim(6,30,81);
 await as(1);
 const records=(await db.query('select id,employee_id,unit_rate from employee_work_records where sewing_assignment_id is not null order by employee_id')).rows;
 assert.equal(Number(records[0].unit_rate),50,'claim stores provisional regular rate');
 await assert.rejects(db.query("update employee_work_records set status='approved' where id=$1",[records[0].id]),/Admin must select/);
 await as(5);await assert.rejects(db.query("select approve_sewer_assignment_pay($1,'promo')",[records[0].id]),/Only admin/);
 await as(1);await db.query('update sewing_garment_rates set promo_rate=null where employee_id=$1',[id(5)]);
 await assert.rejects(db.query("select approve_sewer_assignment_pay($1,'promo')",[records[0].id]),/Enter a valid promo price/);
 assert.equal((await db.query('select status from employee_work_records where id=$1',[records[0].id])).rows[0].status,'pending_review');
 for(const invalid of ['-1','NaN','Infinity','10000000000','1.001'])await assert.rejects(db.query("select approve_sewer_assignment_pay($1,'promo',$2::numeric)",[records[0].id,invalid]),/valid promo price/);
 await assert.rejects(db.query("select approve_sewer_assignment_pay($1,'regular',12)",[records[0].id]),/only allowed for Promo/);
 await as(2);await assert.rejects(db.query("select approve_sewer_assignment_pay($1,'promo',37.5)",[records[0].id]),/Only admin/);
 await as(1);
 await db.query("select approve_sewer_assignment_pay($1,'promo',37.5)",[records[0].id]);
 await db.query("select approve_sewer_assignment_pay($1,'promo',37.5)",[records[0].id]);
 await assert.rejects(db.query("select approve_sewer_assignment_pay($1,'promo',38)",[records[0].id]),/Only unreviewed/);
 assert.equal(Number((await db.query('select unit_rate from sewing_assignments where id=$1',[id(80)])).rows[0].unit_rate),37.5);
 assert.equal((await db.query('select promo_rate from sewing_garment_rates where employee_id=$1',[id(5)])).rows[0].promo_rate,null);

 await db.query("select approve_sewer_assignment_pay($1,'regular')",[records[1].id]);
 const amounts=(await db.query('select quantity*unit_rate as amount from employee_work_records where sewing_assignment_id is not null order by employee_id')).rows;
 assert.equal(Number(amounts[0].amount),750);assert.equal(Number(amounts[1].amount),1500);
 await as(5);await claim(5,20,80); // retry remains valid after admin applied promo
 await as(1);await db.query('update sewing_garment_rates set promo_rate=99');
 const date=(await db.query("select (now() at time zone 'Asia/Manila')::date::text as day")).rows[0].day;
 const cutoff=(await db.query('select ($1::date-3)::text as start,($1::date+11)::text as end',[date])).rows[0];
 const run=(await db.query('select create_payroll_run($1,$2) as id',[cutoff.start,cutoff.end])).rows[0].id;
 const saved=(await db.query('select period_start::text,period_end::text from payroll_runs where id=$1',[run])).rows[0];
 assert.equal(saved.period_start,cutoff.start);assert.equal(saved.period_end,cutoff.end);
 assert.equal(Number((await db.query("select sum(production_pay) as pay from payroll_lines where payroll_run_id=$1 and role='sewer'",[run])).rows[0].pay),2250);
 await assert.rejects(db.query("select approve_sewer_assignment_pay($1,'regular')",[records[0].id]),/locked/);
});
