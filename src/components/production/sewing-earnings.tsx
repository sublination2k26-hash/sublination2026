"use client";

import { SearchableList } from "@/components/ui/searchable-list";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readAllRows } from "@/lib/workspace-loading";

type Earning = { id: string; quantity: number; unit_rate: number; status: string; pay_eligible: boolean; payroll_run_id: string | null; work_date: string };
export function SewingEarnings({ userId, refreshToken }: { userId: string; refreshToken: unknown }) {
  const [records, setRecords] = useState<Earning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const db = createClient();
    void readAllRows((from, to) => db.from("employee_work_records").select("id,quantity,unit_rate,status,pay_eligible,payroll_run_id,work_date").eq("employee_id", userId).eq("role", "cutting_sewing").order("id").range(from, to)).then(work => { if (active) { setRecords(work as Earning[]); setError(""); } }).catch(cause => { if (active) setError((cause as {message?: string}).message ?? "Could not load earnings."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, refreshToken]);
  const total = (status: string) => records.filter(record => record.status === status && record.pay_eligible && !record.payroll_run_id).reduce((sum, record) => sum + Number(record.quantity) * Number(record.unit_rate), 0);
  return <section className="panel"><h2>Your sewing earnings</h2>{error ? <p role="alert">{error}</p> : loading ? <p role="status">Loading your earnings...</p> : <><p>Pending review: <b>PHP {total("pending_review").toFixed(2)}</b> · Approved, awaiting payroll: <b>PHP {total("approved").toFixed(2)}</b></p><p>Output earnings use the rate saved when you completed the pieces. Final take-home pay includes payroll deductions and adjustments. Rejected work, rework and example orders do not add to these totals.</p>
    <SearchableList className="table-wrap"><table><thead><tr><th>OUTPUT DATE</th><th>PIECES</th><th>SAVED RATE / PIECE</th><th>OUTPUT AMOUNT</th><th>STATUS</th></tr></thead><tbody>{records.map(record => <tr key={record.id}><td>{record.work_date}</td><td>{record.quantity}</td><td>PHP {Number(record.unit_rate).toFixed(2)}</td><td>PHP {(Number(record.quantity) * Number(record.unit_rate)).toFixed(2)}</td><td>{!record.pay_eligible ? "Excluded from output pay" : record.payroll_run_id ? "Included in payroll" : record.status.replaceAll("_", " ")}</td></tr>)}</tbody></table></SearchableList>
    {records.length === 0 && <p>No sewing output recorded yet.</p>}
    </>}</section>;
}
