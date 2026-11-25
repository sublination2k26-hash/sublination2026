import { latestStage, type RoutingDocument } from "./document-routing";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const money = (value: number) => Number(value).toLocaleString("en-PH", { style: "currency", currency: "PHP" });

export function routingDocumentPrintHtml(document: RoutingDocument) {
  const entries = [...document.document_routing_entries].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const details = (items: [string, unknown][]) => `<dl>${items.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value || "—")}</dd></div>`).join("")}</dl>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Document routing - ${escape(document.pr_number)}</title>
    <style>
      @page{size:A4;margin:15mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#182b45;margin:0;line-height:1.5}h1{font-size:23px;margin:0}h2{font-size:16px;margin:24px 0 12px}header{border-bottom:2px solid #182b45;padding-bottom:15px}header p{margin:5px 0}dl{display:grid;grid-template-columns:1fr 1fr;gap:12px 24px}dl div{break-inside:avoid}dt{font-size:11px;color:#536273}dd{margin:3px 0 0;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #bac4cf;padding:8px;vertical-align:top;text-align:left;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#f1f5f9}thead{display:table-header-group}tr{break-inside:avoid}footer{margin-top:26px;border-top:1px solid #bac4cf;padding-top:12px;font-size:10px;color:#536273}.hint{background:#f1f5f9;padding:12px}@media print{.hint{display:none}body{color:#000}}
    </style></head><body><p class="hint">Use your browser’s Print command (Ctrl+P) to print again or save as PDF. This printout contains saved information.</p>
    <header><h1>Subli-nation Printing System</h1><p>Document routing &amp; disbursement record</p><p><b>P.R. ${escape(document.pr_number)}</b> · Current stage: ${escape(latestStage(document))}</p></header>
    <h2>Document details</h2>${details([
      ["P.R. number", document.pr_number], ["P.O. number", document.po_number],
      ["Description", document.title], ["Supplier", document.suppliers?.join(", ")], ["Payee", document.payee],
      ["Request date", document.request_date], ["Request amount", money(document.amount)],
    ])}
    <h2>Cheque release</h2>${details([
      ["Payment status", document.released_date ? "Released" : "Pending"], ["Cheque number", document.cheque_number],
      ["BIR reference", document.bir_reference], ["Gross payment", money(document.gross_amount)],
      ["Tax deduction", money(document.tax_deduction)], ["Net payment", money(document.net_amount)],
      ["Release date", document.released_date], ["Released to / signature reference", document.released_to],
    ])}
    <h2>Routing history</h2><table><thead><tr><th>Office</th><th>Received</th><th>Forwarded</th><th>Handled by</th><th>Remarks</th><th>Recorded (PH)</th></tr></thead><tbody>${entries.length ? entries.map(entry => `<tr>${[
      entry.stage, entry.received_date, entry.forwarded_date || "—", entry.handled_by || "—", entry.remarks || "—",
      new Date(entry.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
    ].map(value => `<td>${escape(value)}</td>`).join("")}</tr>`).join("") : '<tr><td colspan="6">No office updates recorded.</td></tr>'}</tbody></table>
    <footer>Printed ${escape(new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" }))} (Philippine time). Entries appear in recorded order.</footer></body></html>`;
}

export function printRoutingDocument(document: RoutingDocument) {
  const preview = window.open("", "_blank");
  if (!preview) throw new Error("Allow pop-ups for this site to print the document, then try again.");
  preview.opener = null;
  preview.document.open();
  preview.document.write(routingDocumentPrintHtml(document));
  preview.document.close();
  preview.focus();
  preview.print();
}
