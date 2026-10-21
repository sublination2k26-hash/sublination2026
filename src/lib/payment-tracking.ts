export function manilaToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

export function paymentTracking(total: number, payments: { amount: number }[], due: string, today = manilaToday(), cancelled = false) {
  const paid = Math.round(payments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
  const balance = cancelled ? 0 : Math.max(0, Math.round((total - paid) * 100) / 100);
  const status = cancelled ? "Cancelled" : balance === 0 ? "Paid" : !due ? "No due date" : due < today ? "Overdue" : due === today ? "Due today" : "Upcoming";
  return { paid, balance, status, overdue: status === "Overdue" };
}

type PaymentOrder = { customerId: string; customer: string; phone: string; total: number; payments: { amount: number }[]; paymentDue: string; status: string };
export type CustomerPaymentSummary = { id: string; name: string; phone: string; orders: number; spent: number; balance: number; overdue: number; overdueOrders: number; nextPaymentDue: string };

export function customerPaymentSummaries(orders: PaymentOrder[], directory: { id: string; name: string; phone: string }[], today = manilaToday()): CustomerPaymentSummary[] {
  const customers = new Map<string, CustomerPaymentSummary>();
  const ensure = (id: string, name: string, phone: string) => {
    if (!customers.has(id)) customers.set(id, { id, name, phone, orders: 0, spent: 0, balance: 0, overdue: 0, overdueOrders: 0, nextPaymentDue: "" });
    return customers.get(id)!;
  };
  directory.forEach(customer => ensure(customer.id, customer.name, customer.phone));
  orders.forEach(order => {
    const customer = ensure(order.customerId, order.customer, order.phone);
    customer.orders++;
    if (order.status === "cancelled") return;
    customer.spent += order.total;
    const tracking = paymentTracking(order.total, order.payments, order.paymentDue, today);
    customer.balance += tracking.balance;
    if (tracking.overdue) { customer.overdue += tracking.balance; customer.overdueOrders++; }
    if (tracking.balance > 0 && order.paymentDue && (!customer.nextPaymentDue || order.paymentDue < customer.nextPaymentDue)) customer.nextPaymentDue = order.paymentDue;
  });
  return [...customers.values()].map(customer => ({ ...customer, spent: Math.round(customer.spent * 100) / 100, balance: Math.round(customer.balance * 100) / 100, overdue: Math.round(customer.overdue * 100) / 100 }));
}
