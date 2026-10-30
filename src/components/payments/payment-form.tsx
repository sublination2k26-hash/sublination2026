"use client";
import { useRef, useState } from "react";
import { manilaToday } from "@/lib/payment-tracking";

export type PaymentInput = { requestId: string; amount: number; method: string; note: string; date: string; kind: string };
const peso = (value: number) => value.toLocaleString("en-PH", {style: "currency", currency: "PHP"});
export function PaymentForm({order,onSave,onCancel}: {order: {total: number; payments: {amount: number}[]}; onSave: (payment: PaymentInput) => Promise<void>; onCancel: () => void}) {
  const balance = Math.max(0, order.total - order.payments.reduce((sum, payment) => sum + payment.amount, 0));
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState("Cash");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(manilaToday);
  const [kind, setKind] = useState("down_payment");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const request = useRef<{signature: string; id: string} | null>(null);
  const received = Number(amount) || 0, applied = Math.min(received, balance), change = method === "Cash" ? Math.max(0, received-balance) : 0;
  return <form className="form" onSubmit={async event => {
    event.preventDefault(); if (saving.current || applied <= 0) return;
    const details = {amount: applied, method, date, kind, note: change>0 ? `${note || "Payment"} · Cash received ${peso(received)}; change ${peso(change)}` : note};
    const signature = JSON.stringify(details);
    if (request.current?.signature !== signature) request.current = {signature, id: crypto.randomUUID()};
    saving.current = true; setBusy(true); setError("");
    try { await onSave({...details, requestId: request.current.id}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : (cause as {message?: string})?.message ?? "Could not record payment."); }
    finally { saving.current = false; setBusy(false); }
  }}>
    <div className="payment-callout">Remaining balance <b>{peso(balance)}</b></div>
    <p>Record each down payment separately. Earlier entries remain in the customer’s history.</p>
    <fieldset disabled={busy} style={{border:0,padding:0,margin:0,display:"contents"}}>
      <label>Payment date<input type="date" required max={manilaToday()} value={date} onChange={event => setDate(event.target.value)}/></label>
      <label>Payment type<select value={kind} onChange={event => setKind(event.target.value)}><option value="down_payment">Down payment / installment</option><option value="payment">Balance / other payment</option></select></label>
      <label>{method==="Cash" ? "Cash received (₱)" : "Payment amount (₱)"}<input type="number" min="0.01" step="0.01" max={method==="Cash" ? undefined : balance} required value={amount} onChange={event => setAmount(event.target.value)}/></label>
      {method==="Cash" && <div className="payment-callout">Change due <b>{peso(change)}</b></div>}
      <label>Payment method<select value={method} onChange={event => setMethod(event.target.value)}>{["Cash","GCash","Bank transfer","Card","Other"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Reference / note<input maxLength={800} value={note} onChange={event => setNote(event.target.value)} placeholder="Receipt or transaction reference"/></label>
    </fieldset>
    {error && <p role="alert" className="blocked-message">{error}</p>}
    <div className="form-actions"><button type="button" className="cancel-button" disabled={busy} onClick={onCancel}>Cancel</button><button className="primary-button" disabled={busy || applied<=0 || (method!=="Cash" && received>balance)}>{busy ? "Saving…" : "Record payment"}</button></div>
  </form>;
}
