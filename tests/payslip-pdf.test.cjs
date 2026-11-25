const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

test('payslip PDF downloads a valid cross-reference structure and renders saved Unicode details', async () => {
  const source = ts.transpileModule(fs.readFileSync('src/lib/payslip-pdf.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const rendered = [];
  let blob, clicked = false;
  const link = { click() { clicked = true; } };
  const context = {
    exports: {}, Blob, Uint8Array, atob,
    setTimeout: () => 0,
    require: name => {
      assert.equal(name, './attendance');
      return { money: value => `₱${Number(value).toFixed(2)}` };
    },
    URL: { createObjectURL(value) { blob = value; return 'blob:test'; }, revokeObjectURL() {} },
    document: { createElement(tag) {
      if (tag === 'a') return link;
      assert.equal(tag, 'canvas');
      return { getContext: () => ({ fillRect() {}, fillText: text => rendered.push(text) }), toDataURL: () => 'data:image/jpeg;base64,/9j/2Q==' };
    } },
  };
  vm.runInNewContext(source, context);
  context.exports.downloadPayslip({payslip_no:7,employee_name:'José Dela Peña',issue_date:'2026-10-28',period_start:'2026-10-01',period_end:'2026-10-15',basic_pay:500,production_pay:20,artist_layout_count:2,artist_layout_unit_rate:150,artist_layout_pay:300,sss:20,net_pay:800}, {basic_pay:'Basic pay',production_pay:'Production pay',artist_layout_pay:'Artist layout pay',sss:'SSS'}, 'Artist');
  assert.ok(clicked);
  assert.equal(link.download, 'PS-007.pdf');
  assert.equal(blob.type, 'application/pdf');
  assert.ok(rendered.includes('Employee: José Dela Peña'));
  assert.ok(rendered.includes('Artist layouts: 2 × ₱150.00'));
  assert.ok(rendered.includes('NET PAY: ₱800.00'));
  const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  const xrefOffset = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.ok(pdf.slice(xrefOffset).startsWith('xref\n0 6\n'));
  const entries = pdf.slice(xrefOffset).split('\n').slice(3, 8);
  entries.forEach((entry, i) => assert.ok(pdf.slice(Number(entry.slice(0, 10))).startsWith(`${i + 1} 0 obj\n`)));
  assert.ok(pdf.endsWith('%%EOF'));
});
