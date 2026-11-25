"use client";

import { TableScroll } from "@/components/ui/table-scroll";
import { SearchableList } from "@/components/ui/searchable-list";
import { ExcelExport } from "@/components/ui/excel-export";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readAllRows } from "@/lib/workspace-loading";
import { artistCutoffTasks, artistManilaDate, printArtistPayroll, type ArtistAccount, type ArtistLayoutTask, type ArtistPayrollRecord, type ArtistPayrollItem } from "@/lib/artist-payroll";
import "./artist-payroll.css";

const peso=(value:number)=>Number(value).toLocaleString("en-PH",{style:"currency",currency:"PHP"});
const dateTime=(value:string)=>new Date(value).toLocaleString("en-PH",{timeZone:"Asia/Manila"});
const addDays=(value:string,days:number)=>{const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
const currentWeek=()=>{const today=artistManilaDate(new Date().toISOString());return addDays(today,-((new Date(`${today}T00:00:00Z`).getUTCDay()+6)%7));};
const message=(reason:unknown)=>reason&&typeof reason==="object"&&"message" in reason?String(reason.message):"Could not save artist payroll.";
type RunLayoutReservation={task_reference:string;unit_rate:number;payroll_run:{id:string;period_start:string;period_end:string;status:"draft"|"approved"|"paid"}|null};

export function ArtistWorkTracking({onSaved,reportOnly=false,automaticPayroll=false}:{onSaved?:()=>void;reportOnly?:boolean;automaticPayroll?:boolean}) {
  const headingId=useId();
  const [tasks,setTasks]=useState<ArtistLayoutTask[]>([]);
  const [employees,setEmployees]=useState<ArtistAccount[]>([]);
  const [records,setRecords]=useState<ArtistPayrollRecord[]>([]);
  const [items,setItems]=useState<ArtistPayrollItem[]>([]);
  const [runItems,setRunItems]=useState<RunLayoutReservation[]>([]);
  const [rate,setRate]=useState<number|null>(null),[rateInput,setRateInput]=useState("");
  const [artist,setArtist]=useState("");
  const [customStart,setStart]=useState(currentWeek),[customEnd,setEnd]=useState(()=>addDays(currentWeek(),6));
  const [allDates,setAllDates]=useState(true);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const saving=useRef(false);
  useEffect(()=>{
    const controller=new AbortController();
    const db=createClient();
    setLoading(true);setError("");setTasks([]);setRecords([]);setItems([]);setRunItems([]);setRate(null);
    async function load(){
      const [t,e,r,i,ri,s]=await Promise.all([
        readAllRows((from,to)=>db.from("production_tasks").select("id,status,started_by,completed_by,started_at,completed_at,notes,order:orders!production_tasks_order_id_fkey(order_number,status,notes,customer:customers!orders_customer_id_fkey(full_name)),item:order_items!production_tasks_order_item_id_fkey(product_name,quantity)").eq("stage","layout").eq("status","completed").order("id").range(from,to).abortSignal(controller.signal)),
        readAllRows((from,to)=>db.from("profiles").select("id,full_name,role,active").order("id").range(from,to).abortSignal(controller.signal)),
        readAllRows((from,to)=>db.from("artist_layout_payroll_records").select("*").order("created_at",{ascending:false}).order("id").range(from,to).abortSignal(controller.signal)),
        readAllRows((from,to)=>db.from("artist_layout_payroll_items").select("record_id,task_reference,order_number,team_name,garment,completed_at").order("id").range(from,to).abortSignal(controller.signal)),
        readAllRows((from,to)=>db.from("payroll_run_artist_layout_items").select("task_reference,unit_rate,payroll_run:payroll_runs!payroll_run_artist_layout_items_payroll_run_id_fkey(id,period_start,period_end,status)").order("id").range(from,to).abortSignal(controller.signal)),
        db.from("artist_layout_pay_settings").select("unit_rate").eq("singleton",true).abortSignal(controller.signal).single(),
      ]);
      if(s.error)throw s.error;
      if(controller.signal.aborted)return;
      setTasks(t as unknown as ArtistLayoutTask[]);setEmployees(e as ArtistAccount[]);setRecords(r as ArtistPayrollRecord[]);setItems(i as ArtistPayrollItem[]);setRunItems(ri as unknown as RunLayoutReservation[]);
      setRate(Number(s.data.unit_rate));setRateInput(String(s.data.unit_rate));
    }
    void load().catch(reason=>{if(!controller.signal.aborted)setError(message(reason));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[version]);
  const allRange=useMemo(()=>{
    const days=tasks.filter(t=>t.completed_at&&employees.some(e=>e.id===t.completed_by&&e.role==="artist")).map(t=>artistManilaDate(t.completed_at!));
    const starts=[...days,...records.map(r=>r.period_start)].sort();
    const ends=[...days,...records.map(r=>r.period_end)].sort();
    return {start:starts[0]??currentWeek(),end:ends[ends.length-1]??addDays(currentWeek(),6)};
  },[tasks,employees,records]);
  const start=allDates?allRange.start:customStart;
  const end=allDates?allRange.end:customEnd;
  function selectWeek(offset:number){const week=addDays(currentWeek(),offset*7);setStart(week);setEnd(addDays(week,6));setAllDates(false);}
  const visible=useMemo(()=>artistCutoffTasks(tasks,employees,start,end,artist),[tasks,employees,start,end,artist]);
  const names=useMemo(()=>new Map(employees.map(e=>[e.id,e.full_name])),[employees]);
  const recordByTask=useMemo(()=>{
    const byId=new Map(records.map(r=>[r.id,r]));
    return new Map(items.map(item=>[item.task_reference,byId.get(item.record_id)]));
  },[records,items]);
  const runByTask=useMemo(()=>new Map(runItems.map(item=>[item.task_reference,item])),[runItems]);
  const summaries=useMemo(()=>{
    const result=new Map<string,{count:number;total:number;unrecorded:ArtistLayoutTask[];rates:Set<number>}>();
    for(const task of visible){
      const id=task.completed_by!;const saved=recordByTask.get(task.id);const reserved=runByTask.get(task.id);const price=Number(saved?.unit_rate??reserved?.unit_rate??rate??0);
      const row=result.get(id)??{count:0,total:0,unrecorded:[],rates:new Set<number>()};
      row.count++;row.total+=price;row.rates.add(price);if(!saved&&!reserved)row.unrecorded.push(task);result.set(id,row);
    }
    return [...result].sort(([a],[b])=>(names.get(a)??"").localeCompare(names.get(b)??""));
  },[visible,recordByTask,runByTask,rate,names]);
  const history=records.filter(r=>(!artist||r.employee_id===artist)&&!!start&&!!end&&start<=end&&r.period_start<=end&&r.period_end>=start);
  const validDates=Boolean(start&&end&&start<=end);
  async function saveRate(event:React.FormEvent){
    event.preventDefault();if(saving.current)return;
    if(!/^\d+(\.\d{1,2})?$/.test(rateInput.trim())||Number(rateInput)>=10000000000){setError("Enter a non-negative layout price with at most two decimals.");return;}
    saving.current=true;setBusy(true);setError("");setNotice("");
    try{const {data,error}=await createClient().from("artist_layout_pay_settings").update({unit_rate:Number(rateInput)}).eq("singleton",true).select("unit_rate").single();if(error)throw error;setRate(Number(data.unit_rate));setNotice("Artist layout price updated. Saved records keep their original price.");}
    catch(reason){setError(message(reason));}finally{saving.current=false;setBusy(false);}
  }
  async function saveRecord(employeeId:string,unrecorded:ArtistLayoutTask[]){
    if(saving.current||rate===null||!validDates)return;
    saving.current=true;setBusy(true);setError("");setNotice("");
    try{
      const {error}=await createClient().rpc("create_artist_layout_payroll",{p_employee:employeeId,p_start:start,p_end:end,p_expected_rate:rate,p_expected_tasks:unrecorded.map(t=>t.id)});
      if(error)throw error;
      setNotice("Artist payroll record and payslip saved. Print the saved record below or open Payroll records for its payslip PDF.");setVersion(value=>value+1);onSaved?.();
    }catch(reason){setError(message(reason));}finally{saving.current=false;setBusy(false);}
  }
  function printRecord(record:ArtistPayrollRecord){try{printArtistPayroll(record,items);}catch(reason){setError(message(reason));}}
  return <section className="payroll-section panel artist-payroll" aria-labelledby={headingId}>
    <div className="panel-heading payroll-section-heading"><div><h2 id={headingId}>Artist layout payroll &amp; reports</h2><p>{automaticPayroll?"Review completed layouts and rates included automatically in payroll runs. Daily attendance and layout earnings appear together on the approved run payslip.":"This section records layout pay only; daily attendance pay is handled separately in Payroll runs."} One completed layout = one payable layout. Garment pieces do not multiply artist pay.</p></div><button type="button" className="filter-button" disabled={busy||loading} onClick={()=>setVersion(v=>v+1)}>Refresh</button></div>
    <div className="artist-payroll-filters">
      <label>Artist<select value={artist} onChange={e=>setArtist(e.target.value)} disabled={busy}><option value="">All artists</option>{employees.filter(e=>e.role==="artist").map(e=><option key={e.id} value={e.id}>{e.full_name}{e.active?"":" (inactive)"}</option>)}</select></label>
      <label>Cutoff start<input type="date" value={start} disabled={busy} onChange={e=>{setEnd(end);setStart(e.target.value);setAllDates(false);}}/></label>
      <label>Cutoff end<input type="date" value={end} min={start||undefined} disabled={busy} onChange={e=>{setStart(start);setEnd(e.target.value);setAllDates(false);}}/></label>
    </div>
    <div className="artist-payroll-cutoffs" role="group" aria-label="Quick cutoff selection"><button type="button" className="filter-button" aria-pressed={allDates} disabled={busy} onClick={()=>setAllDates(true)}>All records</button><button type="button" className="filter-button" disabled={busy} onClick={()=>selectWeek(0)}>This week</button><button type="button" className="filter-button" disabled={busy} onClick={()=>selectWeek(-1)}>Previous week</button></div>
    <p>{allDates?"Showing all artist records":"Selected cutoff"}: {start} to {end}.</p>
    {!validDates&&<p role="alert">Choose a valid cutoff start and end date.</p>}
    {error&&<p className="payroll-alert is-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {loading?<p role="status">Loading artist payroll...</p>:rate!==null&&<>
      {!reportOnly&&<form className="artist-payroll-price" onSubmit={saveRate}><label>Admin price per completed layout (PHP)<input required type="number" inputMode="decimal" min="0" max="9999999999.99" step="0.01" value={rateInput} onChange={e=>setRateInput(e.target.value)} disabled={busy}/></label><button className="primary-button" disabled={busy}>Save artist price</button></form>}
      <p>Current layout price: <b>{rate===null?"Not configured":peso(rate)}</b>. Default is PHP 150. Only admin can change it. Saved payroll keeps its original rate.</p>
      <p>Only the artist recorded as completing the layout is credited. Admin completions and training examples are excluded. Payroll runs save the layout count and current rate in the draft; deleting a draft releases those layouts.</p>
      {automaticPayroll&&<p>Newly eligible layouts are included when you create a payroll run. Layouts already reserved by a draft or paid through an older artist record are not counted again.</p>}
      <h3>Artist totals for this cutoff</h3>
      <ExcelExport title="Artist layout cutoff totals" columns={[{header:"Artist",width:28},{header:"Completed layouts",width:22},{header:"Rates (PHP)",width:28},{header:"Total pay (PHP)",width:22},{header:automaticPayroll?"Awaiting payroll run":"Unrecorded layouts",width:22}]} rows={summaries.map(([id,s])=>[names.get(id)??"Artist",s.count,[...s.rates].join(", "),s.total,s.unrecorded.length])}/>
      <TableScroll className="table-wrap payroll-table-wrap" aria-label="Artist work totals"><table><thead><tr><th>ARTIST</th><th>COMPLETED LAYOUTS</th><th>RATE / LAYOUT</th><th>CUTOFF PAY</th><th>{automaticPayroll?"AWAITING PAYROLL RUN":"UNRECORDED LAYOUTS"}</th>{!reportOnly&&!automaticPayroll&&<th>PAYROLL RECORD</th>}</tr></thead><tbody>{summaries.map(([id,s])=><tr key={id}><td>{names.get(id)??"Artist"}</td><td>{s.count}</td><td>{[...s.rates].map(peso).join(" / ")}</td><td>{peso(s.total)}</td><td>{s.unrecorded.length}</td>{!reportOnly&&!automaticPayroll&&<td><button type="button" className="filter-button" disabled={busy||!s.unrecorded.length||!employees.find(e=>e.id===id)?.active} onClick={()=>void saveRecord(id,s.unrecorded)}>Save payroll: {peso(s.unrecorded.length*Number(rate??0))}</button></td>}</tr>)}</tbody><tfoot><tr><th>Total</th><td>{visible.length}</td><td></td><td>{peso(summaries.reduce((sum,[,s])=>sum+s.total,0))}</td><td>{summaries.reduce((sum,[,s])=>sum+s.unrecorded.length,0)}</td>{!reportOnly&&!automaticPayroll&&<td/>}</tr></tfoot></table></TableScroll>
      <h3>Completed layout breakdown ({visible.length} layouts)</h3>
      <SearchableList className="table-wrap payroll-table-wrap"><table><thead><tr><th>ARTIST WHO COMPLETED</th><th>TEAM / ORDER / WORK</th><th>LAYOUTS</th><th>GARMENT PIECES</th><th>COMPLETED (PH)</th><th>RATE / PAY</th><th>RECORD</th></tr></thead><tbody>{visible.map(t=>{const saved=recordByTask.get(t.id);const reserved=runByTask.get(t.id);const price=Number(saved?.unit_rate??reserved?.unit_rate??rate??0);return <tr key={t.id}><td>{names.get(t.completed_by!)??"Artist"}</td><td><strong className="payroll-team-name">{t.order?.customer?.full_name??"Team unavailable"}</strong><small>{t.order?.order_number}</small><small>{t.item?.product_name}</small></td><td>1</td><td>{t.item?.quantity??"?"}<small>Reference only</small></td><td>{dateTime(t.completed_at!)}</td><td>{peso(price)}</td><td>{saved?"Historical payroll record":reserved?.payroll_run?`${reserved.payroll_run.status==="draft"?"Reserved in draft":"Included in run"} · ${reserved.payroll_run.period_start} to ${reserved.payroll_run.period_end}`:automaticPayroll?"Awaiting payroll run":"Not yet recorded"}</td></tr>;})}</tbody></table></SearchableList>
      {!visible.length&&<p>No completed artist layouts in this cutoff. Choose <button type="button" className="filter-button" onClick={()=>setAllDates(true)}>All records</button> to see earlier work.</p>}
      <h3>Saved artist payroll records</h3><p>Records whose cutoff overlaps the selected dates. Each record has a saved payslip in Payroll records; saving does not mark payment received.</p>
      <ExcelExport title="Saved artist payroll records" columns={[{header:"Artist",width:28},{header:"Cutoff start",width:18},{header:"Cutoff end",width:18},{header:"Layouts",width:14},{header:"Saved rate (PHP)",width:22},{header:"Total pay (PHP)",width:22},{header:"Payslip ID",width:38}]} rows={history.map(r=>[r.employee_name,r.period_start,r.period_end,r.layout_count,Number(r.unit_rate),Number(r.total_pay),r.payslip_id])}/>
      <SearchableList className="table-wrap payroll-table-wrap"><table><thead><tr><th>ARTIST</th><th>CUTOFF</th><th>LAYOUTS</th><th>SAVED PRICE</th><th>TOTAL PAY</th><th>ACTION</th></tr></thead><tbody>{history.map(r=><tr key={r.id}><td>{r.employee_name}</td><td>{r.period_start} to {r.period_end}</td><td>{r.layout_count}</td><td>{peso(r.unit_rate)}</td><td>{peso(r.total_pay)}</td><td><button className="filter-button" onClick={()=>printRecord(r)}>Print / Save PDF</button></td></tr>)}</tbody></table></SearchableList>
      {!history.length&&<p>No saved artist payroll records for this cutoff.</p>}
    </>}
  </section>;
}
