"use client";

import { SearchableList } from "@/components/ui/searchable-list";
import { useEffect, useRef, useState } from "react";
import { manilaToday } from "@/lib/payment-tracking";
import { createClient } from "@/lib/supabase/client";

type Release = { id: string; quantity: number; received_by: string; released_at: string; release_on: string; notes: string; exception_reason: string; pickup_payment_id: string | null };

export function PieceReleases({ orderId, quantity, status, canRelease, isAdmin, onSaved }: {
  orderId: string; quantity: number; status: string; canRelease: boolean; isAdmin: boolean; onSaved: () => Promise<void>;
}) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [amount, setAmount] = useState("0");
  const [method, setMethod] = useState("cash");
  const request = useRef<{signature: string; id: string} | null>(null);
  const [releaseAll, setReleaseAll] = useState(false);
  const [releaseDate, setReleaseDate] = useState(manilaToday);
  const [pieces, setPieces] = useState("1");
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");
  const [exception, setException] = useState("");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setReady(false);
      const result = await createClient().from("order_releases").select("id,quantity,received_by,released_at,release_on,notes,exception_reason,pickup_payment_id").eq("order_id", orderId).order("release_on").order("released_at");
      if (cancelled) return;
      if (result.error) { setError("Release tracking is unavailable. Apply the order release migrations first, then refresh."); return; }
      setReleases(result.data ?? []); setError(""); setReady(true);
    };
    void load().catch(() => { if (!cancelled) setError("Could not load release history. Refresh and try again."); });
    return () => { cancelled = true; };
  }, [orderId]);
  const recorded = releases.reduce((sum, release) => sum + release.quantity, 0);
  const released = status === "released" ? quantity : recorded;
  const remaining = Math.max(0, quantity - released);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const count = releaseAll ? remaining : Number(pieces);
    if (!Number.isSafeInteger(count) || count < 1 || count > remaining) { setError("Enter a whole number within the remaining quantity."); return; }
    submitting.current = true; setSaving(true); setError("");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in again to record a release.");
      const args = { p_order_id: orderId, p_quantity: count, p_release_on: releaseDate, p_received_by: recipient.trim(), p_notes: notes.trim(), p_exception: isAdmin ? exception.trim() : "", p_amount: Number(amount), p_method: method };
      if (!Number.isFinite(args.p_amount) || args.p_amount < 0) throw new Error("Enter a valid payment amount.");
      const signature = JSON.stringify(args);
      if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
      const { error: saveError } = await supabase.rpc("record_pickup", { ...args, p_request_id: request.current.id });
      if (saveError) throw saveError;
      const history = await supabase.from("order_releases").select("id,quantity,received_by,released_at,release_on,notes,exception_reason,pickup_payment_id").eq("order_id", orderId).order("release_on").order("released_at");
      if (history.error) throw history.error;
      setReleases(history.data ?? []); request.current = null; setAmount("0"); setRecipient(""); setNotes(""); setException(""); setPieces("1"); setReleaseAll(false); setReleaseDate(manilaToday());
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : (cause as {message?:string})?.message ?? "Could not record release."); }
    finally { submitting.current = false; setSaving(false); }
  }
  const pickupCount = releaseAll ? remaining : Number(pieces);
  const pieceLabel = (count: number) => count === 1 ? "piece" : "pieces";
  return <section id="order-pickup" className="panel piece-release-panel">
    <div className="section-kicker">PIECE RELEASES</div>
    <h2>Record a pickup</h2>
    <div className="release-summary">
      <div><strong>{released}<span> / {quantity}</span></strong><span>{pieceLabel(quantity)} released</span></div>
      <span className="release-remaining">{remaining} {pieceLabel(remaining)} remaining</span>
      <progress value={released} max={Math.max(1,quantity)} aria-label={`${released} of ${quantity} pieces released`}/>
    </div>
    {!ready&&!error&&<p className="release-help" role="status">Loading pickup history?</p>}
    {error && <p role="alert" className="blocked-message">{error}</p>}
    {ready && canRelease && status === "ready_for_release" && remaining > 0 && <form onSubmit={save} className="release-form" aria-label="Record a pickup" aria-busy={saving}>
      <fieldset disabled={saving}>
        <legend>Pickup details</legend>
        <label>Release option<select value={releaseAll ? "all" : "partial"} onChange={event => setReleaseAll(event.target.value === "all")}><option value="partial">Choose quantity</option><option value="all">All remaining ({remaining} {pieceLabel(remaining)})</option></select></label>
        <div className="release-field-row">
          <label>Release date<input type="date" required value={releaseDate} onChange={event => setReleaseDate(event.target.value)}/></label>
          <label>Quantity<input type="number" required min={1} max={remaining} step={1} disabled={releaseAll} value={releaseAll ? String(remaining) : pieces} onChange={event => setPieces(event.target.value)}/></label>
        </div>
        <label>Received by <span className="release-optional">Required</span><input required maxLength={200} value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="Name of person collecting" autoComplete="off"/></label>
      </fieldset>
      <fieldset disabled={saving}>
        <legend>Payment at pickup</legend>
        <p className="release-help" id="pickup-payment-help">Enter only the new payment collected today. Earlier payments already count.</p>
        <label>Amount collected (PHP)<input type="number" min="0" step="0.01" required inputMode="decimal" aria-describedby="pickup-payment-help" value={amount} onChange={event => setAmount(event.target.value)}/></label>
        <label>Payment method<select value={method} onChange={event => setMethod(event.target.value)}>{[{value:"cash",label:"Cash"},{value:"gcash",label:"GCash"},{value:"bank_transfer",label:"Bank transfer"},{value:"card",label:"Card"},{value:"other",label:"Other"}].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </fieldset>
      <fieldset disabled={saving}>
        <label>Pickup notes <span className="release-optional">Optional</span><textarea rows={2} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Add any details about this pickup"/></label>
        {isAdmin && <details className="release-exception"><summary>Need an admin exception?</summary><p className="release-help">Record why this pickup is allowed without approved QC or sufficient payment.</p><label>Exception reason<textarea rows={2} maxLength={1000} value={exception} onChange={event => setException(event.target.value)} placeholder="Explain the reason for this exception"/></label></details>}
      </fieldset>
      <p className="release-policy">Approved QC and payment covering these pieces are required. Remaining pieces stay available for the next pickup.</p>
      <button className="primary-button release-submit" disabled={saving} type="submit">{saving ? "Recording pickup?" : `Release ${Number.isSafeInteger(pickupCount)&&pickupCount>0?pickupCount:""} ${pieceLabel(pickupCount)}`}</button>
    </form>}
    {ready && status !== "ready_for_release" && status !== "released" && remaining > 0 && <p className="release-help">{status === "cancelled" ? "This order is cancelled. Pickups are unavailable." : "Pickups become available when this order is ready for release."}</p>}
    {ready && releases.length > 0 && <h3 className="release-history-title">Pickup history</h3>}
    {ready && releases.length > 0 && <SearchableList className="table-wrap"><table><thead><tr><th>RELEASE DATE</th><th>RECORDED AT</th><th>PIECES</th><th>RECEIVED BY</th><th>NOTES</th></tr></thead><tbody>{releases.map(release => <tr key={release.id}><td>{release.release_on}</td><td>{new Date(release.released_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td><td>{release.quantity}</td><td>{release.received_by}</td><td>{release.notes}{release.pickup_payment_id && <p>Payment recorded in payment history.</p>}{release.exception_reason && <p>Admin exception: {release.exception_reason}</p>}</td></tr>)}</tbody></table></SearchableList>}
    {ready && status === "released" && releases.length === 0 && <p className="empty-inline">Previously released in full. No per-pickup records were recorded.</p>}
  </section>;
}
