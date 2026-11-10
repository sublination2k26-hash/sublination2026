"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { garmentCategories } from "@/lib/garment-options";
import { readAllRows } from "@/lib/workspace-loading";

type Rate = { garment: string; unit_rate: number };
export function SewingGarmentRates({ employeeId, employeeName, salaryBasis }: { employeeId: string; employeeName: string; salaryBasis?: string }) {
  const [rates, setRates] = useState<Rate[]>([]);
  const [garment, setGarment] = useState("Jersey");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    if (!employeeId) return;
    setLoading(true);
    const db = createClient();
    void readAllRows((from, to) => db.from("sewing_garment_rates").select("garment,unit_rate").eq("employee_id", employeeId).order("garment").range(from, to))
      .then(data => {
        if (!active) return;
        const saved = data as Rate[];
        setRates(saved);
        setAmount(String(saved.find(rate => rate.garment === "Jersey")?.unit_rate ?? ""));
      })
      .catch(cause => { if (active) setError((cause as { message?: string }).message ?? "Could not load garment rates."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employeeId]);
  function choose(value: string) {
    setGarment(value);
    setAmount(String(rates.find(rate => rate.garment === value)?.unit_rate ?? ""));
    setMessage("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const unitRate = Number(amount);
    if (!employeeId || saving.current || loading || !amount.trim() || !Number.isFinite(unitRate) || unitRate < 0 || unitRate > 9999999999.99) return;
    saving.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const { data, error: saveError } = await createClient().from("sewing_garment_rates").upsert({ employee_id: employeeId, garment, unit_rate: unitRate }).select("garment,unit_rate").single();
      if (saveError) throw saveError;
      setRates(current => [...current.filter(rate => rate.garment !== garment), data as Rate].sort((a,b) => a.garment.localeCompare(b.garment)));
      setMessage(`${employeeName}: ${garment} saved at PHP ${Number(data.unit_rate).toFixed(2)} per piece. New completions use this price; recorded earnings keep their saved rate.`);
    } catch (cause) { setError((cause as { message?: string }).message ?? "Could not save rate."); }
    finally { saving.current = false; setBusy(false); }
  }
  const savedRate = rates.find(rate => rate.garment === garment);
  return <div className="sewing-garment-pay-settings">
    <h3>Price per tahi by garment</h3>
    {!employeeId ? <p>Select a sewing employee above to set their Jersey, T-shirt and other garment prices.</p> : <>
      <p>Set or update <b>{employeeName}</b>'s price for each type of garment. Only admin can change prices; the sewer can view their own rates and earnings in Sewing.</p>
      {(!salaryBasis || salaryBasis === "fixed") && <p role="status">To earn per piece, choose Per approved output or Fixed + output above and save pay settings. Garment prices can be prepared here, but fixed salary does not add piece pay.</p>}
      <form className="payroll-form-grid" onSubmit={event => void save(event)}>
        <label>Garment / type of tahi<select disabled={busy || loading} value={garment} onChange={event => choose(event.target.value)}>{garmentCategories.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option}>{option}</option>)}</optgroup>)}</select></label>
        <label>Price per piece (PHP)<input required type="number" min="0" max="9999999999.99" step="0.01" value={amount} disabled={busy || loading} onChange={event => setAmount(event.target.value)}/></label>
        <button className="primary-button" disabled={busy || loading}>{busy ? "Saving..." : savedRate ? "Update garment price" : "Save garment price"}</button>
      </form>
      {loading ? <p role="status">Loading garment prices...</p> : <p>{savedRate ? `Saved ${garment} price: PHP ${Number(savedRate.unit_rate).toFixed(2)} per piece.` : `No separate ${garment} price saved. The employee's default output rate applies.`}</p>}
      {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
      {rates.length > 0 && <div className="payroll-table-wrap"><table><thead><tr><th>GARMENT</th><th>PRICE PER PIECE</th><th></th></tr></thead><tbody>{rates.map(rate => <tr key={rate.garment}><td>{rate.garment}</td><td>PHP {Number(rate.unit_rate).toFixed(2)}</td><td><button type="button" className="payroll-link" disabled={busy || loading} onClick={() => choose(rate.garment)}>Edit {rate.garment} price</button></td></tr>)}</tbody></table></div>}
      <p>Garments without a separate price use the default output rate. New prices apply to future completions.</p>
    </>}
  </div>;
}
