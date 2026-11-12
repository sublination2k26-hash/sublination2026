"use client";

import { SearchableList } from "@/components/ui/searchable-list";
import { SewingMonitor } from "@/components/production/sewing-monitor";
import { PayslipManager } from "./payslip-manager";
import { SewingGarmentRates } from "./sewing-garment-rates";
import { CashAdvanceLedger } from "./cash-advance-ledger";
import { RecurringSssSettings } from "./recurring-sss-settings";
import { SssSettings } from "./sss-settings";
import { OvertimeSettings } from "./overtime-settings";
import { ArtistWorkTracking } from "./artist-work-tracking";
import { useEffect, useId, useMemo, useState } from "react";
import { Check, LoaderCircle, Plus, RefreshCw, Save, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readAllRows } from "@/lib/workspace-loading";
import { workPayDisplay } from "@/lib/work-pay-display";
import "./payroll-workspace.css";
import type { AppRole } from "@/lib/auth/permissions";

type PayrollOrder = { id: string; order_number: string; customer: { full_name: string } | null };
type Employee = { id:string; full_name:string; role:AppRole; active:boolean };
type Compensation = { employee_id:string; salary_basis:"fixed"|"piece"|"combined"; pay_frequency:"daily"|"weekly"|"semi_monthly"|"monthly"; base_rate:number; piece_rate:number };
type WorkRecord = { sewing_assignment_id:string|null; id:string; employee_id:string; role:AppRole; order_id:string|null; task_id:string|null; activity:string; quantity:number; unit_rate:number; work_date:string; started_at:string|null; completed_at:string|null; status:string; is_rework:boolean; pay_eligible:boolean; rework_reason:string|null; payroll_run_id:string|null; notes:string|null };
type Run = { id:string; period_start:string; period_end:string; status:"draft"|"approved"|"paid"; created_at:string };
type Line = { id:string; payroll_run_id:string; employee_id:string; role:AppRole; salary_basis:string; pay_frequency:string; base_pay:number; approved_units:number; production_pay:number; attendance_hours:number; overtime_hours:number; overtime_rate:number; overtime_pay:number; overtime_note:string; sss_deduction:number; sss_note:string; adjustments:number; adjustment_note:string|null; cash_advance:number; cash_advance_note:string|null; total_pay:number };
const roleNames:Record<string,string>={admin:"Admin / Owner",front_desk:"Front Desk",artist:"Artist",printing:"Printer",heat_press:"Heat press operator",cutter:"Cutter",sewer:"Sewer",qc:"Quality control"};
const basisNames:Record<string,string>={fixed:"Fixed salary",piece:"Per approved output",combined:"Fixed + output"};
const frequencyNames:Record<string,string>={daily:"Daily",weekly:"Weekly",semi_monthly:"Twice monthly",monthly:"Monthly"};
const peso=(value:number)=>`₱${Number(value||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Manila"});

const payrollViews = [
  { id: "sewing", label: "Sewing & payroll", help: "Monitor sewer output and pay, review regular/promo encodings, and prepare payroll for any selected cutoff." },
  { id: "artist", label: "Artist pay & monitoring", help: "Monitor artist layout work and total weekly pay at ₱150 per completed layout." },
  { id: "records", label: "Payroll records", help: "Add employee pay for a cutoff, or find and download a saved payslip." },
  { id: "work", label: "Work review", help: "Review sewer assignment pay before preparing pay." },
  { id: "rates", label: "Sewing rates", help: "Set fixed pay and prices per piece for sewing employees." },
  { id: "deductions", label: "Adjustments & advances", help: "Manage overtime, SSS and cash advances for a selected payroll run." },
  { id: "runs", label: "Payroll runs", help: "Prepare and approve calculated payroll runs, or view earlier periods." },
] as const;

export function PayrollManager(){
  const [view,setView]=useState<typeof payrollViews[number]["id"]>("records");
  const workspaceId=useId();
  const db=createClient();
  const [employees,setEmployees]=useState<Employee[]>([]),[compensations,setCompensations]=useState<Compensation[]>([]),[records,setRecords]=useState<WorkRecord[]>([]),[runs,setRuns]=useState<Run[]>([]),[lines,setLines]=useState<Line[]>([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[selectedEmployee,setSelectedEmployee]=useState("");
  const [basis,setBasis]=useState<Compensation["salary_basis"]>("fixed"),[frequency,setFrequency]=useState<Compensation["pay_frequency"]>("monthly"),[baseRate,setBaseRate]=useState(""),[pieceRate,setPieceRate]=useState("");
  const [periodStart,setPeriodStart]=useState(today().slice(0,8)+"01"),[periodEnd,setPeriodEnd]=useState(today()),[openRun,setOpenRun]=useState("");
  const [adjustments,setAdjustments]=useState<Record<string,{amount:string;note:string;advance:string;advanceNote:string;otHours:string;otRate:string;otNote:string}>>({});
  const [linesVersion,setLinesVersion]=useState(0);

  const load=async()=>{setLoading(true);setError("");try{const [e,c,w,r,o]=await Promise.all([
    db.from("profiles").select("id,full_name,role,active").order("full_name"),
    db.from("employee_compensation").select("employee_id,salary_basis,pay_frequency,base_rate,piece_rate"),
    db.from("employee_work_records").select("id,sewing_assignment_id,employee_id,role,order_id,task_id,activity,quantity,unit_rate,work_date,started_at,completed_at,status,is_rework,pay_eligible,rework_reason,payroll_run_id,notes").eq("role","sewer").in("activity",["Sewing assigned","Sewing completed","Sewing batch completed","Sewing rework"]).order("work_date",{ascending:false}).limit(100),
    db.from("payroll_runs").select("id,period_start,period_end,status,created_at").order("created_at",{ascending:false}).limit(30),
    readAllRows((from,to)=>db.from("orders").select("id,order_number,customer:customers!orders_customer_id_fkey(full_name)").order("id").range(from,to)).then(data=>({data,error:null})),
  ]);for(const result of [e,c,w,r,o])if(result.error)throw result.error;setEmployees((e.data??[]) as Employee[]);setCompensations((c.data??[]) as Compensation[]);setRecords((w.data??[]) as WorkRecord[]);setRuns((r.data??[]) as Run[]);const current=(r.data??[])[0]?.id??"";setOpenRun(value=>value||current);setOrders((o.data??[]) as unknown as PayrollOrder[]);}catch(reason){setError(reason instanceof Error?reason.message:typeof reason==="object"&&reason!==null&&"message" in reason?String(reason.message):"Could not load payroll records.");}finally{setLoading(false);}};
  const [orders,setOrders]=useState<PayrollOrder[]>([]);
  useEffect(()=>{void load();},[]);
  useEffect(()=>{const config=compensations.find(item=>item.employee_id===selectedEmployee);setBasis(config?.salary_basis??"fixed");setFrequency(config?.pay_frequency??"monthly");setBaseRate(config?String(config.base_rate):"");setPieceRate(config?String(config.piece_rate):"");},[selectedEmployee,compensations]);
  useEffect(()=>{
    let active=true;
    setLines([]);
    setAdjustments({});
    if(openRun){
      void db.from("payroll_lines").select("id,payroll_run_id,employee_id,role,salary_basis,pay_frequency,base_pay,approved_units,production_pay,attendance_hours,overtime_hours,overtime_rate,overtime_pay,overtime_note,sss_deduction,sss_note,adjustments,adjustment_note,cash_advance,cash_advance_note,total_pay").eq("payroll_run_id",openRun).then(({data,error})=>{
        if(!active)return;
        if(error)setError(error.message);
        else setLines((data??[]) as Line[]);
      });
    }
    return()=>{active=false;};
  },[openRun,db,linesVersion]);
  const activeEmployees=employees.filter(employee=>employee.active&&employee.role!=="admin");
  const currentRun=runs.find(run=>run.id===openRun);
  const compByEmployee=useMemo(()=>new Map(compensations.map(item=>[item.employee_id,item])),[compensations]);
  const employeeName=(id:string)=>employees.find(item=>item.id===id)?.full_name??"Unknown employee";
  const fail=(reason:unknown)=>setError(reason instanceof Error?reason.message:typeof reason==="object"&&reason!==null&&"message" in reason?String(reason.message):"Could not save payroll information.");
  const isSewer=employees.find(item=>item.id===selectedEmployee)?.role==="sewer";
  const saveCompensation=async()=>{if(!selectedEmployee){setError("Select an employee first.");return;}setBusy(true);setError("");try{const {data:{user}}=await db.auth.getUser();const {error}=await db.from("employee_compensation").upsert({employee_id:selectedEmployee,salary_basis:isSewer?basis:"fixed",pay_frequency:frequency,base_rate:Number(baseRate)||0,piece_rate:isSewer?(Number(pieceRate)||0):0,updated_by:user?.id,updated_at:new Date().toISOString()});if(error)throw error;setNotice("Pay settings saved.");await load();}catch(reason){fail(reason);}finally{setBusy(false);}};
  const [payrollPrice,setPayrollPrice]=useState<Record<string,string>>({});
  const [promoPrice,setPromoPrice]=useState<Record<string,string>>({});
  const reviewWork=async(record:WorkRecord,status:"approved"|"rejected"|"rework")=>{if(busy)return;setBusy(true);try{
    if(status==="approved"&&record.sewing_assignment_id){
      const mode=payrollPrice[record.id]??"regular";
      const typedPromo=promoPrice[record.id]?.trim()??"";
      if(mode==="promo"&&(!/^\d+(\.\d{1,2})?$/.test(typedPromo)||Number(typedPromo)>9999999999.99))throw new Error("Enter a valid promo price per piece with at most two decimal places.");
      const {error}=await db.rpc("approve_sewer_assignment_pay",{p_work:record.id,p_mode:mode,...(mode==="promo"?{p_promo_rate:Number(typedPromo)}:{})});if(error)throw error;
    }else{
      const {data:{user}}=await db.auth.getUser();const {error}=await db.from("employee_work_records").update({status,approved_by:status==="approved"?user?.id:null,approved_at:status==="approved"?new Date().toISOString():null}).eq("id",record.id).eq("status","pending_review").is("payroll_run_id",null).select("id").single();if(error)throw error;
    }
    setNotice(`Work record ${status}.`);await load();
  }catch(reason){fail(reason);}finally{setBusy(false);}};
  const createRun=async()=>{setBusy(true);setError("");try{const {data,error}=await db.rpc("create_payroll_run",{p_start:periodStart,p_end:periodEnd});if(error)throw error;setOpenRun(data);setNotice("Draft payroll created. Review earnings and adjustments before approval.");await load();}catch(reason){fail(reason);}finally{setBusy(false);}};
  const updateRunStatus=async(run:Run,action:"approve_payroll_run"|"mark_payroll_run_paid")=>{setBusy(true);setError("");try{const {error}=await db.rpc(action,{p_run_id:run.id});if(error)throw error;setNotice(action==="approve_payroll_run"?"Payroll approved.":"Payroll marked paid.");await load();}catch(reason){fail(reason);}finally{setBusy(false);}};
  const saveAdjustment=async(line:Line)=>{
    if(currentRun?.status!=="draft"||line.payroll_run_id!==openRun)return;
    const value=adjustments[line.id]??{amount:String(line.adjustments),note:line.adjustment_note??"",advance:String(line.cash_advance),advanceNote:line.cash_advance_note??"",otHours:String(line.overtime_hours??0),otRate:String(line.overtime_rate??0),otNote:line.overtime_note??""};
    const amount=Number(value.amount);
    const advance=Number(value.advance);
    if(!Number.isFinite(advance)||advance<0||advance>9999999999.99){setError("Enter a valid, non-negative cash advance amount.");return;}
    if(!Number.isFinite(amount)){setError("Enter a valid adjustment amount.");return;}
    setBusy(true);setError("");
    try{
      const {error}=await db.from("payroll_lines").update({adjustments:amount,adjustment_note:value.note||null,total_pay:Number(line.base_pay)+Number(line.production_pay)+amount-advance}).eq("id",line.id).select("id").single();
      if(error)throw error;
      setNotice("Payroll adjustment saved.");
      setLinesVersion(version=>version+1);
    }catch(reason){fail(reason);}finally{setBusy(false);}
  };
  return <div className="payroll-manager payroll-workspace">
    <div className="payroll-workspace-heading"><div><h2>Pay employees</h2><p>Choose a section below. Start with Payroll records to enter pay without attendance.</p></div></div>
    <nav className="payroll-view-nav" aria-label="Payroll sections">{payrollViews.map(item=><button key={item.id} type="button" aria-current={view===item.id?"page":undefined} aria-controls={`${workspaceId}-${item.id}`} onClick={()=>setView(item.id)}>{item.label}</button>)}</nav>
    <p className="payroll-view-help">{payrollViews.find(item=>item.id===view)?.help}</p>
    {error&&<div className="payroll-alert is-error" role="alert">{error}</div>}{notice&&<div className="payroll-alert" role="status"><Check size={15}/>{notice}<button onClick={()=>setNotice("")} aria-label="Dismiss"><X size={14}/></button></div>}
    {view==="sewing"&&<div id={`${workspaceId}-sewing`}><SewingMonitor role="admin" onUpdated={load}/></div>}
    {view==="artist"&&<div id={`${workspaceId}-artist`}><ArtistWorkTracking employees={employees}/></div>}
    <div id={`${workspaceId}-records`} hidden={view!=="records"}><PayslipManager/></div>
    <div id={`${workspaceId}-rates`} hidden={view!=="rates"}>
    <section className="payroll-section"><div className="payroll-section-heading"><div><h2>Sewing pay settings</h2><p>Set pay rules for sewing employees.</p></div></div><div className="payroll-form-grid"><label>Employee<select value={selectedEmployee} onChange={e=>setSelectedEmployee(e.target.value)}><option value="">Choose employee</option>{activeEmployees.filter(item=>item.role==="sewer").map(item=><option key={item.id} value={item.id}>{item.full_name} · {roleNames[item.role]}</option>)}</select></label><label>Salary method<select disabled={!isSewer} value={isSewer?basis:"fixed"} onChange={e=>setBasis(e.target.value as Compensation["salary_basis"])}><option value="fixed">Fixed salary</option><option value="piece">Per approved output</option><option value="combined">Fixed + output</option></select></label><label>Pay frequency<select value={frequency} onChange={e=>setFrequency(e.target.value as Compensation["pay_frequency"])}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="semi_monthly">Twice monthly</option><option value="monthly">Monthly</option></select></label><label>Base amount per frequency (₱)<input type="number" min="0" step="0.01" value={baseRate} onChange={e=>setBaseRate(e.target.value)} disabled={isSewer&&basis==="piece"}/></label><label>Default price per piece (₱)<input type="number" min="0" step="0.01" value={pieceRate} onChange={e=>setPieceRate(e.target.value)} disabled={!isSewer||basis==="fixed"}/></label><button className="primary-button" disabled={busy||!selectedEmployee} onClick={()=>void saveCompensation()}><Save size={14}/>Save pay settings</button></div><p className="payroll-footnote">Choose a sewing employee, set the rate, then save. Use Work review to approve output before creating a payroll run.</p><SewingGarmentRates key={selectedEmployee} employeeId={selectedEmployee} employeeName={employeeName(selectedEmployee)} salaryBasis={compByEmployee.get(selectedEmployee)?.salary_basis}/><SearchableList className="payroll-table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>ROLE</th><th>METHOD</th><th>BASE</th><th>OUTPUT RATE</th></tr></thead><tbody>{activeEmployees.filter(item=>item.role==="sewer").map(item=>{const config=compByEmployee.get(item.id);return <tr key={item.id}><td><button className="payroll-link" onClick={()=>setSelectedEmployee(item.id)}>{item.full_name}</button></td><td>{roleNames[item.role]}</td><td>{config?(item.role==="sewer"?basisNames[config.salary_basis]:"Attendance"):"Not configured"}</td><td>{config?`${peso(config.base_rate)} / ${frequencyNames[config.pay_frequency]}`:"—"}</td><td>{config&&item.role==="sewer"&&config.salary_basis!=="fixed"?peso(config.piece_rate):"—"}</td></tr>})}</tbody></table></SearchableList></section>
    </div>
    <div id={`${workspaceId}-work`} hidden={view!=="work"}>
    <section className="payroll-section"><div className="payroll-section-heading"><div><h2>Sewer assignment pay review</h2><p>Approve eligible sewing work for piece pay.</p></div><button className="quiet-button" onClick={()=>void load()}><RefreshCw size={14}/>Refresh</button></div><SearchableList className="payroll-table-wrap"><table><thead><tr><th>DATE / EMPLOYEE</th><th>TEAM / TASK / ORDER</th><th>QTY</th><th>STATUS</th><th>PAY BASIS / AMOUNT</th><th>REVIEW</th></tr></thead><tbody>{records.map(record=><tr key={record.id}><td>{record.work_date}<small>{employeeName(record.employee_id)} · {roleNames[record.role]}</small></td><td><strong className="payroll-team-name">{orders.find(item=>item.id===record.order_id)?.customer?.full_name?.trim() || (record.order_id ? "Team unavailable" : "No linked order")}</strong><small>{record.activity}</small>{record.order_id&&<small>{orders.find(item=>item.id===record.order_id)?.order_number}</small>}{record.started_at&&<small>Started {new Date(record.started_at).toLocaleString("en-PH")}</small>}{record.completed_at&&<small>Completed {new Date(record.completed_at).toLocaleString("en-PH")}</small>}{record.is_rework&&<small>Rework: {record.rework_reason}</small>}</td><td>{record.quantity}</td><td><span className={`payroll-status ${record.status}`}>{record.status.replaceAll("_"," ")}</span></td><td><WorkPay record={record} config={compByEmployee.get(record.employee_id)}/>{record.sewing_assignment_id&&record.status==="pending_review"&&!record.payroll_run_id&&<label>Admin payroll price<select aria-label={`Payroll price for ${employeeName(record.employee_id)} on ${record.work_date}`} disabled={busy} value={payrollPrice[record.id]??"regular"} onChange={e=>setPayrollPrice(current=>({...current,[record.id]:e.target.value}))}><option value="regular">Regular price</option><option value="promo">Promo price</option></select><small>Regular uses the configured rate. Choose Promo to type a price per piece.</small></label>}{record.sewing_assignment_id&&record.status==="pending_review"&&!record.payroll_run_id&&payrollPrice[record.id]==="promo"&&<label>Admin promo price / piece (PHP)<input aria-label={`Promo price for ${employeeName(record.employee_id)} on ${record.work_date}`} type="number" min="0" max="9999999999.99" step="0.01" inputMode="decimal" disabled={busy} value={promoPrice[record.id]??""} onChange={e=>setPromoPrice(current=>({...current,[record.id]:e.target.value}))} placeholder="Enter promo price"/><small>{promoPrice[record.id]?.trim()&&Number.isFinite(Number(promoPrice[record.id]))?`${record.quantity} pieces ? ${peso(Number(promoPrice[record.id]))} = ${peso(record.quantity*Number(promoPrice[record.id]))}`:"Enter the promo amount, then approve to save this assignment?s price."}</small></label>}</td><td>{record.status==="pending_review"&&!record.payroll_run_id?<div className="payroll-review-actions"><button disabled={busy} title="Approve selected payroll price" onClick={()=>void reviewWork(record,"approved")}><Check size={14}/></button><button title="Reject" onClick={()=>void reviewWork(record,"rejected")}><X size={14}/></button><button title="Return for rework" onClick={()=>void reviewWork(record,"rework")}><RefreshCw size={14}/></button></div>:record.payroll_run_id?"In payroll":"—"}</td></tr>)}</tbody></table>{!records.length&&!loading&&<div className="payroll-empty">No sewing work has been recorded yet.</div>}</SearchableList></section>
    </div>
    <div id={`${workspaceId}-deductions`} hidden={view!=="deductions"}>
    <details className="payroll-setting-group" open><summary>Overtime</summary>
    <OvertimeSettings runs={runs} runId={openRun} onSelectRun={setOpenRun} lines={lines} employees={employees} onSaved={()=>setLinesVersion(v=>v+1)}/>
    </details>
    <details className="payroll-setting-group"><summary>SSS deductions</summary>
    <RecurringSssSettings employees={employees}/>
    <SssSettings runs={runs} runId={openRun} onSelectRun={setOpenRun} lines={lines} employees={employees} onSaved={()=>setLinesVersion(v=>v+1)}/>
    </details>
    <details className="payroll-setting-group"><summary>Cash advances</summary>
    <CashAdvanceLedger employees={employees} lines={lines} run={currentRun} refreshToken={linesVersion} onChange={()=>setLinesVersion(v=>v+1)}/>
    </details>
    </div>
    <div id={`${workspaceId}-runs`} hidden={view!=="runs"}>
    <p className="payroll-run-notice">For staff paid manually, use Payroll records. These calculated runs keep the earlier attendance rules for non-sewing employees. Avoid recording the same pay in both places.</p>
    <section className="payroll-section"><div className="payroll-section-heading"><div><h2>Payroll periods</h2><p>Create a draft, review each line and adjustment, then approve and mark paid.</p></div></div><div className="payroll-run-create"><label>Period start<input type="date" value={periodStart} onChange={e=>setPeriodStart(e.target.value)}/></label><label>Period end<input type="date" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)}/></label><button className="primary-button" disabled={busy||!activeEmployees.length} onClick={()=>void createRun()}><Plus size={14}/>Create draft payroll</button></div><SearchableList className="payroll-table-wrap"><table><thead><tr><th>PERIOD</th><th>STATUS</th><th>CREATED</th><th>ACTION</th></tr></thead><tbody>{runs.map(run=><tr key={run.id} className={run.id===openRun?"selected-run":""}><td><button className="payroll-link" onClick={()=>setOpenRun(run.id)}>{run.period_start} — {run.period_end}</button></td><td><span className={`payroll-status ${run.status}`}>{run.status}</span></td><td>{new Date(run.created_at).toLocaleDateString("en-PH")}</td><td>{run.status==="draft"?<button className="quiet-button" disabled={busy} onClick={()=>void updateRunStatus(run,"approve_payroll_run")}>Approve payroll</button>:run.status==="approved"?<button className="quiet-button" disabled={busy} onClick={()=>void updateRunStatus(run,"mark_payroll_run_paid")}>Mark paid</button>:<span>Paid</span>}</td></tr>)}</tbody></table>{!runs.length&&!loading&&<div className="payroll-empty">No payroll periods yet.</div>}</SearchableList>
      {currentRun&&<div className="payroll-lines"><div className="payroll-lines-heading"><p>Gross earnings (base + production + overtime): <b>{peso(lines.reduce((sum,l)=>sum+Number(l.base_pay)+Number(l.production_pay)+Number(l.overtime_pay),0))}</b> | Total deductions (SSS + cash advances): <b>{peso(lines.reduce((sum,l)=>sum+Number(l.sss_deduction)+Number(l.cash_advance),0))}</b> | Net pay: <b>{peso(lines.reduce((sum,l)=>sum+Number(l.total_pay),0))}</b></p><b>{currentRun.period_start} — {currentRun.period_end}</b><span>Pay is snapshotted for this run. Enter additional overtime hours and hourly rates per employee. Overtime and adjustments are editable while this is a draft. Cash advances and employee SSS deductions are deducted from net pay.</span></div><SearchableList className="payroll-table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>BASIS</th><th>HOURS / UNITS</th><th>BASE PAY</th><th>PRODUCTION</th><th>OVERTIME</th><th>ADJUSTMENT</th><th>CASH ADVANCE</th><th>SSS DEDUCTION</th><th>NET PAY</th></tr></thead><tbody>{lines.map(line=>{const edit=adjustments[line.id]??{amount:String(line.adjustments),note:line.adjustment_note??"",advance:String(line.cash_advance),advanceNote:line.cash_advance_note??"",otHours:String(line.overtime_hours??0),otRate:String(line.overtime_rate??0),otNote:line.overtime_note??""};return <tr key={line.id}><td>{employeeName(line.employee_id)}<small>{roleNames[line.role]}</small></td><td>{basisNames[line.salary_basis]} · {frequencyNames[line.pay_frequency]}</td><td>{line.role==="sewer"?`${line.approved_units} units`:`${line.attendance_hours} hours`}</td><td>{peso(Number(line.base_pay))}</td><td>{peso(Number(line.production_pay))}</td><td>{peso(line.overtime_pay)}<small>{line.overtime_hours} hours ? {peso(line.overtime_rate)}</small><a href="#overtime-settings" onClick={()=>setView("deductions")}>Overtime settings</a></td><td>{currentRun.status==="draft"?<div className="payroll-adjust"><input aria-label="Adjustment amount" type="number" step="0.01" value={edit.amount} onChange={e=>setAdjustments(values=>({...values,[line.id]:{...edit,amount:e.target.value}}))}/><input aria-label="Adjustment note" value={edit.note} onChange={e=>setAdjustments(values=>({...values,[line.id]:{...edit,note:e.target.value}}))} placeholder="Reason"/><button disabled={busy} title="Save adjustment" onClick={()=>void saveAdjustment(line)}><Save size={13}/></button></div>:peso(Number(line.adjustments))}</td><td>{peso(Number(line.cash_advance))}<small>Includes historical deductions and selected advance recoveries.</small></td><td>{peso(Number(line.sss_deduction))}{line.sss_note&&<small>{line.sss_note}</small>}<a href="#sss-settings" onClick={()=>setView("deductions")}>SSS settings</a></td><td><b>{peso(Number(line.total_pay))}</b></td></tr>})}</tbody><tfoot><tr><td colSpan={3}>Totals for this payroll</td><td><b>{peso(lines.reduce((sum,l)=>sum+Number(l.base_pay),0))}</b></td><td><b>{peso(lines.reduce((sum,l)=>sum+Number(l.production_pay),0))}</b></td><td><b>{peso(lines.reduce((sum,l)=>sum+Number(l.overtime_pay),0))}</b></td><td><b>{peso(lines.reduce((sum,l)=>sum+Number(l.adjustments),0))}</b></td><td><b>{peso(lines.reduce((sum,l)=>sum+Number(l.cash_advance),0))}</b></td><td><b>{peso(lines.reduce((sum,l)=>sum+Number(l.sss_deduction),0))}</b></td><td><b>{peso(lines.reduce((sum,l)=>sum+Number(l.total_pay),0))}</b></td></tr></tfoot></table>{!lines.length&&!loading&&<div className="payroll-empty">This payroll has no configured employees.</div>}</SearchableList></div>}
    </section>
    {loading&&<div className="payroll-loading"><LoaderCircle className="spin" size={16}/>Loading employee and payroll records…</div>}
    </div>
  </div>;
}

function WorkPay({record,config}:{record:WorkRecord;config?:Compensation}) {
  if(record.role==="artist") return <div className="work-pay-display"><b>Activity record</b><small>Enter artist pay in Payroll records.</small></div>;
  const pay=workPayDisplay(record,config);
  return <div className="work-pay-display">
    {pay.fixedRate!==null&&<><b>{peso(pay.fixedRate)} / {frequencyNames[pay.frequency??""]??pay.frequency}</b><small>Current fixed rate</small><small>Calculated in payroll, not per task</small></>}
    {pay.outputPay!==null&&<><b>{peso(pay.outputPay)}{config?.salary_basis==="combined"?" output":""}</b><small>Recorded output rate: {peso(Number(record.unit_rate))} / unit</small></>}
    {pay.outputExcluded&&<small>Output pay excluded</small>}
    {pay.zeroOutputRate&&<small>No output rate was recorded for this task.</small>}
    {pay.needsSettings&&<small>Sewing pay settings not configured</small>}
  </div>;
}
