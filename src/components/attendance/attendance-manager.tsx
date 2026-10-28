"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Download, Pencil, Plus, QrCode, ScanLine, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { attendanceRoles, logStatus, manilaToday, money, punchLabels, timeLabel, type Punch, type TimeLog } from "@/lib/attendance";
import { ExcelExport } from "@/components/ui/excel-export";
import { AttendanceDialog } from "./attendance-dialog";
import { QrCamera } from "./qr-camera";
import "./attendance.css";

type Employee = { id: string; full_name: string; role: string; active: boolean };
type Credential = { employee_id: string; token: string; payment_method: string };
type Compensation = { employee_id: string; base_rate: number; pay_frequency: string };
type Log = TimeLog & { approval_status: "pending" | "approved" | "rejected"; id: string; employee_id: string; work_date: string; hours: number; deductions: number | null; net_pay: number | null; daily_rate_snapshot: number | null; notes: string | null; payroll_run_id: string | null; attendance_method: string; scheduled_am_start: string | null; scheduled_am_end: string | null; scheduled_pm_start: string | null; scheduled_pm_end: string | null };
type Schedule = { am_start: string; am_end: string; pm_start: string; pm_end: string; grace_minutes: number; deduct_late: boolean; deduct_undertime: boolean };
type Modal = { kind: "salary"; employee?: string } | { kind: "qr"; employee: string } | { kind: "log"; employee?: string } | { kind: "scan" } | { kind: "schedule" } | { kind: "delete"; employee: string };
const emptyTimes: TimeLog = { am_in: null, am_out: null, pm_in: null, pm_out: null };
const message = (error: unknown) => error && typeof error === "object" && "message" in error ? String(error.message) : "Could not save attendance. Please try again.";

