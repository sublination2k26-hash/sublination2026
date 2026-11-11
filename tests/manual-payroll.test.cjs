const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/manual-payroll.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api });
test('manual daily pay supports full and partial days without attendance', () => {
  assert.equal(api.manualDailyPay('600', '10'), 6000);
  assert.equal(api.manualDailyPay('600', '10.5'), 6300);
  assert.equal(api.manualDailyPay('550.25', '2.5'), 1375.63);
  assert.equal(api.manualDailyPay('0', '10'), 0);
});
test('manual daily pay rejects missing, negative, and nonfinite entries', () => {
  for (const [rate, days] of [['', '10'], ['600', ''], ['600', '0'], ['-1', '2'], ['600', '-2'], ['Infinity', '2'], ['abc', '2']]) assert.ok(Number.isNaN(api.manualDailyPay(rate, days)));
});
