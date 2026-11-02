const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/document-routing.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject });

test('stage update date follows recorded history, including returns and corrections', () => {
  const entries = [
    { stage: 'BAC', created_at: '2026-11-01T16:30:00Z', received_date: '2026-10-28' },
    { stage: 'ACCOUNTING', created_at: '2026-10-31T03:00:00Z', received_date: '2026-10-30' },
  ];
  const document = { document_routing_entries: entries };
  assert.equal(exportsObject.latestStage(document), 'BAC');
  assert.equal(exportsObject.latestStageUpdatedAt(document), '2026-11-01T16:30:00Z');
  assert.equal(entries[0].stage, 'BAC');
  entries.push({ stage: 'BAC', created_at: '2026-11-02T01:00:00Z' });
  assert.equal(exportsObject.latestStageUpdatedAt(document), '2026-11-02T01:00:00Z');
});

test('documents without recorded stages have no stage update date', () => {
  assert.equal(exportsObject.latestStageUpdatedAt({ document_routing_entries: [] }), null);
});
