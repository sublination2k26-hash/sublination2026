"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./production-products-board.css";

type Product = {
  id: string;
  name: string;
  category: string;
  base_price: number;
};

const errorMessage = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "message" in cause ? String(cause.message) : "Could not load products.";

export function ProductionProductsBoard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data, error: loadError } = await createClient()
          .from("products")
          .select("id,name,category,base_price")
          .eq("active", true)
          .order("name");
        if (loadError) throw loadError;
        if (active) setProducts(data ?? []);
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const categories = [...new Set(products.map(product => product.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const visibleProducts = products.filter(product => !selectedCategory || product.category === selectedCategory);

  return <section className="panel production-products">
    <div className="production-products-heading">
      <div><div className="section-kicker">PRODUCT CATALOG</div><h2>Products by category</h2></div>
      <span>{loading ? "Loading…" : `${visibleProducts.length} product${visibleProducts.length === 1 ? "" : "s"}`}</span>
    </div>
    {error ? <p className="employee-error" role="alert">Could not load products: {error}</p> : <>
      <div className="production-product-categories" role="group" aria-label="Filter products by category">
        <button type="button" className="production-category-pill" aria-pressed={!selectedCategory} onClick={() => setSelectedCategory("")}>All categories</button>
        {categories.map(category => <button key={category} type="button" className="production-category-pill" aria-pressed={selectedCategory === category} onClick={() => setSelectedCategory(category)}>{category}</button>)}
      </div>
      {loading ? <p className="lane-empty" role="status">Loading products…</p> : visibleProducts.length ? <div className="production-product-grid">
        {visibleProducts.map(product => <article className="production-product-card" key={product.id}>
          <div><h3>{product.name}</h3><span>{product.category}</span></div>
          <b>{Number(product.base_price).toLocaleString("en-PH", { style: "currency", currency: "PHP" })}</b>
        </article>)}
      </div> : <p className="lane-empty">{selectedCategory ? `No products in ${selectedCategory}.` : "No active products in the catalog."}</p>}
    </>}
  </section>;
}
