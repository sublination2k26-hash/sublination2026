const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/loan-tracking.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported, Date, Intl });
const { monthlyDue, firstRepaymentDate, repaymentDueDate, equalInstallmentPreview, loanInstallmentPlan, loanDuration, loanTracking } = exported;
test('monthly percentage automatically computes peso interest with centavo rounding', () => {
  const calculate = exported.monthlyInterestFromPercent;
  assert.equal(calculate(50000, 12), 6000);
  assert.equal(calculate(50000, 1.5), 750);
  assert.equal(calculate(1234.56, 2.75), 33.95);
  assert.equal(calculate(1, 0.5), 0.01);
  assert.equal(calculate(50000, 0), 0);
  assert.throws(() => calculate(0, 12), /valid principal/);
  assert.throws(() => calculate(50000, -1), /non-negative/);
  assert.throws(() => calculate(50000, NaN), /non-negative/);
  assert.throws(() => calculate(Infinity, 12), /valid principal/);
  assert.throws(() => calculate(9999999999.99, 200), /exceeds/);
});
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
test('daily, weekly and monthly repayment schedules preserve the first date and interval', () => {
  assert.equal(firstRepaymentDate('2026-01-31', 31, 'daily'), '2026-02-01');
  assert.equal(firstRepaymentDate('2026-01-31', 31, 'weekly'), '2026-02-07');
  assert.equal(firstRepaymentDate('2026-01-31', 31, 'monthly'), '2026-02-28');
  assert.equal(repaymentDueDate('2026-02-28', 31, 'weekly', 2), '2026-03-14');
  assert.equal(repaymentDueDate('2026-01-31', 31, 'monthly', 1), '2026-02-28');
});
test('equal installment preview prorates the monthly interest and adjusts centavos', () => {
  assert.deepEqual({ ...equalInstallmentPreview(1000, 30, 'daily', 3) }, { interest: 1, first: 334.34, last: 334.33 });
  assert.deepEqual({ ...equalInstallmentPreview(1000, 30, 'weekly', 3) }, { interest: 7, first: 340.34, last: 340.33 });
  assert.deepEqual({ ...equalInstallmentPreview(1000, 30, 'monthly', 3) }, { interest: 30, first: 363.34, last: 363.33 });
  assert.throws(() => equalInstallmentPreview(1000, 30, 'weekly', 0), /installments/);
});
test('scheduled loan tracking reports recurring due dates and remaining installment balances', () => {
  const scheduled = { ...loan, principal: 1000, monthly_interest: 30, first_due_date: '2026-02-07',
    due_day: 7, repayment_frequency: 'weekly', installment_count: 3, interest_mode: 'monthly' };
  const plan = loanInstallmentPlan(scheduled);
  assert.deepEqual([...plan.map(item => item.due)], ['2026-02-07', '2026-02-14', '2026-02-21']);
  const before = loanTracking(scheduled, [], '2026-02-07');
  assert.equal(before.installments.length, 3);
  assert.equal(before.installments[0].totalDue, 340.34);
  assert.equal(before.interestBalance, 7);
  const paid = loanTracking(scheduled, [
    { ...payment('first', '2026-02-07', 333.34, 7, '2026-02-07'), source: 'installment' },
  ], '2026-02-07');
  assert.equal(paid.principalBalance, 666.66);
  assert.equal(paid.interestBalance, 0);
  assert.equal(paid.installments[0].balance, 0);
  assert.equal(paid.due, '2026-02-14');
});
test('scheduled full payoff settles accrued installments and prorated daily interest without future charges', () => {
  const scheduled = { ...loan, principal: 1000, monthly_interest: 30, first_due_date: '2026-02-07',
    due_day: 7, repayment_frequency: 'weekly', installment_count: 3, interest_mode: 'monthly' };
  const payments = [
    { ...payment('first', '2026-02-07', 333.34, 7, '2026-02-07'), source: 'installment' },
    { ...payment('next-interest', '2026-02-17', 0, 7, '2026-02-14'), source: 'installment' },
    { ...payment('payoff-principal', '2026-02-17', 666.66), source: 'installment' },
    { ...payment('daily', '2026-02-17', 0, 0), daily_interest_amount: 3, source: 'installment' },
  ];
  const result = loanTracking(scheduled, payments, '2026-02-17');
  assert.equal(result.principalBalance, 0);
  assert.equal(result.interestBalance, 0);
  assert.equal(result.dailyInterestBalance, 0);
  assert.equal(result.outstandingBalance, 0);
  assert.equal(result.settled, true);
  assert.equal(result.installments[2].balance, 0);
});
test('loan duration and extra monthly days compute simple daily interest at monthly rate divided by thirty', () => {
  const result = loanTracking(loan, [], '2026-03-05');
  assert.deepEqual({ ...loanDuration('2026-01-31', '2026-03-05') }, { months: 1, days: 5 });
  assert.equal(result.dailyDays, 5);
  assert.equal(result.dailyInterestBalance, 16.67);
  assert.equal(result.outstandingBalance, 1116.67);
  assert.equal(loanTracking({ ...loan, interest_mode: 'one_time' }, [], '2026-03-05').dailyInterestBalance, 0);
});
test('daily interest and monthly interest together settle through the payoff date', () => {
  const records = [
    payment('monthly', '2026-03-05', 0, 100, '2026-02-28'),
    { ...payment('principal', '2026-03-05', 1000, 0), daily_interest_amount: 16.67 },
  ];
  const result = loanTracking(loan, records, '2026-03-05');
  assert.equal(result.dailyInterestBalance, 0);
  assert.equal(result.principalBalance, 0);
  assert.equal(result.interestBalance, 0);
  assert.equal(result.settled, true);
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
  assert.equal(result.dailyInterestBalance, 33.33);
  assert.equal(result.principalBalance, 0);
  assert.equal(result.settled, false);
  assert.equal(result.nextDue, null);
  records.push(payment('2', '2026-07-01', 0, 100, '2026-02-28'));
  assert.equal(loanTracking(loan, records, '2026-07-01').settled, false);
  records.push({ ...payment('3', '2026-07-01', 0, 0), daily_interest_amount: 33.33 });
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
  assert.equal(result.outstandingBalance, 866.67);
 });

test('one-time interest is charged once, including before its due date and after early payoff', () => {
  const once = { ...loan, principal: 50000, monthly_interest: 6000, interest_mode: 'one_time', interest_rate: 12 };
  assert.equal(loanTracking(once, [], '2026-02-01').outstandingBalance, 56000);
  assert.equal(loanTracking(once, [], '2026-07-01').interestBalance, 6000);
  const records = [payment('early', '2026-02-01', 50000, 0)];
  assert.equal(loanTracking(once, records, '2026-07-01').settled, false);
  records.push(payment('interest', '2026-02-02', 0, 6000, '2026-02-28'));
  assert.equal(loanTracking(once, records, '2026-07-01').settled, true);
  assert.equal(loanTracking({ ...once, monthly_interest: 0 }, [], '2026-07-01').status, 'Overdue');
});
