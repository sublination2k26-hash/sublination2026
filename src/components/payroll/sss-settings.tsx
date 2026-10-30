"use client";

import { useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Run = {id:string;period_start:string;period_end:string;status:string};
type Line = {id:string;employee_id:string;payroll_run_id:string;sss_deduction:number;sss_note:string};
const peso = (n:number) => Number(n).toLocaleString("en-PH",{style:"currency",currency:"PHP"});
export function SssSettings({runs,runId,onSelectRun,lines,employees,onSaved}:{
  runs:Run[];runId:string;onSelectRun:(id:string)=>void;lines:Line[];
  employees:{id:string;full_name:string}[];onSaved:()=>void;
}) {
  const [employee,setEmployee]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const saving=useRef(false);
  const run=runs.find(r=>r.id===runId);
  const available=lines.filter(l=>l.payroll_run_id===runId);
  const line=available.find(l=>l.employee_id===employee);
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!line||run?.status!=="draft"||saving.current)return;
    const data=new FormData(event.currentTarget);
    saving.current=true;setBusy(true);setError("");setNotice("");
    try {
      const amount=Number(data.get("amount"));
      if(!Number.isFinite(amount)||amount<0||amount>9999999999.99)throw new Error("Enter a valid, non-negative SSS deduction.");
      const {data:saved,error}=await createClient().from("payroll_lines").update({sss_deduction:amount,sss_note:String(data.get("note")??"").trim()}).eq("id",line.id).select("id").single();
      if(error)throw error;if(!saved)throw new Error("Could not save SSS deduction.");
      setNotice("SSS deduction saved and subtracted from this employee's net pay.");onSaved();
    }catch(e){setError(typeof e==="object"&&e!==null&&"message" in e?String(e.message):"Could not save SSS deduction.");}
    finally{saving.current=false;setBusy(false);}
  }
  return <section className="payroll-section" id="sss-settings"><h2>SSS adjustment for an existing payroll</h2>
    <p>Enter the employee SSS share to deduct for this payroll period. Use the amount allocated to this period so a monthly contribution is not deducted twice. Employer contributions are excluded from this employee deduction.</p>
    {error&&<p className="payroll-alert is-error" role="alert">{error}</p>}{notice&&<p className="payroll-alert" role="status">{notice}</p>}
    <div className="payroll-form-grid">
      <label>Payroll period<select value={runId} disabled={busy} onChange={e=>{onSelectRun(e.target.value);setEmployee("");setNotice("");setError("");}}><option value="">Choose payroll period</option>{runs.map(r=><option key={r.id} value={r.id}>{r.period_start} – {r.period_end} ({r.status})</option>)}</select></label>
      <label>Employee<select value={employee} disabled={busy||!run} onChange={e=>{setEmployee(e.target.value);setNotice("");setError("");}}><option value="">Choose employee</option>{available.map(l=><option key={l.id} value={l.employee_id}>{employees.find(e=>e.id===l.employee_id)?.full_name??"Employee"}</option>)}</select></label>
    </div>
    {!runs.length&&<p>Create a draft payroll period below to set SSS deductions.</p>}
    {line&&<form key={`${line.id}-${line.sss_deduction}-${line.sss_note}`} onSubmit={save}><fieldset disabled={busy||run?.status!=="draft"} style={{border:0,padding:0,margin:"12px 0"}}><div className="payroll-form-grid">
      <label>Employee SSS deduction (PHP)<input name="amount" type="number" required min="0" max="9999999999.99" step="0.01" defaultValue={line.sss_deduction}/></label>
      <label>Reference / note<input name="note" maxLength={1000} defaultValue={line.sss_note}/></label>
      <button type="submit" className="primary-button">{busy?"Saving…":"Save SSS deduction"}</button>
    </div></fieldset><p>Saved SSS deduction: <b>{peso(line.sss_deduction)}</b>{run?.status!=="draft"&&" · This payroll is locked."}</p></form>}
  </section>;
}
