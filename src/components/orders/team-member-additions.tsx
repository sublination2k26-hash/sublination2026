"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Member = {name: string; number: string; size: string};
export function TeamMemberAdditions({itemId, availableSlots, onSaved}: {
  itemId: string; availableSlots: number; onSaved: (orderNumber: string) => Promise<void>;
}) {
  const [open,setOpen] = useState(false);
  const [extra,setExtra] = useState(availableSlots <= 0);
  const [members,setMembers] = useState<Member[]>([{name:"",number:"",size:""}]);
  const [due,setDue] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const request = useRef<{signature: string; id: string} | null>(null);
  const saving = useRef(false);
  if (!open) return <button type="button" className="filter-button" onClick={()=>setOpen(true)}>Add team members</button>;
  return <form className="form" onSubmit={async event=>{
    event.preventDefault();if(saving.current)return;
    const rows=members.map(row=>({name:row.name.trim(),number:row.number.trim(),size:row.size.trim()}));
    const payload={p_item_id:itemId,p_members:rows,p_extra_pieces:extra,p_due_date:extra?due:null};
    const signature=JSON.stringify(payload);
    if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
    saving.current=true;setBusy(true);setError("");
    try{
      const db=createClient();
      const {data:orderId,error}=await db.rpc("add_team_members",{...payload,p_request_id:request.current.id});
      if(error)throw error;
      const {data:order,error:readError}=await db.from("orders").select("order_number").eq("id",orderId).single();
      if(readError)throw readError;
      await onSaved(order.order_number);
      setOpen(false);setMembers([{name:"",number:"",size:""}]);request.current=null;
    }catch(cause){setError(cause instanceof Error?cause.message:(cause as {message?:string})?.message??"Could not add members.");}
    finally{saving.current=false;setBusy(false);}
  }}>
    <h3>Add team members</h3>
    <fieldset disabled={busy} className="roster-editor"><legend>Team addition</legend>
      <label>Addition type<select value={extra?"extra":"existing"} onChange={event=>setExtra(event.target.value==="extra")}>
        {availableSlots>0&&<option value="existing">Fill existing ordered pieces ({availableSlots} available)</option>}
        <option value="extra">Extra pieces — new add-on order for this team</option>
      </select></label>
      <p>{extra?"Extra pieces get a linked order with their own production and balance. The system uses the saved item price; previous orders and payments stay intact.":"Add player details within the existing ordered quantity."}</p>
      {extra&&<label>Add-on due date<input type="date" required value={due} onChange={event=>setDue(event.target.value)}/></label>}
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Number</th><th>Size</th><th/></tr></thead><tbody>
        {members.map((row,index)=><tr key={index}>{(["name","number","size"] as const).map(field=><td key={field}><input required={field==="name"} aria-label={`New member ${index+1} ${field}`} maxLength={field==="name"?120:30} value={row[field]} onChange={event=>setMembers(values=>values.map((value,i)=>i===index?{...value,[field]:event.target.value}:value))}/></td>)}<td><button type="button" disabled={members.length===1} onClick={()=>setMembers(values=>values.filter((_,i)=>i!==index))} aria-label={`Remove new member ${index+1}`}>Remove</button></td></tr>)}
      </tbody></table></div>
      <button type="button" disabled={members.length>=(extra?500:availableSlots)} onClick={()=>setMembers(values=>[...values,{name:"",number:"",size:""}])}>Add another member</button>
      <div className="form-actions"><button type="button" className="cancel-button" onClick={()=>setOpen(false)}>Cancel</button><button className="primary-button" disabled={!extra&&members.length>availableSlots}>{busy?"Saving…":extra?"Create team add-on":"Save additional members"}</button></div>
    </fieldset>
    {error&&<p role="alert" className="blocked-message">{error}</p>}
  </form>;
}
