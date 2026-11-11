"use client";

import { SearchableList } from "@/components/ui/searchable-list";
import { useRef, useState } from "react";
import "./team-member-additions.css";
import { garmentCategories } from "@/lib/garment-options";
import { createClient } from "@/lib/supabase/client";

type Member = {name: string; number: string; size: string};
export function TeamMemberAdditions({itemId, sourceName, sourceGarment, sourcePrice, availableSlots, onSaved}: {
  itemId: string; sourceName: string; sourceGarment: string; sourcePrice: number; availableSlots: number; onSaved: (orderNumber: string) => Promise<void>;
}) {
  const [garment,setGarment] = useState(sourceGarment || "");
  const [unitPrice,setUnitPrice] = useState(String(sourcePrice));
  const [open,setOpen] = useState(false);
  const [extra,setExtra] = useState(true);
  const [members,setMembers] = useState<Member[]>([{name:"",number:"",size:""}]);
  const [quantity,setQuantity] = useState("1");
  const [personalize,setPersonalize] = useState(false);
  const [due,setDue] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const request = useRef<{signature: string; id: string} | null>(null);
  const saving = useRef(false);
  if (!open) return <button type="button" className="filter-button" onClick={()=>setOpen(true)}>Add production items</button>;
  return <form className="form team-addon-form" onInvalidCapture={event=>{ const field=event.target as HTMLInputElement; setError(field.type === "date" ? "Choose the add-on due date before saving." : "Complete the required fields with valid values before saving."); }} onSubmit={async event=>{
    event.preventDefault();if(saving.current)return;
    const rows=(extra&&!personalize?[]:members).map(row=>({name:row.name.trim(),number:row.number.trim(),size:row.size.trim()})).filter(row=>row.name||row.number||row.size);
    const payload=extra?{p_item_id:itemId,p_quantity:Number(quantity),p_roster:rows,p_due_date:due,p_garment:garment,p_unit_price:Number(unitPrice)}:{p_item_id:itemId,p_members:rows,p_extra_pieces:false,p_due_date:null};
    const signature=JSON.stringify(payload);
    if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
    saving.current=true;setBusy(true);setError("");
    try{
      const db=createClient();
      const {data:orderId,error}=await db.rpc(extra?"add_production_garment":"add_team_members",{...payload,p_request_id:request.current.id});
      if(error)throw error;
      const {data:order,error:readError}=await db.from("orders").select("order_number").eq("id",orderId).single();
      if(readError)throw readError;
      await onSaved(order.order_number);
      setOpen(false);setQuantity("1");setPersonalize(false);setMembers([{name:"",number:"",size:""}]);request.current=null;
    }catch(cause){setError(cause instanceof Error?cause.message:(cause as {message?:string})?.message??"Could not add production items.");}
    finally{saving.current=false;setBusy(false);}
  }}>
    <h3>Add production items</h3>
    {error&&<p role="alert" className="blocked-message">{error}</p>}
    <fieldset disabled={busy} className="roster-editor"><legend>Client add-on</legend>
      <div className="team-addon-fields"><label className="team-addon-full">Addition type<select value={extra?"extra":"existing"} onChange={event=>setExtra(event.target.value==="extra")}>
        {availableSlots>0&&<option value="existing">Fill existing ordered pieces ({availableSlots} available)</option>}
        <option value="extra">Extra pieces — new add-on order for this team</option>
      </select></label>
      </div><p>{extra?"Choose the garment requested by the client and confirm its price. The new order follows the same production service as the original item.":"Add player details within the existing ordered quantity."}</p>
      <p>Original item: <b>{sourceName}</b>{sourceGarment && ` / ${sourceGarment}`}</p>
      <div className="team-addon-fields">{extra&&<><label>Garment type / Klase ng add-on<select required value={garment} onChange={event=>{setGarment(event.target.value);setUnitPrice(event.target.value===sourceGarment?String(sourcePrice):"");}}><option value="">Choose T-shirt, jersey, polo, etc.</option>{garmentCategories.map(group=><optgroup key={group.label} label={group.label}>{group.options.map(option=><option key={option} value={option}>{option}</option>)}</optgroup>)}</select></label>
      <label>Price per piece (PHP)<input type="number" min="0" max="9999999999.99" step="0.01" required value={unitPrice} onChange={event=>setUnitPrice(event.target.value)}/></label>
      <p className="team-addon-total">Add-on total: <b>PHP {(Number(quantity)*Number(unitPrice)).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}</b></p></>}
      {extra&&<label>Additional quantity<input type="number" min="1" max="10000" step="1" required value={quantity} onChange={event=>setQuantity(event.target.value)}/></label>}
      {extra&&<label>Add-on due date<input type="date" aria-label="Add-on due date" required value={due} onChange={event=>setDue(event.target.value)}/></label>}
      </div>{extra&&<label className="team-addon-checkbox"><input type="checkbox" checked={personalize} onChange={event=>setPersonalize(event.target.checked)}/><span>Include names, numbers or sizes (optional)</span></label>}
      {(!extra||personalize)&&<><SearchableList className="table-wrap"><table><thead><tr><th>Name</th><th>Number</th><th>Size</th><th/></tr></thead><tbody>
        {members.map((row,index)=><tr key={index}>{(["name","number","size"] as const).map(field=><td key={field} data-label={field}><input required={!extra&&field==="name"} aria-label={`New member ${index+1} ${field}`} maxLength={field==="name"?120:30} value={row[field]} onChange={event=>setMembers(values=>values.map((value,i)=>i===index?{...value,[field]:event.target.value}:value))}/></td>)}<td><button type="button" disabled={members.length===1} onClick={()=>setMembers(values=>values.filter((_,i)=>i!==index))} aria-label={`Remove new member ${index+1}`}>Remove</button></td></tr>)}
      </tbody></table></SearchableList>
      <button type="button" disabled={members.length>=(extra?Number(quantity):availableSlots)} onClick={()=>setMembers(values=>[...values,{name:"",number:"",size:""}])}>Add another row</button></>}
      <div className="form-actions"><button type="button" className="cancel-button" onClick={()=>setOpen(false)}>Cancel</button><button className="primary-button" disabled={extra?personalize&&members.length>Number(quantity):members.length>availableSlots}>{busy?"Saving…":extra?"Add to production":"Save additional members"}</button></div>
    </fieldset>
  </form>;
}
