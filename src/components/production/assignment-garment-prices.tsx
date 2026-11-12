"use client";

import {useRef,useState} from "react";
import {createClient} from "@/lib/supabase/client";

type Employee={id:string;full_name:string};
type Rate={employee_id:string;garment:string;unit_rate:number;promo_rate:number|null};
type Compensation={employee_id:string;salary_basis:string;piece_rate:number};

export function AssignmentGarmentPrices({garment,employees,rates,compensations,onSaved}:{garment:string;employees:Employee[];rates:Rate[];compensations:Compensation[];onSaved:()=>Promise<void>}){
  const [drafts,setDrafts]=useState<Record<string,{regular:string;promo:string}>>({});
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const saving=useRef(false);
  const key=(id:string)=>JSON.stringify([id,garment]);
  function prices(id:string){
    const saved=rates.find(rate=>rate.employee_id===id&&rate.garment===garment);
    const config=compensations.find(item=>item.employee_id===id);
    return drafts[key(id)]??{regular:String(saved?.unit_rate??config?.piece_rate??""),promo:String(saved?.promo_rate??"")};
  }
  async function save(employee:Employee){
    if(saving.current)return;
    const draft=prices(employee.id);
    const valid=(value:string)=>/^\d+(\.\d{1,2})?$/.test(value.trim())&&Number(value)<=9999999999.99;
    if(!valid(draft.regular)||(draft.promo.trim()&&!valid(draft.promo))){setError("Enter non-negative prices with at most two decimal places.");return;}
    saving.current=true;setBusy(employee.id);setError("");setNotice("");
    try{
      const db=createClient();
      // Create missing pay settings without overwriting an existing salary agreement.
      const {error:configError}=await db.from("employee_compensation").upsert({employee_id:employee.id,salary_basis:"piece",pay_frequency:"weekly",base_rate:0,piece_rate:Number(draft.regular)},{onConflict:"employee_id",ignoreDuplicates:true});
      if(configError)throw configError;
      const {error:rateError}=await db.from("sewing_garment_rates").upsert({employee_id:employee.id,garment,unit_rate:Number(draft.regular),promo_rate:draft.promo.trim()?Number(draft.promo):null});
      if(rateError)throw rateError;
      await onSaved();
      setDrafts(current=>{const next={...current};delete next[key(employee.id)];return next;});
      setNotice(`${employee.full_name}: ${garment} prices saved. Approved assignments keep their saved price.`);
    }catch(cause){setError((cause as {message?:string})?.message??"Could not save garment prices.");}
    finally{saving.current=false;setBusy("");}
  }
  return <div className="sewing-job-prices">
    <h3>Garment prices · {garment}</h3>
    <p>Admin can enter regular and promo prices per piece here. New sewers without pay settings use weekly piece pay when prices are saved.</p>
    <div className="table-wrap"><table><thead><tr><th>SEWER</th><th>GARMENT</th><th>REGULAR / PIECE</th><th>PROMO / PIECE</th><th>ACTION</th></tr></thead><tbody>{employees.map(employee=>{
      const draft=prices(employee.id),config=compensations.find(item=>item.employee_id===employee.id);
      return <tr key={employee.id}><td>{employee.full_name}{config?.salary_basis==="fixed"&&<small>Fixed salary; no piece pay</small>}</td><td>{garment}</td>
        <td><input aria-label={`Regular ${garment} price for ${employee.full_name}`} type="number" min="0" max="9999999999.99" step="0.01" inputMode="decimal" value={draft.regular} placeholder="Enter regular price" disabled={!!busy} onChange={e=>setDrafts(current=>({...current,[key(employee.id)]:{...draft,regular:e.target.value}}))}/></td>
        <td><input aria-label={`Promo ${garment} price for ${employee.full_name}`} type="number" min="0" max="9999999999.99" step="0.01" inputMode="decimal" value={draft.promo} placeholder="Optional promo price" disabled={!!busy} onChange={e=>setDrafts(current=>({...current,[key(employee.id)]:{...draft,promo:e.target.value}}))}/></td>
        <td><button type="button" className="filter-button" disabled={!!busy} onClick={()=>void save(employee)}>{busy===employee.id?"Saving…":"Save prices"}</button></td></tr>;
    })}</tbody></table></div>
    {!employees.length&&<p>No active sewer matches the selected filter.</p>}
    {error&&<p role="alert" className="blocked-message">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <p>Regular prices apply to new assignment estimates. Admin approves Regular or types a Promo price in Payroll → Work review.</p>
  </div>;
}
