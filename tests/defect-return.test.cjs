const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsUnderTest = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/lib/defect-return.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, { exports: exportsUnderTest });
const { saveDefectReturn } = exportsUnderTest;

test('overlapping submissions insert and return only once', async () => {
  const progress = { inserted: false, routed: false };
  let inserts = 0, returns = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const operations = {
    insert: async () => { inserts++; await gate; },
    route: async () => { returns++; },
  };
  const first = saveDefectReturn(progress, operations);
  const second = saveDefectReturn(progress, operations);
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(inserts, 1);
  assert.equal(returns, 1);
});

test('failed return retries routing without inserting another defect', async () => {
  const progress = { inserted: false, routed: false };
  let inserts = 0, returns = 0;
  const operations = {
    insert: async () => { inserts++; },
    route: async () => { if (++returns === 1) throw new Error('Routing failed'); },
  };
  await assert.rejects(saveDefectReturn(progress, operations), /Routing failed/);
  await saveDefectReturn(progress, operations);
  assert.equal(inserts, 1);
  assert.equal(returns, 2);
});

test('retry after a refresh failure does not reset production again', async () => {
  const progress = { inserted: false, routed: false };
  let inserts = 0, returns = 0;
  const operations = {
    insert: async () => { inserts++; },
    route: async () => { returns++; },
  };
  await saveDefectReturn(progress, operations);
  await saveDefectReturn(progress, operations);
  assert.equal(inserts, 1);
  assert.equal(returns, 1);
});

test('failed insert can be retried and never routes before insertion', async () => {
  const progress = { inserted: false, routed: false };
  let inserts = 0, returns = 0;
  const operations = {
    insert: async () => { if (++inserts === 1) throw new Error('Insert failed'); },
    route: async () => { returns++; },
  };
  await assert.rejects(saveDefectReturn(progress, operations), /Insert failed/);
  assert.equal(returns, 0);
  await saveDefectReturn(progress, operations);
  assert.equal(inserts, 2);
  assert.equal(returns, 1);
});
