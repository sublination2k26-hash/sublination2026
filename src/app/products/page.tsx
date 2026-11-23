import { redirect } from "next/navigation";
import { ProductManager } from "@/components/products/product-manager";
import { SectionPage } from "@/components/layout/section-page";
import { createClient } from "@/lib/supabase/server";

export default async function ProductsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (!profile?.active || profile.role !== "admin") redirect("/dashboard");

  const [products, materials, recipes] = await Promise.all([
    supabase.from("products")
      .select("id,name,category,production_type,base_price,active,created_at")
      .order("created_at", { ascending: false }),
    supabase.from("inventory_materials")
      .select("id,name,unit,archived_at")
      .order("name"),
    supabase.from("product_material_recipes")
      .select("product_id,material_id,quantity_per_unit"),
  ]);
  const error = products.error ?? materials.error ?? recipes.error;
  return <SectionPage area="Products" title="Products & pricing" description="Add products and services to use when creating job orders.">
    {error
      ? <p className="employee-error" role="alert">Could not load products and material recipes. Make sure the inventory order-deduction migration has been applied. {error.message}</p>
      : <ProductManager initialProducts={products.data ?? []} initialMaterials={materials.data ?? []} initialRecipes={recipes.data ?? []} />}
  </SectionPage>;
}
