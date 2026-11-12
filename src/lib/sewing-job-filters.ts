export type SewingJobFilter = {search:string;orderId:string;sewerId:string;garment:string;status:string};
export type SewingJobSummary = {orderId:string;team:string;orderNumber:string;garment:string;sewers:{id:string;name:string}[];closed:boolean;completed:boolean;upstreamReady:boolean;unassigned:number;waitingHandoff:number;readyToSew:number};
export const sewingJobStatuses=[{id:"active",label:"Active jobs"},{id:"all",label:"All jobs"},{id:"unassigned",label:"Pieces available to assign"},{id:"waiting",label:"Waiting for materials"},{id:"handoff",label:"Needs handoff"},{id:"sewing",label:"Ready to sew"},{id:"completed",label:"Sewing completed"},{id:"closed",label:"Released / cancelled"}];
export function matchesSewingJob(job:SewingJobSummary,filter:SewingJobFilter){
  if(filter.orderId&&job.orderId!==filter.orderId)return false;
  if(filter.sewerId&&!job.sewers.some(s=>s.id===filter.sewerId))return false;
  if(filter.garment&&job.garment!==filter.garment)return false;
  const term=filter.search.trim().toLocaleLowerCase();
  if(term&&!`${job.team} ${job.orderNumber} ${job.garment} ${job.sewers.map(s=>s.name).join(" ")}`.toLocaleLowerCase().includes(term))return false;
  switch(filter.status){
    case "active":return !job.closed&&!job.completed;
    case "unassigned":return !job.closed&&!job.completed&&job.unassigned>0;
    case "waiting":return !job.closed&&!job.completed&&!job.upstreamReady;
    case "handoff":return !job.closed&&!job.completed&&job.upstreamReady&&job.waitingHandoff>0;
    case "sewing":return !job.closed&&!job.completed&&job.upstreamReady&&job.readyToSew>0;
    case "completed":return job.completed&&!job.closed;
    case "closed":return job.closed;
    default:return true;
  }
}
