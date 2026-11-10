"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readAllRows } from "@/lib/workspace-loading";
import { buildCompleteSewingExcel, buildSewingReport, printSewingReport } from "@/lib/sewing-report";
import { garmentCategories } from "@/lib/garment-options";
import { getOwnSewingRate } from "@/actions/employees";
import "./sewing.css";
import { SewingEarnings } from "./sewing-earnings";

type Task = { id: string; order_id: string; order_item_id: string; stage: string; status: string };
type Item = { id: string; product_name: string; quantity: number; customization: { names?: string; garment?: string }; notes: string | null };
type Order = { customer_id: string; id: string; order_number: string; status: string; notes: string | null; due_date: string | null };
type Employee = { id: string; full_name: string; role: string; active: boolean };
type Assignment = { id: string; task_id: string | null; employee_id: string; quantity: number; assigned_by: string; notes: string; created_at: string };
type SewingEvent = { id: string; assignment_id: string; kind: string; quantity: number; recorded_by: string; notes: string; created_at: string };
type QueueEntry = { task_id: string; available_quantity: number; claimed_quantity: number };
type Data = { tasks: Task[]; items: Item[]; orders: Order[]; employees: Employee[]; assignments: Assignment[]; events: SewingEvent[]; queue: QueueEntry[] };
const empty: Data = { tasks: [], items: [], orders: [], employees: [], assignments: [], events: [], queue: [] };
const stageNames: Record<string, string> = { layout: "Layout", printing: "Printing", heat_press: "Heat Press", cutting: "Cutting", sewing: "Sewing", qc: "QC" };
const sequence = ["layout", "printing", "heat_press", "cutting", "sewing", "qc"];
const message = (error: unknown) => error instanceof Error ? error.message : (error as { message?: string })?.message ?? "Could not save. Please try again.";

