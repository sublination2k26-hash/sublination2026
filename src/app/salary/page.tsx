import { redirect } from "next/navigation";
import { SectionPage } from "@/components/layout/section-page";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/attendance";
import "./salary.css";

export default async function SalaryPage() {
  const db = await createClient();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError) throw new Error("Could not verify your salary session.");
  if (!user) redirect("/login");
  const { data: profile, error: profileError } = await db.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (profileError) throw new Error("Could not verify employee access.");
  if (!profile?.active || profile.role === "admin") redirect("/dashboard");
  const [comp, lines, runs] = await Promise.all([
    db.from("employee_compensation").select("salary_basis,pay_frequency,base_rate,piece_rate").eq("employee_id", user.id).maybeSingle(),
    db.from("payroll_lines").select("id,payroll_run_id,base_pay,production_pay,overtime_pay,adjustments,adjustment_note,cash_advance,sss_deduction,sss_note,total_pay,attendance_hours,approved_units").eq("employee_id", user.id),
    db.from("payroll_runs").select("id,period_start,period_end,status").order("period_end", { ascending: false }),
  ]);
  const failure = [comp, lines, runs].find(result => result.error)?.error;
  const frequency: Record<string, string> = { daily: "daily", weekly: "weekly", semi_monthly: "twice monthly", monthly: "monthly" };
  return <SectionPage area="My Salary" title="My salary information" description="View your earnings, deductions, and payroll status.">
    <div className="salary-info">
      {failure ? <section role="alert"><h2>Salary information is unavailable</h2><p>{failure.message}</p><p>Ask your admin to apply the pending payroll and employee salary information migrations, then refresh.</p></section> : <>
        <section><h2>Current pay settings</h2>{comp.data ? <><dl className="salary-grid"><Value label="Salary method" value={profile.role !== "cutting_sewing" ? "Attendance based" : ({ fixed: "Fixed salary", piece: "Per approved output", combined: "Fixed salary + output" }[comp.data.salary_basis as string] ?? comp.data.salary_basis)}/><Value label="Pay frequency" value={frequency[comp.data.pay_frequency] ?? comp.data.pay_frequency}/><Value label="Configured base rate" value={money(comp.data.base_rate)}/>{profile.role === "cutting_sewing" && comp.data.salary_basis !== "fixed" && <Value label="Rate per approved unit" value={money(comp.data.piece_rate)}/>}</dl><p>Configured rates are not your final salary. Actual earnings depend on attendance or approved sewing output and deductions.</p></> : <p>Your admin has not configured your salary yet.</p>}</section>
        <section><h2>Payroll status and breakdown</h2><p>Draft amounts are provisional. Approved means reviewed by admin; Paid means the admin has marked the payroll paid.</p>
          {!lines.data?.length && <p>No payroll has been prepared for you yet.</p>}
          {runs.data?.map(run => {
            const line = lines.data?.find(item => item.payroll_run_id === run.id);
            if (!line) return null;
            const negativeAdjustment = Math.max(0, -Number(line.adjustments));
            const earnings = Number(line.base_pay) + Number(line.production_pay) + Number(line.overtime_pay) + Math.max(0, Number(line.adjustments));
            return <details key={line.id} open={run.id === runs.data?.[0]?.id}><summary><b>{run.period_start} – {run.period_end}</b><span className={`salary-status ${run.status}`}>{run.status === "draft" ? "Draft · provisional" : run.status === "approved" ? "Approved · awaiting payment" : "Paid"}</span><strong>Net pay {money(line.total_pay)}</strong></summary><dl className="salary-grid">
              <Value label="Base pay" value={money(line.base_pay)}/><Value label="Sewing output pay" value={money(line.production_pay)}/><Value label="Overtime pay" value={money(line.overtime_pay)}/><Value label="Additional earnings" value={money(Math.max(0, Number(line.adjustments)))}/><Value label="Gross earnings" value={money(earnings)}/><Value label="Cash advance recovery" value={money(line.cash_advance)}/><Value label="SSS deduction" value={money(line.sss_deduction)}/><Value label="Other adjustment deductions" value={money(negativeAdjustment)}/><Value label="Total deductions" value={money(Number(line.cash_advance) + Number(line.sss_deduction) + negativeAdjustment)}/><Value label="Net pay" value={money(line.total_pay)}/><Value label={profile.role === "cutting_sewing" ? "Approved units" : "Paid attendance hours"} value={String(profile.role === "cutting_sewing" ? line.approved_units : line.attendance_hours)}/>
            </dl>{line.adjustment_note && <p>Adjustment: {line.adjustment_note}</p>}{line.sss_note && <p>SSS: {line.sss_note}</p>}</details>;
          })}
        </section>

      </>}
    </div>
  </SectionPage>;
}
function Value({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
