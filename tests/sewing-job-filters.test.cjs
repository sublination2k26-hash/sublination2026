const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const x={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/sewing-job-filters.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:x});
const job={orderId:'o1',team:'Red hawk',orderNumber:'JO-0041',garment:'T-shirt',sewers:[{id:'s1',name:'reymond'}],closed:false,completed:false,upstreamReady:true,unassigned:5,waitingHandoff:10,readyToSew:7};
const defaults={search:'',orderId:'',sewerId:'',garment:'',status:'active'};
test('sewing filters combine search, team, sewer and garment',()=>{
 assert.equal(x.matchesSewingJob(job,{...defaults,search:'  REYMOND ',orderId:'o1',sewerId:'s1',garment:'T-shirt'}),true);
 for(const filter of [{orderId:'o2'},{sewerId:'s2'},{garment:'Jersey'},{search:'No match'}])assert.equal(x.matchesSewingJob(job,{...defaults,...filter}),false);
 assert.equal(x.matchesSewingJob(job,{...defaults,search:'jo-0041'}),true);
});
test('work filters show actionable jobs and keep closed jobs out of active queues',()=>{
 for(const status of ['active','unassigned','handoff','sewing'])assert.equal(x.matchesSewingJob(job,{...defaults,status}),true);
 assert.equal(x.matchesSewingJob(job,{...defaults,status:'waiting'}),false);
 assert.equal(x.matchesSewingJob({...job,upstreamReady:false},{...defaults,status:'waiting'}),true);
 assert.equal(x.matchesSewingJob({...job,upstreamReady:false},{...defaults,status:'handoff'}),false);
 assert.equal(x.matchesSewingJob({...job,readyToSew:0},{...defaults,status:'sewing'}),false);
 assert.equal(x.matchesSewingJob({...job,unassigned:0},{...defaults,status:'unassigned'}),false);
 for(const status of ['active','unassigned','handoff','sewing','waiting'])assert.equal(x.matchesSewingJob({...job,closed:true},{...defaults,status}),false);
 assert.equal(x.matchesSewingJob({...job,closed:true},{...defaults,status:'closed'}),true);
 assert.equal(x.matchesSewingJob({...job,closed:true},{...defaults,status:'all'}),true);
 assert.equal(x.matchesSewingJob({...job,completed:true},{...defaults,status:'active'}),false);
 assert.equal(x.matchesSewingJob({...job,completed:true},{...defaults,status:'completed'}),true);
});
