const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/document-routing.ts', 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {exports:exported});
test('release requires every preceding office and latest returns to be completed', () => {
  const {routingStages, pendingRoutingStages} = exported;
  assert.equal(pendingRoutingStages([]).length, routingStages.length - 1);
  const entries = routingStages.filter(stage => stage !== 'CHEQUE RELEASE').map(stage => ({stage, forwarded_date:'2026-10-30',created_at:'2026-10-30T01:00:00Z'}));
  assert.equal(pendingRoutingStages(entries).length, 0);
  entries.push({stage:'COA',forwarded_date:null,created_at:'2026-10-30T02:00:00Z'});
  assert.equal(pendingRoutingStages(entries).join(','), 'COA');
});
