"use client";

import { FormEvent, useState } from "react";
import { Check, Package, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { garmentCategories } from "@/lib/garment-options";

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
  const [productionType, setProductionType] = useState<Product["production_type"]>("full_garment");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const addProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { data, error: insertError } = await createClient().from("products").insert({
        name: name.trim(),
        category: category.trim(),
        production_type: productionType,
        base_price: Number(price),
      }).select("id,name,category,production_type,base_price,active,created_at").single();
      if (insertError) throw insertError;
      setProducts(current => [data as Product, ...current]);
      setName("");
      setCategory("");
      setProductionType("full_garment");
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
        <p>New products are saved in your shared Supabase database.</p>
      </div>
    </div>

    {notice && <div className="employee-notice"><Check size={14}/>{notice}</div>}
    {error && <div className="employee-error" role="alert">{error}</div>}

    <form className="employee-form" onSubmit={addProduct}>
      <div className="employee-form-title"><span>Add product</span></div>
      <div className="employee-form-fields">
        <label>Product name *<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Custom basketball jersey"/></label>
        {productionType === "full_garment"
          ? <label>Garment type *<select required value={category} onChange={event => setCategory(event.target.value)}><option value="">Choose garment type</option>{garmentCategories.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option} value={`${group.label} · ${option}`}>{option}</option>)}</optgroup>)}</select></label>
          : <label>Category *<input required maxLength={80} value={category} onChange={event => setCategory(event.target.value)} placeholder="e.g. Artwork printing"/></label>}
        <label>Production type *<select value={productionType} onChange={event => setProductionType(event.target.value as Product["production_type"])}><option value="full_garment">Full garment</option><option value="print_only">Print only</option><option value="service">Other service</option></select></label>
        <label>Base price (₱) *<input required type="number" min="0" step="0.01" value={price} onChange={event => setPrice(event.target.value)} placeholder="0.00"/></label>
      </div>
      <div className="form-actions"><button className="primary-button" type="submit" disabled={saving}><Plus size={15}/>{saving ? "Saving…" : "Add product"}</button></div>
    </form>

    <div className="employee-table-wrap">
      <table>
        <thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>TYPE</th><th>BASE PRICE</th><th>STATUS</th></tr></thead>
        <tbody>{products.map(product => <tr key={product.id}>
          <td><b>{product.name}</b></td>
          <td>{product.category}</td>
          <td>{typeLabels[product.production_type]}</td>
          <td>{Number(product.base_price).toLocaleString("en-PH", { style: "currency", currency: "PHP" })}</td>
          <td>{product.active ? "Active" : "Inactive"}</td>
        </tr>)}</tbody>
      </table>
      {products.length === 0 && <p className="empty-inline"><Package size={16}/> No products yet. Add your first product above.</p>}
    </div>
  </section>;
}
