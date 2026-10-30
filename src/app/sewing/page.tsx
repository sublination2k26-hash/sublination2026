import { redirect } from "next/navigation";
import { SectionPage } from "@/components/layout/section-page";
import { SewingManager } from "@/components/production/sewing-manager";
import { createClient } from "@/lib/supabase/server";

export default async function SewingPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("role,active").eq("id", user.id).single();
  if (!profile?.active || !["admin", "front_desk", "cutting_sewing"].includes(profile.role)) redirect("/dashboard");
  const params = await searchParams;
  return <SectionPage area="Sewing assignments" title="Shared sewing queue & output" description="Choose sewing pieces, track Front Desk handoffs, and record each sewer’s completed output.">
    <SewingManager userId={user.id} role={profile.role} initialOrderId={params.order}/>
  </SectionPage>;
}
