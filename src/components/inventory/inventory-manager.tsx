"use client";

import { SearchableList } from "@/components/ui/searchable-list";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useAppDialogs } from "@/components/ui/app-dialog-provider";
import { createClient } from "@/lib/supabase/client";
import { stockStatus, type InventoryItem, type InventoryMovement } from "@/lib/inventory";
import "./inventory-manager.css";

const columns = "id,name,category,unit,quantity,low_stock_level,updated_at,archived_at";
const movementColumns = "id,material_id,movement_type,quantity,movement_date,created_at,source,order_number";
const categories = ["Ink", "Paper", "Fabric", "Cleaning", "Sewing", "Tools", "Other"];
const message = (error: unknown) => typeof error === "object" && error !== null && "message" in error ? String(error.message) : "Could not save material.";
const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

type MovementType = "stock_in" | "deduction";
type InventoryDialogState =
  | { kind: "add" }
  | { kind: "details" | "edit"; materialId: string }
  | { kind: "movement"; materialId: string; movementType: MovementType; fromEdit: boolean };

function MaterialStock({ item, busy, onAdjust }: { item: InventoryItem; busy: boolean; onAdjust: () => void }) {
  const status = item.archived_at ? "Archived" : stockStatus(item);
  return <div className="inventory-stock-summary">
    <div>
      <span className="inventory-stock-label">Available stock</span>
      <strong className="inventory-stock-quantity">{Number(item.quantity).toLocaleString("en-PH")} {item.unit}</strong>
      <span className="inventory-stock-status" data-status={status}>{status}</span>
    </div>
    {!item.archived_at && <button type="button" className="secondary-button" disabled={busy} onClick={onAdjust}>Adjust Stock</button>}
  </div>;
}

