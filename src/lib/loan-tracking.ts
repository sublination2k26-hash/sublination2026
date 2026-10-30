export type LoanPayment = {
  id: string; loan_id: string; paid_on: string; principal_amount: number;
  interest_amount: number; interest_due_date: string | null; notes: string; created_at: string;
};
export type PersonalLoan = {
  id: string; borrower_name: string; principal: number; start_date: string;
  first_due_date: string; due_day: number; monthly_interest: number;
  archived_at: string | null; created_at: string;
};
export const loanColumns = "id,borrower_name,principal,start_date,first_due_date,due_day,monthly_interest,archived_at,created_at";
export const loanPaymentColumns = "id,loan_id,paid_on,principal_amount,interest_amount,interest_due_date,notes,created_at";
export const manilaToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
export const cents = (amount: number) => Math.round(Number(amount) * 100);

// Each due date uses the original day, including after a short month.
export function monthlyDue(month: string, day: number, offset = 0) {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number + offset, 0));
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, last.getUTCDate())).padStart(2, "0")}`;
}

export function loanTracking(loan: PersonalLoan, allPayments: LoanPayment[], today: string) {
  const payments = allPayments.filter(payment => payment.loan_id === loan.id);
  const principalPaid = payments.reduce((sum, payment) => sum + cents(payment.principal_amount), 0);
  const principalBalance = Math.max(0, cents(loan.principal) - principalPaid);
  const payoffDate = principalBalance === 0
    ? payments.filter(payment => cents(payment.principal_amount) > 0).map(payment => payment.paid_on).sort().at(-1)
    : undefined;
  const cutoff = payoffDate && payoffDate < today ? payoffDate : today;
  const interestByDate = new Map<string, number>();
  for (const payment of payments) if (payment.interest_due_date) {
    interestByDate.set(payment.interest_due_date, (interestByDate.get(payment.interest_due_date) ?? 0) + cents(payment.interest_amount));
  }
  const installments: { due: string; balance: number; paid: number }[] = [];
  const [firstYear, firstMonth] = loan.first_due_date.split("-").map(Number);
  const [endYear, endMonth] = cutoff.split("-").map(Number);
  const months = (endYear - firstYear) * 12 + endMonth - firstMonth;
  for (let offset = 0; offset <= months; offset++) {
    const due = monthlyDue(loan.first_due_date, loan.due_day, offset);
    if (due > cutoff) break;
    const paid = interestByDate.get(due) ?? 0;
    installments.push({ due, balance: Math.max(0, cents(loan.monthly_interest) - paid) / 100, paid: paid / 100 });
  }
  const unpaid = installments.filter(installment => installment.balance > 0);
  const interestBalance = unpaid.reduce((sum, installment) => sum + cents(installment.balance), 0) / 100;
  let nextDue: string | null = null;
  if (principalBalance > 0 && cents(loan.monthly_interest) > 0) {
    nextDue = monthlyDue(today, loan.due_day);
    if (nextDue <= today) nextDue = monthlyDue(today, loan.due_day, 1);
    if (nextDue < loan.first_due_date) nextDue = loan.first_due_date;
  }
  const due = unpaid[0]?.due ?? nextDue;
  const settled = principalBalance === 0 && cents(interestBalance) === 0;
  const reminderEnd = new Date(`${today}T00:00:00Z`);
  reminderEnd.setUTCDate(reminderEnd.getUTCDate() + 7);
  const dueSoon = Boolean(due && due > today && due <= reminderEnd.toISOString().slice(0, 10));
  const lastPaymentDate = payments.map(payment => payment.paid_on).sort().at(-1) ?? null;
  const outstandingBalance = (principalBalance + cents(interestBalance)) / 100;
  const status = loan.archived_at ? "Archived" : settled ? "Fully paid" : unpaid.some(item => item.due < today) ? "Overdue" : unpaid.some(item => item.due === today) ? "Due today" : dueSoon ? "Due soon" : "Current";
  return { principalBalance: principalBalance / 100, interestBalance, installments, unpaid, nextDue, due, status, settled, lastPaymentDate, outstandingBalance };
}

