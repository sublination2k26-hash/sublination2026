"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { readAllRows } from "@/lib/workspace-loading";
import { cents, loanColumns, loanPaymentColumns, loanTracking, manilaToday, monthlyDue, monthlyInterestFromPercent, type LoanPayment, type PersonalLoan } from "@/lib/loan-tracking";
import "./loan-tracker.css";

const money = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : typeof cause === "object" && cause && "message" in cause ? String(cause.message) : "Could not save. Please try again.";

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
  const [interestMode, setInterestMode] = useState<"one_time" | "monthly">("one_time");
  const [interestPercent, setInterestPercent] = useState("0");
  let computedInterest: number | null = null;
  try { computedInterest = monthlyInterestFromPercent(Number(principalInput), Number(interestPercent)); } catch { /* Preview waits for valid inputs. */ }
  const [start, setStart] = useState(manilaToday);
  const [firstDue, setFirstDue] = useState(() => monthlyDue(manilaToday(), Number(manilaToday().slice(8)), 1));
  const [dueDay, setDueDay] = useState(() => Number(manilaToday().slice(8)));
  const [interestDate, setInterestDate] = useState("");
  const requestId = useRef<string | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  async function load() {
    const db = createClient();
    const [records, history] = await Promise.all([
      readAllRows<PersonalLoan>((from, to) => db.from("personal_loans").select(loanColumns).order("created_at", { ascending: false }).order("id").range(from, to)),
      readAllRows<LoanPayment>((from, to) => db.from("personal_loan_payments").select(loanPaymentColumns).order("paid_on").order("id").range(from, to)),
    ]);
    setLoans(records); setPayments(history); setLoaded(true); setToday(manilaToday());
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
    setInterestDate(loanTracking(item, payments, today).unpaid[0]?.due ?? "");
    setError(""); setNotice("");
  }
  async function createLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = requestId.current ?? crypto.randomUUID(); requestId.current = id;
    await run(async () => {
      const db = createClient();
      const values = { id, borrower_name: String(data.get("borrower_name")).trim(), principal: Number(data.get("principal")), start_date: start,
        first_due_date: firstDue, due_day: dueDay, interest_mode: interestMode, interest_rate: Number(data.get("interest_percent")), monthly_interest: monthlyInterestFromPercent(Number(data.get("principal")), Number(data.get("interest_percent"))) };
      const { data: saved, error: cause } = await db.from("personal_loans").insert(values).select(loanColumns).single();
      if (cause && cause.code !== "23505") throw cause;
      const result = saved ?? (await db.from("personal_loans").select(loanColumns).eq("id", id).single()).data;
      if (!result) throw new Error("Could not confirm the loan. Retry saving.");
      setLoans(current => [result as PersonalLoan, ...current.filter(item => item.id !== id)]);
      setAdding(false); requestId.current = null; setSelected(id); setInterestDate(""); setNotice("Loan saved / Naitala ang pautang.");
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
    const name = String(new FormData(event.currentTarget).get("borrower_name") ?? "").trim();
    await run(async () => {
      const { data, error: cause } = await createClient().from("personal_loans").update({ borrower_name: name }).eq("id", loan.id).select(loanColumns).single();
      if (cause) throw cause;
      setLoans(current => current.map(item => item.id === loan.id ? data as PersonalLoan : item));
      setNotice("Borrower name updated.");
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
    if (!window.confirm(`Remove this payment of ${money(Number(payment.principal_amount) + Number(payment.interest_amount))}? The unpaid balance and reminders will be restored.`)) return;
    await run(async () => {
      const { data, error: cause } = await createClient().from("personal_loan_payments").delete().eq("id", payment.id).select("id").single();
      if (cause || !data) throw cause ?? new Error("Payment was not removed. Refresh and retry.");
      const next = payments.filter(item => item.id !== payment.id); setPayments(next);
      if (loan) setInterestDate(loanTracking(loan, next, today).unpaid[0]?.due ?? "");
      setNotice("Payment removed. Balances updated.");
    });
  }
  return <section className="employee-manager loan-tracker" aria-label="Personal loan reminders">
    <div className="employee-manager-heading"><div><h2>Mga pautang / Loan reminders</h2><p>Loan deadlines and unpaid balances · Manila date: {today}</p></div>
      <div className="loan-actions"><button type="button" className="secondary-button" disabled={busy} onClick={refresh}>Refresh</button><button type="button" className="secondary-button" disabled={busy || !loaded} onClick={() => { setAdding(true); setSelected(null); requestId.current = null; setError(""); }}>Add borrower</button></div></div>
    {error && <p className="employee-error" role="alert">{error}{!loaded && " Loan tracking could not load. Retry Refresh; if the tables are missing, apply the loan tracking migrations, including personal_loan_interest_modes."}</p>}
    {notice && <p className="employee-notice" role="status">{notice}</p>}
    {!loaded && !error && <p role="status">Loading loans…</p>}
    {loaded && <><div className="loan-reminders" role="status"><b>{overdue.length} overdue · {dueToday.length} due today ? {dueSoon.length} due within 7 days</b><span>Unpaid interest: {money(summaries.filter(item => !item.loan.archived_at).reduce((sum, item) => sum + cents(item.tracking.interestBalance), 0) / 100)}</span></div>
    <p className="loan-help">Choose one-time or monthly interest. One-time interest is charged once; monthly interest repeats on the original principal without compounding. Existing loans keep their monthly schedule.</p>
    <div className="employee-form-fields"><label>Borrower name<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name"/></label><label>Show<select value={filter} onChange={event => setFilter(event.target.value)}><option value="active">Active loans</option><option value="overdue">Overdue / Hindi pa bayad</option><option value="archived">Archived / Paid</option></select></label></div>
    {adding && <form className="employee-form" onSubmit={createLoan}><h3>Add borrower / Bagong pautang</h3><fieldset disabled={busy}><div className="employee-form-fields">
      <label>Name / Pangalan<input name="borrower_name" required maxLength={200}/></label>
      <label>Amount lent / Principal (PHP)<input name="principal" type="number" min="0.01" max="9999999999.99" step="0.01" required value={principalInput} onChange={event => setPrincipalInput(event.target.value)}/></label>
      <label>Start date<input type="date" min="1900-01-01" max={today} required value={start} onChange={event => { const value = event.target.value; setStart(value); if (value) { const day = Number(value.slice(8)); setDueDay(day); setFirstDue(monthlyDue(value, day, 1)); } }}/></label>
      {interestMode === "monthly" && <label>Due day every month (1–31)<input type="number" min="1" max="31" required value={dueDay} onChange={event => { const day = Number(event.target.value); setDueDay(day); if (day >= 1 && day <= 31 && firstDue) setFirstDue(monthlyDue(firstDue, day)); }}/></label>}
      <label>{interestMode === "monthly" ? "First monthly due date" : "Loan due date"}<input type="date" min={start ? new Date(Date.parse(`${start}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : undefined} required value={firstDue} onChange={event => { const value = event.target.value; setFirstDue(value); if (value) setDueDay(Number(value.slice(8))); }}/></label>
      <label>Interest type<select value={interestMode} onChange={event => setInterestMode(event.target.value as "one_time" | "monthly")}><option value="one_time">One-time interest</option><option value="monthly">Monthly interest</option></select></label>
      <label>Interest rate / Tubo (%)<input name="interest_percent" type="number" min="0" max="9999999999.99" step="0.01" required value={interestPercent} onChange={event => setInterestPercent(event.target.value)}/></label>
      <div role="status"><b>Automatic {interestMode === "monthly" ? "monthly" : "one-time"} interest</b><p>{computedInterest === null || interestPercent === "" ? "Enter the principal and interest percentage." : `${money(Number(principalInput))} x ${interestPercent}% = ${money(computedInterest)}${interestMode === "monthly" ? " / month" : " once"}`}</p>{computedInterest !== null && interestPercent !== "" && <p><b>{interestMode === "monthly" ? "Principal + first month's interest" : "Total amount"}: {money((cents(Number(principalInput)) + cents(computedInterest)) / 100)}</b></p>}</div>
    </div><p className="loan-help">{interestMode === "one_time" ? "Example: PHP 50,000 at 12% = PHP 6,000 interest once. Total repayment: PHP 56,000, due on the loan due date." : "Example: PHP 50,000 at 12% monthly = PHP 6,000 every month. Interest stays fixed after partial principal payments and stops after full principal repayment. Due days 29-31 use the last day of shorter months."}</p><div className="loan-actions"><button type="submit" className="primary-button" disabled={computedInterest === null || interestPercent === ""}>{busy ? "Saving…" : "Save loan"}</button><button type="button" className="secondary-button" onClick={() => { setAdding(false); requestId.current = null; }}>Cancel</button></div></fieldset></form>}
    <div className="loan-cards">{shown.map(item => <article className="loan-card" key={item.loan.id}>
      <div className="loan-card-heading"><h3>{item.loan.borrower_name}</h3><span className={`loan-status ${item.tracking.status === "Overdue" ? "loan-overdue" : ""}`}>{item.tracking.status}</span></div>
      <dl><div><dt>Total outstanding</dt><dd>{money(item.tracking.outstandingBalance)}</dd></div><div><dt>Last payment</dt><dd>{item.tracking.lastPaymentDate ?? "No payments yet"}</dd></div><div><dt>Principal remaining</dt><dd>{money(item.tracking.principalBalance)}</dd></div><div><dt>Unpaid interest</dt><dd>{money(item.tracking.interestBalance)}</dd></div><div><dt>{item.loan.interest_mode === "one_time" ? "One-time interest" : "Monthly interest"}{item.loan.interest_rate != null ? ` (${item.loan.interest_rate}%)` : ""}</dt><dd>{money(Number(item.loan.monthly_interest))}</dd></div><div><dt>Next / oldest unpaid due</dt><dd>{item.tracking.due ?? "—"}</dd></div></dl>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => choose(item.loan)}>View / Record payment</button>
    </article>)}</div>{!shown.length && <p>No loans in this list.</p>}
    {loan && tracking && <section className="loan-detail" aria-label={`Loan details for ${loan.borrower_name}`}>
      <div className="employee-manager-heading"><div><h3 ref={detailHeading} tabIndex={-1}>{loan.borrower_name}</h3><p>Started {loan.start_date} · Original principal {money(Number(loan.principal))} · Due day {loan.due_day}</p></div><button type="button" className="secondary-button" disabled={busy} onClick={() => { setSelected(null); requestId.current = null; }}>Close details</button></div>
      <form key={`rename-${loan.id}`} className="employee-form" onSubmit={rename}><label>Borrower name<input name="borrower_name" required maxLength={200} defaultValue={loan.borrower_name} disabled={busy}/></label><button type="submit" className="secondary-button" disabled={busy}>Save name</button></form>
      <p>To correct loan amounts or terms, delete the incorrect loan and enter it again with the correct details.</p><button type="button" className="secondary-button" disabled={busy} onClick={() => void removeLoan()}>Delete loan and payments</button>
      {tracking.unpaid.length > 0 && <div className="loan-unpaid"><h4>Unpaid interest</h4><ul>{tracking.unpaid.map(item => <li key={item.due}>{item.due}: {money(item.balance)} unpaid{item.due < today ? " — Overdue" : item.due === today ? " — Due today" : " — Upcoming"}</li>)}</ul></div>}
      <p>Principal balance: <b>{money(tracking.principalBalance)}</b> · Interest due: <b>{money(tracking.interestBalance)}</b></p>
      {!loan.archived_at && !tracking.settled && <form key={loan.id} className="employee-form" onSubmit={recordPayment}><h4>Record payment / Magtala ng bayad</h4><fieldset disabled={busy}><div className="employee-form-fields">
        <label>Date paid<input name="paid_on" type="date" min={loan.start_date} max={today} defaultValue={today} required/></label>
        <label>Principal payment (PHP)<input name="principal_amount" type="number" min="0" max={tracking.principalBalance} step="0.01" defaultValue="0" required/></label>
        <label>Interest due date<select value={interestDate} onChange={event => setInterestDate(event.target.value)}><option value="">Principal only</option>{tracking.unpaid.map(item => <option key={item.due} value={item.due}>{item.due} — {money(item.balance)} unpaid</option>)}</select></label>
        <label>Interest payment (PHP)<input name="interest_amount" type="number" min="0" max={tracking.unpaid.find(item => item.due === interestDate)?.balance ?? 0} step="0.01" defaultValue="0" required/></label>
        <label>Notes / Reference<input name="notes" maxLength={1000}/></label>
      </div><p className="loan-help">Select the due date covered by the interest payment. One-time interest can be paid early. For monthly loans, record separate payments for different months. Partial payments are allowed.</p><button className="primary-button" type="submit">{busy ? "Saving…" : "Save payment"}</button></fieldset></form>}
      {(tracking.settled || loan.archived_at) && <button type="button" className="secondary-button" disabled={busy} onClick={archive}>{loan.archived_at ? "Unarchive loan" : "Fully paid — Remove from active list"}</button>}
      <h4>Payment history</h4><ul className="loan-history">{history.map(payment => <li key={payment.id}><div><b>{payment.paid_on}</b><p>Principal: {money(Number(payment.principal_amount))} · Interest: {money(Number(payment.interest_amount))}{payment.interest_due_date ? ` for ${payment.interest_due_date}` : ""}</p>{payment.notes && <p>{payment.notes}</p>}</div>{!loan.archived_at && <button type="button" className="secondary-button" disabled={busy} onClick={() => undo(payment)}>Undo payment</button>}</li>)}</ul>{!history.length && <p>No payments recorded yet.</p>}
    </section>}</>}
  </section>;
}
