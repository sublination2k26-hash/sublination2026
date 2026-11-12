const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/sewer-pay-report.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exportsObject});
test('report separates custom regular and promo pay and totals by employee identity',()=>{
  const result=exportsObject.sewerPaySummaries([
    {employeeId:'a',employee:'Same name',mode:'regular',quantity:20,total:845},
    {employeeId:'a',employee:'Same name',mode:'promo',quantity:10,total:375},
    {employeeId:'a',employee:'Same name',mode:'regular',quantity:2,total:100},
    {employeeId:'b',employee:'Same name',mode:'promo',quantity:30,total:900},
  ]);
  const rows=new Map(result);
  assert.equal(rows.size,2);
  assert.equal(rows.get('a').regularPieces,22);
  assert.equal(rows.get('a').regularPay,945);
  assert.equal(rows.get('a').promoPay,375);
  assert.equal(rows.get('a').pieces,32);
  assert.equal(rows.get('a').total,1320);
  assert.equal(rows.get('b').total,900);
  assert.equal(exportsObject.sewerPaySummaries([]).length,0);
});

