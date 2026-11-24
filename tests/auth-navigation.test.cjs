const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {NextRequest,NextResponse}=require('next/server');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;

async function runMiddleware(path,scenario={}){
  let signouts=0,authChecks=0;
  const exported={};
  vm.runInNewContext(compile('src/middleware.ts'),{exports:exported,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test-key'}},require(name){
    if(name==='next/server')return {NextResponse};
    if(name==='@supabase/ssr')return {createServerClient(url,key,{cookies}){return {
      auth:{async getUser(){
        authChecks++;
        if(scenario.refresh){
          cookies.setAll([{name:'session.0',value:'new-first',options:{path:'/'}}],{'Cache-Control':'private, no-store',Pragma:'no-cache',Expires:'0'});
          cookies.setAll([{name:'session.1',value:'new-second',options:{path:'/'}}],{});
        }
        return {data:{user:scenario.noUser?null:{id:'staff'}},error:scenario.authError??null};
      },async signOut(){signouts++;cookies.setAll([{name:'session.0',value:'',options:{path:'/',maxAge:0}},{name:'session.1',value:'',options:{path:'/',maxAge:0}}],{});return {error:null};}},
      from(){return {select(){return {eq(){return {async maybeSingle(){return {data:scenario.missingProfile?null:{active:scenario.active??true},error:scenario.profileError??null};}};}};}};},
    };}};
    throw new Error('Unexpected import '+name);
  }});
  const request=new NextRequest('https://shop.test'+path,{headers:{cookie:'session.0=old-first; session.1=old-second'}});
  const response=await exported.middleware(request);
  return {response,signouts,authChecks,request};
}

test('Back to login with an authenticated session redirects to the menu and preserves every refreshed cookie chunk',async()=>{
  const {response,request,signouts}=await runMiddleware('/login',{refresh:true});
  assert.equal(response.status,307);assert.equal(response.headers.get('location'),'https://shop.test/dashboard');
  assert.equal(signouts,0);
  for(const [name,value] of [['session.0','new-first'],['session.1','new-second']]){
    assert.equal(response.cookies.get(name).value,value);assert.equal(request.cookies.get(name).value,value);
  }
  assert.match(response.headers.get('cache-control'),/private.*no-store/);
  assert.equal(response.headers.get('pragma'),'no-cache');assert.equal(response.headers.get('expires'),'0');
});

test('protected navigation keeps refreshed cookies and cannot cache session responses',async()=>{
  const {response,signouts}=await runMiddleware('/dashboard?view=Production',{refresh:true});
  assert.equal(response.status,200);assert.equal(signouts,0);
  assert.equal(response.cookies.get('session.0').value,'new-first');assert.equal(response.cookies.get('session.1').value,'new-second');
  assert.match(response.headers.get('cache-control'),/no-store/);
});

test('temporary auth and profile outages fail closed without logging the employee out',async()=>{
  for(const scenario of [{noUser:true,authError:{name:'AuthRetryableFetchError',status:0}},{noUser:true,authError:{status:503}},{noUser:true,authError:{status:429}},{profileError:{message:'Connection interrupted'}}]){
    const {response,signouts}=await runMiddleware('/dashboard',scenario);
    assert.equal(response.status,503);assert.equal(signouts,0);assert.equal(response.headers.get('location'),null);
    assert.equal(response.cookies.getAll().length,0);assert.match(response.headers.get('cache-control'),/no-store/);
  }
});

test('genuinely expired sessions still require sign-in and inactive accounts are blocked',async()=>{
  const expired=await runMiddleware('/dashboard?view=Production',{noUser:true,authError:{status:401}});
  assert.equal(expired.response.headers.get('location'),'https://shop.test/login');assert.equal(expired.signouts,0);
  const inactive=await runMiddleware('/dashboard',{active:false,refresh:true});
  assert.equal(inactive.signouts,1);assert.equal(inactive.response.headers.get('location'),'https://shop.test/login?error=inactive');
  assert.equal(inactive.response.cookies.get('session.0').value,'');assert.equal(inactive.response.cookies.get('session.0').maxAge,0);
});

