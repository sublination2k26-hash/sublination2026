"use client";

import { SearchableList } from "@/components/ui/searchable-list";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { garmentCategories } from "@/lib/garment-options";
import { facebookAccountOptions } from "@/lib/facebook-account-options";
import { manilaToday } from "@/lib/payment-tracking";
import { createClient } from "@/lib/supabase/client";

type Product = { id: string; name: string; category: string; base_price: number; production_type?: string; production_service?: string | null };
type RosterRow = { name: string; number: string; size: string };
export type AdditionalOrderItem = { productId: string; qty: number; garment: string; notes: string };
export type OrderData = { items: AdditionalOrderItem[]; requestId: string; customer: string; phone: string; facebook: string; productId: string; qty: number; due: string; paymentDue: string; deposit: number; depositDate: string; garment: string; roster: RosterRow[]; notes: string; files: File[]; sewingAssignments: { requestId: string; employeeId: string; quantity: number; notes: string }[] };

export function OrderForm({ products, onSave, onCancel, allowArtwork }: { products: Product[]; onSave: (data: OrderData) => void | Promise<void>; onCancel: () => void; allowArtwork: boolean }) {
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const requestId = useRef<string|null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [sewers, setSewers] = useState<{id: string; full_name: string}[]>([]);
  const [sewerError, setSewerError] = useState("");
  const [assignmentRows, setAssignmentRows] = useState<{requestId: string; employeeId: string; quantity: string; notes: string}[]>([]);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const {data, error} = await createClient().from("profiles").select("id,full_name").eq("role", "sewer").eq("active", true).order("full_name");
        if (!active) return;
        if (error) throw error;
        setSewers(data ?? []);
      } catch { if (active) setSewerError("Could not load sewers. You can assign them later in Sewing assignments."); }
    })();
    return () => { active = false; };
  }, []);
  const [depositDate, setDepositDate] = useState(manilaToday);
  const [facebook, setFacebook] = useState("");
  const [customer, setCustomer] = useState(""); const [phone, setPhone] = useState(""); const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [paymentDue,setPaymentDue]=useState(""); const [qty, setQty] = useState("1"); const [due, setDue] = useState(""); const [deposit, setDeposit] = useState("0"); const [garment, setGarment] = useState("Jersey");
  const [roster, setRoster] = useState<RosterRow[]>([{ name: "", number: "", size: "" }]); const [notes, setNotes] = useState(""); const [files, setFiles] = useState<File[]>([]);
  const [extraItems, setExtraItems] = useState<(AdditionalOrderItem & { key: string })[]>([]);
  const changeItem = (key: string, patch: Partial<AdditionalOrderItem>) => setExtraItems(items => items.map(item => item.key === key ? {...item, ...patch} : item));
  const product = products.find(p => p.id === productId); const total = (Number(qty) || 0) * (product?.base_price ?? 0) + extraItems.reduce((sum, item) => sum + item.qty * (products.find(p => p.id === item.productId)?.base_price ?? 0), 0);
  const hasSewing = product?.production_service ? ["full_garment", "subcon_sewing"].includes(product.production_service) : product?.production_type !== "print_only";
  const assignedQuantity = assignmentRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  const update = (index: number, key: keyof RosterRow, value: string) => setRoster(rows => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  return <form className="form" onSubmit={async e => {
    e.preventDefault();
    if (!product || savingRef.current) return;
    if (hasSewing && (assignedQuantity > Number(qty) || assignmentRows.some(row => !row.employeeId || !Number.isSafeInteger(Number(row.quantity)) || Number(row.quantity) < 1))) {
      setFormError("Choose a sewer and positive whole quantity for each assignment. The total must not exceed the order quantity."); return;
    }
    if (!Number.isSafeInteger(Number(qty)) || Number(qty) < 1 || extraItems.some(item => !products.some(p => p.id === item.productId) || !Number.isSafeInteger(item.qty) || item.qty < 1)) {
      setFormError("Choose a product and positive whole quantity for every item."); return;
    }
    setFormError("");
    savingRef.current = true;
    setSaving(true);
    setSubmitted(true);
    requestId.current ??= crypto.randomUUID();
    try {
      await onSave({ items: [{productId, qty: Number(qty), garment, notes}, ...extraItems.map(({productId, qty, garment, notes}) => ({productId, qty, garment, notes}))], requestId: requestId.current, customer, phone, facebook, productId, qty: Number(qty), due, paymentDue, deposit: Number(deposit), depositDate, garment, roster: roster.filter(r => r.name || r.number || r.size), notes, files, sewingAssignments: hasSewing ? assignmentRows.map(row => ({...row, quantity: Number(row.quantity)})) : [] });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }}>
    <fieldset disabled={submitted} style={{border:0,padding:0,margin:0,minWidth:0,display:"contents"}}>
    <div className="form-grid"><label>Customer name *<input required value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Customer or team" /></label><label>Contact number<input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="09xx xxx xxxx" /></label>
      <label className="full-field">Facebook account<select value={facebook} onChange={e => setFacebook(e.target.value)}><option value="">Choose account</option>{facebookAccountOptions.map(account => <option key={account} value={account}>{account}</option>)}</select></label>
      <label className="full-field">Product *<select required value={productId} onChange={e => setProductId(e.target.value)}><option value="">Choose an active product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.category}</option>)}</select></label>
      <label>Garment type *<select value={garment} onChange={e => setGarment(e.target.value)}>{garmentCategories.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option}>{option}</option>)}</optgroup>)}</select></label><label>Quantity *<input type="number" min="1" required value={qty} onChange={e => setQty(e.target.value)} /></label><label>Due date<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label><label>Payment due date<input type="date" value={paymentDue} onChange={e=>setPaymentDue(e.target.value)}/></label><label>Down payment (₱)<input type="number" min="0" max={total} step="0.01" value={deposit} onChange={e => setDeposit(e.target.value)} /></label><label>Down payment date<input type="date" required={Number(deposit)>0} disabled={Number(deposit)<=0} max={manilaToday()} value={depositDate} onChange={event=>setDepositDate(event.target.value)}/></label><div className="total-preview"><span>Calculated order total</span><b>₱{total.toLocaleString("en-PH", { maximumFractionDigits: 2 })}</b></div>
    </div>
    <section className="roster-editor" aria-label="Additional order items">
      <div className="roster-title"><b>Order items</b><span>The product above is item 1. All items share one order, total and down payment.</span></div>
      {extraItems.map((item, index) => <div className="form-grid" key={item.key}>
        <label className="full-field">Item {index + 2} product *<select required value={item.productId} onChange={event => changeItem(item.key, {productId: event.target.value})}><option value="">Choose an active product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.category}</option>)}</select></label>
        <label>Garment type<select value={item.garment} onChange={event => changeItem(item.key, {garment: event.target.value})}>{garmentCategories.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option}>{option}</option>)}</optgroup>)}</select></label>
        <label>Quantity *<input type="number" min={1} step={1} required value={item.qty || ""} onChange={event => changeItem(item.key, {qty: Number(event.target.value)})}/></label>
        <label className="full-field">Item notes / names / sizes<textarea value={item.notes} onChange={event => changeItem(item.key, {notes: event.target.value})}/></label>
        <p>Item subtotal: ₱{(item.qty * (products.find(p => p.id === item.productId)?.base_price ?? 0)).toLocaleString("en-PH", {maximumFractionDigits: 2})}</p>
        <button type="button" className="cancel-button" onClick={() => setExtraItems(items => items.filter(value => value.key !== item.key))}>Remove item {index + 2}</button>
      </div>)}
      <button type="button" className="roster-add" disabled={extraItems.length >= 99} onClick={() => setExtraItems(items => [...items, {key: crypto.randomUUID(), productId: "", qty: 1, garment: "T-shirt", notes: ""}])}><Plus size={14}/> Add item</button>
    </section>
    {hasSewing && <section className="roster-editor" aria-label="Sewer assignments"><div className="roster-title"><b>Automatic shared sewing queue</b></div><p>This order will appear to all sewers automatically. Each sewer chooses how many pieces to assign to themselves. No sewer selection is required here.</p><details><summary>Optional Front Desk reservation for item 1</summary><p>{assignedQuantity} / {qty} pieces reserved. Any remaining pieces stay available for sewers to claim.</p>
      {sewerError && <p role="alert">{sewerError}</p>}
      {assignmentRows.map((row, index) => <div className="form-grid" key={row.requestId}>
        <label>Sewer {index + 1}<select required value={row.employeeId} onChange={event => setAssignmentRows(rows => rows.map((value, i) => i === index ? {...value, employeeId: event.target.value} : value))}><option value="">Choose sewer</option>{sewers.map(sewer => <option key={sewer.id} value={sewer.id}>{sewer.full_name}</option>)}</select></label>
        <label>Pieces<input type="number" required min={1} max={Number(qty)} step={1} value={row.quantity} onChange={event => setAssignmentRows(rows => rows.map((value, i) => i === index ? {...value, quantity: event.target.value} : value))}/></label>
        <label>Bundle / sizes / instructions<input maxLength={1000} value={row.notes} onChange={event => setAssignmentRows(rows => rows.map((value, i) => i === index ? {...value, notes: event.target.value} : value))}/></label>
        <button type="button" className="cancel-button" onClick={() => setAssignmentRows(rows => rows.filter((_, i) => i !== index))}>Remove assignment {index + 1}</button>
      </div>)}
      <button type="button" className="roster-add" disabled={sewers.length === 0} onClick={() => setAssignmentRows(rows => [...rows, {requestId: crypto.randomUUID(), employeeId: "", quantity: String(Math.max(1, Number(qty) - assignedQuantity)), notes: ""}])}><Plus size={14}/> Add sewer assignment</button>
      {!sewerError && sewers.length === 0 && <p>No active sewers loaded. Add or activate a Cutting / Sewing employee first, or assign later.</p>}
      </details>
    </section>}
    <div className="roster-editor"><div className="roster-title"><b>Item 1 names, numbers & sizes</b><span>Enter one player per row</span></div><SearchableList className="roster-scroll"><table><thead><tr><th>NAME</th><th>NO.</th><th>SIZE</th><th /></tr></thead><tbody>{roster.map((row, i) => <tr key={i}><td><input aria-label={`Player ${i + 1} name`} placeholder="Player name" value={row.name} onChange={e => update(i, "name", e.target.value)} /></td><td><input aria-label={`Player ${i + 1} number`} placeholder="#" value={row.number} onChange={e => update(i, "number", e.target.value)} /></td><td><input aria-label={`Player ${i + 1} size`} placeholder="Size" value={row.size} onChange={e => update(i, "size", e.target.value)} /></td><td><button type="button" className="roster-remove" aria-label="Remove row" onClick={() => setRoster(rows => rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td></tr>)}</tbody></table></SearchableList><button type="button" className="roster-add" onClick={() => setRoster(rows => [...rows, { name: "", number: "", size: "" }])}><Plus size={14} /> Add player row</button></div>
    {allowArtwork && <label className="file-upload">Client artwork / logos<input type="file" multiple accept="image/*,.pdf,.ai,.eps,.svg,.psd" onChange={e => setFiles(Array.from(e.target.files ?? []))} /><small>{files.length ? files.map(f => f.name).join(", ") : "Attach logos or reference files supplied by the client."}</small></label>}
    <label>Design / production notes<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Colors, fabric, special instructions" /></label>
    {products.length === 0 && <p className="empty-inline">No active products are available. Ask the admin to add a product first.</p>}
    </fieldset>
    {formError && <p role="alert" className="blocked-message">{formError}</p>}
    {submitted&&!saving&&<p className="empty-inline">Retry to finish saving this order without creating another copy.</p>}
    <div className="form-actions"><button type="button" className="cancel-button" onClick={onCancel} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={!product || saving}><Plus size={15} /> {saving ? "Saving…" : submitted ? "Retry saving order" : "Create job order"}</button></div>
  </form>;
}
