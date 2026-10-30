"use client";

import { useEffect, useRef, useState } from "react";
import { manilaToday } from "@/lib/payment-tracking";
import { createClient } from "@/lib/supabase/client";

type Release = { id: string; quantity: number; received_by: string; released_at: string; release_on: string; notes: string; exception_reason: string };

export function PieceReleases({ orderId, quantity, status, canRelease, isAdmin, onSaved }: {
  orderId: string; quantity: number; status: string; canRelease: boolean; isAdmin: boolean; onSaved: () => Promise<void>;
}) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
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
      const result = await createClient().from("order_releases").select("id,quantity,received_by,released_at,release_on,notes,exception_reason").eq("order_id", orderId).order("release_on").order("released_at");
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
      const { data, error: saveError } = await supabase.from("order_releases").insert({ order_id: orderId, quantity: count, release_on: releaseDate, received_by: recipient.trim(), notes: notes.trim(), exception_reason: isAdmin ? exception.trim() : "", released_by: user.id }).select("id,quantity,received_by,released_at,release_on,notes,exception_reason").single();
      if (saveError) throw saveError;
      setReleases(current => [...current, data]); setRecipient(""); setNotes(""); setException(""); setPieces("1"); setReleaseAll(false); setReleaseDate(manilaToday());
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : (cause as {message?:string})?.message ?? "Could not record release."); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <section className="panel">
    <div className="section-kicker">PIECE RELEASES</div><h2>{released} / {quantity} pieces released</h2>
    <p>{remaining} pieces remaining</p>
    {error && <p role="alert" className="blocked-message">{error}</p>}
    {ready && canRelease && status === "ready_for_release" && remaining > 0 && <form onSubmit={save} className="notes-label">
      <label>Release option<select disabled={saving} value={releaseAll ? "all" : "partial"} onChange={event => setReleaseAll(event.target.value === "all")}><option value="partial">Choose quantity</option><option value="all">Release all remaining ({remaining} pieces)</option></select></label>
      <label>Release date<input type="date" required disabled={saving} value={releaseDate} onChange={event => setReleaseDate(event.target.value)}/></label>
      <label>Pieces to release<input type="number" required min={1} max={remaining} step={1} disabled={saving || releaseAll} value={releaseAll ? String(remaining) : pieces} onChange={event => setPieces(event.target.value)}/></label>
      <label>Received by<input required maxLength={200} value={recipient} onChange={event => setRecipient(event.target.value)}/></label>
      <label>Release notes<textarea maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)}/></label>
      {isAdmin && <label>Admin exception reason (if needed)<textarea maxLength={1000} value={exception} onChange={event => setException(event.target.value)}/></label>}
      <p className="workflow-hint">QC approval and full payment are required. An admin may record an exception for this pickup.</p>
      <button className="primary-button" disabled={saving} type="submit">{saving ? "Saving…" : releaseAll ? `Release all ${remaining} pieces` : "Release pieces"}</button>
    </form>}
    {ready && releases.length > 0 && <div className="table-wrap"><table><thead><tr><th>RELEASE DATE</th><th>RECORDED AT</th><th>PIECES</th><th>RECEIVED BY</th><th>NOTES</th></tr></thead><tbody>{releases.map(release => <tr key={release.id}><td>{release.release_on}</td><td>{new Date(release.released_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td><td>{release.quantity}</td><td>{release.received_by}</td><td>{release.notes}{release.exception_reason && <p>Admin exception: {release.exception_reason}</p>}</td></tr>)}</tbody></table></div>}
    {ready && status === "released" && releases.length === 0 && <p className="empty-inline">Previously released in full. No per-pickup records were recorded.</p>}
  </section>;
}
