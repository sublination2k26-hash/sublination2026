"use client";

import { SearchableList } from "@/components/ui/searchable-list";
import { FormEvent, useRef, useState } from "react";
import { Check, Package, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { garmentPricing, pricingServices, serviceProductionStages, type PricingService } from "@/lib/product-pricing";
import "./product-manager.css";

type Product = {
  id: string;
  name: string;
  category: string;
  production_type: "full_garment" | "print_only" | "service";
  base_price: number;
  active: boolean;
  created_at: string;
};

const typeLabels: Record<Product["production_type"], string> = {
  full_garment: "Full garment",
  print_only: "Print only",
  service: "Other service",
};

export function ProductManager({ initialProducts }: { initialProducts: Product[] }) {
  const [products, setProducts] = useState(initialProducts);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [service, setService] = useState<PricingService>("full_garment");
  const [garment, setGarment] = useState("");
  const selectedService = pricingServices.find(item => item.id === service)!;
  const productionType = selectedService.productionType;
  const options = garmentPricing(service);
  const fixedPrice = options.find(item => item.garment === garment)?.price;
  const manualPricing = fixedPrice == null;
  const selectGarment = (value: string, nextService: PricingService = service) => {
    const selected = garmentPricing(nextService).find(item => item.garment === value);
    const mode = pricingServices.find(item => item.id === nextService)!;
    setGarment(value);
    setCategory(value ? `${mode.label} - ${value}` : "");
    setName(value ? (nextService === "full_garment" ? value : `${mode.label} - ${value}`) : "");
    setPrice(selected?.price == null ? "" : String(selected.price));
  };
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [changingId, setChangingId] = useState<string | null>(null);
  const changing = useRef(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const visibleProducts = products.filter(product => showRemoved || product.active);
  const [selectedCategory, setSelectedCategory] = useState("");
  const categories = [...new Set(products.map(product => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const filteredProducts = visibleProducts.filter(product => !selectedCategory || product.category === selectedCategory);

  const deleteProduct = async (product: Product) => {
    if (changing.current || saving) return;
    if (!window.confirm(`Permanently delete ${product.name}? This cannot be undone. Products already used in job orders must be removed from the catalog instead.`)) return;
    changing.current = true;
    setChangingId(product.id);
    setError("");
    setNotice("");
    try {
      const { data, error: deleteError } = await createClient().from("products")
        .delete().eq("id", product.id).select("id").single();
      if (deleteError?.code === "23503") throw new Error("This product is used in existing records and cannot be deleted. Use Remove to hide it from new orders.");
      if (deleteError) throw deleteError;
      if (!data) throw new Error("Product was not deleted. Refresh and try again.");
      setProducts(current => current.filter(item => item.id !== data.id));
      setNotice(`${product.name} permanently deleted.`);
    } catch (cause) {
      setError(typeof cause === "object" && cause !== null && "message" in cause ? String(cause.message) : "Could not delete this product.");
    } finally {
      changing.current = false;
      setChangingId(null);
    }
  };

  const changeProductStatus = async (product: Product) => {
    if (changing.current || saving) return;
    if (product.active && !window.confirm(`Remove ${product.name} from the catalog? Existing orders will be kept. You can restore the product later.`)) return;
    changing.current = true;
    setChangingId(product.id);
    setError("");
    setNotice("");
    try {
      const { data, error: updateError } = await createClient().from("products")
        .update({ active: !product.active }).eq("id", product.id).select("id,active").single();
      if (updateError) throw updateError;
      if (!data) throw new Error("Product was not updated. Refresh and try again.");
      setProducts(current => current.map(item => item.id === data.id ? { ...item, active: data.active } : item));
      setNotice(`${product.name} ${data.active ? "restored to" : "removed from"} the catalog.`);
    } catch (cause) {
      setError(typeof cause === "object" && cause !== null && "message" in cause ? String(cause.message) : "Could not update this product.");
    } finally {
      changing.current = false;
      setChangingId(null);
    }
  };

  const addProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || changing.current) return;
    const unitPrice = Number(price);
    if (!garment || !name.trim() || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      setError("Choose a garment and enter a product name and a price greater than zero.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { data, error: insertError } = await createClient().from("products").insert({
        name: name.trim(),
        category: category.trim(),
        production_type: productionType,
        production_service: service,
        base_price: unitPrice,
      }).select("id,name,category,production_type,base_price,active,created_at").single();
      if (insertError) throw insertError;
      setProducts(current => [data as Product, ...current]);
      setName("");
      setCategory("");
      setService("full_garment");
      setGarment("");
      setPrice("");
      setNotice("Product saved to Supabase.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this product.");
    } finally {
      setSaving(false);
    }
  };

  return <section className="employee-manager">
    <div className="employee-manager-heading">
      <div>
        <div className="section-kicker">ADMIN CATALOG</div>
        <h2>Products</h2>
        <p>Manage products available for new orders. Removed products can be restored. Delete unused test products permanently.</p>
      </div>
    </div>

    {notice && <div className="employee-notice" role="status"><Check size={14}/>{notice}</div>}
    {error && <div className="employee-error" role="alert">{error}</div>}

    <form className="employee-form" onSubmit={addProduct}>
      <div className="employee-form-title"><span>Add product</span></div>
      <div className="employee-form-fields">
        <label>Service *<select value={service} onChange={event => {const next = event.target.value as PricingService; setService(next); selectGarment("", next);}}>{pricingServices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Garment type *<select required value={garment} onChange={event => selectGarment(event.target.value)}><option value="">Choose garment type</option>{options.map(item => <option key={item.garment} value={item.garment}>{item.garment}</option>)}</select></label>
        <label>Product name *<input required maxLength={120} value={name} readOnly={!!garment && !manualPricing} onChange={event => setName(event.target.value)} placeholder="Select a garment or name your special item"/></label>
        <label>Unit price (PHP) *<input required type="number" min="0.01" step="0.01" value={price} onChange={event => setPrice(event.target.value)} placeholder="Enter your price"/><small>{!garment ? "Choose a garment to load its preset price." : manualPricing ? "Enter your price for this item before adding it." : `Preset: PHP ${fixedPrice}. You can change the price before adding this product.`}</small></label>
      </div>
      <p className="employee-form-note">Production: {serviceProductionStages[service].map(stage => ({layout:"Layout",printing:"Printing",heat_press:"Heat press",cutting:"Cutting",sewing:"Sewing",qc:"QC"}[stage])).join(" → ")} → Release</p>
      <div className="form-actions"><button className="primary-button" type="submit" disabled={saving || changingId !== null}><Plus size={15}/>{saving ? "Saving…" : "Add product"}</button></div>
    </form>

    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13 }}><input type="checkbox" checked={showRemoved} onChange={event => setShowRemoved(event.target.checked)}/> Show removed products</label>
    <div className="product-category-filters" role="group" aria-label="Filter products by category">
      <button type="button" className="product-category-pill" aria-pressed={!selectedCategory} onClick={() => setSelectedCategory("")}>All categories</button>
      {categories.map(value => <button key={value} type="button" className="product-category-pill" aria-pressed={selectedCategory === value} onClick={() => setSelectedCategory(value)}>{value}</button>)}
    </div>
    <SearchableList className="employee-table-wrap products-table-scroll" role="region" aria-label="Product catalog, scroll to see more products" tabIndex={0}>
      <table>
        <thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>TYPE</th><th>BASE PRICE</th><th>STATUS</th><th>ACTION</th></tr></thead>
        <tbody>{filteredProducts.map(product => <tr key={product.id}>
          <td><b>{product.name}</b></td>
          <td>{product.category}</td>
          <td>{pricingServices.find(item => (product.category.startsWith(item.label + " - ") || product.category.startsWith(item.label + " ? ")))?.label ?? typeLabels[product.production_type]}</td>
          <td>{Number(product.base_price).toLocaleString("en-PH", { style: "currency", currency: "PHP" })}</td>
          <td>{product.active ? "Active" : "Removed"}</td>
          <td><button type="button" className="filter-button" disabled={saving || changingId !== null} aria-label={`${product.active ? "Remove" : "Restore"} ${product.name}`} onClick={() => void changeProductStatus(product)}>{changingId === product.id ? "Saving…" : product.active ? "Remove" : "Restore"}</button>{" "}<button type="button" className="filter-button" disabled={saving || changingId !== null} aria-label={`Permanently delete ${product.name}`} onClick={() => void deleteProduct(product)}>Delete</button></td>
        </tr>)}</tbody>
      </table>
      {filteredProducts.length === 0 && <p className="empty-inline"><Package size={16}/> No {showRemoved ? "" : "active "}{selectedCategory ? `products in ${selectedCategory}.` : "products."} { !selectedCategory && <>Add a product above{!showRemoved && " or show removed products to restore one"}.</>}</p>}
    </SearchableList>
  </section>;
}
