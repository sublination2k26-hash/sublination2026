"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Setting = { employee_id: string; amount: number; note: string };
export function RecurringSssSettings({ employees }: { employees: { id: string; full_name: string; active: boolean; role: string }[] }) {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [employee, setEmployee] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await createClient().from("employee_sss_settings").select("employee_id,amount,note");
      if (!active) return;
      if (error) { setError(error.message); return; }
      setSettings(data ?? []); setReady(true);
    }
    void load().catch(() => { if (active) setError("Could not load employee SSS settings."); });
    return () => { active = false; };
  }, []);
  const selected = settings.find(setting => setting.employee_id === employee);
  const available = employees.filter(item => item.active && item.role !== "admin");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employee || saving.current) return;
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) { setError("Enter a valid non-negative SSS amount."); return; }
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const { data, error } = await createClient().from("employee_sss_settings").upsert({ employee_id: employee, amount, note: String(form.get("note") ?? "").trim() }).select("employee_id,amount,note").single();
      if (error) throw error;
      setSettings(current => [...current.filter(setting => setting.employee_id !== employee), data]);
      setNotice("SSS setting saved. This amount will be deducted automatically in each new payroll cutoff.");
    } catch (cause) { setError((cause as { message?: string })?.message ?? "Could not save SSS settings."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <section className="payroll-section" id="recurring-sss-settings">
    <h2>Automatic SSS per employee</h2>
    <p>Set the employee share to deduct in every new payroll cutoff, including sewers. Enter the amount for one cutoff, not the full monthly amount if you split it across cutoffs. Employer contributions are excluded.</p>
    <p>Existing drafts, approved payrolls and paid payrolls keep their saved amounts. Use the period adjustment below to correct an existing draft. Employees without a saved setting have a zero SSS deduction.</p>
    {error && <p className="payroll-alert is-error" role="alert">{error}</p>}{notice && <p className="payroll-alert" role="status">{notice}</p>}
    <label>Employee<select disabled={!ready || busy} value={employee} onChange={event => { setEmployee(event.target.value); setNotice(""); }}><option value="">Choose employee</option>{available.map(item => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
    {employee && ready && <form key={`${employee}-${selected?.amount}-${selected?.note}`} onSubmit={save}><fieldset disabled={busy} style={{ border: 0, padding: 0 }}><div className="payroll-form-grid">
      <label>SSS deduction per payroll cutoff (PHP)<input name="amount" required type="number" min="0" max="9999999999.99" step="0.01" defaultValue={selected?.amount ?? 0}/></label>
      <label>Reference / note<input name="note" maxLength={1000} defaultValue={selected?.note ?? ""}/></label>
      <button type="submit" className="primary-button">{busy ? "Saving…" : "Save automatic SSS"}</button>
    </div></fieldset></form>}
    {ready && <div className="payroll-table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>SSS PER CUTOFF</th></tr></thead><tbody>{available.map(item => {
      const setting = settings.find(value => value.employee_id === item.id);
      return <tr key={item.id}><td>{item.full_name}</td><td>{setting ? Number(setting.amount).toLocaleString("en-PH", { style: "currency", currency: "PHP" }) : "Not set — zero deduction"}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}
