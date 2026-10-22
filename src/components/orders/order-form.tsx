"use client";

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { garmentCategories } from "@/lib/garment-options";

type Product = { id: string; name: string; category: string; base_price: number };
type RosterRow = { name: string; number: string; size: string };
type OrderData = { requestId: string; customer: string; phone: string; facebook: string; productId: string; qty: number; due: string; paymentDue: string; deposit: number; garment: string; roster: RosterRow[]; notes: string; files: File[] };

export function OrderForm({ products, onSave, onCancel, allowArtwork }: { products: Product[]; onSave: (data: OrderData) => void | Promise<void>; onCancel: () => void; allowArtwork: boolean }) {
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const requestId = useRef<string|null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [facebook, setFacebook] = useState("");
  const [customer, setCustomer] = useState(""); const [phone, setPhone] = useState(""); const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [paymentDue,setPaymentDue]=useState(""); const [qty, setQty] = useState("1"); const [due, setDue] = useState(""); const [deposit, setDeposit] = useState("0"); const [garment, setGarment] = useState("Jersey");
  const [roster, setRoster] = useState<RosterRow[]>([{ name: "", number: "", size: "" }]); const [notes, setNotes] = useState(""); const [files, setFiles] = useState<File[]>([]);
  const product = products.find(p => p.id === productId); const total = (Number(qty) || 0) * (product?.base_price ?? 0);
  const update = (index: number, key: keyof RosterRow, value: string) => setRoster(rows => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  return <form className="form" onSubmit={async e => {
    e.preventDefault();
    if (!product || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSubmitted(true);
    requestId.current ??= crypto.randomUUID();
    try {
      await onSave({ requestId: requestId.current, customer, phone, facebook, productId, qty: Number(qty), due, paymentDue, deposit: Number(deposit), garment, roster: roster.filter(r => r.name || r.number || r.size), notes, files });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }}>
    <fieldset disabled={submitted} style={{border:0,padding:0,margin:0,minWidth:0,display:"contents"}}>
    <div className="form-grid"><label>Customer name *<input required value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Customer or team" /></label><label>Contact number<input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="09xx xxx xxxx" /></label>
      <label className="full-field">Facebook account<input value={facebook} onChange={e => setFacebook(e.target.value)} placeholder="Facebook name, username, or profile link" /></label>
      <label className="full-field">Product *<select required value={productId} onChange={e => setProductId(e.target.value)}><option value="">Choose an active product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.category}</option>)}</select></label>
      <label>Garment type *<select value={garment} onChange={e => setGarment(e.target.value)}>{garmentCategories.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option}>{option}</option>)}</optgroup>)}</select></label><label>Quantity *<input type="number" min="1" required value={qty} onChange={e => setQty(e.target.value)} /></label><label>Due date<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label><label>Payment due date<input type="date" value={paymentDue} onChange={e=>setPaymentDue(e.target.value)}/></label><label>Down payment (₱)<input type="number" min="0" max={total} step="0.01" value={deposit} onChange={e => setDeposit(e.target.value)} /></label><div className="total-preview"><span>Calculated order total</span><b>₱{total.toLocaleString("en-PH", { maximumFractionDigits: 2 })}</b></div>
    </div>
    <div className="roster-editor"><div className="roster-title"><b>Names, numbers & sizes</b><span>Enter one player per row</span></div><div className="roster-scroll"><table><thead><tr><th>NAME</th><th>NO.</th><th>SIZE</th><th /></tr></thead><tbody>{roster.map((row, i) => <tr key={i}><td><input aria-label={`Player ${i + 1} name`} placeholder="Player name" value={row.name} onChange={e => update(i, "name", e.target.value)} /></td><td><input aria-label={`Player ${i + 1} number`} placeholder="#" value={row.number} onChange={e => update(i, "number", e.target.value)} /></td><td><input aria-label={`Player ${i + 1} size`} placeholder="Size" value={row.size} onChange={e => update(i, "size", e.target.value)} /></td><td><button type="button" className="roster-remove" aria-label="Remove row" onClick={() => setRoster(rows => rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div><button type="button" className="roster-add" onClick={() => setRoster(rows => [...rows, { name: "", number: "", size: "" }])}><Plus size={14} /> Add player row</button></div>
    {allowArtwork && <label className="file-upload">Client artwork / logos<input type="file" multiple accept="image/*,.pdf,.ai,.eps,.svg,.psd" onChange={e => setFiles(Array.from(e.target.files ?? []))} /><small>{files.length ? files.map(f => f.name).join(", ") : "Attach logos or reference files supplied by the client."}</small></label>}
    <label>Design / production notes<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Colors, fabric, special instructions" /></label>
    {products.length === 0 && <p className="empty-inline">No active products are available. Ask the admin to add a product first.</p>}
    </fieldset>
    {submitted&&!saving&&<p className="empty-inline">Retry to finish saving this order without creating another copy.</p>}
    <div className="form-actions"><button type="button" className="cancel-button" onClick={onCancel} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={!product || saving}><Plus size={15} /> {saving ? "Saving…" : submitted ? "Retry saving order" : "Create job order"}</button></div>
  </form>;
}
