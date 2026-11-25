"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function MarkReady({ orderId, onSaved, open, onOpenChange }: {
  orderId: string;
  onSaved: () => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    element.showModal();
    reasonField.current?.focus();
    return () => element.close();
  }, [open]);

  function dismiss() {
    if (pending.current) return;
    setReason("");
    setError("");
    onOpenChange(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || (!saved && !reason.trim())) return;
    pending.current = true;
    setSaving(true);
    setError("");

    try {
      if (!saved) {
        const { error: rpcError } = await createClient().rpc("admin_mark_order_ready", {
          p_order_id: orderId,
          p_reason: reason.trim(),
        });
        if (rpcError) {
          if ((rpcError.code === "PGRST202" || rpcError.code === "42883") && rpcError.message.includes("admin_mark_order_ready")) {
            throw new Error("The mark-ready database function is missing. Apply Supabase migration 20261105094552_admin_ready_for_release.sql, then reload.");
          }
          throw rpcError;
        }
        setSaved(true);
      }

      try {
        await onSaved();
      } catch {
        setError("The order was marked ready. Select Refresh order to update the workflow.");
        return;
      }
      setSaved(false);
      setReason("");
      onOpenChange(false);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? "Could not update order status.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialog}
      className="ready-dialog"
      aria-labelledby="mark-ready-title"
      aria-describedby="mark-ready-description"
      onCancel={event => { event.preventDefault(); dismiss(); }}
      onClick={event => { if (event.target === event.currentTarget) dismiss(); }}
    >
      <section className="modal ready-modal">
        <div className="modal-heading">
          <h2 id="mark-ready-title">Mark order ready for release</h2>
          <button type="button" aria-label="Close" disabled={saving} onClick={dismiss}><X size={18}/></button>
        </div>
        <p id="mark-ready-description" className="ready-modal-copy">
          Confirm that production is complete. Record the handoff under Piece releases.
        </p>
        <form className="form" onSubmit={save}>
          <label>
            Reason for marking ready
            <textarea ref={reasonField} required={!saved} maxLength={1000} readOnly={saving || saved} value={reason}
              onChange={event => setReason(event.target.value)} placeholder="I verified the remaining production work is complete."/>
          </label>
          {error && <p role="alert" className="blocked-message">{error}</p>}
          <div className="form-actions">
            <button type="button" className="cancel-button" disabled={saving} onClick={dismiss}>{saved ? "Close" : "Cancel"}</button>
            <button type="submit" className="primary-button" disabled={saving || (!saved && !reason.trim())}>
              {saving ? "Updating order…" : saved ? "Refresh order" : "Confirm"}
            </button>
          </div>
        </form>
      </section>
    </dialog>
  );
}
