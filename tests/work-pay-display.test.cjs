const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const exported={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/work-pay-display.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exported});
const {workPayDisplay}=exported;
const record={quantity:10,unit_rate:0,pay_eligible:true};
test('fixed salary shows configured period rate without multiplying it per task',()=>{
 const pay=workPayDisplay(record,{salary_basis:'fixed',base_rate:600,pay_frequency:'daily'});
 assert.equal(pay.fixedRate,600);assert.equal(pay.frequency,'daily');assert.equal(pay.outputPay,null);assert.equal(pay.zeroOutputRate,false);
});
test('combined salary separates fixed rate from recorded output earnings',()=>{
 const pay=workPayDisplay({...record,unit_rate:25},{salary_basis:'combined',base_rate:5000,pay_frequency:'monthly'});
 assert.equal(pay.fixedRate,5000);assert.equal(pay.outputPay,250);
});
test('excluded output never hides fixed salary',()=>{
 const pay=workPayDisplay({...record,pay_eligible:false},{salary_basis:'combined',base_rate:600,pay_frequency:'daily'});
 assert.equal(pay.fixedRate,600);assert.equal(pay.outputPay,null);assert.equal(pay.outputExcluded,true);
});
test('zero historical output rates are explained without repricing saved work',()=>{
 const pay=workPayDisplay(record,{salary_basis:'piece',base_rate:0,pay_frequency:'weekly'});
 assert.equal(pay.fixedRate,null);assert.equal(pay.outputPay,0);assert.equal(pay.zeroOutputRate,true);
 assert.equal(workPayDisplay(record).needsSettings,true);
});
