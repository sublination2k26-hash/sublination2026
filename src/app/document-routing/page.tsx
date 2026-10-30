import { redirect } from "next/navigation";
import { SectionPage } from "@/components/layout/section-page";
import { DocumentRoutingManager } from "@/components/document-routing/document-routing-manager";
import { DocumentRoutingWorkspace } from "@/components/document-routing/loan-tracker";
import { createClient } from "@/lib/supabase/server";
import { documentColumns, type RoutingDocument } from "@/lib/document-routing";

export default async function DocumentRoutingPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (!profile?.active || profile.role !== "admin") redirect("/dashboard");
  const { data, error } = await db.from("routing_documents").select(documentColumns).order("created_at", { ascending: false });
  return <SectionPage area="Document Routing" title="Document routing & disbursement" description="Track purchase documents through each office and record cheque releases.">
    <DocumentRoutingWorkspace>{error ? <p className="employee-error" role="alert">Could not load documents. Apply the document routing migration and reload. {error.message}</p>
      : <DocumentRoutingManager initialDocuments={(data ?? []) as RoutingDocument[]}/>}</DocumentRoutingWorkspace>
  </SectionPage>;
}
