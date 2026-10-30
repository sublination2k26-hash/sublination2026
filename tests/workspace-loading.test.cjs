const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/workspace-loading.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported, setTimeout, clearTimeout });

test('workspace requests resolve and preserve database errors', async () => {
  assert.equal(await exported.withWorkspaceTimeout(Promise.resolve('ready')), 'ready');
  await assert.rejects(exported.withWorkspaceTimeout(Promise.reject(new Error('Access denied'))), /Access denied/);
});

test('a stalled request times out so the workspace can offer retry', async () => {
  await assert.rejects(exported.withWorkspaceTimeout(new Promise(() => {}), 10), /Loading took too long/);
});

test('grouping keeps related records separate and preserves payment and inspection ordering', () => {
  const rows = [{ order_id: 'a', id: 1 }, { order_id: 'b', id: 2 }, { order_id: 'a', id: 3 }];
  const groups = exported.groupByOrder(rows);
  assert.deepEqual(Array.from(groups.get('a'), row => row.id), [1, 3]);
  assert.deepEqual(Array.from(groups.get('b'), row => row.id), [2]);
  assert.equal(groups.get('missing'), undefined);
});

test('complete report loading reads all pages and rejects errors instead of exporting partial history', async () => {
  const source=Array.from({length:1205},(_,id)=>({id}));
  const pages=[];
  const rows=await exported.readAllRows(async(from,to)=>{pages.push([from,to]);return {data:source.slice(from,to+1),error:null};});
  assert.equal(rows.length,1205); assert.equal(rows[1204].id,1204);
  assert.deepEqual(pages,[[0,499],[500,999],[1000,1499]]);
  await assert.rejects(exported.readAllRows(async(from)=>from===0?{data:source.slice(0,500),error:null}:{data:null,error:{message:'Connection failed'}}),/Connection failed/);
});
