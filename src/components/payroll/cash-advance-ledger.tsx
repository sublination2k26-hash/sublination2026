"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Advance = { id:string; employee_id:string; amount:number; advance_date:string; reference:string; reason:string };
type Recovery = { advance_id:string; payroll_line_id:string; amount:number; payroll_lines:{payroll_runs:{status:string;period_start:string;period_end:string}} };
type Props = {
  employees:{id:string;full_name:string;active:boolean;role:string}[];
  lines:{id:string;employee_id:string}[];
  run?:{id:string;status:string;period_start:string;period_end:string};
  refreshToken:number;
  onChange:()=>void;
};
const peso = (n:number) => Number(n).toLocaleString("en-PH",{style:"currency",currency:"PHP"});
const errorMessage = (e:unknown) => typeof e==="object" && e!==null && "message" in e ? String(e.message) : "Could not save cash advance.";
export function CashAdvanceLedger({employees,lines,run,refreshToken,onChange}:Props) {
  const [db] = useState(createClient);
  const [advances,setAdvances] = useState<Advance[]>([]);
  const [recoveries,setRecoveries] = useState<Recovery[]>([]);
  const [amounts,setAmounts] = useState<Record<string,string>>({});
  const [employee,setEmployee] = useState("");
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [version,setVersion] = useState(0);
  const saving = useRef(false);
  useEffect(()=>{
    let active=true;
    setLoading(true);
    void Promise.all([
      db.from("employee_cash_advances").select("id,employee_id,amount,advance_date,reference,reason").order("advance_date",{ascending:false}),
      db.from("payroll_advance_recoveries").select("advance_id,payroll_line_id,amount,payroll_lines(payroll_runs(status,period_start,period_end))"),
    ]).then(([a,r])=>{
      if(!active)return;
      if(a.error||r.error){setError((a.error||r.error)?.message??"Could not load advances.");return;}
      setError("");setAdvances((a.data??[]) as Advance[]);setRecoveries((r.data??[]) as unknown as Recovery[]);setAmounts({});
    }).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[db,version,refreshToken,run?.id,run?.status]);
  async function issue(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(saving.current)return;
    const form=event.currentTarget;const data=new FormData(form);
    saving.current=true;setBusy(true);setError("");setNotice("");
    try {
      const {error}=await db.rpc("issue_employee_cash_advance",{p_employee:String(data.get("employee")),p_amount:Number(data.get("amount")),p_date:String(data.get("date")),p_reference:String(data.get("reference")),p_reason:String(data.get("reason"))});
      if(error)throw error;
      form.reset();setNotice("Employee cash advance recorded.");setVersion(v=>v+1);
    }catch(e){setError(errorMessage(e));}finally{saving.current=false;setBusy(false);}
  }
  async function recover(advance:Advance,lineId:string,amount:number) {
    if(saving.current)return;
    saving.current=true;setBusy(true);setError("");setNotice("");
    try {
      if(!Number.isFinite(amount)||amount<0)throw new Error("Enter a valid recovery amount.");
      const {error}=await db.rpc("set_payroll_advance_recovery",{p_line:lineId,p_advance:advance.id,p_amount:amount});
      if(error)throw error;
      setNotice("Recovery saved to the draft payroll. Use zero to remove a reservation.");setVersion(v=>v+1);onChange();
    }catch(e){setError(errorMessage(e));}finally{saving.current=false;setBusy(false);}
  }
  return <section className="payroll-section"><h2>Employee cash advances</h2>
    <p>Record each advance once. Choose a draft payroll below, then reserve its recovery amount here. Paid payrolls reduce the unpaid balance. Draft and approved payrolls reserve amounts until paid.</p>
    {error&&<p className="payroll-alert is-error" role="alert">{error} Make sure the employee cash advance ledger migration is applied.</p>}
    {notice&&<p className="payroll-alert" role="status">{notice}</p>}
    <form onSubmit={issue}><fieldset disabled={busy||loading} style={{border:0,padding:0,margin:0}}><div className="payroll-form-grid">
      <label>Employee<select name="employee" required><option value="">Choose employee</option>{employees.filter(e=>e.active&&e.role!=="admin").map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
      <label>Advance amount (PHP)<input name="amount" type="number" required min="0.01" max="9999999999.99" step="0.01"/></label>
      <label>Date issued<input name="date" type="date" required/></label>
      <label>Reference<input name="reference" required maxLength={100} placeholder="CA-001"/></label>
      <label>Reason<input name="reason" maxLength={1000}/></label>
      <button className="primary-button" type="submit">Record cash advance</button>
    </div></fieldset></form>
    <label>Filter employee<select value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">All employees</option>{employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
    <p>{run ? `Selected payroll: ${run.period_start} to ${run.period_end} (${run.status}).` : "Create or select a payroll period below to record deductions."}</p>
    {loading?<p role="status">Loading advances…</p>:<div className="payroll-table-wrap"><table><thead><tr><th>EMPLOYEE / ADVANCE</th><th>ISSUED</th><th>REPAID</th><th>UNPAID BALANCE</th><th>RESERVED</th><th>AVAILABLE</th><th>RECOVER IN SELECTED PAYROLL</th></tr></thead><tbody>
      {advances.filter(a=>!employee||a.employee_id===employee).map(a=>{
        const history=recoveries.filter(r=>r.advance_id===a.id);
        const paid=history.filter(r=>r.payroll_lines.payroll_runs.status==="paid").reduce((n,r)=>n+Number(r.amount),0);
        const reserved=history.filter(r=>r.payroll_lines.payroll_runs.status!=="paid").reduce((n,r)=>n+Number(r.amount),0);
        const line=lines.find(l=>l.employee_id===a.employee_id);
        const existing=history.find(r=>r.payroll_line_id===line?.id);
        const amount=amounts[a.id]??String(existing?.amount??0);
        return <tr key={a.id}><td><b>{employees.find(e=>e.id===a.employee_id)?.full_name??"Employee"}</b><small>{a.reference} · {a.advance_date}</small><small>{a.reason}</small><details><summary>Recovery history ({history.length})</summary>{history.map(r=><p key={r.payroll_line_id}>{r.payroll_lines.payroll_runs.period_start} – {r.payroll_lines.payroll_runs.period_end}: {peso(r.amount)} ({r.payroll_lines.payroll_runs.status})</p>)}</details></td><td>{peso(a.amount)}</td><td>{peso(paid)}</td><td>{peso(Number(a.amount)-paid)}</td><td>{peso(reserved)}</td><td>{peso(Number(a.amount)-paid-reserved)}</td><td>{run?.status==="draft"&&line?<div className="payroll-adjust"><input aria-label={`Recovery for ${a.reference}`} type="number" min="0" step="0.01" value={amount} disabled={busy} onChange={e=>setAmounts(v=>({...v,[a.id]:e.target.value}))}/><button disabled={busy} onClick={()=>void recover(a,line.id,Number(amount))}>Save recovery</button></div>:existing?peso(existing.amount):"Select an employee's draft payroll"}</td></tr>;
      })}
    </tbody></table>{!advances.length&&<p>No cash advances recorded yet.</p>}</div>}
  </section>;
}
