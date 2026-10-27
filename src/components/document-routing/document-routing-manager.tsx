"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { documentColumns, latestStage, routingStages, type RoutingDocument, type RoutingEntry } from "@/lib/document-routing";
import "./document-routing.css";

const money = (value: number) => Number(value).toLocaleString("en-PH", { style: "currency", currency: "PHP" });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const message = (error: unknown) => typeof error === "object" && error !== null && "message" in error ? String(error.message) : "Could not save document.";

export function DocumentRoutingManager({ initialDocuments }: { initialDocuments: RoutingDocument[] }) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!formOpen || !element) return;
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    element.showModal();
    return () => { element.close(); window.document.body.style.overflow = previousOverflow; };
  }, [formOpen]);
  const document = documents.find(item => item.id === selected);
  const entries = [...(document?.document_routing_entries ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  function choose(id: string | null) { setSelected(id); setError(""); setNotice(""); setFormKey(key => key + 1); setFormOpen(true); }
  async function save(event: FormEvent<HTMLFormElement>, routing = false) {
    event.preventDefault();
    if (saving.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const db = createClient();
      if (routing && document) {
        const { data: entry, error: cause } = await db.from("document_routing_entries").insert({
          document_id: document.id, stage: value("stage"), received_date: value("received_date"),
          forwarded_date: value("forwarded_date") || null, handled_by: value("handled_by"), remarks: value("remarks"),
        }).select().single();
        if (cause) throw cause;
        setDocuments(current => current.map(item => item.id === document.id ? { ...item, document_routing_entries: [...item.document_routing_entries, entry as RoutingEntry] } : item));
        form.reset(); setNotice("Routing entry added.");
      } else {
        const values = {
          pr_number: value("pr_number"), po_number: value("po_number"), title: value("title"), payee: value("payee"),
          request_date: value("request_date"), amount: Number(value("amount")),
          cheque_number: value("cheque_number"), bir_reference: value("bir_reference"),
          gross_amount: Number(value("gross_amount")), tax_deduction: Number(value("tax_deduction")),
          released_date: value("released_date") || null, released_to: value("released_to"),
        };
        if (![values.amount, values.gross_amount, values.tax_deduction].every(n => Number.isFinite(n) && n >= 0) || values.tax_deduction > values.gross_amount) throw new Error("Enter valid amounts. Tax cannot exceed the gross payment.");
        const result = document
          ? await db.from("routing_documents").update(values).eq("id", document.id).eq("updated_at", document.updated_at).select(documentColumns).maybeSingle()
          : await db.from("routing_documents").insert(values).select(documentColumns).single();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("This document changed in another session. Reload before saving again.");
        const saved = result.data as RoutingDocument;
        setDocuments(current => document ? current.map(item => item.id === saved.id ? saved : item) : [saved, ...current]);
        setSelected(saved.id); setFormKey(key => key + 1); setNotice("Document saved.");
        setFormOpen(false);
      }
    } catch (cause) { setError(message(cause)); }
    finally { saving.current = false; setBusy(false); }
  }
  const shown = documents.filter(item => (!stageFilter || latestStage(item) === stageFilter) && `${item.pr_number} ${item.po_number} ${item.title} ${item.payee}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="employee-manager document-routing">
    <div className="employee-manager-heading"><div><h2>Document register</h2><p>{documents.length} documents · {documents.filter(item => item.released_date).length} payments released</p></div><button className="secondary-button" disabled={busy} onClick={() => choose(null)}>New document</button></div>
    {error && !formOpen && <p className="employee-error" role="alert">{error}</p>}
    {notice && <p className="employee-notice" role="status">{notice}</p>}
    <div className="employee-form-fields">
      <label>Search documents<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="PR, PO, description or payee"/></label>
      <label>Current office<select value={stageFilter} onChange={event => setStageFilter(event.target.value)}><option value="">All stages</option>{routingStages.map(stage => <option key={stage}>{stage}</option>)}</select></label>
    </div>
    <div className="employee-table-wrap routing-table" role="region" aria-label="Document register" tabIndex={0}><table><thead><tr><th>PR / PO</th><th>DESCRIPTION / PAYEE</th><th>REQUEST DATE</th><th>AMOUNT</th><th>CURRENT STAGE</th><th>PAYMENT</th><th>ACTION</th></tr></thead><tbody>
      {shown.map(item => <tr key={item.id}><td><b>{item.pr_number}</b><br/>{item.po_number || "—"}</td><td>{item.title}<br/>{item.payee}</td><td>{item.request_date}</td><td>{money(item.amount)}</td><td>{latestStage(item)}</td><td>{item.released_date ? `Released ${item.released_date}` : "Pending"}</td><td><button className="secondary-button" disabled={busy} onClick={() => choose(item.id)} aria-label={`Open ${item.pr_number}`}>Open</button></td></tr>)}
    </tbody></table>{shown.length === 0 && <p className="empty-inline">No documents match. Select New document or adjust the filters.</p>}</div>
    <dialog ref={dialog} className="routing-document-dialog" aria-labelledby={titleId} onCancel={event => { if (saving.current) event.preventDefault(); else setFormOpen(false); }} onClose={() => setFormOpen(false)}>
    <div className="routing-dialog-heading"><h2 id={titleId}>{document ? `Edit ${document.pr_number}` : "New document"}</h2><button type="button" className="secondary-button" disabled={busy} onClick={() => setFormOpen(false)} aria-label="Close document form">Close</button></div>
    {error && formOpen && <p className="employee-error" role="alert">{error}</p>}
    <form className="employee-form" key={`${selected}-${formKey}`} onSubmit={event => save(event)}>
      <fieldset disabled={busy}><div className="employee-form-fields">
        <label>P.R. number *<input name="pr_number" required maxLength={100} defaultValue={document?.pr_number}/></label>
        <label>P.O. number<input name="po_number" maxLength={100} defaultValue={document?.po_number}/></label>
        <label>Description *<input name="title" required maxLength={300} defaultValue={document?.title}/></label>
        <label>Supplier / payee<input name="payee" maxLength={200} defaultValue={document?.payee}/></label>
        <label>Request date *<input name="request_date" type="date" required defaultValue={document?.request_date ?? today()}/></label>
        <label>Request amount (PHP) *<input name="amount" type="number" required min="0" max="9999999999.99" step="0.01" defaultValue={document?.amount ?? 0}/></label>
      </div><h3>Cheque release</h3><p>Save payment details here. Record office movement separately in the routing history.</p><div className="employee-form-fields">
        <label>Cheque number<input name="cheque_number" maxLength={100} defaultValue={document?.cheque_number}/></label>
        <label>BIR reference<input name="bir_reference" maxLength={100} defaultValue={document?.bir_reference}/></label>
        <label>Gross payment (PHP)<input name="gross_amount" type="number" required min="0" max="9999999999.99" step="0.01" defaultValue={document?.gross_amount ?? 0}/></label>
        <label>Tax deduction (PHP)<input name="tax_deduction" type="number" required min="0" max="9999999999.99" step="0.01" defaultValue={document?.tax_deduction ?? 0}/></label>
        <label>Release date<input name="released_date" type="date" defaultValue={document?.released_date ?? ""}/></label>
        <label>Released to / signature reference<input name="released_to" maxLength={200} defaultValue={document?.released_to}/></label>
      </div>{document && <p>Saved net payment: <b>{money(document.net_amount)}</b></p>}<button className="primary-button" type="submit">{busy ? "Saving…" : "Save document"}</button></fieldset>
    </form>
    </dialog>
    {document && <>
      <h3>Routing history · {document.pr_number}</h3><p>Entries follow the order they were recorded. Add another entry to record a return or correction; earlier entries are preserved.</p>
      <ol className="routing-stages" aria-label="Routing stages">{routingStages.map(stage => <li key={stage} className={entries.some(entry => entry.stage === stage) ? "visited" : ""}>{stage}</li>)}</ol>
      <div className="employee-table-wrap routing-table"><table><thead><tr><th>OFFICE</th><th>RECEIVED</th><th>FORWARDED</th><th>HANDLED BY</th><th>REMARKS</th><th>RECORDED</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td>{entry.stage}</td><td>{entry.received_date}</td><td>{entry.forwarded_date ?? "—"}</td><td>{entry.handled_by || "—"}</td><td className="routing-remarks">{entry.remarks || "—"}</td><td>{new Date(entry.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td></tr>)}</tbody></table>{!entries.length && <p className="empty-inline">No office updates yet.</p>}</div>
      <form className="employee-form" key={document.id} onSubmit={event => save(event, true)}><h3>Add office update</h3><fieldset disabled={busy}><div className="employee-form-fields">
        <label>Office / stage<select name="stage" defaultValue={latestStage(document)}>{routingStages.map(stage => <option key={stage}>{stage}</option>)}</select></label>
        <label>Date received *<input name="received_date" type="date" required defaultValue={today()}/></label>
        <label>Date forwarded<input name="forwarded_date" type="date"/></label>
        <label>Handled by / initials<input name="handled_by" maxLength={200}/></label>
        <label>Remarks / control number<textarea name="remarks" maxLength={2000} rows={3}/></label>
      </div><button className="primary-button" type="submit">{busy ? "Saving…" : "Add routing entry"}</button></fieldset></form>
    </>}
  </section>;
}
