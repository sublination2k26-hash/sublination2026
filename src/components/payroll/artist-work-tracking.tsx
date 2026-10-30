"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readAllRows } from "@/lib/workspace-loading";

type ArtistTask = {
  id: string; status: string; assigned_to: string | null; started_by: string | null;
  completed_by: string | null; started_at: string | null; completed_at: string | null; notes: string | null;
  order: { order_number: string; status: string } | null;
  item: { product_name: string; quantity: number } | null;
};
type Account = { id: string; full_name: string; role: string; active: boolean };
const statuses: Record<string, string> = {
  pending: "Pending", in_progress: "In progress", completed: "Completed",
  returned_for_correction: "Returned for correction", blocked: "Blocked",
};
const dateTime = (value: string | null) => value
  ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "—";

export function ArtistWorkTracking({ employees }: { employees: Account[] }) {
  const [tasks, setTasks] = useState<ArtistTask[]>([]);
  const [artist, setArtist] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const rows = await readAllRows((from, to) => createClient().from("production_tasks")
        .select("id,status,assigned_to,started_by,completed_by,started_at,completed_at,notes,order:orders!production_tasks_order_id_fkey(order_number,status),item:order_items!production_tasks_order_item_id_fkey(product_name,quantity)")
        .eq("stage", "layout").order("id").range(from, to).abortSignal(signal));
      if (!signal.aborted) setTasks(rows as unknown as ArtistTask[]);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "Artist work could not load.");
    } finally { if (!signal.aborted) setLoading(false); }
  }, []);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, version]);
  const names = useMemo(() => new Map(employees.map(employee => [employee.id, employee.full_name])), [employees]);
  const visible = tasks.filter(task => (!artist || [task.assigned_to, task.started_by, task.completed_by].includes(artist)) && (!status || task.status === status))
    .sort((a, b) => (b.completed_at ?? b.started_at ?? "").localeCompare(a.completed_at ?? a.started_at ?? ""));
  const name = (id: string | null) => id ? names.get(id) ?? "Staff member" : "—";

  return <section className="payroll-section" aria-labelledby="artist-work-heading">
    <div className="payroll-section-heading"><div><h2 id="artist-work-heading">Artist / layout work tracking</h2><p>See what each artist is working on and has completed while reviewing payroll.</p></div><button className="quiet-button" type="button" disabled={loading} onClick={() => setVersion(value => value + 1)}><RefreshCw size={14}/>Refresh artist work</button></div>
    <div className="payroll-form-grid">
      <label>Artist<select value={artist} onChange={event => setArtist(event.target.value)}><option value="">All artists and unassigned work</option>{employees.filter(employee => employee.role === "artist" || tasks.some(task => [task.started_by, task.completed_by, task.assigned_to].includes(employee.id))).map(employee => <option key={employee.id} value={employee.id}>{employee.full_name}{employee.active ? "" : " (inactive)"}</option>)}</select></label>
      <label>Work status<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {error && <p className="payroll-alert is-error" role="alert">{error}</p>}
    <p className="payroll-footnote">{visible.length} layout tasks · {visible.filter(task => task.status === "in_progress").length} in progress · {visible.filter(task => task.status === "completed").length} completed. Times are Philippine time.</p>
    <div className="payroll-table-wrap"><table><thead><tr><th>ARTIST</th><th>ORDER / WORK</th><th>QTY</th><th>STATUS</th><th>STARTED</th><th>COMPLETED</th></tr></thead><tbody>
      {visible.map(task => <tr key={task.id}>
        <td>{name(task.status === "completed" ? task.completed_by ?? task.started_by ?? task.assigned_to : task.started_by ?? task.assigned_to)}{!task.started_by && !task.completed_by && !task.assigned_to && <small>Not assigned / not started</small>}</td>
        <td>{task.order?.order_number ?? "Order unavailable"}<small>{task.item?.product_name ?? "Layout / design"}</small>{task.notes && <small>{task.notes}</small>}{task.order && ["cancelled", "released"].includes(task.order.status) && <small>Order {task.order.status}</small>}</td>
        <td>{task.item?.quantity ?? "—"}</td><td><span className={`payroll-status ${task.status}`}>{statuses[task.status] ?? task.status}</span></td>
        <td>{dateTime(task.started_at)}{task.started_by && <small>By {name(task.started_by)}</small>}</td>
        <td>{dateTime(task.completed_at)}{task.completed_by && <small>By {name(task.completed_by)}</small>}</td>
      </tr>)}
    </tbody></table>{loading && <p role="status" className="payroll-empty">Loading artist activities…</p>}{!loading && !error && !visible.length && <p className="payroll-empty">No layout tasks match these filters. Artist work appears here when orders include layout/design.</p>}</div>
    <p className="payroll-footnote">Completed artist activities can be reviewed in the work review queue below. Artist salary continues to use approved attendance.</p>
  </section>;
}
