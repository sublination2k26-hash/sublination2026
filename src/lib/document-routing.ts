export const routingStages = ["P.R.", "P.O.", "COA", "BAC", "GSO", "BADMIN", "GSO BODEGA", "INSPECTOR", "NUMBERING", "CHECKING", "ACCOUNTING", "ASSESSORS", "CHEQUE RELEASE"] as const;
export type RoutingEntry = {
  id: string; document_id: string; stage: string; received_date: string;
  forwarded_date: string | null; handled_by: string; remarks: string; created_at: string;
};
export type RoutingDocument = {
  id: string; pr_number: string; po_number: string; title: string; payee: string;
  request_date: string; amount: number; cheque_number: string; bir_reference: string;
  gross_amount: number; tax_deduction: number; net_amount: number;
  released_date: string | null; released_to: string; updated_at: string; created_at: string;
  document_routing_entries: RoutingEntry[];
};
export const documentColumns = "*,document_routing_entries(*)";
export function latestStage(document: RoutingDocument) {
  return [...document.document_routing_entries].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.stage ?? "P.R.";
}

// Cheque release follows completion of every preceding office.
export function pendingRoutingStages(entries: RoutingEntry[]) {
  return routingStages.filter(stage => stage !== "CHEQUE RELEASE" &&
    !entries.filter(entry => entry.stage === stage)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.forwarded_date);
}
