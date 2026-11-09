"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readAllRows } from "@/lib/workspace-loading";

type Earning = { id: string; quantity: number; unit_rate: number; status: string; pay_eligible: boolean; payroll_run_id: string | null; work_date: string };
export function SewingEarnings({ userId, refreshToken }: { userId: string; refreshToken: unknown }) {
  const [records, setRecords] = useState<Earning[]>([]);
  const [rates, setRates] = useState<{ garment: string; unit_rate: number }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const db = createClient();
    void Promise.all([
      readAllRows((from, to) => db.from("employee_work_records").select("id,quantity,unit_rate,status,pay_eligible,payroll_run_id,work_date").eq("employee_id", userId).eq("role", "cutting_sewing").order("id").range(from, to)),
      readAllRows((from, to) => db.from("sewing_garment_rates").select("garment,unit_rate").eq("employee_id", userId).order("garment").range(from, to)),
    ]).then(([work, prices]) => { if (active) { setRecords(work as Earning[]); setRates(prices as typeof rates); setError(""); } }).catch(cause => { if (active) setError((cause as {message?: string}).message ?? "Could not load earnings."); });
    return () => { active = false; };
  }, [userId, refreshToken]);
  const total = (status: string) => records.filter(record => record.status === status && record.pay_eligible && !record.payroll_run_id).reduce((sum, record) => sum + Number(record.quantity) * Number(record.unit_rate), 0);
  return <section className="panel"><h2>Your sewing earnings</h2>{error ? <p role="alert">{error}</p> : <><p>Pending review: <b>PHP {total("pending_review").toFixed(2)}</b> · Approved, awaiting payroll: <b>PHP {total("approved").toFixed(2)}</b></p><p>Output earnings use the rate saved when you completed the pieces. Final take-home pay includes payroll deductions and adjustments. Rejected work, rework and example orders do not add to these totals.</p><ul>{rates.map(rate => <li key={rate.garment}>{rate.garment}: PHP {Number(rate.unit_rate).toFixed(2)} per piece</li>)}</ul></>}</section>;
}
