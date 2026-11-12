const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const api={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/artist-payroll.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:api,Intl,Date});

test('artist tables share completer attribution and Philippine cutoff; garment quantity never counts as layouts',()=>{
 const staff=[{id:'artist',role:'artist',full_name:'Artist',active:true},{id:'admin',role:'admin',full_name:'Owner',active:true}];
 const task=(id,who,at)=>({id,status:'completed',completed_by:who,completed_at:at,order:{notes:'',order_number:'JO-1'},item:{quantity:31}});
 const tasks=[task('in','artist','2026-11-12T16:00:00Z'),task('out','artist','2026-11-13T16:00:00Z'),task('owner','admin','2026-11-13T00:00:00Z'),{...task('unrecorded',null,'2026-11-13T00:00:00Z'),assigned_to:'artist'},{...task('pending','artist','2026-11-13T00:00:00Z'),status:'pending'},{...task('sample','artist','2026-11-13T00:00:00Z'),order:{notes:'[SEWING EXAMPLE] Training'}}];
 const rows=api.artistCutoffTasks(tasks,staff,'2026-11-13','2026-11-13');
 assert.equal(rows.length,1);assert.equal(rows[0].id,'in');
 assert.equal(api.artistCutoffTasks(tasks,staff,'2026-11-13','2026-11-13','admin').length,0);
 assert.equal(api.artistCutoffTasks(tasks,staff,'2026-11-14','2026-11-13').length,0);
});

test('printable payroll uses saved price and escapes names and work descriptions',()=>{
 const record={id:'r',employee_name:'<script>name</script>',period_start:'2026-11-13',period_end:'2026-11-13',layout_count:1,unit_rate:150,total_pay:150,payslip_id:'p'};
 const html=api.artistPayrollPrintHtml(record,[{record_id:'r',team_name:'<img src=x>',order_number:'JO-1',garment:'Jersey',completed_at:'2026-11-13T00:00:00Z'},{record_id:'other',team_name:'Wrong record',completed_at:'bad'}]);
 assert.ok(html.includes('&lt;script&gt;name&lt;/script&gt;'));
 assert.ok(html.includes('&lt;img src=x&gt;'));assert.ok(!html.includes('Wrong record'));
 assert.ok(html.includes('150.00'));assert.ok(html.includes('does not confirm payment received'));
});

test('artist payroll snapshots rates, issues payslips, protects permissions and prevents duplicate layouts',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;`);
 await db.exec(fs.readFileSync('supabase/migrations/202610170001_initial_schema.sql','utf8').replace('create extension if not exists pgcrypto;','').split('-- Create a private storage bucket')[0]);
 await db.exec('alter table production_tasks add column started_by uuid references profiles(id),add column completed_by uuid references profiles(id);');
 await db.exec(fs.readFileSync('supabase/migrations/20261028080216_employee_payslips.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261112161448_artist_layout_payroll_reports.sql','utf8'));
 for(const [n,role] of [[1,'admin'],[2,'artist'],[3,'artist']]){await db.query('insert into auth.users values($1)',[id(n)]);await db.query('insert into profiles(id,full_name,role) values($1,$2,$3)',[id(n),'Employee '+n,role]);}
 const customer=(await db.query("insert into customers(full_name) values('Team A') returning id")).rows[0].id;
 const order=(await db.query('insert into orders(customer_id) values($1) returning id',[customer])).rows[0].id;
 const make=async(n,at,employee=2)=>{
  const item=(await db.query("insert into order_items(order_id,product_name,quantity,unit_price) values($1,'Jersey',31,100) returning id",[order])).rows[0].id;
  await db.query("insert into production_tasks(id,order_id,order_item_id,stage,status,completed_by,completed_at) values($1,$2,$3,'layout','completed',$4,$5)",[id(n),order,item,id(employee),at]);
 };
 await make(10,'2026-11-12T16:00:00Z');await make(11,'2026-11-13T15:59:59Z');await make(12,'2026-11-13T16:00:00Z');await make(13,'2026-11-13T08:00:00Z',1);
 const as=async n=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');};
 const save=(employee,start,end,rate,tasks)=>db.query('select create_artist_layout_payroll($1,$2,$3,$4,$5::uuid[]) as id',[id(employee),start,end,rate,tasks.map(id)]);
 await as(2);assert.equal((await db.query('select * from artist_layout_pay_settings')).rows.length,0);
 await db.query('update artist_layout_pay_settings set unit_rate=999');
 await assert.rejects(save(2,'2026-11-13','2026-11-13',150,[10,11]),/Only admin/);
 await as(1);assert.equal(Number((await db.query('select unit_rate from artist_layout_pay_settings')).rows[0].unit_rate),150);
 await assert.rejects(save(1,'2026-11-13','2026-11-13',150,[13]),/active artist/);
 await assert.rejects(save(2,'2026-11-13','2026-11-13',150,[10]),/completed layouts changed/);
 const record=(await save(2,'2026-11-13','2026-11-13',150,[11,10])).rows[0].id;
 let row=(await db.query('select * from artist_layout_payroll_records where id=$1',[record])).rows[0];
 assert.equal(row.layout_count,2);assert.equal(Number(row.total_pay),300);assert.equal(Number(row.unit_rate),150);
 assert.equal((await db.query('select * from artist_layout_payroll_items where record_id=$1',[record])).rows.length,2);
 assert.equal(Number((await db.query('select basic_pay from employee_payslips where id=$1',[row.payslip_id])).rows[0].basic_pay),300);
 await assert.rejects(save(2,'2026-11-12','2026-11-13',150,[10,11]),/No unrecorded/);
 await db.query('update artist_layout_pay_settings set unit_rate=200');
 await assert.rejects(save(2,'2026-11-14','2026-11-14',150,[12]),/price changed/);
 await save(2,'2026-11-14','2026-11-14',200,[12]);
 row=(await db.query('select * from artist_layout_payroll_records where id=$1',[record])).rows[0];
 assert.equal(Number(row.total_pay),300);assert.equal(Number(row.unit_rate),150);
 await db.exec('reset role');await db.query('update customers set full_name=$1 where id=$2',['New team name',customer]);
 assert.equal((await db.query('select team_name from artist_layout_payroll_items where record_id=$1 limit 1',[record])).rows[0].team_name,'Team A');
 await as(1);await assert.rejects(db.query('update artist_layout_payroll_records set total_pay=1 where id=$1',[record]),/permission denied/);
 await as(2);assert.equal((await db.query('select * from artist_layout_payroll_records')).rows.length,0);
 await as(0);await assert.rejects(save(2,'2026-11-15','2026-11-15',200,[]),/Only admin/);
});
