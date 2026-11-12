"use client";

import { sewerPaySummaries } from "@/lib/sewer-pay-report";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readAllRows } from "@/lib/workspace-loading";
import { ExcelExport } from "@/components/ui/excel-export";
import { SearchableList } from "@/components/ui/searchable-list";

type Row = { id: string; employeeId: string; employee: string; date: string; team: string; order: string; mode: string; quantity: number; rate: number; total: number };
const peso = (amount: number) => amount.toLocaleString("en-PH", { style: "currency", currency: "PHP" });

export function SewerPayReport({ orders }: { orders: { dbId: string; id: string; customer: string }[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setRows([]);
    const db = createClient();
    async function load() {
      const [work, assignments, employees] = await Promise.all([
        readAllRows((from, to) => db.from("employee_work_records").select("id,employee_id,order_id,sewing_assignment_id,work_date,quantity,unit_rate").eq("role", "sewer").eq("status", "approved").eq("pay_eligible", true).not("sewing_assignment_id", "is", null).order("work_date").order("id").range(from, to)),
        readAllRows((from, to) => db.from("sewing_assignments").select("id,pricing_mode").order("id").range(from, to)),
        readAllRows((from, to) => db.from("profiles").select("id,full_name").order("id").range(from, to)),
      ]);
      const modes = new Map(assignments.map(a => [a.id, a.pricing_mode]));
      const names = new Map(employees.map(e => [e.id, e.full_name]));
      if (active) setRows(work.map(w => ({ id: w.id, employeeId: w.employee_id, employee: names.get(w.employee_id) ?? "Unknown sewer", date: w.work_date, team: w.order_id ?? "", order: w.order_id ?? "", mode: modes.get(w.sewing_assignment_id) ?? "unknown", quantity: Number(w.quantity), rate: Number(w.unit_rate), total: Math.round(Number(w.quantity) * Number(w.unit_rate) * 100) / 100 })));
    }
    void load().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load sewer pay."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  const filtered = useMemo(() => rows.filter(r => (!start || r.date >= start) && (!end || r.date <= end)).map(row => {
    const order = orders.find(order => order.dbId === row.order);
    return { ...row, team: order?.customer ?? "Team unavailable", order: order?.id ?? "No linked order" };
  }), [rows, start, end, orders]);
  const summaries = useMemo(() => {
    return sewerPaySummaries(filtered);
  }, [filtered]);
  const invalidDates = Boolean(start && end && start > end);
  return <section className="panel">
    <div className="panel-heading"><div><div className="section-kicker">SEWER PAY REPORT</div><h2>Regular &amp; Promo pay per sewer</h2></div><button className="filter-button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh</button></div>
    <p>Approved assignment piece pay using saved rates. Totals exclude fixed salary, overtime and deductions.</p>
    <label className="notes-label">From work date<input type="date" value={start} onChange={e => setStart(e.target.value)}/></label>
    <label className="notes-label">To work date<input type="date" value={end} onChange={e => setEnd(e.target.value)}/></label>
    {invalidDates && <p role="alert">End date must be on or after start date.</p>}
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Loading sewer pay...</p> : !error && !invalidDates && <>
      <ExcelExport title="Sewer pay totals" columns={[{header:"Sewer",width:24},{header:"Regular pieces",width:24},{header:"Regular pay (PHP)",width:24},{header:"Promo pieces",width:24},{header:"Promo pay (PHP)",width:24},{header:"Total pieces",width:24},{header:"Total pay (PHP)",width:24}]} rows={summaries.map(([, s]) => [s.employee,s.regularPieces,s.regularPay,s.promoPieces,s.promoPay,s.pieces,s.total])}/>
      <SearchableList className="table-wrap"><table><thead><tr><th>SEWER</th><th>REGULAR PIECES</th><th>REGULAR PAY</th><th>PROMO PIECES</th><th>PROMO PAY</th><th>TOTAL PIECES</th><th>TOTAL PAY</th></tr></thead><tbody>{summaries.map(([id,s]) => <tr key={id}><td><b>{s.employee}</b></td><td>{s.regularPieces}</td><td>{peso(s.regularPay)}</td><td>{s.promoPieces}</td><td>{peso(s.promoPay)}</td><td>{s.pieces}</td><td><b>{peso(s.total)}</b></td></tr>)}</tbody><tfoot><tr><td colSpan={5}>Grand total</td><td>{filtered.reduce((sum,r) => sum+r.quantity,0)}</td><td><b>{peso(filtered.reduce((sum,r) => sum+r.total,0))}</b></td></tr></tfoot></table></SearchableList>
      <h3>Assignment rate breakdown</h3>
      <ExcelExport title="Sewer pay breakdown" columns={[{header:"Work date",width:24},{header:"Sewer",width:24},{header:"Team",width:24},{header:"Job order",width:24},{header:"Price type",width:24},{header:"Pieces",width:24},{header:"Rate (PHP)",width:24},{header:"Total pay (PHP)",width:24}]} rows={filtered.map(r => [r.date,r.employee,r.team,r.order,r.mode,r.quantity,r.rate,r.total])}/>
      <SearchableList className="table-wrap"><table><thead><tr><th>WORK DATE</th><th>SEWER</th><th>TEAM NAME</th><th>JOB ORDER</th><th>PRICE TYPE</th><th>PIECES</th><th>RATE / PIECE</th><th>TOTAL PAY</th></tr></thead><tbody>{filtered.map(r => <tr key={r.id}><td>{r.date}</td><td>{r.employee}</td><td><b>{r.team}</b></td><td>{r.order}</td><td>{r.mode === "regular" ? "Regular" : r.mode === "promo" ? "Promo" : "Unspecified"}</td><td>{r.quantity}</td><td>{peso(r.rate)}</td><td><b>{peso(r.total)}</b></td></tr>)}</tbody></table></SearchableList>
      {!filtered.length && <p className="empty-inline">No approved assignment pay for this period.</p>}
    </>}
  </section>;
}
