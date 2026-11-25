"use client";

import { TableScroll } from "@/components/ui/table-scroll";
import {useCallback,useEffect,useRef,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {readAllRows} from "@/lib/workspace-loading";
import {manilaToday} from "@/lib/payment-tracking";
import {validSewingPeriod,sewingReconciliation,sewingPeriodTotals,type SewingEncoding,type SewingWork,type SewingAssignment,type SewingCompletion} from "@/lib/sewing-payroll";
import "./sewing-monitor.css";
import {activeSewerEmployees} from "@/lib/sewer-employees";

type Data={audit:{id:number;encoding_id:string|null;task_id:string|null;actor_id:string;action:string;reason:string;created_at:string}[];encodings:SewingEncoding[];work:SewingWork[];assignments:SewingAssignment[];events:SewingCompletion[];tasks:{id:string;order_id:string;order_item_id:string}[];items:{id:string;quantity:number;product_name:string;customization:{garment?:string}}[];orders:{id:string;order_number:string;customer_id:string}[];customers:{id:string;full_name:string}[];employees:{id:string;full_name:string;role:string;active:boolean}[];controls:{task_id:string;paused:boolean;reason:string}[];runs:{id:string;period_start:string;period_end:string;status:string}[];lines:{payroll_run_id:string;employee_id:string;role:string;approved_units:number;production_pay:number;total_pay:number}[]};
const empty:Data={audit:[],encodings:[],work:[],assignments:[],events:[],tasks:[],items:[],orders:[],customers:[],employees:[],controls:[],runs:[],lines:[]};
const money=(n:number)=>'PHP '+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const errorMessage=(e:unknown)=>(e as {message?:string})?.message??'Could not save. Try again.';
export function SewingMonitor({role,refreshToken,onUpdated}:{role:string;refreshToken?:unknown;onUpdated?:()=>Promise<void>}){
  const [data,setData]=useState<Data>(empty),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [start,setStart]=useState(()=>manilaToday().slice(0,8)+"01"),[end,setEnd]=useState(manilaToday),[filter,setFilter]=useState(''),[selectedSewer,setSelectedSewer]=useState('');
  const [section,setSection]=useState("jobs"),[jobStatus,setJobStatus]=useState("assigned"),[expandedJob,setExpandedJob]=useState(""),[page,setPage]=useState(1);
  useEffect(()=>setPage(1),[filter,selectedSewer,jobStatus]);
  const [edit,setEdit]=useState<{id:string;quantity:string;reason:string}|null>(null),[pause,setPause]=useState<{task:string;paused:boolean;reason:string}|null>(null);
  const editForm=useRef<HTMLFormElement>(null),pauseForm=useRef<HTMLFormElement>(null);
  useEffect(()=>{if(edit){editForm.current?.scrollIntoView({behavior:"smooth",block:"center"});editForm.current?.querySelector("input")?.focus({preventScroll:true});}},[edit?.id]);
  useEffect(()=>{if(pause){pauseForm.current?.scrollIntoView({behavior:"smooth",block:"center"});pauseForm.current?.querySelector("input")?.focus({preventScroll:true});}},[pause?.task]);
  const saving=useRef(false);const admin=role==='admin';const validPeriod=validSewingPeriod(start,end);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const db=createClient();
      const page=(table:string,columns:string)=>readAllRows((from,to)=>db.from(table).select(columns).order('id').range(from,to).returns<Record<string,unknown>[]>());
      const results=await Promise.all([
        page('sewing_encodings','*'),page('employee_work_records','id,employee_id,task_id,quantity,unit_rate,work_date,status,pay_eligible,payroll_run_id,activity').then(rows=>rows.filter(w=>String(w.activity).startsWith('Sewing')&&w.activity!=='Sewing rework')),
        page('sewing_assignments','id,task_id,employee_id,quantity,pay_on_assignment'),page('sewing_events','assignment_id,kind,quantity'),page('production_tasks','id,order_id,order_item_id,stage').then(rows=>rows.filter(t=>t.stage==='sewing')),
        page('order_items','id,quantity,product_name,customization'),page('orders','id,order_number,customer_id'),page('customers','id,full_name'),page('profiles','id,full_name,role,active'),
        readAllRows((from,to)=>db.from('sewing_payroll_controls').select('*').order('task_id').range(from,to)),
        page('payroll_runs','id,period_start,period_end,status'),page('payroll_lines','payroll_run_id,employee_id,role,approved_units,production_pay,total_pay'),admin?page('sewing_encoding_audit','id,encoding_id,task_id,actor_id,action,reason,created_at'):Promise.resolve([])
      ]);
      setData({audit:results[12],encodings:results[0].map(e=>({...e,assignment_pay:results[2].find(a=>a.id===e.assignment_id)?.pay_on_assignment??false})),work:results[1],assignments:results[2],events:results[3],tasks:results[4],items:results[5],orders:results[6],customers:results[7],employees:results[8],controls:results[9],runs:results[10],lines:results[11]} as unknown as Data);
    }catch(e){setError(errorMessage(e));}finally{setLoading(false);}
  },[admin]);
  useEffect(()=>{void load();},[load,refreshToken]);
  async function perform(action:()=>PromiseLike<{error:unknown}>,success:string){
    if(saving.current)return;saving.current=true;setBusy(true);setError('');setNotice('');
    try{const r=await action();if(r.error)throw r.error;setNotice(success);setEdit(null);setPause(null);await load();await onUpdated?.();}catch(e){setError(errorMessage(e));}finally{saving.current=false;setBusy(false);}
  }
  const name=(id:string)=>data.employees.find(e=>e.id===id)?.full_name??'Archived employee';
  const tasks=data.tasks.map(task=>{
    const item=data.items.find(i=>i.id===task.order_item_id),order=data.orders.find(o=>o.id===task.order_id);
    const assignments=data.assignments.filter(a=>a.task_id===task.id),encodings=data.encodings.filter(e=>e.task_id===task.id),work=data.work.filter(w=>w.task_id===task.id);
    const summary=sewingReconciliation(admin?(item?.quantity??0):assignments.reduce((n,a)=>n+Number(a.quantity),0),assignments,data.events,encodings,selectedSewer||undefined);
    const label=[data.customers.find(c=>c.id===order?.customer_id)?.full_name??'Customer',item?.customization?.garment??item?.product_name,order?.order_number].filter(Boolean).join(' · ');
    return {...task,label,assignments,encodings,work,summary,paused:data.controls.find(c=>c.task_id===task.id&&c.paused)};
  });
  const matching=tasks.filter(t=>t.label.toLowerCase().includes(filter.trim().toLowerCase())&&(!selectedSewer||t.assignments.some(a=>a.employee_id===selectedSewer)));
  const matchesStatus=(task:typeof tasks[number],status:string)=>status==="all"||status==="assigned"&&(task.summary.assigned>0||task.summary.encoded>0||Boolean(task.paused))||status==="unassigned"&&task.summary.assigned===0||status==="paused"&&Boolean(task.paused)||task.summary.status===status;
  const statusOptions=[{id:"assigned",label:"With assignments"},{id:"all",label:"All jobs"},{id:"unassigned",label:"Unassigned"},{id:"over",label:"Over-encoded"},{id:"short",label:"Incomplete"},{id:"balanced",label:"Balanced"},{id:"paused",label:"Paused"}];
  const visible=matching.filter(t=>matchesStatus(t,jobStatus));
  const pages=Math.max(1,Math.ceil(visible.length/10)),currentPage=Math.min(page,pages);
  const pageJobs=visible.slice((currentPage-1)*10,currentPage*10);
  const selectedWork=data.work.filter(w=>!selectedSewer||w.employee_id===selectedSewer),selectedEncodings=data.encodings.filter(e=>!selectedSewer||e.employee_id===selectedSewer);
  const totals=sewingPeriodTotals(selectedWork,selectedEncodings,start,end);
  const periodEncodings=selectedEncodings.filter(e=>validPeriod&&e.work_date>=start&&e.work_date<=end).sort((a,b)=>b.work_date.localeCompare(a.work_date));
  const over=tasks.filter(t=>t.summary.status==='over').length;
  const pausedTasks=tasks.filter(t=>t.paused).length;
  const people=Array.from(new Set([...selectedWork.filter(w=>validPeriod&&w.work_date>=start&&w.work_date<=end).map(w=>w.employee_id),...periodEncodings.map(e=>e.employee_id)]));
  return <section className="sewing-monitor panel">
    <div className="monitor-heading"><div><div className="section-kicker">SEWING & PAYROLL</div><h2>{admin?'Production reconciliation & pay':'Your encoding & pay'}</h2><p>Pay is based on assigned pieces and the price approved by admin in Payroll Work review. Completion tracking does not add pay. Amounts are sewing output pay before deductions.</p></div><button type="button" className="quiet-button" disabled={busy||loading} onClick={()=>void load()}>Refresh</button></div>
    <div className="monitor-filters"><label>Start date<input type="date" required value={start} max={end||undefined} onChange={e=>setStart(e.target.value)}/></label><label>End date<input type="date" required value={end} min={start||undefined} onChange={e=>setEnd(e.target.value)}/></label><label>Sewer<select value={selectedSewer} onChange={e=>setSelectedSewer(e.target.value)}><option value="">All sewers</option>{activeSewerEmployees(data.employees).map(employee=><option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label></div>
    <p className="monitor-caption">Cutoff: <b>{start} to {end}</b>. Reconciliation uses all-time quantities. {selectedSewer?`Quantities and status show ${name(selectedSewer)}'s assignments; the target is their assigned quantity.`:'Job quantities and status include all visible sewers; the target is the full job quantity for admin.'} Pay amounts use the selected cutoff.</p>
    {!validPeriod&&<p role="alert" className="blocked-message">Choose valid start and end dates. End date must be on or after start date.</p>}
    {error&&<p className="blocked-message" role="alert">{error}</p>}{notice&&<p role="status" className="monitor-notice">{notice}</p>}
    {loading?<p role="status">Loading sewing and payroll records…</p>:<>
      <div className="monitor-metrics"><div><span>Payable pieces in cutoff</span><strong>{totals.pieces}</strong></div><div><span>Approved sewing pay</span><strong>{money(totals.approved)}</strong></div><div><span>Awaiting review / held estimate</span><strong>{money(totals.pending)}</strong></div><div><span>Over-encoded jobs / paused</span><strong>{over} / {pausedTasks}</strong></div></div>
      <nav className="monitor-tabs" aria-label="Sewing payroll sections">{[{id:"jobs",label:"Job status"},{id:"encoding",label:"Encoding review"},{id:"pay",label:"Pay summary"},{id:"history",label:"History"}].map(tab=><button type="button" key={tab.id} aria-pressed={section===tab.id} onClick={()=>setSection(tab.id)}>{tab.label}</button>)}</nav>
      {section==="jobs"&&<>
        <div className="monitor-section-title"><div><h3>{admin?"Team / job reconciliation":"Your assignment reconciliation"}</h3><p>Review a job at a glance. Open details only when you need the sewer breakdown.</p></div></div>
        <div className="monitor-job-filters"><label>Find a team or job<input type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Team, garment or job order"/></label><label>Show<select value={jobStatus} onChange={e=>setJobStatus(e.target.value)}>{statusOptions.map(option=><option key={option.id} value={option.id}>{option.label} ({matching.filter(t=>matchesStatus(t,option.id)).length})</option>)}</select></label><button type="button" className="quiet-button" onClick={()=>{setFilter('');setSelectedSewer('');setJobStatus('assigned');setExpandedJob('');}}>Reset filters</button></div>
        <p className="monitor-result-count" role="status">{visible.length} matching jobs. Quantities below include all dates; pay amounts use the selected cutoff.</p>
        <div className="monitor-job-list">{pageJobs.map(task=><article className={`monitor-job-row ${task.summary.status}`} key={task.id}>
          <div className="monitor-job-top"><div className="monitor-job-name"><h4>{task.label}</h4><div className="monitor-job-badges"><span className={`monitor-badge ${task.summary.status}`}>{task.summary.status==='over'?'Over-encoded':task.summary.status==='balanced'?'Balanced':'Incomplete'}</span>{task.paused&&<span className="monitor-badge over">Computation paused</span>}</div></div>
            <dl className="monitor-job-numbers"><div><dt>Target</dt><dd>{task.summary.target}</dd></div><div><dt>Assigned</dt><dd>{task.summary.assigned}</dd></div><div><dt>Encoded</dt><dd>{task.summary.encoded}</dd></div><div><dt>{task.summary.excess?'Excess':'Remaining'}</dt><dd>{task.summary.excess||task.summary.remaining}</dd></div></dl>
            <button type="button" className="quiet-button" aria-expanded={expandedJob===task.id} aria-controls={`monitor-job-${task.id}`} onClick={()=>setExpandedJob(current=>current===task.id?'':task.id)}>{expandedJob===task.id?'Close details':'View details'}</button>
          </div>
          {expandedJob===task.id&&<div className="monitor-job-detail" id={`monitor-job-${task.id}`}>
            {task.paused&&<p className="blocked-message">Computation paused: {task.paused.reason}. Warnings remain active.</p>}
            {task.summary.employees.length?<div className="monitor-sewer-cards">{task.summary.employees.filter(e=>!selectedSewer||e.employeeId===selectedSewer).map(e=>{const period=sewingPeriodTotals(task.work.filter(w=>w.employee_id===e.employeeId),task.encodings.filter(w=>w.employee_id===e.employeeId),start,end);return <section key={e.employeeId} className="monitor-sewer-card"><div><h5>{name(e.employeeId)}</h5><span className={`monitor-badge ${e.over?'over':e.encoded===e.assigned?'balanced':'short'}`}>{e.over?'Over-encoded':e.encoded===e.assigned?'Balanced':'Incomplete'}</span></div><dl><div><dt>Assigned</dt><dd>{e.assigned}</dd></div><div><dt>Encoded</dt><dd>{e.encoded}</dd></div><div><dt>Cutoff pay pieces</dt><dd>{period.pieces}</dd></div><div><dt>Cutoff amount*</dt><dd>{money(period.approved+period.pending)}</dd></div></dl></section>;})}</div>:<p className="monitor-empty">No sewer is assigned to this job yet. Assign pieces from Sewing assignments to start tracking pay.</p>}
            <div className="monitor-job-controls"><a className="quiet-button" href={`/sewing?order=${task.order_id}`}>Open assignments</a>{admin&&<button type="button" className="quiet-button" disabled={busy} onClick={()=>setPause({task:task.id,paused:!task.paused,reason:''})}>{task.paused?'Resume computation':'Pause computation'}</button>}</div>
            <p className="monitor-caption">* Includes pending estimates. Admin reviews assignment pay in Payroll.</p>
          </div>}
        </article>)}</div>
        {!visible.length&&<div className="monitor-empty"><strong>No jobs match these filters.</strong><p>Choose All jobs or reset the filters to see other work.</p></div>}
        {visible.length>10&&<div className="monitor-pagination"><span>Page {currentPage} of {pages}</span><button type="button" className="quiet-button" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Previous</button><button type="button" className="quiet-button" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>Next</button></div>}
        <p className="monitor-caption">Red warnings, unreviewed assignment pay, and paused computation block payroll. Incomplete jobs can still be paid for approved assigned pieces.</p>
      </>}
      {section==="encoding"&&<>
      <h3>Production encoding review</h3><p className="monitor-caption">Review assignment pay under Payroll ? Work review. These completion entries do not add pay to new assignments.</p><TableScroll className="monitor-table" aria-label="Legacy sewing completions"><table><thead><tr><th>Date / sewer</th><th>Team / job</th><th>Pieces</th><th>Price</th><th>Amount</th><th>Status / action</th></tr></thead><tbody>{periodEncodings.map(e=><tr key={e.id}><td>{e.work_date}<small>{name(e.employee_id)}</small></td><td>{tasks.find(t=>t.id===e.task_id)?.label??'Archived job'}</td><td>{e.quantity}</td><td>{e.pricing_mode} · {money(e.unit_rate)}</td><td>{e.assignment_pay?"Production only; paid by assignment":money(e.quantity*e.unit_rate)}</td><td>{e.status}{e.review_reason&&<small>{e.review_reason}</small>}{admin&&e.status==='pending'&&<div className="monitor-actions"><button type="button" disabled={busy} onClick={()=>void perform(()=>createClient().rpc('review_sewing_encoding',{p_id:e.id,p_action:'post',p_quantity:e.quantity,p_reason:''}),'Production output validated. Assignment-based pay is counted only once.')}>Validate output</button><button type="button" disabled={busy} onClick={()=>setEdit({id:e.id,quantity:String(e.quantity),reason:''})}>Correct / void</button></div>}</td></tr>)}</tbody></table></TableScroll>{!periodEncodings.length&&<p>No encodings in this cutoff.</p>}
      {edit&&<form ref={editForm} className="monitor-edit" onSubmit={e=>{e.preventDefault();void perform(()=>createClient().rpc('review_sewing_encoding',{p_id:edit.id,p_action:'correct',p_quantity:Number(edit.quantity),p_reason:edit.reason}),'Encoding corrected; warnings recalculated.');}}><h4>Correct pending encoding</h4><label>Correct quantity<input type="number" required min="1" step="1" value={edit.quantity} onChange={e=>setEdit({...edit,quantity:e.target.value})}/></label><label>Reason<input required maxLength={1000} value={edit.reason} onChange={e=>setEdit({...edit,reason:e.target.value})}/></label><div className="monitor-actions"><button disabled={busy} type="submit">Save correction</button><button disabled={busy||!edit.reason.trim()} type="button" onClick={()=>void perform(()=>createClient().rpc('review_sewing_encoding',{p_id:edit.id,p_action:'void',p_quantity:null,p_reason:edit.reason}),'Encoding voided with an audit reason.')}>Void encoding</button><button type="button" disabled={busy} onClick={()=>setEdit(null)}>Cancel</button></div></form>}
      </>}
      {pause&&<form ref={pauseForm} className="monitor-edit" onSubmit={e=>{e.preventDefault();void perform(()=>createClient().rpc('pause_sewing_computation',{p_task:pause.task,p_paused:pause.paused,p_reason:pause.reason}),'Computation setting saved.');}}><h4>{pause.paused?'Pause':'Resume'} automatic computation</h4><label>Reason<input required maxLength={1000} value={pause.reason} onChange={e=>setPause({...pause,reason:e.target.value})}/></label><div className="monitor-actions"><button disabled={busy}>Save setting</button><button type="button" disabled={busy} onClick={()=>setPause(null)}>Cancel</button></div></form>}
      {section==="pay"&&<>
      <h3>Individual sewing pay for this cutoff</h3><TableScroll className="monitor-table" aria-label="Sewing pay by employee"><table><thead><tr><th>Sewer</th><th>Pieces</th><th>Approved pay</th><th>Pending / held</th></tr></thead><tbody>{people.map(id=>{const w=sewingPeriodTotals(selectedWork.filter(w=>w.employee_id===id),selectedEncodings.filter(e=>e.employee_id===id),start,end);return <tr key={id}><td>{name(id)}</td><td>{w.pieces}</td><td>{money(w.approved)}</td><td>{money(w.pending)}</td></tr>;})}</tbody><tfoot><tr><th>Total</th><th>{totals.pieces}</th><th>{money(totals.approved)}</th><th>{money(totals.pending)}</th></tr></tfoot></table></TableScroll>
      {admin&&<p className="monitor-caption">Preparing a payroll run includes all configured employees for this cutoff. The tables here show the sewing portion.</p>}
      {admin&&<button className="primary-button" type="button" disabled={busy||loading||!validPeriod} onClick={()=>void perform(()=>createClient().rpc('create_payroll_run',{p_start:start,p_end:end}),'Payroll draft created. Review and approve it under Payroll runs.')}>Prepare payroll · {start} – {end}</button>}
      </>}
      {section==="history"&&<>
      {admin&&<details><summary>Encoding and computation change history</summary><TableScroll className="monitor-table" aria-label="Sewing change history"><table><thead><tr><th>Recorded</th><th>By</th><th>Action</th><th>Team / job</th><th>Reason</th></tr></thead><tbody>{[...data.audit].sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(a=><tr key={a.id}><td>{new Date(a.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})}</td><td>{name(a.actor_id)}</td><td>{a.action}</td><td>{tasks.find(t=>t.id===a.task_id)?.label??'Archived job'}</td><td>{a.reason}</td></tr>)}</tbody></table></TableScroll></details>}
      <h3>Payroll history</h3><p className="monitor-caption">Payroll totals include base pay, sewing output, and deductions. Open Payroll runs to review, approve or mark paid.</p><TableScroll className="monitor-table" aria-label="Sewing payroll periods"><table><thead><tr><th>Period</th><th>Status</th><th>Sewing pieces</th><th>Sewing amount</th><th>Net pay</th></tr></thead><tbody>{[...data.runs].sort((a,b)=>b.period_start.localeCompare(a.period_start)).map(run=>{const lines=data.lines.filter(l=>l.payroll_run_id===run.id&&l.role==='sewer'&&(!selectedSewer||l.employee_id===selectedSewer));return <tr key={run.id}><td>{run.period_start} – {run.period_end}</td><td>{run.status}</td><td>{lines.reduce((n,l)=>n+Number(l.approved_units),0)}</td><td>{money(lines.reduce((n,l)=>n+Number(l.production_pay),0))}</td><td>{money(lines.reduce((n,l)=>n+Number(l.total_pay),0))}</td></tr>;})}</tbody></table></TableScroll>
      </>}
    </>}
  </section>;
}
