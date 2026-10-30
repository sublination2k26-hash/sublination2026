import type { ExportColumn, ExportValue } from "./excel-export";

type Source = {
  tasks: { id: string; order_id: string; order_item_id: string; stage: string; status: string }[];
  orders: { id: string; order_number: string; due_date: string | null; notes: string | null }[];
  items: { id: string; product_name: string; quantity: number; customization: { names?: string }; notes: string | null }[];
  employees: { id: string; full_name: string }[];
  assignments: { id: string; task_id: string; employee_id: string; quantity: number; assigned_by: string; notes: string; created_at: string }[];
  events: { id: string; assignment_id: string; kind: string; quantity: number; recorded_by: string; notes: string; created_at: string }[];
};
export type SewingReport = ReturnType<typeof buildSewingReport>;
const phDate = (value: string) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
const column = (header: string, width = 22, numeric = false): ExportColumn => ({ header, width, ...(numeric ? { format: "0" } : {}) });
export const sewingSummaryColumns = [column("Job order"), column("Product"), column("Sewer"), column("Assigned by"), column("Assigned at (PH)", 26), column("Assigned", 12, true), column("Handed over", 14, true), column("Completed", 12, true), column("Remaining", 12, true), column("Awaiting handoff", 18, true), column("Ready to sew", 15, true), column("Rework", 12, true), column("Last output (PH)", 26), column("Recorded by"), column("Task status"), column("Due date"), column("Bundle / sizes / instructions", 40), column("Assignment ID", 38)];
export const sewingHistoryColumns = [column("Job order"), column("Product"), column("Sewer"), column("Action"), column("Pieces", 12, true), column("Recorded by"), column("Recorded at (PH)", 26), column("Notes", 40), column("Assignment ID", 38), column("Record ID", 38)];

