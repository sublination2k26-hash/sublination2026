const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const x={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/sewing-payroll.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:x,Date,Set,Math,Number});
test('51 encoded against 50 stays red until corrected; pause is independent of warnings',()=>{
 const assignments=[{id:'a',employee_id:'1',quantity:20},{id:'b',employee_id:'2',quantity:30}];
 const pending=[{assignment_id:'a',quantity:20,status:'pending'},{assignment_id:'b',quantity:31,status:'pending'}];
 let s=x.sewingReconciliation(50,assignments,[],pending);assert.equal(s.status,'over');assert.equal(s.excess,1);assert.equal(s.employees[1].over,true);
 pending[1].quantity=30;s=x.sewingReconciliation(50,assignments,[],pending);assert.equal(s.status,'balanced');assert.equal(s.encoded,50);
 pending[1].quantity=29;assert.equal(x.sewingReconciliation(50,assignments,[],pending).status,'short');
});
test('posted encodings are counted once through completion events and weekly work records',()=>{
 const encodings=[{id:'e',assignment_id:'a',employee_id:'1',quantity:20,status:'posted',unit_rate:40,work_date:'2026-11-09'},{id:'f',assignment_id:'a',employee_id:'1',quantity:30,status:'pending',unit_rate:40,work_date:'2026-11-10'}];
 const work=[{employee_id:'1',quantity:20,unit_rate:40,work_date:'2026-11-09',status:'approved',pay_eligible:true},{employee_id:'1',quantity:5,unit_rate:40,work_date:'2026-11-09',status:'rejected',pay_eligible:true}];
 const s=x.sewingReconciliation(50,[{id:'a',employee_id:'1',quantity:50}],[{assignment_id:'a',kind:'completion',quantity:20}],encodings);assert.equal(s.encoded,50);
 const week=x.sewingPeriodTotals(work,encodings,'2026-11-09','2026-11-15');assert.equal(week.pieces,50);assert.equal(week.approved,800);assert.equal(week.pending,1200);assert.equal(week.pendingCount,1);
 assert.equal(x.sewingPeriodTotals(work,encodings,'2026-11-16','2026-11-22').pieces,0);
});
test('custom cutoffs allow arbitrary dates and reject missing, reversed or invalid dates',()=>{
 assert.equal(x.validSewingPeriod('2026-11-03','2026-11-19'),true);
 assert.equal(x.validSewingPeriod('2026-11-12','2026-11-12'),true);
 assert.equal(x.validSewingPeriod('2025-12-28','2026-01-19'),true);
 assert.equal(x.validSewingPeriod('2026-11-19','2026-11-03'),false);
 assert.equal(x.validSewingPeriod('','2026-11-19'),false);
 assert.equal(x.validSewingPeriod('2026-02-30','2026-03-19'),false);
});

test('assignment earnings count claimed pieces and ignore production-only pending output',()=>{
 const work=[{employee_id:'1',quantity:20,unit_rate:40,work_date:'2026-11-12',status:'pending_review',pay_eligible:true}];
 const output=[{assignment_pay:true,employee_id:'1',quantity:20,unit_rate:40,work_date:'2026-11-12',status:'pending'}];
 const totals=x.sewingPeriodTotals(work,output,'2026-11-09','2026-11-15');
 assert.equal(totals.pieces,20);assert.equal(totals.pending,800);assert.equal(totals.approved,0);
});

test('custom cutoff includes both boundaries and excludes records outside the chosen range',()=>{
 const work=['2026-11-02','2026-11-03','2026-11-19','2026-11-20'].map(work_date=>({work_date,quantity:10,unit_rate:40,pay_eligible:true,status:'approved'}));
 const totals=x.sewingPeriodTotals(work,[],'2026-11-03','2026-11-19');
 assert.equal(totals.pieces,20);assert.equal(totals.approved,800);
 assert.equal(x.sewingPeriodTotals(work,[],'2026-11-19','2026-11-03').pieces,0);
});
