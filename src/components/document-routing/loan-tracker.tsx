"use client";

import { SearchableList } from "@/components/ui/searchable-list";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { readAllRows } from "@/lib/workspace-loading";
import { cents, equalInstallmentPreview, firstRepaymentDate, installmentInterestAmount, loanColumns, loanPaymentColumns, loanTracking, manilaToday, monthlyDue, monthlyInterestFromPercent, type LoanPayment, type PersonalLoan, type RepaymentFrequency } from "@/lib/loan-tracking";
import "./loan-tracker.css";

const money = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : typeof cause === "object" && cause && "message" in cause ? String(cause.message) : "Could not save. Please try again.";
const suppliers = ["MAGNUS", "SUBLI-NATION"] as const;
const dailyPaymentColumns = "id,loan_id,paid_on,amount,notes,created_at";
const installmentPaymentColumns = "id,loan_id,paid_on,installment_due_date,installment_number,principal_amount,interest_amount,daily_interest_amount,notes,created_at";

export function DocumentRoutingWorkspace({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState("documents");
  return <div className="routing-workspace">
    <div className="loan-tabs" role="group" aria-label="Document Routing sections">
      <button type="button" className="secondary-button" aria-pressed={tab === "documents"} onClick={() => setTab("documents")}>Document register</button>
      <button type="button" className="secondary-button" aria-pressed={tab === "loans"} onClick={() => setTab("loans")}>Loan reminders / Mga pautang</button>
    </div>
    <div hidden={tab !== "documents"}>{children}</div>
    {tab === "loans" && <LoanTracker/>}
  </div>;
}

function LoanTracker() {
  const [loans, setLoans] = useState<PersonalLoan[]>([]);
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [today, setToday] = useState(manilaToday);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [principalInput, setPrincipalInput] = useState("");
  const [repaymentFrequency, setRepaymentFrequency] = useState<RepaymentFrequency>("monthly");
  const [installmentCount, setInstallmentCount] = useState("12");
  const [interestPercent, setInterestPercent] = useState("0");
  let computedInterest: number | null = null;
  try { computedInterest = monthlyInterestFromPercent(Number(principalInput), Number(interestPercent)); } catch { /* Preview waits for valid inputs. */ }
  let installmentPreview: ReturnType<typeof equalInstallmentPreview> | null = null;
  try {
    if (principalInput && Number(installmentCount) > 0) {
      installmentPreview = equalInstallmentPreview(Number(principalInput), computedInterest ?? 0, repaymentFrequency, Number(installmentCount));
    }
  } catch { /* Preview waits for valid inputs. */ }
  const [start, setStart] = useState(manilaToday);
  const [firstDue, setFirstDue] = useState(() => firstRepaymentDate(manilaToday(), Number(manilaToday().slice(8)), "monthly"));
  const [dueDay, setDueDay] = useState(() => Number(manilaToday().slice(8)));
  const [interestDate, setInterestDate] = useState("");
  const requestId = useRef<string | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  async function load() {
    const db = createClient();
    const [records, history, dailyHistory, installmentHistory] = await Promise.all([
      readAllRows<PersonalLoan>((from, to) => db.from("personal_loans").select(loanColumns).order("created_at", { ascending: false }).order("id").range(from, to)),
      readAllRows<LoanPayment>((from, to) => db.from("personal_loan_payments").select(loanPaymentColumns).order("paid_on").order("id").range(from, to)),
      readAllRows<{ id: string; loan_id: string; paid_on: string; amount: number; notes: string; created_at: string }>((from, to) => db.from("personal_loan_daily_interest_payments").select(dailyPaymentColumns).order("paid_on").order("id").range(from, to)),
      readAllRows<{ id: string; loan_id: string; paid_on: string; installment_due_date: string | null; installment_number: number | null; principal_amount: number; interest_amount: number; daily_interest_amount: number; notes: string; created_at: string }>((from, to) => db.from("personal_loan_installment_payments").select(installmentPaymentColumns).order("paid_on").order("id").range(from, to)),
    ]);
    const installmentPayments: LoanPayment[] = installmentHistory.map(payment => ({
      id: payment.id, loan_id: payment.loan_id, paid_on: payment.paid_on,
      principal_amount: Number(payment.principal_amount), interest_amount: Number(payment.interest_amount),
      daily_interest_amount: Number(payment.daily_interest_amount), interest_due_date: payment.installment_due_date,
      notes: payment.notes, created_at: payment.created_at, source: "installment",
    }));
    const dailyPayments: LoanPayment[] = dailyHistory.map(payment => ({
      id: payment.id, loan_id: payment.loan_id, paid_on: payment.paid_on, principal_amount: 0,
      interest_amount: 0, daily_interest_amount: Number(payment.amount), interest_due_date: null,
      notes: payment.notes, created_at: payment.created_at, source: "daily",
    }));
    setLoans(records); setPayments([...history.map(payment => ({ ...payment, source: "legacy" as const })), ...dailyPayments, ...installmentPayments]); setLoaded(true); setToday(manilaToday());
  }
  useEffect(() => {
    let active = true;
    load().catch(cause => { if (active) setError(errorMessage(cause)); });
    const refreshDate = () => setToday(manilaToday());
    window.addEventListener("focus", refreshDate);
    const interval = window.setInterval(refreshDate, 60000);
    return () => { active = false; window.removeEventListener("focus", refreshDate); window.clearInterval(interval); };
  }, []);
  useEffect(() => { if (selected) detailHeading.current?.focus(); }, [selected]);
  const loan = loans.find(item => item.id === selected);
  const tracking = loan ? loanTracking(loan, payments, today) : null;
  const selectedInstallment = loan?.repayment_frequency
    ? tracking?.installments.find(item => item.due === interestDate)
    : undefined;
  const scheduledPrincipalRemaining = selectedInstallment
    ? Math.max(0, cents(selectedInstallment.principalDue ?? 0) - cents(selectedInstallment.principalPaid ?? 0)) / 100
    : 0;
  const scheduledInterestRemaining = selectedInstallment
    ? Math.max(0, cents(selectedInstallment.interestDue ?? 0) - cents(selectedInstallment.interestPaid ?? 0)) / 100
    : 0;
  const selectedInterestRemaining = loan?.repayment_frequency
    ? scheduledInterestRemaining
    : tracking?.unpaid.find(item => item.due === interestDate)?.balance ?? 0;
  const history = payments.filter(payment => payment.loan_id === selected).sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at));
  const summaries = useMemo(() => {
    const grouped = new Map<string, LoanPayment[]>();
    for (const payment of payments) {
      const group = grouped.get(payment.loan_id) ?? [];
      group.push(payment); grouped.set(payment.loan_id, group);
    }
    return loans.map(item => ({ loan: item, tracking: loanTracking(item, grouped.get(item.id) ?? [], today) }));
  }, [loans, payments, today]);
  const overdue = summaries.filter(item => !item.loan.archived_at && item.tracking.status === "Overdue");
  const dueToday = summaries.filter(item => !item.loan.archived_at && item.tracking.status === "Due today");
  const dueSoon = summaries.filter(item => !item.loan.archived_at && item.tracking.status === "Due soon");
  const shown = summaries.filter(item => item.loan.borrower_name.toLowerCase().includes(query.toLowerCase()) &&
    (filter === "archived" ? Boolean(item.loan.archived_at) || item.tracking.settled : !item.loan.archived_at && !item.tracking.settled && (filter !== "overdue" || item.tracking.status === "Overdue")))
    .sort((a, b) => Number(b.tracking.status === "Overdue") - Number(a.tracking.status === "Overdue") || (a.tracking.due ?? "9999").localeCompare(b.tracking.due ?? "9999"));
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { working.current = false; setBusy(false); }
  }
  async function refresh() { await run(load); }
  function choose(item: PersonalLoan) {
    setSelected(item.id); setAdding(false); requestId.current = null;
    const tracking = loanTracking(item, payments, today);
    setInterestDate(item.repayment_frequency
      ? tracking.installments.find(installment => installment.due <= today && installment.balance > 0)?.due ?? ""
      : tracking.unpaid[0]?.due ?? "");
    setError(""); setNotice("");
  }
  async function createLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = requestId.current ?? crypto.randomUUID(); requestId.current = id;
    await run(async () => {
      const db = createClient();
      const values = { id, borrower_name: String(data.get("borrower_name")).trim(), principal: Number(data.get("principal")), start_date: start,
        supplier: String(data.get("supplier") ?? ""), first_due_date: firstDue, due_day: dueDay, interest_mode: "monthly",
        repayment_frequency: repaymentFrequency, installment_count: Number(installmentCount),
        interest_rate: Number(data.get("interest_percent")), monthly_interest: monthlyInterestFromPercent(Number(data.get("principal")), Number(data.get("interest_percent"))) };
      const { data: saved, error: cause } = await db.from("personal_loans").insert(values).select(loanColumns).single();
      if (cause && cause.code !== "23505") throw cause;
      const result = saved ?? (await db.from("personal_loans").select(loanColumns).eq("id", id).single()).data;
      if (!result) throw new Error("Could not confirm the loan. Retry saving.");
      setLoans(current => [result as PersonalLoan, ...current.filter(item => item.id !== id)]);
      setAdding(false); requestId.current = null; setSelected(id); setInterestDate(firstDue); setNotice("Loan saved / Naitala ang pautang.");
    });
  }
  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!loan) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const id = requestId.current ?? crypto.randomUUID(); requestId.current = id;
    await run(async () => {
      const interest = Number(data.get("interest_amount"));
      const db = createClient();
      if (loan.repayment_frequency) {
        const { error: cause } = await db.rpc("record_personal_loan_installment_payment", {
          p_loan_id: loan.id, p_due_date: interestDate, p_paid_on: String(data.get("paid_on")),
          p_principal_amount: Number(data.get("principal_amount")), p_interest_amount: interest,
          p_notes: String(data.get("notes")).trim(), p_request_id: id,
        });
        if (cause) throw cause;
        await load();
        requestId.current = null; form.reset(); setNotice("Scheduled installment payment recorded / Naitala ang bayad.");
        return;
      }
      const { data: saved, error: cause } = await db.from("personal_loan_payments").insert({ id, loan_id: loan.id,
        paid_on: String(data.get("paid_on")), principal_amount: Number(data.get("principal_amount")), interest_amount: interest,
        interest_due_date: interest > 0 ? interestDate : null, notes: String(data.get("notes")).trim(),
      }).select(loanPaymentColumns).single();
      if (cause && cause.code !== "23505") throw cause;
      const result = saved ?? (await db.from("personal_loan_payments").select(loanPaymentColumns).eq("id", id).single()).data;
      if (!result) throw new Error("Could not confirm the payment. Retry saving.");
      const next = [...payments.filter(payment => payment.id !== id), result as LoanPayment];
      setPayments(next); setInterestDate(loanTracking(loan, next, today).unpaid[0]?.due ?? "");
      requestId.current = null; form.reset(); setNotice("Payment recorded / Naitala ang bayad.");
    });
  }
  async function archive() {
    if (!loan) return;
    await run(async () => {
      const { data, error: cause } = await createClient().from("personal_loans").update({ archived_at: loan.archived_at ? null : new Date().toISOString() }).eq("id", loan.id).select(loanColumns).single();
      if (cause) throw cause;
      setLoans(current => current.map(item => item.id === loan.id ? data as PersonalLoan : item));
      setSelected(null); setNotice(loan.archived_at ? "Loan restored to the active list." : "Fully paid loan removed from active reminders. History is in Archived / Paid.");
    });
  }
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!loan) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("borrower_name") ?? "").trim();
    const supplier = String(data.get("supplier") ?? "");
    await run(async () => {
      const { data: saved, error: cause } = await createClient().from("personal_loans").update({ borrower_name: name, supplier }).eq("id", loan.id).select(loanColumns).single();
      if (cause) throw cause;
      setLoans(current => current.map(item => item.id === loan.id ? saved as PersonalLoan : item));
      setNotice("Borrower and supplier updated.");
    });
  }
  async function removeLoan() {
    if (!loan || !window.confirm(`Permanently delete the loan for ${loan.borrower_name} and all its payments?`)) return;
    await run(async () => {
      const { error: cause } = await createClient().rpc("delete_personal_loan", { p_id: loan.id });
      if (cause) throw cause;
      setLoans(current => current.filter(item => item.id !== loan.id));
      setPayments(current => current.filter(item => item.loan_id !== loan.id));
      setSelected(null); requestId.current = null; setNotice("Loan and payment history deleted.");
    });
  }
  async function undo(payment: LoanPayment) {
    const dailyInterest = Number(payment.daily_interest_amount ?? 0);
    if (!window.confirm(`Remove this payment of ${money(Number(payment.principal_amount) + Number(payment.interest_amount) + dailyInterest)}? The unpaid balance and reminders will be restored.`)) return;
    await run(async () => {
      const db = createClient();
      if (payment.source === "installment") {
        const { error: cause } = await db.rpc("delete_personal_loan_installment_payment", { p_payment_id: payment.id });
        if (cause) throw cause;
        await load();
        setNotice("Payment removed. Balances updated.");
        return;
      }
      const result = dailyInterest
        ? await db.from("personal_loan_daily_interest_payments").delete().eq("id", payment.id).select("id").single()
        : await db.from("personal_loan_payments").delete().eq("id", payment.id).select("id").single();
      const { data, error: cause } = result;
      if (cause || !data) throw cause ?? new Error("Payment was not removed. Refresh and retry.");
      const next = payments.filter(item => item.id !== payment.id); setPayments(next);
      if (loan) setInterestDate(loanTracking(loan, next, today).unpaid[0]?.due ?? "");
      setNotice("Payment removed. Balances updated.");
    });
  }
  async function recordFullPayoff() {
    if (!loan || !tracking || !window.confirm(`Record full payoff of ${money(tracking.outstandingBalance)} for ${loan.borrower_name} today? This includes remaining principal, scheduled interest and daily interest.`)) return;
    const id = requestId.current ?? crypto.randomUUID(); requestId.current = id;
    await run(async () => {
      const { error: cause } = await createClient().rpc(loan.repayment_frequency ? "record_personal_loan_scheduled_payoff" : "record_personal_loan_payoff", {
        p_loan_id: loan.id, p_paid_on: today, p_request_id: id,
      });
      if (cause) throw cause;
      await load();
      requestId.current = null;
      setNotice("Full payment recorded. The loan is now settled / Nabayaran nang buo.");
    });
  }
  return <section className="employee-manager loan-tracker" aria-label="Personal loan reminders">
    <div className="employee-manager-heading"><div><h2>Mga pautang / Loan reminders</h2><p>Loan deadlines and unpaid balances · Manila date: {today}</p></div>
      <div className="loan-actions"><button type="button" className="secondary-button" disabled={busy} onClick={refresh}>Refresh</button><button type="button" className="secondary-button" disabled={busy || !loaded} onClick={() => { setAdding(true); setSelected(null); requestId.current = null; setError(""); }}>Add borrower</button></div></div>
    {error && <p className="employee-error" role="alert">{error}{!loaded && " Loan tracking could not load. Retry Refresh; if the tables are missing, apply all loan tracking migrations."}</p>}
    {notice && <p className="employee-notice" role="status">{notice}</p>}
    {!loaded && !error && <p role="status">Loading loans…</p>}
    {loaded && <><div className="loan-reminders" role="status"><b>{overdue.length} overdue · {dueToday.length} due today ? {dueSoon.length} due within 7 days</b><span>Unpaid interest: {money(summaries.filter(item => !item.loan.archived_at).reduce((sum, item) => sum + cents(item.tracking.interestBalance + item.tracking.dailyInterestBalance), 0) / 100)}</span></div>
    <p className="loan-help">New loans use equal scheduled repayments. Choose daily, weekly, or monthly dates and the number of installments. Existing loans keep their saved terms.</p>
    <div className="employee-form-fields"><label>Borrower name<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name"/></label><label>Show<select value={filter} onChange={event => setFilter(event.target.value)}><option value="active">Active loans</option><option value="overdue">Overdue / Hindi pa bayad</option><option value="archived">Archived / Paid</option></select></label></div>
    {adding && <form className="employee-form" onSubmit={createLoan}><h3>Add borrower / Bagong pautang</h3><fieldset disabled={busy}><div className="employee-form-fields">
      <label>Name / Pangalan<input name="borrower_name" required maxLength={200}/></label>
      <label>Supplier *<select name="supplier" required defaultValue=""><option value="" disabled>Choose supplier</option>{suppliers.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Amount lent / Principal (PHP)<input name="principal" type="number" min="0.01" max="9999999999.99" step="0.01" required value={principalInput} onChange={event => setPrincipalInput(event.target.value)}/></label>
      <label>Start date<input type="date" min="1900-01-01" max={today} required value={start} onChange={event => { const value = event.target.value; setStart(value); if (value) { const day = Number(value.slice(8)); setDueDay(day); setFirstDue(firstRepaymentDate(value, day, repaymentFrequency)); } }}/></label>
      <label>Repayment frequency<select value={repaymentFrequency} onChange={event => { const frequency = event.target.value as RepaymentFrequency; setRepaymentFrequency(frequency); if (start) setFirstDue(firstRepaymentDate(start, dueDay, frequency)); }}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
      <label>Number of installments<input type="number" min="1" max="1000" step="1" required value={installmentCount} onChange={event => setInstallmentCount(event.target.value)}/></label>
      {repaymentFrequency === "monthly" && <label>Monthly due day (1–31)<input type="number" min="1" max="31" required value={dueDay} onChange={event => { const day = Number(event.target.value); setDueDay(day); if (day >= 1 && day <= 31 && firstDue) setFirstDue(monthlyDue(firstDue, day)); }}/></label>}
      <label>First repayment date<input type="date" min={start ? new Date(Date.parse(`${start}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : undefined} required value={firstDue} onChange={event => { const value = event.target.value; setFirstDue(value); if (value && repaymentFrequency === "monthly") setDueDay(Number(value.slice(8))); }}/></label>
      <label>Monthly interest rate (%)<input name="interest_percent" type="number" min="0" max="9999999999.99" step="0.01" required value={interestPercent} onChange={event => setInterestPercent(event.target.value)}/></label>
      <div role="status"><b>Estimated equal repayment</b><p>{computedInterest === null || interestPercent === "" ? "Enter the principal and monthly interest percentage." : `${money(Number(principalInput))} × ${interestPercent}% = ${money(computedInterest)} monthly interest. ${repaymentFrequency === "daily" ? "Daily" : repaymentFrequency === "weekly" ? "Weekly" : "Monthly"} interest per installment: ${money(installmentInterestAmount(computedInterest, repaymentFrequency))}.`}</p>{installmentPreview && <p><b>{money(installmentPreview.first)} per installment{installmentPreview.first !== installmentPreview.last ? ` (last: ${money(installmentPreview.last)})` : ""} · {installmentCount} total payments</b></p>}</div>
    </div><p className="loan-help">Interest is a flat monthly rate on original principal, prorated by period: daily = monthly interest ÷ 30; weekly = 7/30; monthly = the full monthly amount. First payment uses the first repayment date. The last installment adjusts by centavos if needed. Full payoff remains available at any time.</p><div className="loan-actions"><button type="submit" className="primary-button" disabled={computedInterest === null || interestPercent === "" || !installmentPreview}>{busy ? "Saving…" : "Save loan"}</button><button type="button" className="secondary-button" onClick={() => { setAdding(false); requestId.current = null; }}>Cancel</button></div></fieldset></form>}
    <SearchableList recordSelector=":scope > article" className="loan-cards">{shown.map(item => <article className="loan-card" key={item.loan.id}>
      <div className="loan-card-heading"><h3>{item.loan.borrower_name}</h3><span className={`loan-status ${item.tracking.status === "Overdue" ? "loan-overdue" : ""}`}>{item.tracking.status}</span></div>
      <dl><div><dt>Supplier</dt><dd>{item.loan.supplier ?? "Not selected"}</dd></div>{item.loan.repayment_frequency && <div><dt>Repayment schedule</dt><dd>{item.loan.repayment_frequency} · {item.loan.installment_count} installments</dd></div>}<div><dt>Total outstanding</dt><dd>{money(item.tracking.outstandingBalance)}</dd></div><div><dt>Last payment</dt><dd>{item.tracking.lastPaymentDate ?? "No payments yet"}</dd></div><div><dt>Principal remaining</dt><dd>{money(item.tracking.principalBalance)}</dd></div><div><dt>Unpaid interest</dt><dd>{money(item.tracking.interestBalance + item.tracking.dailyInterestBalance)}</dd></div><div><dt>{item.loan.repayment_frequency ? "Monthly interest rate" : item.loan.interest_mode === "one_time" ? "One-time interest" : "Monthly interest"}{item.loan.interest_rate != null ? ` (${item.loan.interest_rate}%)` : ""}</dt><dd>{money(Number(item.loan.monthly_interest))}</dd></div>{item.loan.repayment_frequency && <div><dt>Interest per installment</dt><dd>{money(installmentInterestAmount(item.loan.monthly_interest, item.loan.repayment_frequency))}</dd></div>}<div><dt>Next / oldest unpaid due</dt><dd>{item.tracking.due ?? "—"}</dd></div></dl>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => choose(item.loan)}>View / Record payment</button>
    </article>)}</SearchableList>{!shown.length && <p>No loans in this list.</p>}
    {loan && tracking && <section className="loan-detail" aria-label={`Loan details for ${loan.borrower_name}`}>
      <div className="employee-manager-heading"><div><h3 ref={detailHeading} tabIndex={-1}>{loan.borrower_name}</h3><p>{loan.supplier ?? "Supplier not selected"} · Started {loan.start_date} · Original principal {money(Number(loan.principal))} · {loan.repayment_frequency ? `${loan.repayment_frequency} × ${loan.installment_count} · first due ${loan.first_due_date}` : `Due day ${loan.due_day}`}</p></div><button type="button" className="secondary-button" disabled={busy} onClick={() => { setSelected(null); requestId.current = null; }}>Close details</button></div>
      <form key={`rename-${loan.id}-${loan.supplier ?? "unassigned"}`} className="employee-form" onSubmit={rename}><div className="employee-form-fields"><label>Borrower name<input name="borrower_name" required maxLength={200} defaultValue={loan.borrower_name} disabled={busy}/></label><label>Supplier *<select name="supplier" required defaultValue={loan.supplier ?? ""} disabled={busy}><option value="" disabled>Choose supplier</option>{suppliers.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div><button type="submit" className="secondary-button" disabled={busy}>Save borrower / supplier</button></form>
      <p>To correct loan amounts or terms, delete the incorrect loan and enter it again with the correct details.</p><button type="button" className="secondary-button" disabled={busy} onClick={() => void removeLoan()}>Delete loan and payments</button>
      {tracking.unpaid.length > 0 && <div className="loan-unpaid"><h4>Unpaid interest</h4><ul>{tracking.unpaid.map(item => <li key={item.due}>{item.due}: {money(item.balance)} unpaid{item.due < today ? " — Overdue" : item.due === today ? " — Due today" : " — Upcoming"}</li>)}</ul></div>}
      <p>Principal balance: <b>{money(tracking.principalBalance)}</b> · Scheduled interest due: <b>{money(tracking.interestBalance)}</b></p>
      {loan.repayment_frequency && <section className="loan-installment-schedule">
        <h4>{loan.repayment_frequency[0].toUpperCase() + loan.repayment_frequency.slice(1)} repayment schedule</h4>
        <ol>{tracking.installments.map(item => <li key={item.due}>
          <div><b>Installment {item.index ?? "—"} · {item.due}</b><span>{item.balance === 0 ? "Paid" : item.due < today ? "Overdue" : item.due === today ? "Due today" : "Upcoming"}</span></div>
          <p>Due {money(item.totalDue ?? 0)} · Principal {money(item.principalDue ?? 0)} · Interest {money(item.interestDue ?? 0)} · Remaining {money(item.balance)}</p>
        </li>)}</ol>
      </section>}
      <div className="loan-daily-summary" role="status"><b>Duration: {tracking.duration.months} month{tracking.duration.months === 1 ? "" : "s"} and {tracking.duration.days} day{tracking.duration.days === 1 ? "" : "s"}</b>{loan.interest_mode === "monthly" ? <span>Daily interest: {tracking.dailyDays} extra day{tracking.dailyDays === 1 ? "" : "s"} × {money(Number(loan.monthly_interest) / 30)} (monthly interest ÷ 30) = {money(tracking.dailyInterestBalance)}. Based on original principal.</span> : <span>One-time interest loans do not accrue daily interest.</span>}</div>
      {!loan.archived_at && !tracking.settled && <div className="loan-full-payment"><button type="button" className="primary-button" disabled={busy} onClick={() => void recordFullPayoff()}>Record full payment · {money(tracking.outstandingBalance)}</button><p>Records all remaining principal and scheduled / daily interest together.</p></div>}
      {!loan.archived_at && !tracking.settled && <form key={`${loan.id}-${interestDate}`} className="employee-form" onSubmit={recordPayment}><h4>Record payment / Magtala ng bayad</h4><fieldset disabled={busy}><div className="employee-form-fields">
        <label>Date paid<input name="paid_on" type="date" min={loan.start_date} max={today} defaultValue={today} required/></label>
        <label>Principal payment (PHP)<input name="principal_amount" type="number" min="0" max={loan.repayment_frequency ? scheduledPrincipalRemaining : tracking.principalBalance} step="0.01" defaultValue={loan.repayment_frequency ? scheduledPrincipalRemaining : "0"} required/></label>
        {loan.repayment_frequency ? <label>Installment due date<select required value={interestDate} onChange={event => setInterestDate(event.target.value)}><option value="">Choose an installment due</option>{tracking.installments.filter(item => item.due <= today && item.balance > 0).map(item => <option key={item.due} value={item.due}>#{item.index} · {item.due} · {money(item.balance)} remaining</option>)}</select></label> : <label>Interest due date<select value={interestDate} onChange={event => setInterestDate(event.target.value)}><option value="">Principal only</option>{tracking.unpaid.map(item => <option key={item.due} value={item.due}>{item.due} — {money(item.balance)} unpaid</option>)}</select></label>}
        <label>Interest payment (PHP)<input name="interest_amount" type="number" min="0" max={selectedInterestRemaining} step="0.01" defaultValue={selectedInterestRemaining} required/></label>
        <label>Notes / Reference<input name="notes" maxLength={1000}/></label>
      </div><p className="loan-help">{loan.repayment_frequency ? "The unpaid interest is filled automatically for the selected installment. Change it to record a partial interest payment. The borrower can also pay the full outstanding balance using Record full payment." : "The unpaid interest is filled automatically for the selected due date. Change it to record a partial payment. One-time interest can be paid early; for monthly loans, select the month covered by this payment."}</p><button className="primary-button" type="submit" disabled={Boolean(loan.repayment_frequency && !interestDate)}>{busy ? "Saving…" : "Save payment"}</button></fieldset></form>}
      {(tracking.settled || loan.archived_at) && (!loan.repayment_frequency || loan.archived_at) && <button type="button" className="secondary-button" disabled={busy} onClick={archive}>{loan.archived_at ? "Unarchive loan" : "Fully paid — Remove from active list"}</button>}
      <h4>Payment history</h4><SearchableList recordSelector=":scope > ul > li"><ul className="loan-history">{history.map(payment => <li key={payment.id}><div><b>{payment.paid_on}</b>{payment.daily_interest_amount ? <p>Daily interest: {money(Number(payment.daily_interest_amount))}</p> : <p>Principal: {money(Number(payment.principal_amount))} · Interest: {money(Number(payment.interest_amount))}{payment.interest_due_date ? ` for ${payment.interest_due_date}` : ""}</p>}{payment.notes && <p>{payment.notes}</p>}</div>{!loan.archived_at && <button type="button" className="secondary-button" disabled={busy} onClick={() => undo(payment)}>Undo payment</button>}</li>)}</ul></SearchableList>{!history.length && <p>No payments recorded yet.</p>}
    </section>}</>}
  </section>;
}