export function InventoryManager({ initialItems, initialMovements }: { initialItems: InventoryItem[]; initialMovements: InventoryMovement[] }) {
  const { confirm } = useAppDialogs();
  const historyDialog = useRef<HTMLDialogElement>(null);
  const materialDialog = useRef<HTMLDialogElement>(null);
  const historyDialogId = useId();
  const historyTitleId = useId();
  const materialDialogId = useId();
  const materialTitleId = useId();
  const [items, setItems] = useState(initialItems);
  const [movements, setMovements] = useState(initialMovements);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [materialDialogState, setMaterialDialogState] = useState<InventoryDialogState | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [movementKey, setMovementKey] = useState(0);
  const [stockDate, setStockDate] = useState(localDate);
  const materialDialogOpen = materialDialogState !== null;
  const materialId = materialDialogState && "materialId" in materialDialogState ? materialDialogState.materialId : null;
  const selectedMaterial = materialId ? items.find(item => item.id === materialId) ?? null : null;
  const editing = materialDialogState?.kind === "edit" || (materialDialogState?.kind === "movement" && materialDialogState.fromEdit)
    ? selectedMaterial : null;
  const movementTarget = materialDialogState?.kind === "movement" ? selectedMaterial : null;
  const movementType = materialDialogState?.kind === "movement" ? materialDialogState.movementType : "stock_in";

  useEffect(() => {
    const dialog = historyDialog.current;
    if (!historyOpen || !dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [historyOpen]);

  useEffect(() => {
    const dialog = materialDialog.current;
    if (!materialDialogOpen || !dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [materialDialogOpen]);

  function openAddMaterial() {
    setError(""); setNotice(""); setStockDate(localDate()); setFormKey(key => key + 1);
    setMaterialDialogState({ kind: "add" });
  }

  function openMaterialDetails(item: InventoryItem) {
    setError(""); setNotice(""); setMaterialDialogState({ kind: "details", materialId: item.id });
  }

  function openMovement(item: InventoryItem) {
    setError(""); setNotice(""); setMovementKey(key => key + 1);
    setMaterialDialogState({ kind: "movement", materialId: item.id, movementType: "stock_in", fromEdit: materialDialogState?.kind === "edit" });
  }

  function closeMaterialDialog() {
    if (busy) return;
    setMaterialDialogState(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || materialDialogState?.kind === "movement") return;
    if (!editing && materialDialogState?.kind !== "add") return;
    const form = new FormData(event.currentTarget);
    const values = {
      name: String(form.get("name") ?? "").trim(),
      category: String(form.get("category") ?? "").trim(),
      unit: String(form.get("unit") ?? "").trim(),
      low_stock_level: Number(form.get("low_stock_level")),
    };
    const quantity = editing ? 0 : Number(form.get("quantity"));
    const date = String(form.get("stock_date") ?? "");
    if (!values.name || !values.category || !values.unit
      || ![values.low_stock_level, quantity].every(n => Number.isFinite(n) && n >= 0 && n <= 999999999.999)
      || !editing && (!date || date > localDate())) {
      setError("Enter a name, category, unit, valid nonnegative stock quantities, and a valid stock-in date."); return;
    }
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const db = createClient();
      let saved: InventoryItem;
      if (editing) {
        const result = await db.from("inventory_materials").update(values).eq("id", editing.id).eq("updated_at", editing.updated_at).select(columns).maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("This material changed in another session. Reload the page before editing again.");
        saved = result.data as InventoryItem;
      } else {
        const created = await db.rpc("create_inventory_material", {
          p_name: values.name,
          p_category: values.category,
          p_unit: values.unit,
          p_quantity: quantity,
          p_low_stock_level: values.low_stock_level,
          p_stock_date: date || null,
        });
        if (created.error) throw created.error;
        if (!created.data) throw new Error("Could not create material.");
        const result = await db.from("inventory_materials").select(columns).eq("id", created.data).single();
        if (result.error) throw new Error(`Material was created, but its latest stock could not be loaded: ${result.error.message}`);
        saved = result.data as InventoryItem;
      }
      setItems(current => (editing ? current.map(item => item.id === saved.id ? saved : item) : [...current, saved])
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)));
      if (!editing && quantity > 0) {
        setNotice(`${saved.name} added with opening stock.`); setMaterialDialogState(null);
        const result = await db.from("inventory_movements").select(movementColumns).order("movement_date", { ascending: false }).order("created_at", { ascending: false });
        if (result.error) throw new Error(`Material and opening stock were saved, but movement history could not be refreshed: ${result.error.message}`);
        setMovements(result.data as InventoryMovement[]);
        return;
      }
      setNotice(`${saved.name} ${editing ? "updated" : "added"}.`);
      setMaterialDialogState(editing ? { kind: "details", materialId: saved.id } : null);
    } catch (cause) { setError(message(cause)); }
    finally { saving.current = false; setBusy(false); }
  }

  async function saveMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || !movementTarget || materialDialogState?.kind !== "movement") return;
    const form = new FormData(event.currentTarget);
    const quantity = Number(form.get("quantity"));
    const date = String(form.get("movement_date") ?? "");
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999999999.999 || Math.round(quantity * 1000) / 1000 !== quantity
      || !date || date > localDate()) {
      setError("Enter a valid positive quantity and a movement date no later than today."); return;
    }
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const db = createClient();
      const result = await db.rpc("record_inventory_movement", {
        p_material_id: movementTarget.id,
        p_movement_type: movementType,
        p_quantity: quantity,
        p_movement_date: date,
      });
      if (result.error) throw result.error;
      setMaterialDialogState(materialDialogState.fromEdit ? { kind: "edit", materialId: movementTarget.id } : null);
      setMovementKey(key => key + 1);
      const [inventory, history] = await Promise.all([
        db.from("inventory_materials").select(columns).order("category").order("name"),
        db.from("inventory_movements").select(movementColumns).order("movement_date", { ascending: false }).order("created_at", { ascending: false }),
      ]);
      if (inventory.error || history.error) {
        throw new Error(`Movement was saved, but inventory could not be refreshed: ${inventory.error?.message ?? history.error?.message}`);
      }
      setItems(inventory.data as InventoryItem[]);
      setMovements(history.data as InventoryMovement[]);
      setNotice(`${movementType === "stock_in" ? "Stock-in" : "Deduction"} recorded for ${movementTarget.name}.`);
    } catch (cause) { setError(message(cause)); }
    finally { saving.current = false; setBusy(false); }
  }

  async function removeMaterial(item: InventoryItem) {
    if (saving.current) return;
    if (!item.archived_at && !await confirm(`Remove ${item.name} from active inventory? Materials with movement history or product recipes will be archived to preserve records.`, {
      title: "Remove material",
      confirmLabel: "Remove",
      variant: "danger",
    })) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const db = createClient();
      const result = item.archived_at
        ? await db.rpc("restore_inventory_material", { p_material_id: item.id })
        : await db.rpc("remove_inventory_material", { p_material_id: item.id });
      if (result.error) throw result.error;
      setMaterialDialogState(null);
      const [inventory, history] = await Promise.all([
        db.from("inventory_materials").select(columns).order("category").order("name"),
        db.from("inventory_movements").select(movementColumns).order("movement_date", { ascending: false }).order("created_at", { ascending: false }),
      ]);
      if (inventory.error || history.error) {
        throw new Error(`Material was ${item.archived_at ? "restored" : "removed"}, but inventory could not be refreshed: ${inventory.error?.message ?? history.error?.message}`);
      }
      setItems(inventory.data as InventoryItem[]);
      setMovements(history.data as InventoryMovement[]);
      setNotice(item.archived_at
        ? `${item.name} restored to active inventory.`
        : result.data === "deleted"
          ? `${item.name} permanently deleted.`
          : `${item.name} archived. Its movement history and product recipes are preserved.`);
    } catch (cause) { setError(message(cause)); }
    finally { saving.current = false; setBusy(false); }
  }

  const activeItems = items.filter(item => !item.archived_at);
  const shown = items.filter(item => (showArchived || !item.archived_at)
    && (!category || item.category === category)
    && (!lowOnly || (!item.archived_at && stockStatus(item) !== "In stock"))
    && `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase()));
  const lastMovementByMaterial = new Map<string, InventoryMovement>();
  for (const movement of movements) {
    const current = lastMovementByMaterial.get(movement.material_id);
    if (!current || movement.movement_date > current.movement_date
      || movement.movement_date === current.movement_date && movement.created_at > current.created_at) {
      lastMovementByMaterial.set(movement.material_id, movement);
    }
  }
  const itemName = (id: string) => items.find(item => item.id === id)?.name ?? "Deleted material";
  const itemUnit = (id: string) => items.find(item => item.id === id)?.unit ?? "";

  return <section className="employee-manager">
    <div className="employee-manager-heading"><div><h2>Material stock</h2><p>{activeItems.length} materials · {activeItems.filter(item => stockStatus(item) !== "In stock").length} need restocking. Stock-ins and deductions are saved with their dates.</p></div><div className="inventory-heading-actions"><button type="button" className="primary-button" aria-haspopup="dialog" aria-controls={materialDialogId} onClick={openAddMaterial}>Add material</button><button type="button" className="secondary-button inventory-history-trigger" aria-haspopup="dialog" aria-expanded={historyOpen} aria-controls={historyDialogId} onClick={() => setHistoryOpen(true)}>Stock movement history ({movements.length})</button></div></div>
    {error && !materialDialogOpen && <p className="employee-error" role="alert">{error}</p>}
    {notice && !materialDialogOpen && <p className="employee-notice" role="status">{notice}</p>}
    <div className="employee-form-fields">
      <label>Search materials<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or category"/></label>
      <label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{Array.from(new Set(activeItems.map(item => item.category))).sort().map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Stock filter</span><select value={lowOnly ? "low" : "all"} onChange={event => setLowOnly(event.target.value === "low")}><option value="all">All stock</option><option value="low">Needs restocking</option></select></label>
      <label className="inventory-archived-filter"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)}/> Show archived materials</label>
    </div>
    <SearchableList className="employee-table-wrap inventory-table-scroll inventory-material-list" role="region" aria-label="Materials inventory" tabIndex={0}><table><thead><tr><th>MATERIAL</th><th>CATEGORY</th><th>AVAILABLE STOCK</th><th>DATE</th><th>LOW-STOCK LEVEL</th><th>STATUS</th><th>ACTION</th></tr></thead>
      <tbody>{shown.map(item => {
        const lastMovement = lastMovementByMaterial.get(item.id);
        return <tr key={item.id}><td data-label="Material"><b>{item.name}</b></td><td data-label="Category">{item.category}</td><td data-label="Available stock">{Number(item.quantity).toLocaleString("en-PH")} {item.unit}</td><td data-label="Date">{lastMovement ? <span className="inventory-last-movement"><time dateTime={lastMovement.movement_date}>{lastMovement.movement_date}</time><small>{lastMovement.movement_type === "stock_in" ? "Stock-in" : "Deduction"}</small></span> : "No recorded movement"}</td><td data-label="Low-stock level">{Number(item.low_stock_level).toLocaleString("en-PH")} {item.unit}</td><td data-label="Status">{item.archived_at ? "Archived" : stockStatus(item)}</td><td data-label="Action"><button className="secondary-button" type="button" disabled={busy} aria-haspopup="dialog" aria-controls={materialDialogId} onClick={() => openMaterialDetails(item)}>View details</button></td></tr>;
      })}</tbody>
    </table>{shown.length === 0 && <p className="empty-inline">No materials match these filters. Add a material or change your search.</p>}</SearchableList>
    <dialog ref={materialDialog} id={materialDialogId} className="inventory-material-dialog" aria-labelledby={materialTitleId} onCancel={event => {
      if (busy) event.preventDefault();
      else setMaterialDialogState(null);
    }} onClose={() => setMaterialDialogState(null)}>
      <div className="inventory-material-heading"><h2 id={materialTitleId}>
        {materialDialogState?.kind === "add" ? "Add material"
          : materialDialogState?.kind === "edit" ? `Edit ${selectedMaterial?.name ?? "material"}`
            : materialDialogState?.kind === "movement" ? `Adjust stock — ${selectedMaterial?.name ?? "material"}`
              : `${selectedMaterial?.name ?? "Material"} details`}
      </h2><button type="button" className="secondary-button" onClick={closeMaterialDialog} disabled={busy}>Close</button></div>
      {error && materialDialogState?.kind === "details" && <p className="employee-error" role="alert">{error}</p>}
      {notice && <p className="employee-notice" role="status">{notice}</p>}
      {materialDialogState?.kind === "details" && selectedMaterial && <>
        <div className="inventory-detail-stock"><MaterialStock item={selectedMaterial} busy={busy} onAdjust={() => openMovement(selectedMaterial)}/></div>
        <dl className="inventory-material-details">
          <div><dt>Category</dt><dd>{selectedMaterial.category}</dd></div>
          <div><dt>Low-stock level</dt><dd>{Number(selectedMaterial.low_stock_level).toLocaleString("en-PH")} {selectedMaterial.unit}</dd></div>
          <div><dt>Unit</dt><dd>{selectedMaterial.unit}</dd></div>
        </dl>
        <div className="inventory-dialog-actions">
          {selectedMaterial.archived_at
            ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void removeMaterial(selectedMaterial)}>Restore material</button>
            : <>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => { setError(""); setNotice(""); setFormKey(key => key + 1); setMaterialDialogState({ kind: "edit", materialId: selectedMaterial.id }); }}>Edit details</button>
              <button type="button" className="secondary-button inventory-delete-button" disabled={busy} onClick={() => void removeMaterial(selectedMaterial)}>Delete</button>
            </>}
        </div>
      </>}
      {(editing || materialDialogState?.kind === "add") && <form key={`${editing?.id ?? "new"}-${formKey}`} className="employee-form inventory-dialog-form" hidden={Boolean(movementTarget)} onSubmit={save}>
        <div className="employee-form-title">{editing ? `Edit ${editing.name}` : "Add material"}</div>
        {editing && <MaterialStock item={editing} busy={busy} onAdjust={() => openMovement(editing)}/>}
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="employee-form-fields">
            <label>Material name *<input name="name" required maxLength={120} defaultValue={editing?.name} placeholder="e.g. Heat-resistant tape"/></label>
            <label>Category *<select name="category" required defaultValue={editing?.category ?? ""}><option value="" disabled>Category</option>{editing?.category && !categories.includes(editing.category) && <option value={editing.category}>{editing.category}</option>}{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Unit *<input name="unit" required maxLength={30} defaultValue={editing?.unit ?? "pcs"} placeholder="ml, meters, rolls, pcs"/></label>
            {!editing && <label>Starting stock *<input name="quantity" type="number" required min="0" max="999999999.999" step="0.001" defaultValue="0"/></label>}
            <label>Low-stock level *<input name="low_stock_level" type="number" required min="0" max="999999999.999" step="0.001" defaultValue={editing?.low_stock_level ?? 0}/></label>
            {!editing && <label>Stock-in date *<input name="stock_date" type="date" required max={localDate()} value={stockDate} onChange={event => setStockDate(event.target.value)}/></label>}
          </div>
          <div className="form-actions"><button className="primary-button" type="submit">{busy ? "Saving…" : editing ? "Save changes" : "Add material"}</button><button type="button" className="secondary-button" onClick={() => {
            setError(""); setNotice("");
            if (editing) setMaterialDialogState({ kind: "details", materialId: editing.id });
            else closeMaterialDialog();
          }} disabled={busy}>Cancel</button></div>
        </fieldset>
        {error && !movementTarget && <p className="employee-error" role="alert">{error}</p>}
      </form>}
      {movementTarget && <form key={movementKey} className="employee-form inventory-dialog-form" onSubmit={saveMovement}>
        <div className="employee-form-title">Adjust stock — {movementTarget.name}</div>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="employee-form-fields">
            <label>Adjustment type *<select name="movement_type" value={movementType} onChange={event => setMaterialDialogState({ kind: "movement", materialId: movementTarget.id, movementType: event.target.value === "deduction" ? "deduction" : "stock_in", fromEdit: Boolean(editing) })}><option value="stock_in">Stock-in / add</option><option value="deduction" disabled={Number(movementTarget.quantity) <= 0}>Deduct</option></select></label>
            <label>Quantity ({movementTarget.unit}) *<input name="quantity" type="number" required min="0.001" max="999999999.999" step="0.001" autoFocus/></label>
            <label>{movementType === "stock_in" ? "Stock-in date" : "Deduction date"} *<input name="movement_date" type="date" required max={localDate()} defaultValue={localDate()}/></label>
          </div>
          <p className="employee-form-note">Current stock: {Number(movementTarget.quantity).toLocaleString("en-PH")} {movementTarget.unit}</p>
          <div className="form-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : movementType === "stock_in" ? "Record stock-in" : "Record deduction"}</button><button type="button" className="secondary-button" onClick={() => { setError(""); setMaterialDialogState({ kind: editing ? "edit" : "details", materialId: movementTarget.id }); }} disabled={busy}>Cancel</button></div>
        </fieldset>
        {error && <p className="employee-error" role="alert">{error}</p>}
      </form>}
    </dialog>
    <dialog ref={historyDialog} id={historyDialogId} className="inventory-history-dialog" aria-labelledby={historyTitleId} onCancel={() => setHistoryOpen(false)} onClose={() => setHistoryOpen(false)} onClick={event => {
      if (event.target === event.currentTarget) {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setHistoryOpen(false);
      }
    }}>
      <div className="inventory-history-heading"><div><h2 id={historyTitleId}>Stock movement history</h2><p>{movements.length} recorded movement{movements.length === 1 ? "" : "s"}</p></div><button type="button" className="secondary-button" onClick={() => setHistoryOpen(false)} autoFocus>Close</button></div>
      <SearchableList className="employee-table-wrap inventory-table-scroll" role="region" aria-label="Dated inventory stock-ins and deductions" tabIndex={0}><table><thead><tr><th>DATE</th><th>MATERIAL</th><th>MOVEMENT</th><th>SOURCE / ORDER</th><th>QUANTITY</th></tr></thead><tbody>
      {movements.map(movement => <tr key={movement.id}><td>{movement.movement_date}</td><td><b>{itemName(movement.material_id)}</b></td><td>{movement.movement_type === "stock_in" ? "Stock-in" : "Deduction"}</td><td>{movement.order_number ? `${movement.source === "order_reversal" ? "Order adjustment" : "Order"} ${movement.order_number}` : movement.source === "manual" ? "Manual" : movement.source === "order_reversal" ? "Order adjustment" : "Order deduction"}</td><td>{Number(movement.quantity).toLocaleString("en-PH")} {itemUnit(movement.material_id)}</td></tr>)}
      </tbody></table>{movements.length === 0 && <p className="empty-inline">No stock movements have been recorded yet.</p>}</SearchableList>
    </dialog>
  </section>;
}
