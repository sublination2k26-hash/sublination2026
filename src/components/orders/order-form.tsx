"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

type Product = { id: string; name: string; category: string; base_price: number };
type RosterRow = { name: string; number: string; size: string };
type OrderData = { customer: string; phone: string; productId: string; qty: number; due: string; deposit: number; garment: string; roster: RosterRow[]; notes: string; files: File[] };

export function OrderForm({ products, onSave, onCancel, allowArtwork }: { products: Product[]; onSave: (data: OrderData) => void; onCancel: () => void; allowArtwork: boolean }) {
  const [customer, setCustomer] = useState(""); const [phone, setPhone] = useState(""); const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [qty, setQty] = useState("1"); const [due, setDue] = useState(""); const [deposit, setDeposit] = useState("0"); const [garment, setGarment] = useState("Jersey");
  const [roster, setRoster] = useState<RosterRow[]>([{ name: "", number: "", size: "" }]); const [notes, setNotes] = useState(""); const [files, setFiles] = useState<File[]>([]);
  const product = products.find(p => p.id === productId); const total = (Number(qty) || 0) * (product?.base_price ?? 0);
  const update = (index: number, key: keyof RosterRow, value: string) => setRoster(rows => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  return <form className="form" onSubmit={e => { e.preventDefault(); if (product) onSave({ customer, phone, productId, qty: Number(qty), due, deposit: Number(deposit), garment, roster: roster.filter(r => r.name || r.number || r.size), notes, files }); }}>
    <div className="form-grid"><label>Customer name *<input required value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Customer or team" /></label><label>Phone / contact<input value={phone} onChange={e => setPhone(e.target.value)} placeholder="09xx xxx xxxx" /></label>
      <label className="full-field">Product *<select required value={productId} onChange={e => setProductId(e.target.value)}><option value="">Choose an active product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.category}</option>)}</select></label>
      <label>Garment type *<select value={garment} onChange={e => setGarment(e.target.value)}>{["T-shirt", "Jersey", "Short", "Polo"].map(x => <option key={x}>{x}</option>)}</select></label><label>Quantity *<input type="number" min="1" required value={qty} onChange={e => setQty(e.target.value)} /></label><label>Due date<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label><label>Down payment (₱)<input type="number" min="0" max={total} step="0.01" value={deposit} onChange={e => setDeposit(e.target.value)} /></label><div className="total-preview"><span>Calculated order total</span><b>₱{total.toLocaleString("en-PH", { maximumFractionDigits: 2 })}</b></div>
    </div>
    <div className="roster-editor"><div className="roster-title"><b>Names, numbers & sizes</b><span>Enter one player per row</span></div><div className="roster-scroll"><table><thead><tr><th>NAME</th><th>NO.</th><th>SIZE</th><th /></tr></thead><tbody>{roster.map((row, i) => <tr key={i}><td><input aria-label={`Player ${i + 1} name`} placeholder="Player name" value={row.name} onChange={e => update(i, "name", e.target.value)} /></td><td><input aria-label={`Player ${i + 1} number`} placeholder="#" value={row.number} onChange={e => update(i, "number", e.target.value)} /></td><td><input aria-label={`Player ${i + 1} size`} placeholder="Size" value={row.size} onChange={e => update(i, "size", e.target.value)} /></td><td><button type="button" className="roster-remove" aria-label="Remove row" onClick={() => setRoster(rows => rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div><button type="button" className="roster-add" onClick={() => setRoster(rows => [...rows, { name: "", number: "", size: "" }])}><Plus size={14} /> Add player row</button></div>
    {allowArtwork && <label className="file-upload">Client artwork / logos<input type="file" multiple accept="image/*,.pdf,.ai,.eps,.svg,.psd" onChange={e => setFiles(Array.from(e.target.files ?? []))} /><small>{files.length ? files.map(f => f.name).join(", ") : "Attach logos or reference files supplied by the client."}</small></label>}
    <label>Design / production notes<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Colors, fabric, special instructions" /></label>
    {products.length === 0 && <p className="empty-inline">No active products are available. Ask the admin to add a product first.</p>}
    <div className="form-actions"><button type="button" className="cancel-button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={!product}><Plus size={15} /> Create job order</button></div>
  </form>;
}