function loginWatcher(verify,search=''){
  const exported={};vm.runInNewContext(compile('src/lib/auth/login-session.ts'),{exports:exported,URLSearchParams});
  const listeners=new Set();const redirects=[];let checked=0;
  const browser={location:{pathname:'/login',search,replace(url){redirects.push(url);}},addEventListener(event,callback){listeners.add(callback);},removeEventListener(event,callback){listeners.delete(callback);}};
  const dispose=exported.watchLoginSession(browser,verify,()=>checked++);
  return {redirects,dispose,listeners,browser,checked:()=>checked,restore(){for(const listener of listeners)listener({persisted:true});}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('a cached login restored by browser Back rechecks Auth and returns an active session to its menu',async()=>{
  let valid=false;const watcher=loginWatcher(async()=>valid);
  await flush();assert.equal(watcher.redirects.length,0);assert.equal(watcher.checked(),1);
  valid=true;watcher.restore();await flush();assert.deepEqual(watcher.redirects,['/dashboard']);
  watcher.dispose();assert.equal(watcher.listeners.size,0);
});

test('login restoration never invents a session, leaves a different page alone and cancels work on unmount',async()=>{
  const failed=loginWatcher(async()=>{throw new Error('Offline');});await flush();assert.equal(failed.redirects.length,0);assert.equal(failed.checked(),1);failed.dispose();
  let resolve;const pending=loginWatcher(()=>new Promise(done=>{resolve=done;}));pending.dispose();resolve(true);await flush();assert.equal(pending.redirects.length,0);
  const qr=loginWatcher(async()=>true,'?next=/scan-qr');await flush();assert.deepEqual(qr.redirects,['/dashboard']);qr.dispose();
  const unsafe=loginWatcher(async()=>true,'?next=https://other.test');await flush();assert.deepEqual(unsafe.redirects,['/dashboard']);unsafe.dispose();
});

test('the installed Supabase SDK refreshes an expired access token and persists the session across Back to login',async()=>{
  const {createServerClient}=require('@supabase/ssr');
  const user={id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'staff@example.test',created_at:'2026-01-01T00:00:00Z',app_metadata:{},user_metadata:{padding:'x'.repeat(4500)}};
  const jwt=exp=>['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',Buffer.from(JSON.stringify({sub:user.id,exp,role:'authenticated'})).toString('base64url'),'testsignature'].join('.');
  const now=Math.floor(Date.now()/1000);
  const session={access_token:jwt(now-100),refresh_token:'valid-test-refresh',expires_at:now-100,expires_in:3600,token_type:'bearer',user};
  let refreshes=0;
  const fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input.url);
    if(url.pathname==='/auth/v1/token'){
      refreshes++;assert.equal(JSON.parse(init.body).refresh_token,'valid-test-refresh');
      return Response.json({...session,access_token:jwt(now+3600),expires_at:now+3600,refresh_token:'rotated-test-refresh'});
    }
    if(url.pathname==='/auth/v1/user')return Response.json(user);
    if(url.pathname==='/rest/v1/profiles')return Response.json([{active:true}]);
    throw new Error('Unexpected SDK request '+url.pathname);
  };
  const exported={};
  vm.runInNewContext(compile('src/middleware.ts'),{exports:exported,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test-key'}},require(name){
    if(name==='next/server')return {NextResponse};
    if(name==='@supabase/ssr')return {createServerClient(url,key,options){return createServerClient(url,key,{...options,global:{fetch}});}};
    throw new Error('Unexpected import '+name);
  }});
  const initial='sb-example-auth-token=base64-'+Buffer.from(JSON.stringify(session)).toString('base64url');
  const response=await exported.middleware(new NextRequest('https://shop.test/dashboard?view=Production',{headers:{cookie:initial}}));
  assert.equal(response.status,200);assert.equal(refreshes,1);
  const updated=response.cookies.getAll().filter(cookie=>cookie.name.startsWith('sb-example-auth-token')&&cookie.value);
  assert.ok(updated.length>=2,'large sessions must keep all cookie chunks');
  const cookie=updated.map(({name,value})=>`${name}=${value}`).join('; ');
  const back=await exported.middleware(new NextRequest('https://shop.test/login',{headers:{cookie}}));
  assert.equal(back.status,307);assert.equal(back.headers.get('location'),'https://shop.test/dashboard');
  assert.equal(refreshes,1,'Back must reuse the refreshed session instead of the expired token');
});

test('password recovery pages are public and keep authenticated users on the reset form',async()=>{
 for(const path of ['/forgot-password','/reset-password','/auth/callback?code=reset&next=/reset-password']){
  const signedOut=await runMiddleware(path,{noUser:true});assert.equal(signedOut.response.status,200);
  const signedIn=await runMiddleware(path,{refresh:true});assert.equal(signedIn.response.status,200);
  assert.match(signedIn.response.headers.get('cache-control'),/no-store/);
 }
});

test('PWA manifest, service worker, and offline page bypass authentication middleware',async()=>{
 for(const path of ['/manifest.webmanifest','/sw.js','/offline.html']){
  const signedOut=await runMiddleware(path,{noUser:true});
  assert.equal(signedOut.response.status,200);
  assert.equal(signedOut.response.headers.get('location'),null);
  assert.equal(signedOut.authChecks,0,'public PWA assets must not require a Supabase session');
  assert.match(signedOut.response.headers.get('cache-control'),/no-store/);
 }
});
