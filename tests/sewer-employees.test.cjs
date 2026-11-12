const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const api={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/sewer-employees.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:api});

test('sewer selectors use the active employee roster regardless of assignment history',()=>{
 const employees=[
  {id:'new',full_name:'Zoe',role:'sewer',active:true},
  {id:'current',full_name:'Ana',role:'sewer',active:true},
  {id:'former',full_name:'Former sewer',role:'cutter',active:true},
  {id:'inactive',full_name:'Inactive sewer',role:'sewer',active:false},
  {id:'admin',full_name:'Owner',role:'admin',active:true},
 ];
 const result=api.activeSewerEmployees(employees);
 assert.deepEqual(Array.from(result,e=>e.id),['current','new']);
 assert.equal(employees.length,5);
 assert.equal(employees[0].id,'new');
});
