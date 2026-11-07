const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const exported={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/workspace-navigation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exported,URLSearchParams});

test('browser Back and Forward restore workspace menus and orders within the authenticated page',()=>{
  const stack=['/dashboard'];let index=0;const listeners=new Set();
  const location={pathname:'/dashboard',search:''};
  const load=()=>{const url=new URL(stack[index],'https://example.test');location.pathname=url.pathname;location.search=url.search;};
  const browser={location,history:{state:{nextRouter:'preserved'},replaceState(state,title,url){stack[index]=url;load();},pushState(state,title,url){stack.splice(index+1);stack.push(url);index++;load();}},addEventListener(event,callback){listeners.add(callback);},removeEventListener(event,callback){listeners.delete(callback);}};
  let current={view:'Production',order:null};
  const history=exported.createWorkspaceHistory(browser,'Production',['Production','Job orders'],next=>{current=next;history.sync(next.view,next.order);});
  history.sync('Production',null);
  history.sync('Job orders',null);
  history.sync('Job orders','JO-2026-1000');
  const pop=()=>{load();for(const listener of listeners)listener();};
  index--;pop();assert.equal(current.view,'Job orders');assert.equal(current.order,null);
  index--;pop();assert.equal(current.view,'Production');assert.equal(location.pathname,'/dashboard');
  index++;pop();index++;pop();assert.equal(current.order,'JO-2026-1000');
  assert.equal(stack.length,3);assert.equal(browser.history.state.nextRouter,'preserved');
  history.dispose();assert.equal(listeners.size,0);
});

test('workspace links round-trip order names and reject views outside the role menu',()=>{
  const href=exported.workspaceLocation('Job orders','JO / team & 1');
  const state=exported.readWorkspaceLocation(new URL(href,'https://example.test').search,'Production',['Production','Job orders']);
  assert.equal(state.view,'Job orders');assert.equal(state.order,'JO / team & 1');
  assert.equal(exported.readWorkspaceLocation('?view=Payments','Production',['Production']).view,'Production');
});
