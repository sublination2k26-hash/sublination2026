import { SectionPage } from "@/components/layout/section-page";
import { EmployeeManager } from "@/components/employees/employee-manager";
import type { AppRole } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const roles: { role: AppRole; title: string; responsibilities: string; permissions: string[] }[] = [
  { role: "admin", title: "Admin / Owner", responsibilities: "Can perform every role’s work and manage all system areas.", permissions: ["Access and perform all Front Desk, Artist, Printing, Heat Press, Cutting / Sewing, and QC actions", "Manage employees and role assignments", "Manage product prices, orders, customers, and payments", "Update every production stage and authorize release exceptions"] },
  { role: "front_desk", title: "Front Desk", responsibilities: "Registers customers, creates orders, and records payments.", permissions: ["Manage customers and orders", "Record payments and balances", "View job order details"] },
  { role: "artist", title: "Artist / Layout Designer", responsibilities: "Prepares artwork and checks personalized design details.", permissions: ["View assigned job details and design files", "Update the layout stage", "Report design corrections"] },
  { role: "printing", title: "Printing Staff", responsibilities: "Prints approved sublimation layouts.", permissions: ["View the printing queue and approved files", "Update the printing stage", "Report printing defects"] },
  { role: "heat_press", title: "Heat Press Staff", responsibilities: "Transfers printed designs onto fabric.", permissions: ["View the heat press queue", "Update the heat press stage", "Report transfer defects"] },
  { role: "cutter", title: "Cutter", responsibilities: "Cuts printed fabric and prepares garment pieces.", permissions: ["View cutting jobs and upcoming cutting work", "Update cutting stages", "Report damaged or missing pieces"] },
  { role: "sewer", title: "Sewer", responsibilities: "Assembles garments and records completed sewing output.", permissions: ["View sewing jobs and claim pieces", "Record own sewing output", "Report sewing defects"] },
  { role: "qc", title: "Quality Control (QC)", responsibilities: "Inspects finished work and records defects.", permissions: ["View completed production jobs", "Record QC checks and defects", "Approve or return work for correction"] },
];

export default async function EmployeesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role,active").eq("id", user.id).maybeSingle()
    : { data: null };
  if (!profile?.active || profile.role !== "admin") redirect("/dashboard");
  return <SectionPage area="Employees" title="Employee accounts" description="Admin workspace · Manage staff records and review every system role." action={{label:"Open payroll",href:"/payroll"}}>
    <EmployeeManager />
    <div className="role-directory">
      <div className="role-directory-heading"><div><h2>All system roles</h2><p>Role visibility for the admin workspace</p></div><span>{roles.length} roles</span></div>
      <div className="role-list">
        {roles.map(({ role, title, responsibilities, permissions }) => <article className="role-card" key={role}>
          <div className="role-card-heading"><div><h3>{title}</h3><p>{responsibilities}</p></div><code>{role}</code></div>
          <ul>{permissions.map(permission => <li key={permission}>{permission}</li>)}</ul>
        </article>)}
      </div>
      <p className="role-directory-note">Employee roles control access to the employee admin workspace and Supabase policies. Order workflows are still local browser demo data.</p>
    </div>
  </SectionPage>;
}
