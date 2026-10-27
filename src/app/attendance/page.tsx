import { redirect } from "next/navigation";
import { SectionPage } from "@/components/layout/section-page";
import { AttendanceManager } from "@/components/attendance/attendance-manager";
import { createClient } from "@/lib/supabase/server";

export default async function AttendancePage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("id,full_name,role,active").eq("id", user.id).maybeSingle();
  if (!profile?.active || profile.role === "cutting_sewing") redirect("/dashboard");
  return <SectionPage area="Time In & Out" title="Time In & Out Management" description="Daily attendance, employee QR codes and salary." action={profile.role === "admin" ? { label: "Open payroll", href: "/payroll" } : undefined}>
    <AttendanceManager isAdmin={profile.role === "admin"} currentEmployee={profile}/>
  </SectionPage>;
}
