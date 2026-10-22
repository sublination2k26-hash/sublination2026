const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/team-messages.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });

test('polling merges a sent message without duplicating it or skipping intervening staff messages', () => {
  const current = [{ id: 1 }, { id: 4 }];
  const merged = exported.mergeMessages(current, [{ id: 2 }, { id: 3 }, { id: 4 }]);
  assert.deepEqual(Array.from(merged, item => item.id), [1, 2, 3, 4]);
  assert.deepEqual(current.map(item => item.id), [1, 4]);
});

test('older history merges in chronological order and preserves newer messages', () => {
  const merged = exported.mergeMessages([{ id: 5 }, { id: 6 }], [{ id: 4 }, { id: 3 }]);
  assert.deepEqual(Array.from(merged, item => item.id), [3, 4, 5, 6]);
});
