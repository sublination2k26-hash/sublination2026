"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function MarkReady({orderId,onSaved,open,onOpenChange}:{orderId:string;onSaved:()=>Promise<void>;open:boolean;onOpenChange:(open:boolean)=>void}) {
  const [reason,setReason]=useState("");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const pending=useRef(false);
  async function save(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(pending.current)return;
    pending.current=true;setSaving(true);setError("");
    try {
      const {error}=await createClient().rpc("admin_mark_order_ready",{p_order_id:orderId,p_reason:reason.trim()});
      if(error)throw error;
      await onSaved();onOpenChange(false);setReason("");
    } catch(cause) {
      setError((cause as {message?:string})?.message??"Could not update order status.");
    } finally {pending.current=false;setSaving(false);}
  }
  return <section className="panel">
    <h2>Previous order already completed?</h2>
    <p>Admin can move an existing order directly to Ready for release. Production history and payments are preserved. Pickup still requires QC approval or an admin exception.</p>
    {!open?<button type="button" className="primary-button" onClick={()=>onOpenChange(true)}>Mark ready for release</button>:<form className="notes-label" onSubmit={save}>
      <label>Reason<textarea required maxLength={1000} disabled={saving} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Previous order; production already completed before encoding"/></label>
      <button type="submit" className="primary-button" disabled={saving||!reason.trim()}>{saving?"Saving…":"Confirm ready for release"}</button>
      <button type="button" disabled={saving} onClick={()=>onOpenChange(false)}>Cancel</button>
    </form>}
    {error&&<p role="alert" className="blocked-message">{error}</p>}
  </section>;
}
