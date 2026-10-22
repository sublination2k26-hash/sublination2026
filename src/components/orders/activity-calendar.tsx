"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildCalendarEvents, manilaDate, type ActivityAudit, type CalendarEvent } from "@/lib/activity-calendar";
import "./activity-calendar.css";

export function ActivityCalendar({ orderId, refreshToken }: { orderId: string; refreshToken: object }) {
  const dialog=useRef<HTMLDialogElement>(null);
  const dialogTitle=useId();
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{
    if(!expanded || !dialog.current)return;
    const current=dialog.current,previous=document.body.style.overflow;
    document.body.style.overflow="hidden";
    current.showModal();
    return ()=>{current.close();document.body.style.overflow=previous;};
  },[expanded]);
  useEffect(()=>setExpanded(false),[orderId]);
  const [events,setEvents]=useState<CalendarEvent[]>([]);
  const [month,setMonth]=useState(()=>manilaDate(new Date().toISOString()).slice(0,7));
  const [day,setDay]=useState("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  const openedOrder=useRef<string|null>(null);
  useEffect(()=>{
    let active=true;
    setLoading(true); setError(""); setEvents([]);
    (async()=>{
      try {
        const db=createClient(), rows:ActivityAudit[]=[];
        for(let offset=0;;offset+=500){
          const {data,error}=await db.rpc("get_order_activity_calendar",{p_order_id:orderId}).range(offset,offset+499);
          if(error) throw error;
          rows.push(...(data??[]) as ActivityAudit[]);
          if(!active) return;
          if(!data || data.length<500) break;
        }
        if(active) {
          const loaded=buildCalendarEvents(rows);
          setEvents(loaded);
          if(openedOrder.current!==orderId){
            openedOrder.current=orderId;
            if(loaded.length) setMonth(loaded[loaded.length-1].date.slice(0,7));
          }
        }
      } catch(cause) {
        if(active) setError(typeof cause === "object" && cause !== null && "message" in cause ? String(cause.message) : "Could not load activity history.");
      } finally {if(active) setLoading(false);}
    })();
    return ()=>{active=false;};
  },[orderId,refreshToken,retry]);
  useEffect(()=>{setDay("");setMonth(manilaDate(new Date().toISOString()).slice(0,7));},[orderId]);
  const [year,number]=month.split("-").map(Number);
  const days=new Date(Date.UTC(year,number,0)).getUTCDate();
  const first=new Date(Date.UTC(year,number-1,1)).getUTCDay();
  const monthLabel=new Date(Date.UTC(year,number-1,1)).toLocaleDateString("en-PH",{month:"long",year:"numeric",timeZone:"Asia/Manila"});
  const changeMonth=(delta:number)=>{const date=new Date(Date.UTC(year,number-1+delta,1));setMonth(date.toISOString().slice(0,7));setDay("");};
  const monthEvents=events.filter(event=>event.date.startsWith(month));
  const visible=monthEvents.filter(event=>!day || event.date===day);
  const grouped=new Map<string,CalendarEvent[]>();
  for(const event of monthEvents) grouped.set(event.date,[...(grouped.get(event.date)??[]),event]);
  const latest=events[events.length-1];
  return <section className="panel activity-calendar activity-compact" aria-label="Order activity summary">
    <div className="activity-summary-row"><div className="activity-summary-copy"><b>Work history</b>{loading?<span role="status">Loading latest activity...</span>:error?<span>History unavailable</span>:latest?<span className="activity-summary-status"><i className={`activity-${latest.color}`} aria-hidden="true"/>{latest.title}<small>{new Date(latest.at).toLocaleString("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</small></span>:<span>No recorded activity yet.</span>}</div><button type="button" className="filter-button" aria-haspopup="dialog" onClick={()=>setExpanded(true)}>View calendar</button></div>
    <dialog ref={dialog} className="activity-calendar-dialog" aria-labelledby={dialogTitle} onCancel={()=>setExpanded(false)} onClose={()=>setExpanded(false)} onClick={event=>{if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)setExpanded(false);}}}>
    <div className="activity-dialog-heading"><h2 id={dialogTitle}>Activity calendar</h2><button type="button" className="activity-dialog-close" onClick={()=>setExpanded(false)} aria-label="Close activity calendar" autoFocus>Close</button></div>
    <div className="activity-dialog-body">
    <button type="button" className="text-button" onClick={()=>setRetry(value=>value+1)} disabled={loading}>Refresh history</button>
    <p className="activity-help">Every recorded action stays on its original date, even after a return or correction. Times are in Asia/Manila.</p>
    <div className="activity-legend"><span className="activity-yellow">Yellow: received / started / updated</span><span className="activity-green">Green: completed / approved</span><span className="activity-red">Red: problem / returned / blocked</span></div>
    {error ? <div className="employee-error" role="alert">Could not load calendar: {error}<p>If this feature was just added, apply the order activity calendar migration first.</p></div> : loading ? <p className="empty-inline" role="status">Loading activity history...</p> : <>
    <div className="activity-latest" aria-label="Latest activity">{events.slice(-3).reverse().map(event=><button type="button" className={`activity-latest-card activity-${event.color}`} key={event.id} onClick={()=>{setMonth(event.date.slice(0,7));setDay(event.date);}}><small>{new Date(event.at).toLocaleString("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</small><b>{event.title}</b><span>{event.actor}</span></button>)}</div>
    <div className="activity-month"><button type="button" className="text-button" aria-label="Previous month" onClick={()=>changeMonth(-1)}>Previous</button><label>Month<input aria-label="Activity month" type="month" value={month} onChange={event=>{if(/^\d{4}-\d{2}$/.test(event.target.value)){setMonth(event.target.value);setDay("");}}}/></label><button type="button" className="text-button" aria-label="Next month" onClick={()=>changeMonth(1)}>Next</button></div>
    <h3 className="activity-month-title">{monthLabel}</h3>
    <div className="activity-grid" aria-label={monthLabel}>
      {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(label=><div className="activity-weekday" key={label}>{label}</div>)}
      {Array.from({length:first},(_,i)=><div key={`blank-${i}`} aria-hidden="true"/>)}
      {Array.from({length:days},(_,i)=>{
        const date=`${month}-${String(i+1).padStart(2,"0")}`;
        const entries=grouped.get(date)??[];
        const colors=[...new Set(entries.map(event=>event.color))];
        return <button type="button" key={date} className={`activity-day ${colors.includes("red")?"activity-red":colors.includes("green")?"activity-green":colors.includes("yellow")?"activity-yellow":""} ${day===date?"selected":""}`} aria-pressed={day===date} aria-label={`${date}: ${entries.length} events`} onClick={()=>setDay(day===date?"":date)}><b>{i+1}</b><span className="activity-dots">{colors.map(color=><i key={color} className={`activity-${color}`}/>)}</span>{entries.length>0&&<small>{entries.length} events</small>}</button>;
      })}
    </div>
    <div className="activity-list-heading"><h3>{day||"All activity this month"}</h3>{day&&<button type="button" className="text-button" onClick={()=>setDay("")}>Show month</button>}</div>
    <ol className="activity-event-list">{visible.map(event=><li key={event.id} className={`activity-event activity-${event.color}`}><time dateTime={event.at}>{new Date(event.at).toLocaleString("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit"})}</time><b>{event.title}</b><span>Action by: {event.actor}</span>{event.detail&&<p>{event.detail}</p>}</li>)}</ol>
    {!visible.length&&<p className="empty-inline">No recorded activity for {day?"this date":"this month"}.</p>}
    {!!events.length&&!monthEvents.length&&<button type="button" className="text-button" onClick={()=>{setMonth(events[events.length-1].date.slice(0,7));setDay("");}}>Go to latest activity</button>}
    <p className="activity-help">History shows saved audit records. Missing older actions cannot be reconstructed reliably.</p>
    </>}
    </div></dialog>
  </section>;
}
