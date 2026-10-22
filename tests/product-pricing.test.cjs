const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const exported={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/product-pricing.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exported});
const prices=service=>Object.fromEntries(exported.garmentPricing(service).map(item=>[item.garment,item.price]));

test('each service has its own production route including sewing without printing or pressing',()=>{
 const expected={
  full_garment:['layout','printing','heat_press','cutting','sewing','qc'],
  subcon_print:['layout','printing','qc'],
  subcon_press:['layout','printing','heat_press','qc'],
  subcon_sewing:['layout','cutting','sewing','qc'],
 };
 for(const [service,stages] of Object.entries(expected)) {
  assert.deepEqual(Array.from(exported.serviceProductionStages[service]),stages);
 }
});
test('full garment prices match the shop price list',()=>{
 assert.deepEqual(prices('full_garment'),{Jersey:300,'T-shirt':320,'Jersey + shorts set':700,Polo:480,'Chinese collar':490,'Long sleeve':480,Hoodie:500,Special:null});
});
test('subcontract prices distinguish print only from print and press',()=>{
 assert.deepEqual(prices('subcon_print'),{Jersey:90,Shorts:90,'T-shirt':100,Polo:110,'Long sleeve':120,Hoodie:140,Special:null});
 assert.deepEqual(prices('subcon_press'),{Jersey:200,Shorts:200,'T-shirt':210,Polo:220,'Long sleeve':220,Hoodie:230,Special:null});
});
test('special and subcontract sewing require manual prices',()=>{
 for(const service of exported.pricingServices) assert.equal(prices(service.id).Special,null);
 const sewing=exported.garmentPricing('subcon_sewing');
 assert.ok(sewing.length>1);
 assert.ok(sewing.every(item=>item.price===null));
});
