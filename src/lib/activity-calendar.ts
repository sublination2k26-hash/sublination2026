export type AuditState = Record<string, string | boolean | null>;
export type ActivityAudit = { id: string | number; occurred_at: string; actor_name: string; assignee_name?: string | null; entity_table: string; entity_id: string; action: string; old_state: AuditState | null; new_state: AuditState | null };
export type CalendarEvent = { id: string; at: string; date: string; color: "yellow" | "green" | "red"; title: string; detail: string; actor: string };
const stages = ["layout", "printing", "heat_press", "cutting", "sewing", "qc"];
const labels: Record<string,string> = {layout:"Artist",printing:"Printing",heat_press:"Heat Press",cutting:"Cutting",sewing:"Sewing",qc:"Quality Check",front_desk:"Front Desk"};
export function manilaDate(at: string) { return new Date(at).toLocaleDateString("en-CA", {timeZone:"Asia/Manila"}); }
export function buildCalendarEvents(rows: ActivityAudit[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const tasks = new Map<string, AuditState>();
  const active = () => [...tasks.entries()].filter(([,t])=>t.status!=="completed").sort((a,b)=>stages.indexOf(String(a[1].stage))-stages.indexOf(String(b[1].stage)))[0];
  const sorted = [...rows].sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at) || (BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0));
  for (const row of sorted) {
    const old = row.old_state ?? {}, next = row.new_state ?? {};
    const emit = (suffix:string,color:CalendarEvent["color"],title:string,detail="") => events.push({id:`${row.id}-${suffix}`,at:row.occurred_at,date:manilaDate(row.occurred_at),color,title,detail,actor:row.actor_name});
    if (row.entity_table === "production_tasks") {
      const before=active()?.[0];
      const label=labels[String(next.stage ?? old.stage)] ?? "Production";
      if(row.action === "DELETE") tasks.delete(row.entity_id); else tasks.set(row.entity_id,next);
      if(row.action !== "INSERT" && next.status !== old.status) {
        if(next.status === "completed") {
          if("completed_by" in next && next.completed_by === null) emit("routing","yellow",`${label}: marked complete by routing`,"Stage adjusted during a return; no employee completion recorded.");
          else emit("complete","green",`${label}: completed`);
        }
        else if(next.status === "returned_for_correction") emit("return","red",`${label}: returned for correction`);
        else if(next.status === "blocked") emit("blocked","red",`${label}: blocked`);
        else if(next.status === "in_progress") emit("started","yellow",`${label}: started`);
        else if(next.status === "pending") emit("reset","yellow",`${label}: waiting again`);
      }
      if(next.assigned_to && next.assigned_to !== old.assigned_to) emit("assigned","yellow",`${label}: assigned`,row.assignee_name ?? "Staff assigned");
      const after=active();
      if(after && before !== after[0] && !["returned_for_correction","blocked"].includes(String(after[1].status))) emit("received","yellow",`${labels[String(after[1].stage)] ?? "Production"}: received / ready`);
    } else if(row.entity_table === "defects") {
      const detail = [next.description ?? old.description, next.origin_stage ? `Found at ${labels[String(next.origin_stage)] ?? next.origin_stage}` : "", next.return_destination || next.return_stage ? `Return to ${labels[String(next.return_destination ?? next.return_stage)] ?? next.return_destination ?? next.return_stage}` : "", next.required_action, next.affected_component].filter(Boolean).join(" / ");
      if(row.action === "INSERT") emit("defect","red","Problem reported",detail);
      else if(next.correction_status === "completed" && old.correction_status !== "completed") emit("corrected","green","Defect correction completed",detail);
      else if(next.correction_status && next.correction_status !== old.correction_status) emit("defect-status","red","Defect status changed",detail);
      if(next.approval_to_resume === true && old.approval_to_resume !== true) emit("approved","green","Correction approved to resume",detail);
      if(row.action === "UPDATE" && (next.return_stage !== old.return_stage || next.return_destination !== old.return_destination)) emit("routed","red","Defect return destination changed",detail);
    } else if(row.entity_table === "orders") {
      if(row.action === "INSERT") emit("created","yellow","Order created");
      else if(next.status !== old.status) emit("status",next.status === "released" || next.status === "ready_for_release" ? "green" : next.status === "cancelled" ? "red" : "yellow",`Order: ${String(next.status ?? "updated").replaceAll("_"," ")}`);
      else emit("edited","yellow","Order details updated");
    } else if(row.entity_table === "qc_inspections") {
      emit("qc",next.status === "approved" ? "green" : next.status === "rejected" ? "red" : "yellow",`QC: ${String(next.status ?? "updated").replaceAll("_"," ")}`);
    } else {
      const names:Record<string,string>={order_items:"Order item",payments:"Payment",design_files:"Artwork file",job_orders:"Job order",player_details:"Player details"};
      emit("change",row.action === "DELETE" ? "red" : "yellow",`${names[row.entity_table] ?? "Record"}: ${row.action === "INSERT" ? "added" : row.action === "DELETE" ? "removed" : "updated"}`);
    }
  }
  return events;
}
