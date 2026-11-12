"use client";

import "./sewing-garment-rates.css";
import { SearchableList } from "@/components/ui/searchable-list";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { garmentCategories } from "@/lib/garment-options";
import { readAllRows } from "@/lib/workspace-loading";

type Rate = { selected_mode: "regular" | "promo"; garment: string; unit_rate: number; promo_rate: number | null };
export function SewingGarmentRates({ employeeId, employeeName, salaryBasis, initialGarment="Jersey", quantity }: { employeeId: string; employeeName: string; salaryBasis?: string; initialGarment?: string; quantity?: number }) {
  const [rates, setRates] = useState<Rate[]>([]);
  const [garment, setGarment] = useState(initialGarment);
  const [selectedMode,setSelectedMode]=useState<"regular"|"promo">("regular");
  const [promo,setPromo]=useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  useEffect(() => {
    let active = true;

    setLoading(true);
    const db = createClient();
    void readAllRows((from, to) => db.from("sewing_shared_garment_rates").select("garment,unit_rate,promo_rate,selected_mode").order("garment").range(from, to))
      .then(data => {
        if (!active) return;
        const saved = data as Rate[];
        setRates(saved);
        setSelectedMode(saved.find(rate=>rate.garment===initialGarment)?.selected_mode??"regular");
        setAmount(String(saved.find(rate => rate.garment === initialGarment)?.unit_rate ?? ""));
        setPromo(String(saved.find(rate=>rate.garment===initialGarment)?.promo_rate??""));
      })
      .catch(cause => { if (active) setError((cause as { message?: string }).message ?? "Could not load garment rates."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [initialGarment]);
  function choose(value: string) {
    setGarment(value);
    setSelectedMode(rates.find(rate=>rate.garment===value)?.selected_mode??"regular");
    setAmount(String(rates.find(rate => rate.garment === value)?.unit_rate ?? ""));
    setPromo(String(rates.find(rate=>rate.garment===value)?.promo_rate??""));
    setMessage("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const unitRate = Number(amount);
    if (saving.current || loading || !amount.trim() || !Number.isFinite(unitRate) || unitRate < 0 || unitRate > 9999999999.99) return;
    if(promo.trim()&&(!Number.isFinite(Number(promo))||Number(promo)<0)){setError("Enter a valid promo rate.");return;}
    if(selectedMode==="promo"&&!promo.trim()){setError("Enter a Promo price before selecting Promo.");return;}
    saving.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const { data, error: saveError } = await createClient().from("sewing_shared_garment_rates").upsert({ garment, selected_mode:selectedMode, unit_rate: unitRate, promo_rate:promo.trim()?Number(promo):null }).select("garment,unit_rate,promo_rate,selected_mode").single();
      if (saveError) throw saveError;
      setRates(current => [...current.filter(rate => rate.garment !== garment), data as Rate].sort((a,b) => a.garment.localeCompare(b.garment)));
      setMessage(`${garment} (all sewers) saved. Selected ${data.selected_mode==="promo"?"Promo":"Regular"}: PHP ${Number(data.selected_mode==="promo"?data.promo_rate:data.unit_rate).toFixed(2)} per piece. Admin applies the configured price in Payroll Work review; approved earnings keep their saved rate.`);
    } catch (cause) { setError((cause as { message?: string }).message ?? "Could not save rate."); }
    finally { saving.current = false; setBusy(false); }
  }
  const savedRate = rates.find(rate => rate.garment === garment);
  const selectedAmount=selectedMode==="promo"?promo:amount;
  return <div className="sewing-garment-pay-settings">
    <h3>Price per tahi by garment</h3>
    <>
      <p>Regular and Promo prices are shared by all sewers for each garment. Pay = assigned pieces multiplied by the selected garment price.</p>
      {quantity!==undefined&&<dl className="garment-price-totals" aria-live="polite"><div><dt>Assigned pieces</dt><dd>{quantity}</dd></div><div><dt>Regular total</dt><dd>{amount.trim()&&Number.isFinite(Number(amount))?`PHP ${(quantity*Number(amount)).toFixed(2)}`:"Set regular price"}</dd></div><div><dt>Promo total</dt><dd>{promo.trim()&&Number.isFinite(Number(promo))?`PHP ${(quantity*Number(promo)).toFixed(2)}`:"Set promo price"}</dd></div><div className="garment-selected-total"><dt>Selected total ({selectedMode==="promo"?"Promo":"Regular"})</dt><dd>{selectedAmount.trim()&&Number.isFinite(Number(selectedAmount))?`PHP ${(quantity*Number(selectedAmount)).toFixed(2)}`:"Set selected price"}</dd></div></dl>}
      <form className="payroll-form-grid" onSubmit={event => void save(event)}>
        <label>Garment / type of tahi<select disabled={busy || loading || quantity!==undefined} value={garment} onChange={event => choose(event.target.value)}>{!garmentCategories.some(group=>group.options.some(option=>option===initialGarment))&&<option>{initialGarment}</option>}{garmentCategories.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option}>{option}</option>)}</optgroup>)}</select></label>
        <label>Regular price per piece (PHP)<input required type="number" inputMode="decimal" min="0" max="9999999999.99" step="0.01" value={amount} disabled={busy || loading} onChange={event => setAmount(event.target.value)}/></label>
        <label>Promo price per piece (PHP)<input type="number" inputMode="decimal" min="0" max="9999999999.99" step="0.01" value={promo} disabled={busy||loading} onChange={e=>setPromo(e.target.value)} placeholder="Not configured"/></label>
        <label>Price to use<select value={selectedMode} disabled={busy||loading} onChange={event=>setSelectedMode(event.target.value as "regular"|"promo")}><option value="regular">Regular price</option><option value="promo">Promo price</option></select></label>
        <button className="primary-button" disabled={busy || loading}>{busy ? "Saving..." : savedRate ? "Update garment price" : "Save garment price"}</button>
      </form>
      {loading ? <p role="status">Loading garment prices...</p> : <p>{savedRate ? `Saved choice: ${savedRate.selected_mode==="promo"?"Promo":"Regular"} for ${garment}, PHP ${Number(savedRate.selected_mode==="promo"?savedRate.promo_rate:savedRate.unit_rate).toFixed(2)} per piece.` : `No separate ${garment} price saved. Set this garment price before assigning pieces.`}</p>}
      {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
      {rates.length > 0 && <SearchableList className="payroll-table-wrap"><table><thead><tr><th>GARMENT</th><th>REGULAR PRICE</th><th>PROMO PRICE</th><th>SELECTED</th><th></th></tr></thead><tbody>{rates.filter(rate=>quantity===undefined||rate.garment===initialGarment).map(rate => <tr key={rate.garment}><td data-label="Garment">{rate.garment}</td><td data-label="Regular / piece">PHP {Number(rate.unit_rate).toFixed(2)}</td><td data-label="Promo / piece">{rate.promo_rate===null?"Not configured":`PHP ${Number(rate.promo_rate).toFixed(2)}`}</td><td data-label="Selected">{rate.selected_mode==="promo"?"Promo":"Regular"}</td><td data-label="Action"><button type="button" className="payroll-link" disabled={busy || loading} onClick={() => choose(rate.garment)}>Edit {rate.garment} price</button></td></tr>)}</tbody></table></SearchableList>}
      <p>Set a shared price for each garment before assigning pieces. The saved choice applies to new assignments. Admin confirms Regular or Promo in Payroll Work review. Approved payroll keeps its saved prices.</p>
    </>
  </div>;
}