export function buildSewingReport(source: Source, orderId = "", employeeId = "") {
  const tasks = new Map(source.tasks.map(row => [row.id, row]));
  const orders = new Map(source.orders.map(row => [row.id, row]));
  const items = new Map(source.items.map(row => [row.id, row]));
  const people = new Map(source.employees.map(row => [row.id, row.full_name]));
  const name = (id: string) => people.get(id) ?? id;
  const summaries = source.assignments.flatMap(assignment => {
    const task = tasks.get(assignment.task_id);
    const order = task && orders.get(task.order_id);
    const item = task && items.get(task.order_item_id);
    if (!task || !order || !item || (orderId && order.id !== orderId) || (employeeId && assignment.employee_id !== employeeId)) return [];
    const events = source.events.filter(event => event.assignment_id === assignment.id).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const sum = (kind: string) => events.reduce((total, event) => total + (event.kind === kind ? event.quantity : 0), 0);
    const completed = sum("completion"), handed = sum("handoff"), last = events.filter(event => event.kind === "completion").at(-1);
    return [{ id: assignment.id, orderId: order.id, order: order.order_number, product: item.product_name, sewer: name(assignment.employee_id), employeeId: assignment.employee_id,
      assignedBy: name(assignment.assigned_by), assignedAt: phDate(assignment.created_at), assigned: assignment.quantity,
      handed, completed, remaining: assignment.quantity - completed, waiting: assignment.quantity - handed, ready: handed - completed,
      rework: sum("rework"), lastOutput: last ? phDate(last.created_at) : "", recordedBy: last ? name(last.recorded_by) : "",
      status: task.status.replaceAll("_", " "), due: order.due_date ?? "", notes: assignment.notes,
      instructions: [item.customization?.names, item.notes, order.notes].filter(Boolean).join(" | "),
      events: [{ id: assignment.id, kind: "Assignment", quantity: assignment.quantity, recorder: name(assignment.assigned_by), at: assignment.created_at, notes: assignment.notes },
        ...events.map(event => ({ id: event.id, kind: ({ handoff: "Materials handoff", completion: "Sewing completion", rework: "Rework" } as Record<string, string>)[event.kind] ?? event.kind, quantity: event.quantity, recorder: name(event.recorded_by), at: event.created_at, notes: event.notes }))],
    }];
  });
  const summaryRows: ExportValue[][] = summaries.map(row => [row.order, row.product, row.sewer, row.assignedBy, row.assignedAt, row.assigned, row.handed, row.completed, row.remaining, row.waiting, row.ready, row.rework, row.lastOutput, row.recordedBy, row.status, row.due, [row.notes, row.instructions].filter(Boolean).join(" | "), row.id]);
  const history = summaries.flatMap(row => row.events.map(event => ({ ...event, order: row.order, product: row.product, sewer: row.sewer, assignmentId: row.id }))).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const historyRows: ExportValue[][] = history.map(row => [row.order, row.product, row.sewer, row.kind, row.quantity, row.recorder, phDate(row.at), row.notes, row.assignmentId, row.id]);
  const sewers = new Map<string, { id: string; name: string; orders: Set<string>; assigned: number; handed: number; completed: number; remaining: number; rework: number }>();
  for (const row of summaries) {
    const total = sewers.get(row.employeeId) ?? { id: row.employeeId, name: row.sewer, orders: new Set<string>(), assigned: 0, handed: 0, completed: 0, remaining: 0, rework: 0 };
    total.orders.add(row.orderId);
    total.assigned += row.assigned; total.handed += row.handed; total.completed += row.completed; total.remaining += row.remaining; total.rework += row.rework;
    sewers.set(row.employeeId, total);
  }
  const sewerRows: ExportValue[][] = [...sewers.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(row => [row.name, row.orders.size, row.assigned, row.handed, row.completed, row.remaining, row.rework, row.id]);
  return { summaries, summaryRows, historyRows, sewerRows,
    totals: summaries.reduce((total, row) => ({ assigned: total.assigned + row.assigned, handed: total.handed + row.handed, completed: total.completed + row.completed, remaining: total.remaining + row.remaining, rework: total.rework + row.rework }), { assigned: 0, handed: 0, completed: 0, remaining: 0, rework: 0 }) };
}

export async function buildCompleteSewingExcel(report: SewingReport) {
  const { buildExcelWorkbook } = await import("./excel-export");
  const note = "Recorded output only; subject to payroll review and QC. Rework is separate from completed pieces. Report follows the selected order and sewer filters.";
  return buildExcelWorkbook([
    { title: "Sewer totals", columns: [column("Sewer", 30), column("Orders", 12, true), column("Assigned", 14, true), column("Handed over", 16, true), column("Completed", 14, true), column("Remaining", 14, true), column("Rework", 14, true), column("Employee ID", 38)], rows: report.sewerRows, note },
    { title: "Order breakdown", columns: sewingSummaryColumns, rows: report.summaryRows, note },
    { title: "Activity history", columns: sewingHistoryColumns, rows: report.historyRows, note },
  ]);
}

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
export function sewingReportPrintHtml(report: SewingReport) {
  const table = (headers: string[], rows: ExportValue[][]) => `<table><thead><tr>${headers.map(header => `<th>${escape(header)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sewing output report</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#182b45}h1{font-size:22px}h2{font-size:15px;margin-top:24px}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #aebbc8;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#eef2f6}thead{display:table-header-group}tr{break-inside:avoid}p{white-space:pre-wrap}footer{margin-top:22px;font-size:10px}@media print{.hint{display:none}}</style></head><body><h1>Subli-nation — Sewing output report</h1>
    <p>Generated ${escape(phDate(new Date().toISOString()))} (Philippine time). ${report.summaries.length} assignments in this report.</p>
    <p>Assigned: ${report.totals.assigned} | Handed over: ${report.totals.handed} | Completed: ${report.totals.completed} | Remaining: ${report.totals.remaining} | Rework: ${report.totals.rework}</p>
    <p>Completed quantities are recorded sewing output, subject to admin payroll review and QC. Rework is shown separately and does not increase completed pieces.</p>
    <p class="hint">Use Ctrl+P to print again or save as PDF.</p>
    ${table(["Job order", "Product", "Sewer", "Assigned by", "Assigned", "Handed over", "Completed", "Remaining", "Rework"], report.summaries.map(row => [row.order, row.product, row.sewer, row.assignedBy, row.assigned, row.handed, row.completed, row.remaining, row.rework]))}
    ${report.summaries.map(row => `<h2>${escape(row.order)} · ${escape(row.product)} · ${escape(row.sewer)}</h2><p>Assignment: ${escape(row.id)} | Assigned by ${escape(row.assignedBy)} at ${escape(row.assignedAt)} (PH) | Due: ${escape(row.due || "Not set")} | Task: ${escape(row.status)}</p><p>Awaiting handoff: ${row.waiting} | Ready to sew: ${row.ready}</p><p>${escape(row.notes)}${row.instructions ? "\n" + escape(row.instructions) : ""}</p>${table(["Action", "Pieces", "Recorded by", "Recorded at (PH)", "Notes"], row.events.map(event => [event.kind, event.quantity, event.recorder, phDate(event.at), event.notes]))}`).join("")}
    <footer>Figures cover only the selected orders and sewers. Assignment and handoff quantities are movements, not additional finished pieces.</footer></body></html>`;
}

export function printSewingReport(report: SewingReport) {
  const preview = window.open("", "_blank");
  if (!preview) throw new Error("Allow pop-ups for this site to print the sewing report, then try again.");
  preview.opener = null;
  preview.document.open(); preview.document.write(sewingReportPrintHtml(report)); preview.document.close();
  preview.focus(); preview.print();
}
