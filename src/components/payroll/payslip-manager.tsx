"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Download, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { money, manilaToday } from "@/lib/attendance";
import { AttendanceDialog } from "@/components/attendance/attendance-dialog";
import "@/components/attendance/attendance.css";
import "./payslips.css";

const fields = ["basic_pay", "overtime_pay", "bonus", "backpay", "sss", "philhealth", "pagibig", "other_deductions"] as const;
const labels = { basic_pay: "Basic pay", overtime_pay: "Overtime pay", bonus: "Other / bonus", backpay: "Backpay", sss: "SSS", philhealth: "PhilHealth", pagibig: "Pag-IBIG", other_deductions: "Other deductions" };
type Amounts = Record<typeof fields[number], number>;
type Slip = Amounts & { id: string; payslip_no: number; employee_name: string; employee_role: string; issue_date: string; period_start: string; period_end: string; net_pay: number };
type Employee = { id: string; full_name: string; role: string; active: boolean };
const roles: Record<string, string> = { front_desk: "Front Desk", artist: "Artist", printing: "Printer", heat_press: "Heat press operator", cutting_sewing: "Cutter / Sewer", qc: "Quality control" };
const empty = Object.fromEntries(fields.map(key => [key, 0])) as Amounts;
const errorMessage = (reason: unknown) => reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "Could not save payslip.";

export function PayslipManager() {
  const [db] = useState(createClient);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false), [employeeId, setEmployeeId] = useState("");
  const [amounts, setAmounts] = useState<Amounts>(empty);
  const [issued, setIssued] = useState(manilaToday), [start, setStart] = useState(manilaToday), [end, setEnd] = useState(manilaToday);
  useEffect(() => {
    let active = true;
    void Promise.all([
      db.from("employee_payslips").select("*").order("payslip_no", { ascending: false }),
      db.from("profiles").select("id,full_name,role,active").neq("role", "admin").order("full_name"),
    ]).then(([s, e]) => {
      if (!active) return;
      if (s.error || e.error) setError(errorMessage(s.error || e.error));
      else { setSlips(s.data as Slip[]); setEmployees(e.data as Employee[]); }
      setLoading(false);
    });
    return () => { active = false; };
  }, [db]);
  const employee = employees.find(item => item.id === employeeId);
  const net = amounts.basic_pay + amounts.overtime_pay + amounts.bonus + amounts.backpay - amounts.sss - amounts.philhealth - amounts.pagibig - amounts.other_deductions;
  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!employee?.active || end < start || fields.some(key => !Number.isFinite(amounts[key]) || amounts[key] < 0) || net < 0) { setError("Choose an active employee, valid dates, and amounts with non-negative net pay."); return; }
    setBusy(true); setError("");
    try {
      const { data, error } = await db.rpc("issue_employee_payslip", { p_employee: employeeId, p_issue_date: issued, p_start: start, p_end: end, p_amounts: amounts });
      if (error) throw error;
      setSlips(items => [data as Slip, ...items]); setOpen(false); setNotice("Payslip issued and saved.");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  async function download(slip: Slip) {
    try { const { downloadPayslip } = await import("@/lib/payslip-pdf"); downloadPayslip(slip, labels, roles[slip.employee_role] ?? slip.employee_role); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  return <section className="payroll-section payslips">
    <div className="payroll-section-heading"><div><h2>Manage Payslips</h2><p>Issue and view employee salary records.</p></div><button className="primary-button" disabled={loading || busy} onClick={() => { setEmployeeId(""); setAmounts({ ...empty }); setError(""); setOpen(true); }}><Plus size={18}/>Issue New Payslip</button></div>
    {error && <p className="payroll-alert is-error" role="alert">{error}</p>}{notice && <p className="payroll-alert" role="status">{notice}</p>}
    <div className="payroll-table-wrap"><table><thead><tr><th>Date issued</th><th>Employee name</th><th>Net pay</th><th>Action</th></tr></thead><tbody>{slips.map(slip => <tr key={slip.id}><td>{slip.issue_date}<small>PS-{String(slip.payslip_no).padStart(3, "0")} · {slip.period_start} – {slip.period_end}</small></td><td><b>{slip.employee_name}</b><small>{roles[slip.employee_role] ?? slip.employee_role}</small></td><td className="payslip-net">{money(slip.net_pay)}</td><td><button className="payslip-pdf" onClick={() => void download(slip)}><Download size={16}/>PDF</button></td></tr>)}</tbody></table></div>
    {loading ? <p role="status">Loading payslips…</p> : !slips.length && <p>No payslips issued yet.</p>}
    {open && <AttendanceDialog title="Issue New Payslip" onClose={() => { if (!busy) setOpen(false); }}>
      <form onSubmit={issue}><div className="attendance-dialog-body">
        {error && <p className="payroll-alert is-error" role="alert">{error}</p>}
        <fieldset disabled={busy} className="payslip-fields"><div className="payslip-grid">
          <label>Select employee<select required value={employeeId} onChange={event => setEmployeeId(event.target.value)}><option value="">Choose employee</option>{employees.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
          <label>Position / role<input readOnly value={employee ? roles[employee.role] ?? employee.role : ""} placeholder="Auto-filled from employee"/></label>
          <label>Payslip no.<input readOnly value="Assigned when issued"/></label><label>Date issued<input required type="date" max={manilaToday()} value={issued} onChange={event => setIssued(event.target.value)}/></label>
          <label>Period start<input required type="date" value={start} onChange={event => setStart(event.target.value)}/></label><label>Period end<input required type="date" min={start} value={end} onChange={event => setEnd(event.target.value)}/></label>
        </div>
        <h3 className="payslip-net">Earnings</h3><div className="payslip-grid">{fields.slice(0, 4).map(key => amountInput(key))}</div>
        <h3 className="payslip-deductions">Deductions</h3><div className="payslip-grid">{fields.slice(4).map(key => amountInput(key))}</div>
        <p>Backpay is entered manually after review. These amounts create a salary record and do not modify payroll runs. Only one payslip can be issued per employee for the same period.</p>
        <p className="payslip-net">Estimated net pay <strong>{money(net)}</strong></p></fieldset>
      </div><footer className="payslip-footer"><button type="button" className="quiet-button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Issuing…" : "Issue Payslip"}</button></footer></form>
    </AttendanceDialog>}
  </section>;
  function amountInput(key: typeof fields[number]) {
    return <label key={key}>{labels[key]} (PHP)<input type="number" required min="0" max="9999999999.99" step="0.01" value={Number.isNaN(amounts[key]) ? "" : amounts[key]} onChange={event => setAmounts(value => ({ ...value, [key]: event.target.value === "" ? NaN : Number(event.target.value) }))}/></label>;
  }
}
