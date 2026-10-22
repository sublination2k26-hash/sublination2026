"use client";

import { useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { stockStatus, type InventoryItem } from "@/lib/inventory";
import "./inventory-manager.css";

const columns = "id,name,category,unit,quantity,low_stock_level,updated_at";
const categories = ["Ink", "Paper", "Fabric", "Cleaning", "Sewing", "Tools", "Other"];
const message = (error: unknown) => typeof error === "object" && error !== null && "message" in error ? String(error.message) : "Could not save material.";

export function InventoryManager({ initialItems }: { initialItems: InventoryItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formKey, setFormKey] = useState(0);
  const reset = () => { setEditing(null); setFormKey(key => key + 1); };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const form = new FormData(event.currentTarget);
    const values = {
      name: String(form.get("name") ?? "").trim(),
      category: String(form.get("category") ?? "").trim(),
      unit: String(form.get("unit") ?? "").trim(),
      quantity: Number(form.get("quantity")),
      low_stock_level: Number(form.get("low_stock_level")),
    };
    if (!values.name || !values.category || !values.unit || ![values.quantity, values.low_stock_level].every(n => Number.isFinite(n) && n >= 0 && n <= 999999999.999)) {
      setError("Enter a name, category, unit, and valid nonnegative stock quantities."); return;
    }
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const db = createClient();
      const result = editing
        ? await db.from("inventory_materials").update(values).eq("id", editing.id).eq("updated_at", editing.updated_at).select(columns).maybeSingle()
        : await db.from("inventory_materials").insert(values).select(columns).single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("This material changed in another session. Reload the page before editing again.");
      const saved = result.data as InventoryItem;
      setItems(current => (editing ? current.map(item => item.id === saved.id ? saved : item) : [...current, saved])
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)));
      setNotice(`${saved.name} saved.`); reset();
    } catch (cause) { setError(message(cause)); }
    finally { saving.current = false; setBusy(false); }
  }

  const shown = items.filter(item => (!category || item.category === category)
    && (!lowOnly || stockStatus(item) !== "In stock")
    && `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="employee-manager">
    <div className="employee-manager-heading"><div><h2>Material stock</h2><p>{items.length} materials · {items.filter(item => stockStatus(item) !== "In stock").length} need restocking. Enter your actual starting quantities below.</p></div></div>
    {error && <p className="employee-error" role="alert">{error}</p>}
    {notice && <p className="employee-notice" role="status">{notice}</p>}
    <form key={`${editing?.id ?? "new"}-${formKey}`} className="employee-form" onSubmit={save}>
      <div className="employee-form-title">{editing ? `Edit ${editing.name}` : "Add material"}</div>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="employee-form-fields">
          <label>Material name *<input name="name" required maxLength={120} defaultValue={editing?.name} placeholder="e.g. Heat-resistant tape"/></label>
          <label>Category *<input name="category" list="inventory-categories" required maxLength={60} defaultValue={editing?.category ?? "Other"}/><datalist id="inventory-categories">{categories.map(value => <option key={value} value={value}/>)}</datalist></label>
          <label>Unit *<input name="unit" required maxLength={30} defaultValue={editing?.unit ?? "pcs"} placeholder="ml, meters, rolls, pcs"/></label>
          <label>Stock on hand *<input name="quantity" type="number" required min="0" max="999999999.999" step="0.001" defaultValue={editing?.quantity ?? 0}/></label>
          <label>Low-stock level *<input name="low_stock_level" type="number" required min="0" max="999999999.999" step="0.001" defaultValue={editing?.low_stock_level ?? 0}/></label>
        </div>
        <div className="form-actions"><button className="primary-button" type="submit">{busy ? "Saving…" : editing ? "Save changes" : "Add material"}</button>{editing && <button type="button" className="secondary-button" onClick={reset}>Cancel</button>}</div>
      </fieldset>
    </form>
    <div className="employee-form-fields">
      <label>Search materials<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or category"/></label>
      <label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{Array.from(new Set(items.map(item => item.category))).sort().map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Stock filter</span><select value={lowOnly ? "low" : "all"} onChange={event => setLowOnly(event.target.value === "low")}><option value="all">All stock</option><option value="low">Needs restocking</option></select></label>
    </div>
    <div className="employee-table-wrap inventory-table-scroll" role="region" aria-label="Materials inventory, scroll to see more materials" tabIndex={0}><table><thead><tr><th>MATERIAL</th><th>CATEGORY</th><th>ON HAND</th><th>LOW-STOCK LEVEL</th><th>STATUS</th><th>ACTION</th></tr></thead>
      <tbody>{shown.map(item => <tr key={item.id}><td><b>{item.name}</b></td><td>{item.category}</td><td>{Number(item.quantity).toLocaleString("en-PH")} {item.unit}</td><td>{Number(item.low_stock_level).toLocaleString("en-PH")} {item.unit}</td><td>{stockStatus(item)}</td><td><button className="secondary-button" type="button" disabled={busy} aria-label={`Edit ${item.name}`} onClick={() => { setEditing(item); setError(""); setNotice(""); }}>Edit stock</button></td></tr>)}</tbody>
    </table>{shown.length === 0 && <p className="empty-inline">No materials match these filters. Add a material or change your search.</p>}</div>
  </section>;
}
