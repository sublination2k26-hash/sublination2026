const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {NextRequest,NextResponse}=require('next/server');
async function callback(path,error=null){
 const exported={};let exchanged=null;
 const code=ts.transpileModule(fs.readFileSync('src/app/auth/callback/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{exports:exported,URL,require(name){
  if(name==='next/server')return {NextResponse};
  if(name==='@/lib/supabase/server')return {createClient:async()=>({auth:{exchangeCodeForSession:async value=>{exchanged=value;return {error};}}})};
  throw Error(name);
 }});
 return {response:await exported.GET(new NextRequest('https://shop.test'+path)),get exchanged(){return exchanged;}};
}
test('recovery callback exchanges code and opens the new password page',async()=>{
 const result=await callback('/auth/callback?code=recovery-code&next=/reset-password');
 assert.equal(result.exchanged,'recovery-code');assert.equal(result.response.headers.get('location'),'https://shop.test/reset-password');
});
test('failed or expired recovery redirects to a new request; external redirects are rejected',async()=>{
 for(const path of ['/auth/callback?next=/reset-password','/auth/callback?code=expired&next=/reset-password']){
  const result=await callback(path,{message:'Expired'});assert.equal(result.response.headers.get('location'),'https://shop.test/forgot-password?error=recovery');
 }
 const result=await callback('/auth/callback?code=valid&next=https://other.test');assert.equal(result.response.headers.get('location'),'https://shop.test/dashboard');
});
