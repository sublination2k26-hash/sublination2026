const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const exported={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/activity-calendar.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exported,Date,Map,Set,BigInt});
const {buildCalendarEvents,manilaDate}=exported;
const row=(id,at,table,entity,old,next,action='UPDATE')=>({id,occurred_at:at,actor_name:'Staff A',entity_table:table,entity_id:entity,old_state:old,new_state:next,action});
test('preserves yellow receipt, green completion, and later red return on separate days',()=>{
 const result=buildCalendarEvents([
 row(1,'2026-09-01T01:00:00Z','production_tasks','artist',null,{stage:'layout',status:'pending'},'INSERT'),
 row(2,'2026-09-01T01:00:00Z','production_tasks','printer',null,{stage:'printing',status:'pending'},'INSERT'),
 row(3,'2026-09-02T01:00:00Z','production_tasks','artist',{stage:'layout',status:'pending'},{stage:'layout',status:'completed',completed_by:'employee'}),
 row(4,'2026-09-05T01:00:00Z','defects','defect',null,{description:'Wrong spelling',origin_stage:'heat_press',return_stage:'layout'},'INSERT'),
 row(5,'2026-09-05T01:00:00Z','production_tasks','artist',{stage:'layout',status:'completed'},{stage:'layout',status:'returned_for_correction'}),
 ]);
 assert.ok(result.some(e=>e.date==='2026-09-01'&&e.color==='yellow'&&e.title.startsWith('Artist')));
 assert.ok(!result.some(e=>e.date==='2026-09-01'&&e.title.startsWith('Printing')));
 assert.ok(result.some(e=>e.date==='2026-09-02'&&e.color==='green'&&e.title.startsWith('Artist')));
 assert.ok(result.some(e=>e.date==='2026-09-02'&&e.color==='yellow'&&e.title.startsWith('Printing')));
 assert.ok(result.some(e=>e.date==='2026-09-05'&&e.color==='red'&&e.detail.includes('Heat Press')&&e.detail.includes('Artist')));
});
test('uses Philippine date across midnight and preserves multiple actions on the same day',()=>{
 assert.equal(manilaDate('2026-08-31T16:30:00Z'),'2026-09-01');
 const result=buildCalendarEvents([
 row(1,'2026-08-31T16:30:00Z','defects','d',null,{description:'White line'},'INSERT'),
 row(2,'2026-08-31T17:30:00Z','defects','d',{correction_status:'pending'},{correction_status:'completed',description:'White line'}),
 ]);
 assert.equal(result.length,2);assert.equal(result[0].date,result[1].date);
 assert.equal(result[0].color,'red');assert.equal(result[1].color,'green');
});
test('routing a stage does not falsely credit employee completion',()=>{
 const result=buildCalendarEvents([row(1,'2026-09-05T00:00:00Z','production_tasks','t',{stage:'layout',status:'pending'},{stage:'layout',status:'completed',completed_by:null})]);
 assert.ok(result.some(e=>e.title.includes('routing')));assert.ok(!result.some(e=>e.color==='green'));
});
test('sorts equal timestamps by audit ID and keeps reassignment and approval details',()=>{
 const result=buildCalendarEvents([
 {...row(11,'2026-09-01T00:00:00Z','production_tasks','t',{stage:'layout',status:'pending'},{stage:'layout',status:'pending',assigned_to:'employee'}),assignee_name:'Artist B'},
 row(10,'2026-09-01T00:00:00Z','production_tasks','t',null,{stage:'layout',status:'pending'},'INSERT'),
 row(12,'2026-09-02T00:00:00Z','defects','d',{approval_to_resume:false,correction_status:'completed'},{approval_to_resume:true,correction_status:'completed'}),
 ]);
 assert.ok(result[0].id.startsWith('10-'));assert.ok(result.some(e=>e.detail==='Artist B'));assert.ok(result.some(e=>e.title.includes('approved')));
});
