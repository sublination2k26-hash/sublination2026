import { SectionPage } from "@/components/layout/section-page";
import { PayrollManager } from "@/components/payroll/payroll-manager";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function PayrollPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from("profiles").select("role,active").eq("id", user.id).maybeSingle() : { data: null };
  if (!profile?.active || profile.role !== "admin") redirect("/dashboard");
  return <SectionPage area="Payroll" title="Employee work & payroll" description="Configure pay, review work and hours, then approve payroll periods.">
    <PayrollManager />
  </SectionPage>;
}
