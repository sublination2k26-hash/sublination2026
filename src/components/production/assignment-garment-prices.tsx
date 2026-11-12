"use client";
import { SewingGarmentRates } from "@/components/payroll/sewing-garment-rates";
export function AssignmentGarmentPrices({garment,quantities={},onSaved}:{garment:string;quantities?:Record<string,number>;onSaved:()=>Promise<void>}) {
  return <div className="sewing-job-prices"><SewingGarmentRates employeeId="" employeeName="All sewers" initialGarment={garment} quantity={Object.values(quantities).reduce((sum,value)=>sum+value,0)}/><button type="button" className="filter-button" onClick={()=>void onSaved()}>Refresh job prices</button></div>;
}
