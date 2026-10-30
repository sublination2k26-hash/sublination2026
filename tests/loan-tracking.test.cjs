const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/loan-tracking.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported, Date, Intl });
const { monthlyDue, loanTracking } = exported;
const loan = { id: 'a', borrower_name: 'Ana', principal: 1000, monthly_interest: 100,
  start_date: '2026-01-31', first_due_date: '2026-02-28', due_day: 31, archived_at: null };
const payment = (id, date, principal, interest, due = null) => ({ id, loan_id: 'a', paid_on: date,
  principal_amount: principal, interest_amount: interest, interest_due_date: due });

test('month-end deadlines recover original day after short months, including leap years', () => {
  assert.equal(monthlyDue('2026-01-31', 31, 1), '2026-02-28');
  assert.equal(monthlyDue('2026-02-28', 31, 1), '2026-03-31');
  assert.equal(monthlyDue('2028-01-31', 31, 1), '2028-02-29');
  assert.equal(monthlyDue('2026-12-31', 31, 1), '2027-01-31');
});
test('distinguishes upcoming, due today and overdue; unpaid months carry forward', () => {
  assert.equal(loanTracking(loan, [], '2026-02-27').status, 'Due soon');
  assert.equal(loanTracking(loan, [], '2026-02-28').status, 'Due today');
  const result = loanTracking(loan, [], '2026-04-30');
  assert.equal(result.status, 'Overdue');
  assert.equal(result.interestBalance, 300);
  assert.equal(result.due, '2026-02-28');
  assert.equal(result.nextDue, '2026-05-31');
});
test('partial and late interest payments belong to their selected month, never another borrower', () => {
  const records = [payment('1', '2026-03-01', 100, 30, '2026-02-28'),
    payment('2', '2026-03-31', 0, 50, '2026-03-31'),
    { ...payment('other', '2026-03-01', 900, 70, '2026-02-28'), loan_id: 'b' }];
  const result = loanTracking(loan, records, '2026-03-31');
  assert.equal(result.principalBalance, 900);
  assert.equal(result.interestBalance, 120);
  assert.equal(result.unpaid[0].balance, 70);
  assert.equal(result.status, 'Overdue');
});
test('full principal payoff stops new interest but retains old unpaid interest until settled', () => {
  const records = [payment('1', '2026-03-10', 1000, 0)];
  const result = loanTracking(loan, records, '2026-07-01');
  assert.equal(result.interestBalance, 100);
  assert.equal(result.principalBalance, 0);
  assert.equal(result.settled, false);
  assert.equal(result.nextDue, null);
  records.push(payment('2', '2026-07-01', 0, 100, '2026-02-28'));
  assert.equal(loanTracking(loan, records, '2026-07-01').status, 'Fully paid');
  assert.equal(loanTracking({ ...loan, archived_at: '2026-07-01' }, records, '2026-07-01').status, 'Archived');
});
test('payoff on a due date includes that month, and decimal payments use cent precision', () => {
  const records = [payment('1', '2026-03-31', 999.9, 100, '2026-02-28'), payment('2', '2026-03-31', 0.1, 99.9, '2026-03-31')];
  const result = loanTracking(loan, records, '2026-07-01');
  assert.equal(result.principalBalance, 0);
  assert.equal(result.interestBalance, 0.1);
  records.push(payment('3', '2026-04-01', 0, 0.1, '2026-03-31'));
  assert.equal(loanTracking(loan, records, '2026-07-01').settled, true);
});
test('interest-free loans keep principal due without fake overdue interest', () => {
  const result = loanTracking({ ...loan, monthly_interest: 0 }, [], '2026-07-01');
  assert.equal(result.interestBalance, 0);
  assert.equal(result.settled, false);
  assert.equal(result.nextDue, null);
  assert.equal(result.status, 'Current');
});

 test('seven-day reminders and payment summary stay specific to the borrower', () => {
  assert.equal(loanTracking(loan, [], '2026-02-20').status, 'Current');
  assert.equal(loanTracking(loan, [], '2026-02-21').status, 'Due soon');
  const result = loanTracking(loan, [payment('1', '2026-03-01', 200, 40, '2026-02-28')], '2026-03-02');
  assert.equal(result.lastPaymentDate, '2026-03-01');
  assert.equal(result.outstandingBalance, 860);
 });
