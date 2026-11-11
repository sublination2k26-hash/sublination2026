"use client";

import { SearchableList } from "@/components/ui/searchable-list";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FilePenLine, Plus, Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { printRoutingDocument } from "@/lib/document-routing-print";
import { documentColumns, latestStage, latestStageUpdatedAt, pendingRoutingStages, routingStages, type RoutingDocument, type RoutingEntry } from "@/lib/document-routing";
import "./document-routing.css";

const money = (value: number) => Number(value).toLocaleString("en-PH", { style: "currency", currency: "PHP" });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const message = (error: unknown) => typeof error === "object" && error !== null && "message" in error ? String(error.message) : "Could not save document.";

export function DocumentRoutingManager({ initialDocuments }: { initialDocuments: RoutingDocument[] }) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("pending");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [historyOnly, setHistoryOnly] = useState(false);
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
  const pendingStages = pendingRoutingStages(entries);
  const canRelease = Boolean(document) && pendingStages.length === 0;
  function choose(id: string | null, showHistory = false) { setHistoryOnly(showHistory); setSelected(id); setError(""); setNotice(""); setFormKey(key => key + 1); setFormOpen(true); }
  function print(item: RoutingDocument) {
    setError("");
    try { printRoutingDocument(item); }
    catch (cause) { setError(message(cause)); }
  }
  async function remove(item: RoutingDocument) {
    if (saving.current || !window.confirm(`Delete ${item.pr_number} and all its routing history permanently?`)) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const { error: cause } = await createClient().rpc("delete_routing_document", { p_id: item.id });
      if (cause) throw cause;
      setDocuments(current => current.filter(record => record.id !== item.id));
      if (selected === item.id) setSelected(null);
      setNotice("Document and routing history deleted.");
    } catch (cause) { setError(message(cause)); }
    finally { saving.current = false; setBusy(false); }
  }
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
        if (value("stage") === "CHEQUE RELEASE" && !canRelease) throw new Error("Complete all routing stages with a forwarded date before cheque release.");
        const { data: entry, error: cause } = await db.from("document_routing_entries").insert({
          document_id: document.id, stage: value("stage"), received_date: value("received_date"),
          forwarded_date: value("forwarded_date") || null, handled_by: value("handled_by"), remarks: value("remarks"),
        }).select().single();
        if (cause) throw cause;
        setDocuments(current => current.map(item => item.id === document.id ? { ...item, document_routing_entries: [...item.document_routing_entries, entry as RoutingEntry] } : item));
        setNotice("Routing stage saved.");
      } else {
        const values = {
          pr_number: value("pr_number"), po_number: value("po_number"), title: value("title"), payee: value("payee"),
          request_date: value("request_date"), amount: Number(value("amount")),
          cheque_number: value("cheque_number"), bir_reference: value("bir_reference"),
          gross_amount: Number(value("gross_amount")), tax_deduction: Number(value("tax_deduction")),
          released_date: value("released_date") || null, released_to: value("released_to"),
        };
        if (!canRelease) Object.assign(values, {
          cheque_number: document?.cheque_number ?? "", bir_reference: document?.bir_reference ?? "",
          gross_amount: document?.gross_amount ?? 0, tax_deduction: document?.tax_deduction ?? 0,
          released_date: document?.released_date ?? null, released_to: document?.released_to ?? "",
        });
        if (![values.amount, values.gross_amount, values.tax_deduction].every(n => Number.isFinite(n) && n >= 0) || values.tax_deduction > values.gross_amount) throw new Error("Enter valid amounts. Tax cannot exceed the gross payment.");
        const result = document
          ? await db.from("routing_documents").update(values).eq("id", document.id).eq("updated_at", document.updated_at).select(documentColumns).maybeSingle()
          : await db.from("routing_documents").insert(values).select(documentColumns).single();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("This document changed in another session. Reload before saving again.");
        const saved = result.data as RoutingDocument;
        setDocuments(current => document ? current.map(item => item.id === saved.id ? saved : item) : [saved, ...current]);
        setSelected(saved.id); setFormKey(key => key + 1); setNotice("Document saved.");
        setFormOpen(true);
      }
    } catch (cause) { setError(message(cause)); }
    finally { saving.current = false; setBusy(false); }
  }
  const shown = documents.filter(item => (paymentFilter === "all" || (paymentFilter === "paid" ? Boolean(item.released_date) : !item.released_date)) && (!stageFilter || latestStage(item) === stageFilter) && `${item.pr_number} ${item.po_number} ${item.title} ${item.payee}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="employee-manager document-routing">
    <div className="employee-manager-heading"><div><h2>Document register</h2><p>{documents.length} documents · {documents.filter(item => item.released_date).length} payments released</p></div><button className="primary-button routing-new-document" disabled={busy} onClick={() => choose(null)}><Plus size={17} aria-hidden="true"/>New document</button></div>
    {error && !formOpen && <p className="employee-error" role="alert">{error}</p>}
    {notice && <p className="employee-notice" role="status">{notice}</p>}
    <div className="employee-form-fields">
      <label>Payment status<select value={paymentFilter} onChange={event => setPaymentFilter(event.target.value)}><option value="pending">Pending / Hindi pa bayad</option><option value="paid">Paid / Released records</option><option value="all">All documents</option></select></label>
      <label>Search documents<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="PR, PO, description or payee"/></label>
      <label>Current office<select value={stageFilter} onChange={event => setStageFilter(event.target.value)}><option value="">All stages</option>{routingStages.map(stage => <option key={stage}>{stage}</option>)}</select></label>
    </div>
    <SearchableList className="employee-table-wrap routing-table" role="region" aria-label="Document register" tabIndex={0}><table><thead><tr><th>PR / PO</th><th>DESCRIPTION / PAYEE</th><th>REQUEST DATE</th><th>AMOUNT</th><th>CURRENT STAGE</th><th>STAGE UPDATED (PH)</th><th>PAYMENT</th><th>ACTION</th></tr></thead><tbody>
      {shown.map(item => <tr key={item.id}><td><button type="button" className="routing-pr-link" disabled={busy} onClick={() => choose(item.id, true)} aria-label={`View stage history for PR ${item.pr_number}`}>{item.pr_number}</button><br/>{item.po_number || "—"}</td><td>{item.title}<br/>{item.payee}</td><td>{item.request_date}</td><td>{money(item.amount)}</td><td>{latestStage(item)}</td><td>{latestStageUpdatedAt(item) ? <time dateTime={latestStageUpdatedAt(item)!}>{new Date(latestStageUpdatedAt(item)!).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</time> : "—"}</td><td>{item.released_date ? `Released ${item.released_date}` : "Pending"}</td><td><div className="routing-actions"><button className="secondary-button" disabled={busy} onClick={() => choose(item.id)} aria-label={`Open ${item.pr_number}`}><FilePenLine size={16} aria-hidden="true"/>Open</button><button type="button" className="secondary-button" disabled={busy} onClick={() => print(item)} aria-label={`Print ${item.pr_number}`}><Printer size={16} aria-hidden="true"/>Print</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void remove(item)} aria-label={`Delete ${item.pr_number}`}>Delete</button></div></td></tr>)}
    </tbody></table>{shown.length === 0 && <p className="empty-inline">No documents match. Select New document or adjust the filters.</p>}</SearchableList>
    <dialog ref={dialog} className="routing-document-dialog" aria-labelledby={titleId} onCancel={event => { if (saving.current) event.preventDefault(); else setFormOpen(false); }} onClose={() => setFormOpen(false)}>
    <div className="routing-dialog-heading"><h2 id={titleId}>{document ? `PR ${document.pr_number} - Routing history` : "New document"}</h2><button type="button" className="secondary-button" disabled={busy} onClick={() => setFormOpen(false)} aria-label="Close document form">Close</button></div>
    {error && formOpen && <p className="employee-error" role="alert">{error}</p>}
    {notice && formOpen && <p className="employee-notice" role="status">{notice}</p>}
    {document && <section className="routing-history-summary" aria-label={`Stage dates for PR ${document.pr_number}`}>
      <p>{document.title} {document.payee && ` / ${document.payee}`}</p>
      <h3>Stage dates</h3>
      <p>Latest dates for every stage. Pending stages have no recorded dates yet.</p>
      <SearchableList className="employee-table-wrap routing-table routing-stage-summary"><table><thead><tr><th>STAGE</th><th>RECEIVED</th><th>FORWARDED</th><th>LAST UPDATED (PH)</th></tr></thead><tbody>{routingStages.map(stage => {
        const latest = [...entries].reverse().find(entry => entry.stage === stage);
        return <tr key={stage}><td><b>{stage}</b>{!latest && <small>Pending</small>}</td><td>{latest?.received_date ?? "Not recorded"}</td><td>{latest?.forwarded_date ?? "Not recorded"}</td><td>{latest ? <time dateTime={latest.created_at}>{new Date(latest.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</time> : "Not updated"}</td></tr>;
      })}</tbody></table></SearchableList>
      <h3>All recorded updates</h3>
      <SearchableList className="employee-table-wrap routing-table"><table><thead><tr><th>OFFICE</th><th>RECEIVED</th><th>FORWARDED</th><th>HANDLED BY</th><th>REMARKS</th><th>RECORDED</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td>{entry.stage}</td><td>{entry.received_date}</td><td>{entry.forwarded_date ?? "—"}</td><td>{entry.handled_by || "—"}</td><td className="routing-remarks">{entry.remarks || "—"}</td><td>{new Date(entry.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td></tr>)}</tbody></table>{!entries.length && <p className="empty-inline">No office updates yet.</p>}</SearchableList>

    </section>}
    <details className="routing-edit-details" key={`${selected}-${historyOnly}`} open={!document || !historyOnly}>
      <summary>{document ? "Edit document and update stage dates" : "Document details"}</summary>
    <form className="employee-form" key={`${selected}-${formKey}`} onSubmit={event => save(event)}>
      <fieldset disabled={busy}><div className="employee-form-fields">
        <label>P.R. number *<input name="pr_number" required maxLength={100} defaultValue={document?.pr_number}/></label>
        <label>P.O. number<input name="po_number" maxLength={100} defaultValue={document?.po_number}/></label>
        <label>Description *<input name="title" required maxLength={300} defaultValue={document?.title}/></label>
        <label>Supplier / payee<input name="payee" maxLength={200} defaultValue={document?.payee}/></label>
        <label>Request date *<input name="request_date" type="date" required defaultValue={document?.request_date ?? today()}/></label>
        <label>Request amount (PHP) *<input name="amount" type="number" required min="0" max="9999999999.99" step="0.01" defaultValue={document?.amount ?? 0}/></label>
      </div><h3>Cheque release</h3><p>{canRelease ? "All routing stages are complete. You can now record the cheque release." : `Complete all routing stages and record their forwarded dates before cheque release. Pending: ${pendingStages.join(", ")}.`}</p><fieldset disabled={!canRelease}><div className="employee-form-fields">
        <label>Cheque number<input name="cheque_number" maxLength={100} defaultValue={document?.cheque_number}/></label>
        <label>BIR reference<input name="bir_reference" maxLength={100} defaultValue={document?.bir_reference}/></label>
        <label>Gross payment (PHP)<input name="gross_amount" type="number" required min="0" max="9999999999.99" step="0.01" defaultValue={document?.gross_amount ?? 0}/></label>
        <label>Tax deduction (PHP)<input name="tax_deduction" type="number" required min="0" max="9999999999.99" step="0.01" defaultValue={document?.tax_deduction ?? 0}/></label>
        <label>Release date<input name="released_date" type="date" defaultValue={document?.released_date ?? ""}/></label>
        <label>Released to / signature reference<input name="released_to" maxLength={200} defaultValue={document?.released_to}/></label>
      </div></fieldset>{document && <p>Saved net payment: <b>{money(document.net_amount)}</b></p>}<button className="primary-button" type="submit">{busy ? "Saving…" : "Save document"}</button></fieldset>
    </form>
    <h3>Routing stages and dates</h3>
    <p>One routing sheet for this PR. Save the document details first, then record each office below. Leave future stages blank.</p>
    {!document && <ol className="routing-stages">{routingStages.map(stage => <li key={stage}>{stage} ? Pending</li>)}</ol>}
    {document && <>
      <h3>Routing history · {document.pr_number}</h3><p>Entries follow the order they were recorded. Add another entry to record a return or correction; earlier entries are preserved.</p>
      <div className="routing-stage-forms">{routingStages.map(stage => {
        const latest = [...entries].reverse().find(entry => entry.stage === stage);
        const locked = stage === "CHEQUE RELEASE" && !canRelease;
        return <form className="employee-form routing-stage-form" key={`${document.id}-${stage}-${latest?.id ?? "pending"}`} onSubmit={event => save(event, true)}>
          <fieldset disabled={busy || locked}>
            <legend>{stage} ? {latest?.forwarded_date ? "Forwarded" : latest ? "Received" : "Pending"}</legend>
            <input type="hidden" name="stage" value={stage}/>
            <div className="employee-form-fields">
              <label>Date received *<input name="received_date" type="date" required defaultValue={latest?.received_date ?? ""}/></label>
              <label>Date forwarded<input name="forwarded_date" type="date" defaultValue={latest?.forwarded_date ?? ""}/></label>
              <label>Handled by / initials<input name="handled_by" maxLength={200} defaultValue={latest?.handled_by ?? ""}/></label>
              <label>Remarks / control number<textarea name="remarks" maxLength={2000} rows={2} defaultValue={latest?.remarks ?? ""}/></label>
            </div>
            <button className="primary-button" type="submit">{busy ? "Saving?" : `Save ${stage} dates`}</button>
          </fieldset>
          {locked && <p>Complete the forwarded dates of all preceding stages first.</p>}
        </form>;
      })}</div>

    </>}
    </details>
    </dialog>
  </section>;
}
