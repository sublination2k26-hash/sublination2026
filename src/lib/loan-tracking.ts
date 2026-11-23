export type LoanPayment = {
  id: string; loan_id: string; paid_on: string; principal_amount: number;
  interest_amount: number; daily_interest_amount?: number; interest_due_date: string | null; notes: string; created_at: string;
};
export type PersonalLoan = {
  id: string; borrower_name: string; principal: number; start_date: string;
  first_due_date: string; due_day: number; monthly_interest: number;
  interest_mode?: "one_time" | "monthly"; interest_rate?: number | null;
  supplier?: "MAGNUS" | "SUBLI-NATION" | null;
  archived_at: string | null; created_at: string;
};
export const loanColumns = "id,borrower_name,supplier,principal,start_date,first_due_date,due_day,monthly_interest,interest_mode,interest_rate,archived_at,created_at";
export const loanPaymentColumns = "id,loan_id,paid_on,principal_amount,interest_amount,interest_due_date,notes,created_at";
export const manilaToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
export const cents = (amount: number) => Math.round(Number(amount) * 100);

// Percentage input supports two decimals; round the result once to centavos.
export function monthlyInterestFromPercent(principal: number, percent: number) {
  if (!Number.isFinite(principal) || principal <= 0 || principal > 9999999999.99 ||
      !Number.isFinite(percent) || percent < 0 || percent > 9999999999.99) {
    throw new Error("Enter a valid principal and a non-negative interest percentage.");
  }
  const amount = Number((BigInt(cents(principal)) * BigInt(Math.round(percent * 100)) + BigInt(5000)) / BigInt(10000)) / 100;
  if (amount > 9999999999.99) throw new Error("Computed interest exceeds the allowed amount.");
  return amount;
}

// Each due date uses the original day, including after a short month.
export function monthlyDue(month: string, day: number, offset = 0) {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number + offset, 0));
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, last.getUTCDate())).padStart(2, "0")}`;
}

function dateDifference(start: string, end: string) {
  return Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000));
}

export function loanDuration(start: string, end: string) {
  const startDay = Number(start.slice(8));
  let months = Math.max(0, (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12
    + Number(end.slice(5, 7)) - Number(start.slice(5, 7)));
  while (months > 0 && monthlyDue(start, startDay, months) > end) months--;
  const anchor = monthlyDue(start, startDay, months);
  return { months, days: dateDifference(anchor, end) };
}

function dailyInterestAccrued(loan: PersonalLoan, asOf: string) {
  if (loan.interest_mode === "one_time" || cents(loan.monthly_interest) <= 0) return { days: 0, amount: 0 };
  const firstMonth = Number(loan.first_due_date.slice(0, 4)) * 12 + Number(loan.first_due_date.slice(5, 7));
  const targetMonth = Number(asOf.slice(0, 4)) * 12 + Number(asOf.slice(5, 7));
  let anchor = loan.start_date;
  for (let offset = Math.max(0, targetMonth - firstMonth); offset >= 0; offset--) {
    const due = monthlyDue(loan.first_due_date, loan.due_day, offset);
    if (due <= asOf) { anchor = due; break; }
  }
  const days = dateDifference(anchor, asOf);
  return { days, amount: cents(Number(loan.monthly_interest) / 30 * days) / 100 };
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
  const oneTime = loan.interest_mode === "one_time";
  if (oneTime) {
    const paid = interestByDate.get(loan.first_due_date) ?? 0;
    installments.push({ due: loan.first_due_date, balance: Math.max(0, cents(loan.monthly_interest) - paid) / 100, paid: paid / 100 });
  }
  for (let offset = 0; !oneTime && offset <= months; offset++) {
    const due = monthlyDue(loan.first_due_date, loan.due_day, offset);
    if (due > cutoff) break;
    const paid = interestByDate.get(due) ?? 0;
    installments.push({ due, balance: Math.max(0, cents(loan.monthly_interest) - paid) / 100, paid: paid / 100 });
  }
  const unpaid = installments.filter(installment => installment.balance > 0);
  const interestBalance = unpaid.reduce((sum, installment) => sum + cents(installment.balance), 0) / 100;
  const daily = dailyInterestAccrued(loan, cutoff);
  const dailyPaid = payments.reduce((sum, payment) => sum + cents(payment.daily_interest_amount ?? 0), 0);
  const dailyInterestBalance = Math.max(0, cents(daily.amount) - dailyPaid) / 100;
  let nextDue: string | null = null;
  if (!oneTime && principalBalance > 0 && cents(loan.monthly_interest) > 0) {
    nextDue = monthlyDue(today, loan.due_day);
    if (nextDue <= today) nextDue = monthlyDue(today, loan.due_day, 1);
    if (nextDue < loan.first_due_date) nextDue = loan.first_due_date;
  }
  const due = unpaid[0]?.due ?? (oneTime && principalBalance > 0 ? loan.first_due_date : nextDue);
  const settled = principalBalance === 0 && cents(interestBalance) === 0 && cents(dailyInterestBalance) === 0;
  const reminderEnd = new Date(`${today}T00:00:00Z`);
  reminderEnd.setUTCDate(reminderEnd.getUTCDate() + 7);
  const dueSoon = Boolean(due && due > today && due <= reminderEnd.toISOString().slice(0, 10));
  const lastPaymentDate = payments.map(payment => payment.paid_on).sort().at(-1) ?? null;
  const outstandingBalance = (principalBalance + cents(interestBalance) + cents(dailyInterestBalance)) / 100;
  const status = loan.archived_at ? "Archived" : settled ? "Fully paid" : (unpaid.some(item => item.due < today) || (oneTime && principalBalance > 0 && loan.first_due_date < today)) ? "Overdue" : (unpaid.some(item => item.due === today) || (oneTime && principalBalance > 0 && loan.first_due_date === today)) ? "Due today" : dueSoon ? "Due soon" : "Current";
  const duration = loanDuration(loan.start_date, cutoff);
  return { principalBalance: principalBalance / 100, interestBalance, dailyInterestBalance, dailyDays: daily.days, duration, installments, unpaid, nextDue, due, status, settled, lastPaymentDate, outstandingBalance };
}

