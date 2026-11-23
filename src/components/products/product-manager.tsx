"use client";

import { SearchableList } from "@/components/ui/searchable-list";
import { FormEvent, useRef, useState } from "react";
import { Check, Package, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAppDialogs } from "@/components/ui/app-dialog-provider";
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

type InventoryMaterial = {
  id: string;
  name: string;
  unit: string;
  archived_at: string | null;
};

type MaterialRecipe = {
  product_id: string;
  material_id: string;
  quantity_per_unit: number;
};

type RecipeLine = {
  material_id: string;
  quantity_per_unit: string;
};

const typeLabels: Record<Product["production_type"], string> = {
  full_garment: "Full garment",
  print_only: "Print only",
  service: "Other service",
};

export function ProductManager({ initialProducts, initialMaterials, initialRecipes }: {
  initialProducts: Product[];
  initialMaterials: InventoryMaterial[];
  initialRecipes: MaterialRecipe[];
}) {
  const { confirm } = useAppDialogs();
  const [products, setProducts] = useState(initialProducts);
  const [materials] = useState(initialMaterials);
  const [recipes, setRecipes] = useState(initialRecipes);
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
  const [recipeProduct, setRecipeProduct] = useState<Product | null>(null);
  const [recipeLines, setRecipeLines] = useState<RecipeLine[]>([]);
  const [recipeSaving, setRecipeSaving] = useState(false);
  const visibleProducts = products.filter(product => showRemoved || product.active);
  const activeMaterials = materials.filter(material => !material.archived_at);

  const editRecipe = (product: Product) => {
    setRecipeProduct(product);
    setRecipeLines(recipes.filter(recipe => recipe.product_id === product.id)
      .map(recipe => ({ material_id: recipe.material_id, quantity_per_unit: String(recipe.quantity_per_unit) })));
    setError("");
    setNotice("");
  };

  const addRecipeLine = () => {
    const available = activeMaterials.find(material => !recipeLines.some(line => line.material_id === material.id));
    if (!available) {
      setError("All active materials are already in this recipe. Add or restore a material in Inventory first.");
      return;
    }
    setError("");
    setRecipeLines(current => [...current, { material_id: available.id, quantity_per_unit: "1" }]);
  };

  const saveRecipe = async () => {
    if (!recipeProduct || recipeSaving || changing.current || saving) return;
    const validLines = recipeLines.map(line => ({
      material_id: line.material_id,
      quantity_per_unit: Number(line.quantity_per_unit),
    }));
    if (validLines.some(line => !line.material_id || !Number.isFinite(line.quantity_per_unit)
      || line.quantity_per_unit <= 0 || line.quantity_per_unit > 999999999.999
      || Math.round(line.quantity_per_unit * 1000) / 1000 !== line.quantity_per_unit)
      || new Set(validLines.map(line => line.material_id)).size !== validLines.length
      || validLines.some(line => !activeMaterials.some(material => material.id === line.material_id))) {
      setError("Choose a unique active material and enter a positive quantity per product (up to 3 decimal places).");
      return;
    }
    setRecipeSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: saveError } = await createClient().rpc("save_product_material_recipe", {
        p_product_id: recipeProduct.id,
        p_recipe: validLines,
      });
      if (saveError) throw saveError;
      setRecipes(current => [
        ...current.filter(recipe => recipe.product_id !== recipeProduct.id),
        ...validLines.map(line => ({
          product_id: recipeProduct.id,
          material_id: line.material_id,
          quantity_per_unit: line.quantity_per_unit,
        })),
      ]);
      setNotice(`Material recipe saved for ${recipeProduct.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this material recipe.");
    } finally {
      setRecipeSaving(false);
    }
  };

  const deleteProduct = async (product: Product) => {
    if (changing.current || saving) return;
    if (!await confirm(`Permanently delete ${product.name}? This cannot be undone. Products already used in job orders must be removed from the catalog instead.`, {
      title: "Delete product",
      confirmLabel: "Delete permanently",
      variant: "danger",
    })) return;
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
    if (product.active && !await confirm(`Remove ${product.name} from the catalog? Existing orders will be kept. You can restore the product later.`, {
      title: "Remove product",
      confirmLabel: "Remove",
    })) return;
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

    {recipeProduct && <section className="employee-form product-recipe-editor" aria-label={`Material recipe for ${recipeProduct.name}`}>
      <div className="employee-form-title">Materials per {recipeProduct.name}</div>
      <p className="employee-form-note">Set how much of each material is used for one ordered product. These quantities are deducted when production begins. Products with no recipe do not deduct inventory automatically.</p>
      <fieldset disabled={recipeSaving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {recipeLines.map((line, index) => {
          const currentMaterial = materials.find(material => material.id === line.material_id);
          return <div className="employee-form-fields product-recipe-line" key={`${recipeProduct.id}-${index}`}>
            <label>Material<select required value={line.material_id} onChange={event => setRecipeLines(current => current.map((entry, row) => row === index ? { ...entry, material_id: event.target.value } : entry))}>
              {materials.filter(material => !material.archived_at || material.id === line.material_id).map(material => <option key={material.id} value={material.id} disabled={recipeLines.some((entry, row) => row !== index && entry.material_id === material.id)}>{material.name}{material.archived_at ? " (archived - replace this material)" : ""}</option>)}
              {!currentMaterial && <option value="" disabled>Choose an active material</option>}
            </select></label>
            <label>Quantity per product ({currentMaterial?.unit ?? "unit"})<input type="number" min="0.001" max="999999999.999" step="0.001" required value={line.quantity_per_unit} onChange={event => setRecipeLines(current => current.map((entry, row) => row === index ? { ...entry, quantity_per_unit: event.target.value } : entry))}/></label>
            <button type="button" className="secondary-button" onClick={() => setRecipeLines(current => current.filter((_, row) => row !== index))}>Remove</button>
          </div>;
        })}
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={addRecipeLine} disabled={recipeLines.length >= 50}>Add material</button>
          <button type="button" className="primary-button" onClick={() => void saveRecipe()}>{recipeSaving ? "Saving…" : "Save recipe"}</button>
          <button type="button" className="secondary-button" onClick={() => setRecipeProduct(null)} disabled={recipeSaving}>Close</button>
        </div>
      </fieldset>
    </section>}

    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13 }}><input type="checkbox" checked={showRemoved} onChange={event => setShowRemoved(event.target.checked)}/> Show removed products</label>
    <SearchableList className="employee-table-wrap products-table-scroll" role="region" aria-label="Product catalog, scroll to see more products" tabIndex={0}>
      <table>
        <thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>TYPE</th><th>BASE PRICE</th><th>STATUS</th><th>MATERIALS</th><th>ACTION</th></tr></thead>
        <tbody>{visibleProducts.map(product => <tr key={product.id}>
          <td><b>{product.name}</b></td>
          <td>{product.category}</td>
          <td>{pricingServices.find(item => (product.category.startsWith(item.label + " - ") || product.category.startsWith(item.label + " ? ")))?.label ?? typeLabels[product.production_type]}</td>
          <td>{Number(product.base_price).toLocaleString("en-PH", { style: "currency", currency: "PHP" })}</td>
          <td>{product.active ? "Active" : "Removed"}</td>
          <td><button type="button" className="filter-button" onClick={() => editRecipe(product)}>{recipes.some(recipe => recipe.product_id === product.id) ? `${recipes.filter(recipe => recipe.product_id === product.id).length} materials · Edit` : "Set recipe"}</button></td>
          <td><button type="button" className="filter-button" disabled={saving || changingId !== null || recipeSaving} aria-label={`${product.active ? "Remove" : "Restore"} ${product.name}`} onClick={() => void changeProductStatus(product)}>{changingId === product.id ? "Saving…" : product.active ? "Remove" : "Restore"}</button>{" "}<button type="button" className="filter-button" disabled={saving || changingId !== null || recipeSaving} aria-label={`Permanently delete ${product.name}`} onClick={() => void deleteProduct(product)}>Delete</button></td>
        </tr>)}</tbody>
      </table>
      {visibleProducts.length === 0 && <p className="empty-inline"><Package size={16}/> No {showRemoved ? "" : "active "}products. Add a product above{!showRemoved && " or show removed products to restore one"}.</p>}
    </SearchableList>
  </section>;
}
