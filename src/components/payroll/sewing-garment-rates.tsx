"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { garmentCategories } from "@/lib/garment-options";

export function SewingGarmentRates({ employeeId }: { employeeId: string }) {
  const [rates, setRates] = useState<{ garment: string; unit_rate: number }[]>([]);
  const [garment, setGarment] = useState("Jersey");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setRates([]); setMessage("");
    if (employeeId) void createClient().from("sewing_garment_rates").select("garment,unit_rate").eq("employee_id", employeeId).order("garment").then(({ data, error }) => {
      if (active) { setRates(data ?? []); if (error) setMessage(error.message); }
    });
    return () => { active = false; };
  }, [employeeId]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const unitRate = Number(amount);
    if (!employeeId || busy || !amount.trim() || !Number.isFinite(unitRate) || unitRate < 0 || unitRate > 9999999999.99) return;
    setBusy(true); setMessage("");
    try {
      const { error } = await createClient().from("sewing_garment_rates").upsert({ employee_id: employeeId, garment, unit_rate: unitRate });
      if (error) throw error;
      setRates(current => [...current.filter(rate => rate.garment !== garment), { garment, unit_rate: unitRate }]);
      setMessage("Rate saved. New completions use this rate; previous earnings stay unchanged.");
    } catch (error) { setMessage((error as { message?: string }).message ?? "Could not save rate."); }
    finally { setBusy(false); }
  }
  return <section className="payroll-section"><h2>Sewing rates by garment</h2><p>Select a sewer above, then set the price per completed piece for Jersey, T-shirt and other garments. The default output rate applies to garments without a saved rate. Fixed salary employees do not earn piece pay.</p>
    <form className="payroll-form-grid" onSubmit={event => void save(event)}><label>Garment<select disabled={busy} value={garment} onChange={event => { const value = event.target.value; setGarment(value); setAmount(String(rates.find(rate => rate.garment === value)?.unit_rate ?? "")); }}>{garmentCategories.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option}>{option}</option>)}</optgroup>)}</select></label><label>Rate per piece (PHP)<input required type="number" min="0" max="9999999999.99" step="0.01" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)}/></label><button className="primary-button" disabled={busy || !employeeId}>Save garment rate</button></form>
    {message && <p role="status">{message}</p>}<ul>{rates.map(rate => <li key={rate.garment}><button type="button" className="payroll-link" disabled={busy} onClick={() => { setGarment(rate.garment); setAmount(String(rate.unit_rate)); }}>{rate.garment}: PHP {Number(rate.unit_rate).toFixed(2)} / piece</button></li>)}</ul>
  </section>;
}