export function SewingManager({ userId, role, initialOrderId = "" }: { userId: string; role: string; initialOrderId?: string }) {
  const [data, setData] = useState<Data>(empty);
  const [customers, setCustomers] = useState<{ id: string; full_name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [rate, setRate] = useState<Awaited<ReturnType<typeof getOwnSewingRate>>>({});
  const [garmentRates, setGarmentRates] = useState<{ garment: string; unit_rate: number }[]>([]);
  const [ratesError, setRatesError] = useState("");
  const [ratesLoading, setRatesLoading] = useState(true);
  const [estimateGarment, setEstimateGarment] = useState("Jersey");
  const [estimateQuantity, setEstimateQuantity] = useState("1");
  const [selected, setSelected] = useState(initialOrderId);
  const [reportSewer, setReportSewer] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const saving = useRef(false);
  const pending = useRef(new Map<string, string>());
  const version = useRef(0);
  const canAssign = role === "admin" || role === "front_desk";

  const load = useCallback(async (background = false) => {
    const attempt = ++version.current;
    if (!background) setLoading(true);
    try {
      const db = createClient();
      const results = await Promise.all([
        readAllRows((from, to) => db.from("production_tasks").select("id,order_id,order_item_id,stage,status").order("id").range(from, to)),
        readAllRows((from, to) => db.from("order_items").select("id,product_name,quantity,customization,notes").order("id").range(from, to)),
        readAllRows((from, to) => db.from("orders").select("id,customer_id,order_number,status,notes,due_date").order("created_at", { ascending: false }).order("id").range(from, to)),
        readAllRows((from, to) => db.from("profiles").select("id,full_name,role,active").order("id").range(from, to)),
        readAllRows((from, to) => db.from("sewing_assignments").select("*").order("created_at").order("id").range(from, to)),
        readAllRows((from, to) => db.from("sewing_events").select("*").order("created_at").order("id").range(from, to)),
        readAllRows((from, to) => db.rpc("get_sewing_queue").order("task_id").range(from, to)),
        readAllRows((from, to) => db.from("customers").select("id,full_name").order("id").range(from, to)),
      ]);
      if (attempt !== version.current) return;
      setData({ tasks: results[0] as Task[], items: results[1] as Item[], orders: results[2] as Order[], employees: results[3] as Employee[], assignments: results[4] as Assignment[], events: results[5] as SewingEvent[], queue: results[6] as QueueEntry[] });
      setCustomers(results[7] as { id: string; full_name: string }[]);
      setError("");
    } catch (cause) {
      if (attempt === version.current) setError(`Could not load sewing tracking. Apply the sewer assignments and sewer self-claim migrations if needed. ${message(cause)}`);
    } finally { if (attempt === version.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { version.current++; }; }, [load]);
  useEffect(() => {
    const refresh = () => { if (!saving.current && document.visibilityState === "visible") void load(true); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>, action: string, taskId: string, assignmentId?: string) {
    event.preventDefault();
    if (saving.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const quantity = Number(values.get("quantity"));
    if (!Number.isSafeInteger(quantity) || quantity < 1) { setError("Enter a positive whole number of pieces."); return; }
    const args = { p_action: action, p_task_id: taskId, p_assignment_id: assignmentId ?? null, p_employee_id: values.get("employee") || null, p_quantity: quantity, p_notes: String(values.get("notes") ?? "").trim() };
    const signature = JSON.stringify(args);
    if (!pending.current.has(signature)) pending.current.set(signature, crypto.randomUUID());
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const db = createClient();
      const { error: saveError } = action === "claim"
        ? await db.rpc("claim_sewing_pieces", { p_task_id: taskId, p_quantity: quantity, p_notes: args.p_notes, p_request_id: pending.current.get(signature)! })
        : await db.rpc("record_sewing_action", { ...args, p_request_id: pending.current.get(signature)! });
      if (saveError) throw saveError;
      pending.current.delete(signature);
      form.reset();
      setNotice(action === "claim" ? "Pieces assigned to you. Wait for the materials handoff before recording output." : action === "assign" ? "Assignment saved. The sewer can see it immediately." : action === "handoff" ? "Materials handoff recorded." : "Sewing output saved for admin payroll review.");
      await load();
    } catch (cause) { setError(message(cause)); }
    finally { saving.current = false; setBusy(false); }
  }

  async function example() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const { data: orderId, error: createError } = await createClient().rpc("create_sewing_example_order");
      if (createError) throw createError;
      setSelected(orderId as string);
      setNotice("Example order: 24 jerseys. Sewers can now choose and claim their own quantities from the shared queue. Example output is excluded from piece pay by default.");
      await load();
    } catch (cause) { setError(message(cause)); }
    finally { saving.current = false; setBusy(false); }
  }

  useEffect(() => {
    let cancelled = false;
    if (role !== "cutting_sewing") return;
    void Promise.allSettled([
      getOwnSewingRate(),
      readAllRows((from, to) => createClient().from("sewing_garment_rates").select("garment,unit_rate").eq("employee_id", userId).order("garment").range(from, to)),
    ]).then(([defaultRate, garments]) => {
      if (cancelled) return;
      setRate(defaultRate.status === "fulfilled" ? defaultRate.value : { error: "Could not load your default sewing rate." });
      setGarmentRates(garments.status === "fulfilled" ? garments.value as { garment: string; unit_rate: number }[] : []);
      setRatesError(garments.status === "rejected" ? "Could not load garment rates. Press Refresh to try again." : "");
      setRatesLoading(false);
    });
    return () => { cancelled = true; };
  }, [role, userId, data]);
  const pricePerPiece = (garment?: string) => {
    if (ratesLoading) return "Loading rate...";
    if (rate.error) return rate.error;
    if (rate.rate === null) return "Rate not configured. Ask admin to set your sewing pay.";
    if (rate.basis === "fixed") return "Fixed salary (no piece pay)";
    if (ratesError && garment) return "Garment rate unavailable. Press Refresh to try again.";
    const price = garmentRates.find(entry => entry.garment === garment)?.unit_rate ?? rate.rate;
    return price === undefined ? "Rate not configured. Ask admin to set your sewing pay." : `PHP ${Number(price).toFixed(2)} per piece`;
  };
  const estimateRate = ratesLoading || rate.error || rate.rate == null || ratesError ? null
    : rate.basis === "fixed" ? 0 : Number(garmentRates.find(entry => entry.garment === estimateGarment)?.unit_rate ?? rate.rate);
  const estimatePieces = Number(estimateQuantity);
  const validEstimate = estimateQuantity.trim() !== "" && Number.isSafeInteger(estimatePieces) && estimatePieces > 0;
  const teamName = (order: Order) => customers.find(customer => customer.id === order.customer_id)?.full_name ?? "Unnamed team";
  const employeeName = (id: string) => data.employees.find(employee => employee.id === id)?.full_name ?? "Staff";
  const totals = (assignmentId: string, kind: string) => data.events.reduce((sum, entry) => sum + (entry.assignment_id === assignmentId && entry.kind === kind ? entry.quantity : 0), 0);
  const visibleTasks = data.tasks.filter(task => task.stage === "sewing" && (canAssign || data.queue.some(entry => entry.task_id === task.id) || data.assignments.some(a => a.task_id === task.id && a.employee_id === userId)));
  const visibleOrders = data.orders.filter(order => visibleTasks.some(task => task.order_id === order.id));
  const tasks = visibleTasks.filter(task => {
    const order = data.orders.find(order => order.id === task.order_id);
    return (!selected || task.order_id === selected) && (!search.trim() || Boolean(order && `${teamName(order)} ${order.order_number}`.toLowerCase().includes(search.trim().toLowerCase())));
  });
  const report = buildSewingReport({ ...data, customers }, selected, canAssign ? reportSewer : userId);
  const canReport = !loading && !busy && !error && report.summaries.length > 0;
  async function exportComplete() {
    if (exportLock.current || !canReport) return;
    exportLock.current = true; setExporting(true);
    try {
      const buffer = await buildCompleteSewingExcel(report);
      const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `sewing-complete-report-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}.xlsx`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (cause) { setError(`Could not export sewing details. ${message(cause)}`); }
    finally { exportLock.current = false; setExporting(false); }
  }

  return <div className="sewing-workspace">
    <div className="sewing-toolbar"><label>Search team / JO<input type="search" value={search} onChange={event => { setSearch(event.target.value); setSelected(""); }} placeholder="Team name or JO number"/></label><label>Team / customer<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">All sewing orders</option>{visibleOrders.map(order => <option key={order.id} value={order.id}>{teamName(order)} / {order.order_number}{order.notes?.startsWith("[SEWING EXAMPLE]") ? " · EXAMPLE" : ""}</option>)}</select></label><button className="filter-button" disabled={busy || loading} onClick={() => void load()}>Refresh</button>{canAssign && <button className="primary-button" disabled={busy || loading} onClick={() => void example()}>Create example order</button>}</div>
    {role === "cutting_sewing" && <section className="panel sewing-rates" aria-label="Your sewing prices">
      <h2>Your price per tahi</h2>
      <p><b>Default rate:</b> {pricePerPiece()}</p>
      {ratesError && <p role="alert">{ratesError}</p>}
      {!ratesLoading && !rate.error && rate.rate !== null && rate.basis !== "fixed" && garmentRates.length > 0 && <div className="sewing-rate-list">{garmentRates.map(entry => <div key={entry.garment}><span>{entry.garment}</span><b>PHP {Number(entry.unit_rate).toFixed(2)} / piece</b></div>)}</div>}
      {!ratesLoading && !ratesError && !rate.error && rate.rate != null && rate.basis !== "fixed" && garmentRates.length === 0 && <p>No separate garment rates saved. The default rate applies.</p>}
      <div className="sewing-form" role="group" aria-label="Estimate your sewing pay">
        <b>Estimate your sewing pay</b>
        <label>Garment<select value={estimateGarment} onChange={event => setEstimateGarment(event.target.value)}>{garmentCategories.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option}>{option}</option>)}</optgroup>)}</select></label>
        <label>Pieces<input type="number" min={1} step={1} value={estimateQuantity} onChange={event => setEstimateQuantity(event.target.value)}/></label>
        <p aria-live="polite">{estimateRate === null ? "Load your current rates to calculate an estimate." : !validEstimate ? "Enter a positive whole number of pieces." : `${estimatePieces} pieces ? PHP ${estimateRate.toFixed(2)} = PHP ${(estimatePieces * estimateRate).toFixed(2)} estimated output pay.`}</p>
      </div>
      <p>Estimate only, before deductions and adjustments. Actual output pay uses the rate saved at completion and requires payroll approval.</p>
      <p>These are your current rates. Completed output keeps its saved rate and is subject to payroll review.</p>
    </section>}
    {role === "cutting_sewing" && <SewingEarnings userId={userId} refreshToken={data}/>}
    <p>New sewing orders automatically appear in every sewer’s shared queue. Each sewer chooses a quantity and assigns those pieces to themselves. Front Desk records the materials handoff after earlier stages are complete; each sewer records their own output.</p>
    {notice && <p role="status" className="sewing-notice">{notice}</p>}
    {error && <p role="alert" className="blocked-message">{error}</p>}
    {!loading && <section className="panel sewing-order" aria-label="Sewing output report">
      <div className="section-kicker">SEWING DETAILS &amp; REPORTS</div><h2>How many pieces did each sewer finish?</h2>
      <p>The assigned sewer records their own completed pieces. Every assignment, materials handoff, and output entry keeps the recorder’s name and date. Completed output is subject to payroll review and QC.</p>
      <div className="sewing-toolbar">
        {canAssign && <label>Report sewer<select value={reportSewer} onChange={event => setReportSewer(event.target.value)}><option value="">All assigned sewers</option>{data.employees.filter(employee => data.assignments.some(assignment => assignment.employee_id === employee.id)).map(employee => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label>}
        <button type="button" className="filter-button" disabled={!canReport || exporting} onClick={() => void exportComplete()}>{exporting ? "Preparing Excel…" : "Excel — complete sewing report"}</button>
        <button type="button" className="filter-button" disabled={!canReport} onClick={() => { try { printSewingReport(report); } catch (cause) { setError(message(cause)); } }}>Print sewing details</button>
      </div>
      <p>Excel includes three sheets: Sewer totals, Order breakdown, and Activity history. Choose All sewing orders and All assigned sewers to include every sewer’s recorded work. Rework does not add to completed pieces. Each sheet is ready to print with repeating headers.</p>
      <div className="sewing-totals"><span>Assigned<b>{report.totals.assigned}</b></span><span>Handed over<b>{report.totals.handed}</b></span><span>Completed<b>{report.totals.completed}</b></span><span>Remaining<b>{report.totals.remaining}</b></span><span>Rework<b>{report.totals.rework}</b></span></div>
      <div className="table-wrap"><table><thead><tr><th>JOB ORDER / PRODUCT</th><th>ASSIGNED SEWER</th><th>ASSIGNED BY / DATE</th><th>ASSIGNED</th><th>HANDED OVER</th><th>COMPLETED</th><th>REMAINING</th><th>REWORK</th><th>LAST OUTPUT RECORDER / DATE</th></tr></thead><tbody>{report.summaries.map(row => <tr key={row.id}><td><b>{row.team || row.order}</b><small>{row.order} ? {row.product}</small></td><td>{row.sewer}</td><td>{row.assignedBy}<small>{row.assignedAt}</small></td><td>{row.assigned}</td><td>{row.handed}</td><td><b>{row.completed}</b></td><td>{row.remaining}</td><td>{row.rework}</td><td>{row.recordedBy || "No output yet"}<small>{row.lastOutput}</small></td></tr>)}</tbody></table></div>
      {report.summaries.length === 0 && <p>No recorded assignments match this report.</p>}
    </section>}
    {loading ? <p role="status">Loading sewing work…</p> : tasks.length === 0 ? <p>No sewing orders found.{canAssign ? " Create a garment order or use the example above." : " New orders that include sewing will appear here automatically."}</p> : tasks.map(task => {
      const item = data.items.find(value => value.id === task.order_item_id);
      const order = data.orders.find(value => value.id === task.order_id);
      if (!item || !order) return null;
      const assignments = data.assignments.filter(value => value.task_id === task.id && (canAssign || value.employee_id === userId));
      const assigned = assignments.reduce((sum, value) => sum + value.quantity, 0);
      const handed = assignments.reduce((sum, value) => sum + totals(value.id, "handoff"), 0);
      const completed = assignments.reduce((sum, value) => sum + totals(value.id, "completion"), 0);
      const upstream = data.tasks.filter(value => value.order_item_id === task.order_item_id && sequence.indexOf(value.stage) < sequence.indexOf("sewing"));
      const ready = upstream.every(value => value.status === "completed");
      const closed = ["cancelled", "released", "ready_for_release"].includes(order.status);
      const availability = data.queue.find(entry => entry.task_id === task.id);
      const available = availability ? Number(availability.available_quantity) : 0;
      const history = data.events.filter(entry => assignments.some(a => a.id === entry.assignment_id));
      return <section key={task.id} className="panel sewing-order">
        <div className="panel-heading"><div><div className="section-kicker">{order.order_number}{order.notes?.startsWith("[SEWING EXAMPLE]") ? " · EXAMPLE" : ""}</div><h2>{teamName(order)}</h2><p><b>{item.product_name}</b></p><p>{item.quantity} pieces in order · Due {order.due_date || "not set"}</p></div><span className="pill blue">{closed ? order.status.replaceAll("_", " ") : task.status === "completed" ? "Sewing completed" : ready ? "Ready for handoff / sewing" : "Waiting for materials"}</span></div>
        {role === "cutting_sewing" && <p className="sewing-job-rate"><b>Your price per tahi{item.customization?.garment ? ` (${item.customization.garment})` : ""}:</b> {pricePerPiece(item.customization?.garment)}</p>}
        <div className="sewing-stages">{sequence.map(stage => { const stageTask = data.tasks.find(value => value.order_item_id === task.order_item_id && value.stage === stage); return stageTask ? <span key={stage} className={stageTask.status === "completed" ? "sewing-stage-done" : ""}>{stageNames[stage]} · {stageTask.status.replaceAll("_", " ")}</span> : null; })}</div>
        {availability && <p><b>{available} pieces available to claim</b> · {Number(availability.claimed_quantity)} pieces already reserved across all sewers.</p>}
        {role === "cutting_sewing" && !closed && available > 0 && <form className="sewing-form" onSubmit={event => void save(event, "claim", task.id)}><b>Choose pieces for yourself</b><label>Pieces to take<input name="quantity" type="number" min={1} max={available} step={1} required disabled={busy}/></label><label>Bundle / sizes / notes<input name="notes" maxLength={1000} disabled={busy}/></label><button className="primary-button" disabled={busy}>Assign to me</button><small>This reserves pieces under your own account. Front Desk confirms the materials handoff before sewing output can be recorded.</small></form>}
        {!ready && <p><a className="text-button" href="/dashboard?view=Production">Open Production to update earlier stages</a></p>}
        <div className="sewing-totals"><span>{canAssign ? "Assigned" : "Assigned to you"}<b>{assigned}</b></span><span>Handed over<b>{handed}</b></span><span>Completed<b>{completed}</b></span><span>Still to sew<b>{assigned - completed}</b></span>{canAssign && <span>Unassigned<b>{item.quantity - assigned}</b></span>}</div>
        {item.customization?.names && <p><b>Sizes / personalization:</b> {item.customization.names}</p>}{item.notes && <p><b>Instructions:</b> {item.notes}</p>}
        {canAssign && !closed && task.status !== "completed" && assigned < item.quantity && <form className="sewing-form" onSubmit={event => void save(event, "assign", task.id)}><label>Sewer<select name="employee" required disabled={busy}><option value="">Choose sewer</option>{data.employees.filter(employee => employee.active && employee.role === "cutting_sewing").map(employee => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label><label>Pieces to assign<input name="quantity" type="number" min={1} max={item.quantity - assigned} step={1} required disabled={busy}/></label><label>Bundle / sizes / instructions<input name="notes" maxLength={1000} disabled={busy}/></label><button className="primary-button" disabled={busy}>Assign pieces</button></form>}
        <div className="table-wrap"><table><thead><tr><th>SEWER</th><th>ASSIGNED</th><th>HANDED OVER</th><th>COMPLETED</th><th>WAITING FOR HANDOFF</th><th>READY TO SEW</th></tr></thead><tbody>{assignments.map(assignment => <tr key={assignment.id}><td><b>{employeeName(assignment.employee_id)}</b><small>Assigned by {employeeName(assignment.assigned_by)}</small><small>{assignment.notes}</small></td><td>{assignment.quantity}</td><td>{totals(assignment.id, "handoff")}</td><td>{totals(assignment.id, "completion")}</td><td>{assignment.quantity - totals(assignment.id, "handoff")}</td><td>{totals(assignment.id, "handoff") - totals(assignment.id, "completion")}</td></tr>)}</tbody></table></div>
        {assignments.length === 0 && <p>{canAssign ? "No pieces assigned yet. Sewers can choose their own quantities from the shared queue." : "You have not claimed pieces from this order yet."}</p>}
        {!closed && assignments.map(assignment => {
          const toHand = assignment.quantity - totals(assignment.id, "handoff");
          const toSew = totals(assignment.id, "handoff") - totals(assignment.id, "completion");
          return <div key={assignment.id} className="sewing-actions">
            {canAssign && toHand > 0 && <form className="sewing-form" onSubmit={event => void save(event, "handoff", task.id, assignment.id)}><b>Hand over to {employeeName(assignment.employee_id)}</b><label>Ready-to-sew pieces<input name="quantity" type="number" min={1} max={toHand} step={1} required disabled={busy || !ready}/></label><label>Handoff note<input name="notes" maxLength={1000} disabled={busy || !ready}/></label><button className="filter-button" disabled={busy || !ready}>Record handoff</button>{!ready && <small>Waiting for earlier production stages.</small>}</form>}
            {role === "cutting_sewing" && assignment.employee_id === userId && toSew > 0 && <form className="sewing-form" onSubmit={event => void save(event, "completion", task.id, assignment.id)}><b>Your sewing output</b><label>Pieces completed<input name="quantity" type="number" min={1} max={toSew} step={1} required disabled={busy || !ready}/></label><label>Output note<input name="notes" maxLength={1000} disabled={busy}/></label><button className="primary-button" disabled={busy || !ready}>Record completed pieces</button></form>}
            {role === "cutting_sewing" && assignment.employee_id === userId && totals(assignment.id, "completion") > 0 && <details><summary>Record rework (excluded from piece pay by default)</summary><form className="sewing-form" onSubmit={event => void save(event, "rework", task.id, assignment.id)}><label>Pieces corrected<input name="quantity" type="number" min={1} max={totals(assignment.id, "completion")} step={1} required disabled={busy || !ready}/></label><label>Correction reason<input name="notes" maxLength={1000} required disabled={busy}/></label><button className="filter-button" disabled={busy || !ready}>Record rework</button></form></details>}
          </div>;
        })}
        {history.length > 0 && <details className="sewing-history"><summary>Handoff and output history ({history.length})</summary><div className="table-wrap"><table><thead><tr><th>DATE</th><th>SEWER</th><th>ACTION</th><th>PIECES</th><th>RECORDED BY</th><th>NOTE</th></tr></thead><tbody>{history.map(entry => <tr key={entry.id}><td>{new Date(entry.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td><td>{employeeName(assignments.find(a => a.id === entry.assignment_id)!.employee_id)}</td><td>{entry.kind}</td><td>{entry.quantity}</td><td>{employeeName(entry.recorded_by)}</td><td>{entry.notes}</td></tr>)}</tbody></table></div></details>}
        <p className="workflow-hint">Sewing moves to completed when all {item.quantity} pieces are recorded. Admin reviews each sewer’s output separately in Payroll; QC remains a separate inspection.</p>
      </section>;
    })}
  </div>;
}
