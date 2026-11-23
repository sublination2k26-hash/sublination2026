import { redirect } from "next/navigation";
import { SectionPage } from "@/components/layout/section-page";
import { InventoryManager } from "@/components/inventory/inventory-manager";
import { createClient } from "@/lib/supabase/server";

export default async function InventoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (!profile?.active || profile.role !== "admin") redirect("/dashboard");
  const [inventory, movements] = await Promise.all([
    supabase.from("inventory_materials")
      .select("id,name,category,unit,quantity,low_stock_level,updated_at,archived_at").order("category").order("name"),
    supabase.from("inventory_movements")
      .select("id,material_id,movement_type,quantity,movement_date,created_at,source,order_number").order("movement_date", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  const error = inventory.error ?? movements.error;
  return <SectionPage area="Inventory" title="Materials inventory" description="Track dated stock movements. Configured product recipes deduct materials when production begins.">
    {error ? <p className="employee-error" role="alert">Could not load inventory. Make sure the inventory movement and order-deduction migrations have been applied. {error.message}</p>
      : <InventoryManager initialItems={inventory.data ?? []} initialMovements={movements.data ?? []}/>}
  </SectionPage>;
}
