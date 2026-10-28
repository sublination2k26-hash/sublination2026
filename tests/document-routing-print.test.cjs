const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(window = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/lib/document-routing-print.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, window, require: () => ({ latestStage: () => 'ACCOUNTING' }) });
  return exports;
}
const document = {
  pr_number: 'PR-001', po_number: 'PO-002', title: '<script>alert("x")</script>', payee: 'Supplier & Co',
  request_date: '2026-10-28', amount: 1500, cheque_number: 'CH-01', bir_reference: 'BIR-01',
  gross_amount: 1500, tax_deduction: 100, net_amount: 1400, released_date: null, released_to: '',
  document_routing_entries: [
    { stage: 'ACCOUNTING', received_date: '2026-10-28', created_at: '2026-10-28T03:00:00Z', remarks: 'Later <img src=x onerror=alert(1)>', handled_by: 'B' },
    { stage: 'P.R.', received_date: '2026-10-27', created_at: '2026-10-27T03:00:00Z', remarks: 'Earlier entry', handled_by: 'A' },
  ],
};
test('routing print includes saved payment and full chronological history, escaping stored text', () => {
  const html = load().routingDocumentPrintHtml(document);
  assert.ok(html.includes('Supplier &amp; Co'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('CH-01') && html.includes('BIR-01') && html.includes('1,400.00'));
  assert.ok(html.includes('Pending'));
  assert.ok(html.indexOf('Earlier entry') < html.indexOf('Later &lt;img'));
  assert.equal(document.document_routing_entries[0].stage, 'ACCOUNTING');
  assert.ok(html.includes('display:table-header-group'));
  assert.ok(load().routingDocumentPrintHtml({ ...document, document_routing_entries: [] }).includes('No office updates recorded.'));
});
test('routing print handles blocked pop-ups and opens only the formatted document', () => {
  assert.throws(() => load({ open: () => null }).printRoutingDocument(document), /Allow pop-ups/);
  let written = '', printed = false;
  const preview = { opener: {}, focus() {}, print() { printed = true; }, document: { open() {}, write(html) { written = html; }, close() {} } };
  load({ open: () => preview }).printRoutingDocument(document);
  assert.equal(preview.opener, null);
  assert.ok(written.startsWith('<!doctype html>'));
  assert.ok(printed);
});
