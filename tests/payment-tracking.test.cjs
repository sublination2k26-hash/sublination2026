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

test('settlement automatically leaves pending payments and completed paid jobs enter their records folder',()=>{
  const order={total:300,status:'in_production',payments:[{amount:100}]};
  assert.equal(exported.paymentRecordGroup(order),'outstanding');
  order.payments.push({amount:200});
  assert.equal(exported.paymentRecordGroup(order),'paid');
  order.status='ready_for_release';assert.equal(exported.paymentRecordGroup(order),'completed_paid');
  order.status='released';assert.equal(exported.paymentRecordGroup(order),'completed_paid');
  assert.equal(exported.paymentRecordGroup({...order,payments:[{amount:100}]}),'outstanding');
  assert.equal(exported.paymentRecordGroup({...order,status:'cancelled'}),'cancelled');
  assert.equal(exported.paymentRecordGroup({...order,total:0.3,payments:[{amount:0.1},{amount:0.2}]}),'completed_paid');
  assert.equal(exported.paymentRecordGroup({total:500,status:'pending',payments:[]}),'outstanding');
});

test('all dated customer down payments remain separate and aggregate without mixing customers or balance payments',()=>{
  const payments=[
    {id:'c',amount:500,date:'2026-10-26',kind:'down_payment',method:'Cash',note:'Third deposit',recordedAt:'2026-10-29T03:00:00Z'},
    {id:'a',amount:1000,date:'2026-10-11',kind:'down_payment',method:'Cash',note:'First deposit',recordedAt:'2026-10-29T01:00:00Z'},
    {id:'b',amount:1500,date:'2026-10-20',kind:'down_payment',method:'GCash',note:'Second deposit',recordedAt:'2026-10-29T02:00:00Z'},
    {id:'d',amount:2000,date:'2026-10-27',kind:'payment',method:'Cash',note:'Balance',recordedAt:'2026-10-29T04:00:00Z'},
  ];
  const orders=[{id:'JO-1',customerId:'a',customer:'Alex',payments},{id:'JO-2',customerId:'b',customer:'Alex',payments:[{...payments[0],id:'other'}]}];
  const history=exported.customerPaymentHistory(orders,'a');
  assert.deepEqual(Array.from(history,row=>row.date),['2026-10-11','2026-10-20','2026-10-26','2026-10-27']);
  assert.equal(exported.downPayment(history),3000);
  assert.equal(history.reduce((sum,row)=>sum+row.amount,0),5000);
  assert.equal(exported.customerPaymentHistory(orders).length,5);
  assert.equal(payments[0].id,'c');
});

test('customer downpayment includes deposits only, while total paid includes follow-up payments', () => {
  const [customer] = customerPaymentSummaries([
    { customerId: 'a', customer: 'Alex', phone: '', total: 1000, paymentDue: '', status: 'confirmed', payments: [{ amount: 200, note: 'Initial down payment' }, { amount: 300, note: 'Follow-up' }] },
    { customerId: 'a', customer: 'Alex', phone: '', total: 500, paymentDue: '', status: 'confirmed', payments: [{ amount: 100, note: 'Initial down payment' }] },
  ], [], today);
  assert.equal(customer.downpayment, 300);
  assert.equal(customer.paid, 600);
  assert.equal(customer.balance, 900);
});

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
