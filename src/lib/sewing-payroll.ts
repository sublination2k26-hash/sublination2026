export type SewingEncoding = {assignment_pay?:boolean;id:string;assignment_id:string;task_id:string|null;employee_id:string;quantity:number;pricing_mode:string;unit_rate:number;work_date:string;status:string;notes:string;review_reason:string};
export type SewingWork = {id:string;employee_id:string;task_id:string|null;quantity:number;unit_rate:number;work_date:string;status:string;pay_eligible:boolean;payroll_run_id:string|null};
export type SewingAssignment = {pay_on_assignment?:boolean;id:string;task_id:string|null;employee_id:string;quantity:number};
export type SewingCompletion = {assignment_id:string;kind:string;quantity:number};
export function validSewingPeriod(start:string,end:string){
  const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  return validDate(start)&&validDate(end)&&start<=end;
}
export function sewingReconciliation(target:number,assignments:SewingAssignment[],events:SewingCompletion[],encodings:SewingEncoding[],employeeId?:string){
  if(employeeId){
    assignments=assignments.filter(a=>a.employee_id===employeeId);
    target=assignments.reduce((sum,a)=>sum+Number(a.quantity),0);
  }
  const pending=encodings.filter(e=>e.status==='pending');
  const rows=assignments.map(a=>{
    const done=events.filter(e=>e.assignment_id===a.id&&e.kind==='completion').reduce((n,e)=>n+Number(e.quantity),0);
    const encoded=done+pending.filter(e=>e.assignment_id===a.id).reduce((n,e)=>n+Number(e.quantity),0);
    return {employeeId:a.employee_id,assigned:Number(a.quantity),encoded,done};
  });
  const employees=Array.from(new Set(rows.map(r=>r.employeeId))).map(employeeId=>{
    const own=rows.filter(r=>r.employeeId===employeeId);
    return {employeeId,assigned:own.reduce((n,r)=>n+r.assigned,0),encoded:own.reduce((n,r)=>n+r.encoded,0),over:own.some(r=>r.encoded>r.assigned)};
  });
  const encoded=rows.reduce((n,r)=>n+r.encoded,0);
  const assigned=rows.reduce((n,r)=>n+r.assigned,0);
  const over=encoded>target||assigned>target||rows.some(r=>r.encoded>r.assigned);
  return {target,assigned,encoded,remaining:Math.max(0,target-encoded),excess:Math.max(0,encoded-target),status:over?'over':encoded===target?'balanced':'short',employees} as const;
}
export function sewingPeriodTotals(work:SewingWork[],encodings:SewingEncoding[],start:string,end:string){
  const valid=validSewingPeriod(start,end);
  const actual=work.filter(w=>valid&&w.work_date>=start&&w.work_date<=end&&w.pay_eligible&&['approved','pending_review'].includes(w.status));
  const pending=encodings.filter(e=>valid&&e.work_date>=start&&e.work_date<=end&&e.status==='pending'&&!e.assignment_pay);
  const amount=(rows:{quantity:number;unit_rate:number}[])=>Math.round(rows.reduce((n,r)=>n+Number(r.quantity)*Number(r.unit_rate),0)*100)/100;
  return {pieces:actual.reduce((n,w)=>n+Number(w.quantity),0)+pending.reduce((n,e)=>n+Number(e.quantity),0),approved:amount(actual.filter(w=>w.status==='approved')),pending:amount(pending)+amount(actual.filter(w=>w.status==='pending_review')),pendingCount:pending.length};
}
