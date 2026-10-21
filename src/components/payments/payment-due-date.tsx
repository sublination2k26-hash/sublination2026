"use client";

import { useEffect, useState } from "react";
import { paymentTracking } from "@/lib/payment-tracking";

export function PaymentDueDate({ due, total, payments, cancelled, editable, onSave }: {
  due: string; total: number; payments: { amount: number }[]; cancelled: boolean; editable: boolean; onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(due);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setValue(due);setError(""); }, [due]);
  const tracking = paymentTracking(total, payments, due, undefined, cancelled);
  return <div style={{marginBottom:16}}>
    <p><b>Payment due:</b> {due || "Not set"} · <span className={tracking.overdue?"due-payment":""}>{tracking.status}</span></p>
    {editable&&<form style={{display:"flex",gap:8,alignItems:"end",flexWrap:"wrap"}} onSubmit={async event=>{
      event.preventDefault();setBusy(true);setError("");
      try { await onSave(value); } catch(reason) { setError(reason instanceof Error?reason.message:"Could not save the payment due date."); } finally { setBusy(false); }
    }}><label>Payment due date<input type="date" value={value} onChange={event=>setValue(event.target.value)} disabled={busy}/></label><button className="filter-button" type="submit" disabled={busy||value===due}>{busy?"Saving…":"Save payment due"}</button></form>}
    {error&&<p role="alert" className="blocked-message">{error}</p>}
  </div>;
}
