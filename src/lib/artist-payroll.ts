export type ArtistAccount = { id: string; full_name: string; role: string; active: boolean };
export type ArtistLayoutTask = {
  id: string; status: string; completed_by: string | null; completed_at: string | null;
  started_by: string | null; started_at: string | null; notes: string | null;
  order: { order_number: string; status: string; notes: string | null; customer: { full_name: string } | null } | null;
  item: { product_name: string; quantity: number } | null;
};
export type ArtistPayrollRecord = {
  id: string; employee_id: string; employee_name: string; period_start: string; period_end: string;
  layout_count: number; unit_rate: number; total_pay: number; payslip_id: string; created_at: string;
};
export type ArtistPayrollItem = { record_id: string; task_reference: string; order_number: string; team_name: string; garment: string; completed_at: string };
export function artistManilaDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
export function artistCutoffTasks(tasks: ArtistLayoutTask[], employees: ArtistAccount[], start: string, end: string, employeeId = "") {
  const artists = new Set(employees.filter(employee => employee.role === "artist").map(employee => employee.id));
  if (!start || !end || start > end) return [];
  return tasks.filter(task => {
    if (task.status !== "completed" || !task.completed_by || !task.completed_at || !artists.has(task.completed_by)) return false;
    if (!task.order || task.order.notes?.startsWith("[SEWING EXAMPLE]")) return false;
    if (employeeId && task.completed_by !== employeeId) return false;
    const day = artistManilaDate(task.completed_at);
    return day >= start && day <= end;
  }).sort((a,b) => b.completed_at!.localeCompare(a.completed_at!) || a.id.localeCompare(b.id));
}
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
const money = (amount: number) => Number(amount).toLocaleString("en-PH", { style: "currency", currency: "PHP" });
export function artistPayrollPrintHtml(record: ArtistPayrollRecord, items: ArtistPayrollItem[]) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Artist payroll record</title><style>@page{size:A4;margin:15mm}body{font:13px Arial,sans-serif;color:#172b45}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{border:1px solid #aaa;padding:8px;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}.total{font-size:18px;font-weight:bold}@media print{button{display:none}}</style></head><body><h1>Artist payroll record</h1><p><b>Artist:</b> ${escape(record.employee_name)}</p><p><b>Cutoff:</b> ${escape(record.period_start)} to ${escape(record.period_end)}</p><p><b>Record:</b> ${escape(record.id)}<br><b>Payslip:</b> ${escape(record.payslip_id)}</p><p>${record.layout_count} completed layouts × ${escape(money(record.unit_rate))} per layout</p><p class="total">Total pay: ${escape(money(record.total_pay))}</p><table><thead><tr><th>Team</th><th>Job order</th><th>Work</th><th>Completed (PH)</th><th>Layout pay</th></tr></thead><tbody>${items.filter(item=>item.record_id===record.id).map(item=>`<tr><td>${escape(item.team_name)}</td><td>${escape(item.order_number)}</td><td>${escape(item.garment)}</td><td>${escape(new Date(item.completed_at).toLocaleString("en-PH",{timeZone:"Asia/Manila"}))}</td><td>${escape(money(record.unit_rate))}</td></tr>`).join("")}</tbody></table><p>Saved payroll record. This document does not confirm payment received.</p><p>Prepared by: ____________________</p><p>Received by / date: ____________________</p></body></html>`;
}
export function printArtistPayroll(record: ArtistPayrollRecord, items: ArtistPayrollItem[]) {
  const preview = window.open("", "_blank");
  if (!preview) throw new Error("Allow pop-ups to print the artist payroll record.");
  preview.opener = null;
  preview.document.open(); preview.document.write(artistPayrollPrintHtml(record,items)); preview.document.close();
  preview.focus(); preview.print();
}
