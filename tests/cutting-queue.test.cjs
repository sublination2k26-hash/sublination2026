const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/cutting-queue.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject });
const { isWaitingForCutting } = exportsObject;
const order = { status: 'pending', stage: 'Layout', productionTasks: [{ stage: 'layout', status: 'pending' }, { stage: 'cutting', status: 'pending' }] };

test('cutters see upcoming cutting jobs before earlier production stages finish', () => {
  for (const stage of ['Layout', 'Printing', 'Heat press']) {
    assert.equal(isWaitingForCutting({ ...order, stage }), true);
  }
});

test('cutting queue excludes completed, closed and non-cutting work', () => {
  for (const status of ['cancelled', 'released', 'ready_for_release']) {
    assert.equal(isWaitingForCutting({ ...order, status }), false);
  }
  for (const stage of ['Cutting', 'Sewing', 'Quality check', 'Ready for release', 'Released']) {
    assert.equal(isWaitingForCutting({ ...order, stage }), false);
  }
  assert.equal(isWaitingForCutting({ ...order, productionTasks: [{ stage: 'cutting', status: 'completed' }] }), false);
  assert.equal(isWaitingForCutting({ ...order, productionTasks: [{ stage: 'printing', status: 'pending' }] }), false);
});
