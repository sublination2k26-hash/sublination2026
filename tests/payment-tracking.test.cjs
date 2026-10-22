const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/lib/payment-tracking.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, { exports: exported, Date });
const { paymentTracking, customerPaymentSummaries } = exported;
const today = '2026-10-21';

test('tracks partial payments and removes overdue status after settlement', () => {
  const partial = paymentTracking(1000, [{ amount: 250 }], '2026-10-20', today);
  assert.equal(partial.balance, 750);
  assert.equal(partial.status, 'Overdue');
  const settled = paymentTracking(1000, [{ amount: 250 }, { amount: 750 }], '2026-10-20', today);
  assert.equal(settled.balance, 0);
  assert.equal(settled.status, 'Paid');
});

test('distinguishes due today, future deadlines, unset dates and cancellation', () => {
  assert.equal(paymentTracking(100, [], today, today).status, 'Due today');
  assert.equal(paymentTracking(100, [], '2026-10-22', today).status, 'Upcoming');
  assert.equal(paymentTracking(100, [], '', today).status, 'No due date');
  assert.equal(paymentTracking(100, [], '2026-10-20', today, true).balance, 0);
  assert.equal(paymentTracking(0.3, [{ amount: 0.1 }, { amount: 0.2 }], today, today).status, 'Paid');
});

test('customer totals keep namesakes separate and ignore cancelled debts', () => {
  const base = { customerId: 'a', customer: 'Same name', phone: '0911', total: 100, payments: [], paymentDue: '2026-10-20', status: 'in_production' };
  const summary = customerPaymentSummaries([
    base,
    { ...base, total: 200, payments: [{ amount: 50 }], paymentDue: '2026-10-25' },
    { ...base, total: 900, status: 'cancelled' },
    { ...base, customerId: 'b', phone: '0922', payments: [{ amount: 100 }] },
  ], [{ id: 'c', name: 'No orders', phone: '' }], today);
  const a = summary.find(customer => customer.id === 'a');
  assert.equal(a.balance, 250);
  assert.equal(a.overdue, 100);
  assert.equal(a.overdueOrders, 1);
  assert.equal(a.nextPaymentDue, '2026-10-20');
  assert.equal(summary.find(customer => customer.id === 'b').balance, 0);
  assert.equal(summary.find(customer => customer.id === 'c').orders, 0);
});

 test('customer summaries preserve contact details for customers with and without orders', () => {
  const result = customerPaymentSummaries([], [{ id: 'customer-1', name: 'Alex', phone: '09171234567', facebook: 'Alex Prints' }], today);
  assert.equal(result[0].phone, '09171234567');
  assert.equal(result[0].facebook, 'Alex Prints');
});
