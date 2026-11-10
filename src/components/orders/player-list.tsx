"use client";

import { TeamMemberAdditions } from "@/components/orders/team-member-additions";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Player = { name: string; number: string; size: string };
type Item = { id: string; product_name: string; quantity: number; unit_price: number; customization: { garment?: string; roster?: Player[]; names?: string } };

export function PlayerList({ orderId, editable, namesOnly = false, canAddMembers=false, orderStatus, refreshToken, onAdded, onSaved }: { canAddMembers?: boolean; orderStatus?: string; refreshToken?: object; onAdded?: (orderNumber:string)=>Promise<void>; orderId: string; editable: boolean; namesOnly?: boolean; onSaved: () => Promise<void> }) {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState("");
  const [rows, setRows] = useState<Player[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await createClient().from("order_items").select("id,product_name,quantity,unit_price,customization").eq("order_id", orderId).order("created_at").order("id");
        if (error) throw error;
        if (active) { setItems(data as Item[]); setSelected(data[0]?.id ?? ""); setLoaded(true); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Could not load player lists."); }
    })();
    return () => { active = false; };
  }, [orderId,refreshToken]);
  const item = items.find(value => value.id === selected);
  function edit() {
    setRows(item?.customization?.roster?.map(row => ({ name: row.name ?? "", number: row.number ?? "", size: row.size ?? "" })) ?? []);
    setEditing(true); setError(""); setMessage("");
  }
  async function save() {
    if (!item || busy) return;
    setBusy(true); setError("");
    const roster = rows.map(row => ({ name: row.name.trim(), number: namesOnly ? row.number : row.number.trim(), size: namesOnly ? row.size : row.size.trim() })).filter(row => namesOnly || row.name || row.number || row.size);
    try {
      const { error } = await createClient().rpc("update_order_item_roster", { p_item_id: item.id, p_roster: roster });
      if (error) throw error;
      setItems(values => values.map(value => value.id === item.id ? { ...value, customization: { ...value.customization, roster, names: roster.map(row => [row.name, row.number ? `#${row.number}` : "", row.size].filter(Boolean).join(" ")).join("\n") } } : value));
      setEditing(false); setMessage("Player list saved.");
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save player list."); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="panel-heading"><h2>Order items &amp; personalization</h2>{editable && loaded && item && !editing && <button className="filter-button" onClick={edit}>Edit player list</button>}</div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!loaded && !error && <p>Loading player lists…</p>}
    {loaded && <label>Order item<select value={selected} disabled={editing} onChange={event => { setSelected(event.target.value); setMessage(""); }}>{items.map((value, index) => <option key={value.id} value={value.id}>{index + 1}. {value.product_name} ({value.quantity} pcs)</option>)}</select></label>}
    {editing ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <p>Front desk can correct member names. Amount, quantity, player number and size stay locked.</p>
      <fieldset disabled={busy} className="roster-editor"><legend>Player list</legend><div className="table-wrap"><table><thead><tr><th>Name</th><th>Number</th><th>Size</th><th/></tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{(["name", "number", "size"] as const).map(field => <td key={field}><input aria-label={`Player ${index + 1} ${field}`} value={row[field]} disabled={namesOnly && field !== "name"} maxLength={field === "name" ? 120 : 30} onChange={event => setRows(values => values.map((value, i) => i === index ? { ...value, [field]: event.target.value } : value))}/></td>)}<td><button type="button" disabled={namesOnly} onClick={() => setRows(values => values.filter((_, i) => i !== index))} aria-label={`Remove player ${index + 1}`}>Remove</button></td></tr>)}</tbody></table></div>
      <button type="button" disabled={namesOnly || rows.length >= (item?.quantity ?? 0)} onClick={() => setRows(values => [...values, { name: "", number: "", size: "" }])}>Add player</button>
      <button className="primary-button" type="submit">{busy ? "Saving…" : "Save player list"}</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></fieldset>
    </form> : item && <div style={{ whiteSpace: "pre-wrap" }}>{item.customization?.names || "No player details encoded yet."}</div>}
    {canAddMembers&&item&&!editing&&onAdded&&orderStatus!=="cancelled"&&<TeamMemberAdditions key={item.id} itemId={item.id} sourceName={item.product_name} sourceGarment={item.customization?.garment ?? ""} sourcePrice={Number(item.unit_price)} availableSlots={["released","ready_for_release"].includes(orderStatus??"")?0:Math.max(0,item.quantity-(item.customization?.roster?.length??0))} onSaved={onAdded}/>}
  </section>;
}
