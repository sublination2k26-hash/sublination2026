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
  const { data, error } = await supabase.from("inventory_materials")
    .select("id,name,category,unit,quantity,low_stock_level,updated_at").order("category").order("name");
  return <SectionPage area="Inventory" title="Materials inventory" description="Track printing, fabric, cleaning, and sewing supplies. Add more materials anytime.">
    {error ? <p className="employee-error" role="alert">Could not load inventory. Make sure the materials inventory migration has been applied. {error.message}</p>
      : <InventoryManager initialItems={data ?? []}/>}
  </SectionPage>;
}