export function AttendanceManager({ isAdmin, currentEmployee }: { isAdmin: boolean; currentEmployee: Employee }) {
  const [db] = useState(createClient);
  const [tab, setTab] = useState<"logs" | "qr">("logs");
  const [date, setDate] = useState(manilaToday), [filterDate, setFilterDate] = useState(manilaToday);
  const [employees, setEmployees] = useState<Employee[]>([]), [credentials, setCredentials] = useState<Credential[]>([]), [rates, setRates] = useState<Compensation[]>([]), [logs, setLogs] = useState<Log[]>([]);
  const [schedule, setSchedule] = useState<Schedule>({ am_start: "08:00", am_end: "12:00", pm_start: "13:00", pm_end: "17:00", grace_minutes: 0, deduct_late: true, deduct_undertime: true });
  const [scheduleEdit, setScheduleEdit] = useState(schedule);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [modal, setModal] = useState<Modal | null>(null), [employeeId, setEmployeeId] = useState("");
  const [salary, setSalary] = useState(""), [payment, setPayment] = useState("Cash"), [times, setTimes] = useState<TimeLog>(emptyTimes), [notes, setNotes] = useState("");
  const [qrImage, setQrImage] = useState(""), [action, setAction] = useState<Punch>("am_in"), [token, setToken] = useState("");
  const [camera, setCamera] = useState(false);
  const scanning = useRef(false);
  const loadId = useRef(0);

  const load = useCallback(async () => {
    const request = ++loadId.current;
    setLoading(true);
    setError("");
    try {
      const [e, q, c, a, s] = await Promise.all([
        isAdmin ? db.from("profiles").select("id,full_name,role,active").not("role", "in", "(admin,cutting_sewing)").order("full_name") : Promise.resolve({ data: [currentEmployee], error: null }),
        db.from("employee_attendance_qr").select("employee_id,token,payment_method"),
        db.from("employee_compensation").select("employee_id,base_rate,pay_frequency"),
        db.from("employee_attendance").select("*").eq("work_date", date).order("created_at"),
        db.from("attendance_schedule").select("am_start,am_end,pm_start,pm_end,grace_minutes,deduct_late,deduct_undertime").eq("id", true).single(),
      ]);
      for (const result of [e, q, c, a, s]) if (result.error) throw result.error;
      if (request !== loadId.current) return;
      setEmployees((e.data ?? []) as Employee[]); setCredentials((q.data ?? []) as Credential[]); setRates((c.data ?? []) as Compensation[]); setLogs((a.data ?? []) as Log[]);
      if (s.data) setSchedule(s.data);
    } catch (reason) { if (request === loadId.current) setError(message(reason)); }
    finally { if (request === loadId.current) setLoading(false); }
  }, [db, date, isAdmin, currentEmployee]);
  useEffect(() => { void load(); return () => { loadId.current++; }; }, [load]);
  useEffect(() => {
    let active = true;
    setQrImage("");
    if (modal?.kind === "qr") {
      const credential = credentials.find(item => item.employee_id === modal.employee);
      if (credential) void import("qrcode").then(module => module.toDataURL(credential.token, { width: 320, margin: 4, errorCorrectionLevel: "M" })).then(image => { if (active) setQrImage(image); }).catch(reason => { if (active) setError(message(reason)); });
    }
    return () => { active = false; };
  }, [modal, credentials]);
  const name = (id: string) => employees.find(item => item.id === id)?.full_name ?? "Employee";
  const close = () => { if (!busy) { setModal(null); setCamera(false); } };
  const openSalary = (id = "") => {
    const config = rates.find(item => item.employee_id === id);
    setEmployeeId(id); setSalary(config?.pay_frequency === "daily" ? String(config.base_rate) : "");
    setPayment(credentials.find(item => item.employee_id === id)?.payment_method ?? "Cash");
    setError(""); setModal({ kind: "salary", employee: id || undefined });
  };
  const openLog = (id = "") => {
    const log = logs.find(item => item.employee_id === id);
    setEmployeeId(id); setTimes(log ? { am_in: log.am_in, am_out: log.am_out, pm_in: log.pm_in, pm_out: log.pm_out } : emptyTimes); setNotes(log?.notes ?? "");
    setError(""); setModal({ kind: "log", employee: id || undefined });
  };
  const mutate = async (operation: () => PromiseLike<{ error: unknown }>, success: string) => {
    setBusy(true); setError("");
    try { const result = await operation(); if (result.error) throw result.error; setNotice(success); setModal(null); setCamera(false); await load(); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  };
  const saveSalary = () => {
    const amount = Number(salary);
    if (!employeeId || !salary.trim() || !Number.isFinite(amount) || amount < 0 || !payment.trim()) { setError("Choose an employee and enter a valid daily salary and payment method."); return; }
    void mutate(() => db.rpc("save_attendance_qr", { p_employee_id: employeeId, p_daily_rate: amount, p_payment_method: payment }), "Daily salary and employee QR code saved.");
  };
  const saveLog = () => {
    if (!employeeId) { setError("Choose an employee."); return; }
    void mutate(() => db.rpc("save_attendance_log", { p_employee_id: employeeId, p_work_date: date, p_am_in: times.am_in, p_am_out: times.am_out, p_pm_in: times.pm_in, p_pm_out: times.pm_out, p_notes: notes || null }), "Attendance log saved.");
  };
  const scan = async (value: string) => {
    if (scanning.current) return;
    const clean = value.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)) { setError("Scan a valid employee QR code from this system."); setCamera(false); return; }
    scanning.current = true; setCamera(false);
    try { await mutate(() => db.rpc("clock_attendance_qr", { p_token: clean, p_action: action }), `${punchLabels[action]} submitted using the current Philippine time. Pending admin approval.`); }
    finally { scanning.current = false; }
  };
  const displayDate = new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
  const registered = credentials.filter(q => employees.some(e => e.id === q.employee_id));
  const dailyLogs = logs.filter(log => employees.some(e => e.id === log.employee_id));
  const scheduleText = `${timeLabel(schedule.am_start)}–${timeLabel(schedule.am_end)} / ${timeLabel(schedule.pm_start)}–${timeLabel(schedule.pm_end)}`;
  const reviewStatus = (log: Log) => log.approval_status === "pending" ? "Pending approval" : log.approval_status === "rejected" ? "Rejected" : "Approved";
  const currentLog = logs.find(log => log.employee_id === employeeId);

  return <div className="attendance-manager">
    <div className="attendance-tabs" role="tablist" aria-label="Attendance views">
      <button id="attendance-logs-tab" role="tab" aria-selected={tab === "logs"} aria-controls="attendance-panel" onClick={() => setTab("logs")}>Daily Log Viewer</button>
      <button id="attendance-qr-tab" role="tab" aria-selected={tab === "qr"} aria-controls="attendance-panel" onClick={() => setTab("qr")}>{isAdmin ? "QR Management" : "My QR Code"}</button>
    </div>
    <div className="attendance-policy"><span><b>Work schedule</b> {scheduleText} <small>{schedule.grace_minutes} minute grace period · Late deductions {schedule.deduct_late ? "on" : "off"} · Undertime deductions {schedule.deduct_undertime ? "on" : "off"}. No automatic overtime.</small></span>{isAdmin && <button type="button" className="quiet-button" onClick={() => { setScheduleEdit(schedule); setModal({ kind: "schedule" }); }}>Customize schedule</button>}</div>
    {error && <p className="attendance-error" role="alert">{error}</p>}
    {notice && <p className="attendance-notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice("")}>×</button></p>}
    <section id="attendance-panel" role="tabpanel" aria-labelledby={tab === "logs" ? "attendance-logs-tab" : "attendance-qr-tab"} aria-busy={loading}>
      {tab === "logs" ? <>
        <div className="attendance-card">
          <div className="attendance-card-header"><h2><CalendarDays size={21}/>Logs: {displayDate}</h2><form onSubmit={event => { event.preventDefault(); if (filterDate === date) void load(); else setDate(filterDate); }}><label className="attendance-sr-only" htmlFor="attendance-date">Log date</label><input id="attendance-date" type="date" value={filterDate} required onChange={event => setFilterDate(event.target.value)}/><button type="submit" className="attendance-dark" disabled={loading}>Filter</button></form></div>
          <div className="attendance-table-scroll"><table><thead><tr><th>Employee</th><th>AM in / out</th><th>PM in / out</th><th>Deductions</th><th>Net pay</th><th>Status</th>{isAdmin && <th>Actions</th>}</tr></thead><tbody>{!loading && dailyLogs.map(log => <tr key={log.id}>
            <td><b>{name(log.employee_id)}</b><small>{attendanceRoles[employees.find(e => e.id === log.employee_id)?.role ?? ""]}</small></td>
            <td>{timeLabel(log.am_in)} / {timeLabel(log.am_out)}</td><td>{timeLabel(log.pm_in)} / {timeLabel(log.pm_out)}</td>
            <td>{log.deductions == null ? "—" : money(log.deductions)}<small>Unworked scheduled time</small></td><td><b>{log.approval_status === "rejected" ? "Excluded from payroll" : log.approval_status === "pending" ? "Awaiting review" : log.net_pay == null ? "Legacy hours" : money(log.net_pay)}</b><small>{log.hours} {log.approval_status === "approved" ? "paid" : "calculated"} hours{log.attendance_method === "time_log" && logStatus(log) === "Incomplete" ? " · provisional" : ""}</small></td>
            <td><span className={`attendance-badge ${logStatus(log) === "Incomplete" ? "warning" : ""}`}>{reviewStatus(log)}</span><small>{log.attendance_method === "hours" ? "Legacy hours" : logStatus(log)}</small>{log.payroll_run_id && <small>In payroll · locked</small>}{log.notes && <small>{log.notes}</small>}</td>
            {isAdmin && <td>{log.approval_status === "pending" && <div className="attendance-inline-actions">{(["approved", "rejected"] as const).map(status => <button key={status} className="quiet-button" disabled={busy || !!log.payroll_run_id} onClick={() => void mutate(() => db.rpc("review_attendance_log", { p_log_id: log.id, p_status: status }), `Attendance ${status}.`)}>{status === "approved" ? "Approve" : "Reject"}</button>)}</div>}<button className="quiet-button" disabled={busy || !!log.payroll_run_id} onClick={() => openLog(log.employee_id)}><Pencil size={14}/>Edit log</button></td>}
          </tr>)}</tbody></table>{loading ? <p className="attendance-empty">Loading attendance…</p> : !dailyLogs.length && <p className="attendance-empty">No attendance records for {displayDate}.</p>}</div>
        </div>
        <div className="attendance-bottom-actions"><div className="attendance-inline-actions">{!isAdmin && <button className="attendance-red" disabled={loading} onClick={() => { setToken(""); setCamera(false); setError(""); setModal({ kind: "scan" }); }}><ScanLine size={17}/>Scan my QR</button>}{isAdmin && <button className="quiet-button" disabled={loading || date > manilaToday()} onClick={() => openLog()}><Plus size={16}/>Add log</button>}</div>
          <ExcelExport label="Export This Day" title={`Attendance ${date}`} columns={[{ header: "Employee", width: 20 }, { header: "Date", width: 20 }, { header: "AM in", width: 20 }, { header: "AM out", width: 20 }, { header: "PM in", width: 20 }, { header: "PM out", width: 20 }, { header: "Hours", width: 20 }, { header: "Deductions", width: 20 }, { header: "Net pay", width: 20 }, { header: "Status", width: 20 }]} rows={loading ? [] : dailyLogs.map(log => [name(log.employee_id), date, timeLabel(log.am_in), timeLabel(log.am_out), timeLabel(log.pm_in), timeLabel(log.pm_out), Number(log.hours), log.deductions == null ? "" : Number(log.deductions), log.approval_status !== "approved" || log.net_pay == null ? "" : Number(log.net_pay), `${reviewStatus(log)} / ${log.attendance_method === "hours" ? "Legacy hours" : logStatus(log)}`])}/>
        </div>
      </> : <div className="attendance-card">
        <div className="attendance-card-header is-red"><h2><QrCode size={23}/>{isAdmin ? "Employee QR Codes" : "My Employee QR Code"}</h2>{isAdmin && <button className="attendance-white" disabled={loading} onClick={() => openSalary()}><Plus size={18}/>Generate QR Code</button>}</div>
        <div className="attendance-table-scroll"><table><thead><tr><th>Name</th><th>Position</th><th>Daily rate</th><th>QR code</th><th>Payment method</th><th>Actions</th></tr></thead><tbody>{!loading && registered.map(q => { const employee = employees.find(item => item.id === q.employee_id)!; const config = rates.find(item => item.employee_id === q.employee_id); return <tr key={q.employee_id}>
          <td><b>{employee.full_name}</b>{!employee.active && <small>Inactive</small>}</td><td>{attendanceRoles[employee.role]}</td><td><b>{config?.pay_frequency === "daily" ? money(config.base_rate) : "Set daily rate"}</b></td><td><code>QR-{q.token.slice(0, 8).toUpperCase()}</code></td><td>{q.payment_method}</td>
          <td><div className="attendance-inline-actions"><button className="attendance-view" onClick={() => setModal({ kind: "qr", employee: q.employee_id })}>View</button>{isAdmin && <><button className="attendance-edit" onClick={() => openSalary(q.employee_id)}><Pencil size={14}/>Edit</button><button className="attendance-delete" aria-label={`Disable QR for ${employee.full_name}`} onClick={() => setModal({ kind: "delete", employee: q.employee_id })}><Trash2 size={15}/></button></>}</div></td>
        </tr>; })}</tbody></table>{loading ? <p className="attendance-empty">Loading QR codes…</p> : !registered.length && <p className="attendance-empty">{isAdmin ? "Generate a QR code and set a daily salary to get started." : "Your QR code is not ready. Ask your admin to generate it and set your daily salary."}</p>}</div>
      </div>}
    </section>
    {modal && <AttendanceDialog title={modal.kind === "salary" ? modal.employee ? `Edit — ${name(modal.employee)}` : "Generate QR & Set Salary" : modal.kind === "qr" ? name(modal.employee) : modal.kind === "log" ? `Attendance — ${displayDate}` : modal.kind === "schedule" ? "Customize work schedule" : modal.kind === "delete" ? "Disable employee QR code" : "Scan employee QR code"} onClose={close}>
      <div className="attendance-dialog-body">
        {error && <p className="attendance-error" role="alert">{error}</p>}
        {modal.kind === "salary" && <form id="attendance-salary-form" onSubmit={event => { event.preventDefault(); saveSalary(); }}>
          <label>Select employee<select required value={employeeId} disabled={!!modal.employee || busy} onChange={event => { const id = event.target.value; setEmployeeId(id); const config = rates.find(item => item.employee_id === id); setSalary(config?.pay_frequency === "daily" ? String(config.base_rate) : ""); setPayment(credentials.find(item => item.employee_id === id)?.payment_method ?? "Cash"); }}><option value="">— Choose employee —</option>{employees.filter(item => item.active || item.id === employeeId).map(item => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
          <label>Daily salary (PHP)<input required type="number" min="0" max="9999999999.99" step="0.01" placeholder="e.g. 500.00" value={salary} onChange={event => setSalary(event.target.value)}/></label>
          <label>Payment method<input required maxLength={100} value={payment} onChange={event => setPayment(event.target.value)}/></label><p>Hourly pay is calculated from the daily salary and scheduled work hours. Existing attendance keeps its saved rate.</p>
        </form>}
        {modal.kind === "qr" && <div className="attendance-qr-preview">{qrImage ? <><img src={qrImage} width="280" height="280" alt={`Attendance QR code for ${name(modal.employee)}`}/><a className="attendance-red" href={qrImage} download={`attendance-qr-${modal.employee}.png`}><Download size={17}/>Download QR code</a></> : <p>Preparing QR code…</p>}<p>Scan this code from your signed-in attendance page. You can show it on another screen or use a printed copy.</p></div>}
        {modal.kind === "log" && <form id="attendance-log-form" onSubmit={event => { event.preventDefault(); saveLog(); }}>
          <label>Employee<select required value={employeeId} disabled={!!modal.employee} onChange={event => { const id = event.target.value; setEmployeeId(id); const log = logs.find(item => item.employee_id === id); setTimes(log ? { am_in: log.am_in, am_out: log.am_out, pm_in: log.pm_in, pm_out: log.pm_out } : emptyTimes); setNotes(log?.notes ?? ""); }}><option value="">— Choose employee —</option>{employees.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
          <div className="attendance-time-grid">{(Object.keys(punchLabels) as Punch[]).map(key => <label key={key}>{punchLabels[key]}<input type="time" value={times[key]?.slice(0, 5) ?? ""} onChange={event => setTimes(value => ({ ...value, [key]: event.target.value || null }))}/></label>)}</div>
          <label>Correction / absence note<input value={notes} maxLength={1000} onChange={event => setNotes(event.target.value)}/></label><p>{currentLog?.scheduled_am_start ? `Saved schedule: ${timeLabel(currentLog.scheduled_am_start)}–${timeLabel(currentLog.scheduled_am_end)} / ${timeLabel(currentLog.scheduled_pm_start)}–${timeLabel(currentLog.scheduled_pm_end)}.` : `Schedule: ${scheduleText}.`} Leave all times blank to record an absence. Unworked scheduled time reduces daily pay.</p>
        </form>}
        {modal.kind === "schedule" && <form id="attendance-schedule-form" onSubmit={event => { event.preventDefault(); void mutate(() => db.from("attendance_schedule").update(scheduleEdit).eq("id", true).select("id").single(), "Schedule and deduction rules saved. New attendance days will use these settings."); }}><div className="attendance-time-grid">{([['am_start', 'AM starts'], ['am_end', 'AM ends'], ['pm_start', 'PM starts'], ['pm_end', 'PM ends']] as const).map(([key, label]) => <label key={key}>{label}<input required type="time" value={scheduleEdit[key].slice(0, 5)} onChange={event => setScheduleEdit(value => ({ ...value, [key]: event.target.value }))}/></label>)}</div><label>Late arrival grace period (minutes)<input required type="number" min="0" max="120" step="1" value={scheduleEdit.grace_minutes} onChange={event => setScheduleEdit(value => ({ ...value, grace_minutes: Number(event.target.value) }))}/></label><label className="attendance-checkbox"><input type="checkbox" checked={scheduleEdit.deduct_late} onChange={event => setScheduleEdit(value => ({ ...value, deduct_late: event.target.checked }))}/>Deduct late arrivals</label><label className="attendance-checkbox"><input type="checkbox" checked={scheduleEdit.deduct_undertime} onChange={event => setScheduleEdit(value => ({ ...value, deduct_undertime: event.target.checked }))}/>Deduct early departures</label><p>Arrivals within the grace period receive full session time. Arrivals beyond it deduct all late minutes when enabled. Unattended sessions earn no pay. Lunch and time outside the schedule do not earn extra pay. Changes apply to new attendance days.</p></form>}
        {modal.kind === "scan" && <><p>{isAdmin ? "Scan an employee QR code." : "Scan your own employee QR code. Other employees’ codes will be rejected."} Time is recorded using the current Philippine date and time, regardless of the log date filter.</p><label>Clock action<select disabled={busy || camera} value={action} onChange={event => setAction(event.target.value as Punch)}>{(Object.keys(punchLabels) as Punch[]).map(key => <option key={key} value={key}>{punchLabels[key]}</option>)}</select></label>{camera ? <QrCamera onScan={value => void scan(value)}/> : <button className="attendance-red" disabled={busy} onClick={() => setCamera(true)}><ScanLine size={16}/>Start camera</button>}<form id="attendance-scan-form" onSubmit={event => { event.preventDefault(); void scan(token); }}><label>QR code / USB scanner input<input required autoComplete="off" value={token} onChange={event => setToken(event.target.value)} placeholder="Scan or paste the full QR value"/></label></form></>}
        {modal.kind === "delete" && <p>Disable the QR code for <b>{name(modal.employee)}</b>? Existing attendance and salary settings will be kept. Generate a new code to enable scanning again.</p>}
      </div>
      <footer><button type="button" className="quiet-button" disabled={busy} onClick={close}>Close</button>
        {modal.kind === "salary" && <button type="submit" form="attendance-salary-form" className="attendance-red" disabled={busy}>{busy ? "Saving…" : modal.employee ? "Save Changes" : "Generate QR & Save"}</button>}
        {modal.kind === "log" && <button type="submit" form="attendance-log-form" className="attendance-red" disabled={busy}>Save log</button>}
        {modal.kind === "schedule" && <button type="submit" form="attendance-schedule-form" className="attendance-red" disabled={busy}>Save schedule</button>}
        {modal.kind === "scan" && <button type="submit" form="attendance-scan-form" className="attendance-red" disabled={busy || camera}>Record {punchLabels[action]}</button>}
        {modal.kind === "delete" && <button className="attendance-red" disabled={busy} onClick={() => void mutate(() => db.from("employee_attendance_qr").delete().eq("employee_id", modal.employee).select("employee_id").single(), "Employee QR code disabled.")}>Disable QR code</button>}
      </footer>
    </AttendanceDialog>}
  </div>;
}
