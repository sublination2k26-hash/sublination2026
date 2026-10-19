// Initial domain types for the local-first application. Generate Supabase database types after connecting the project.
export type OrderStatus="pending"|"confirmed"|"in_production"|"quality_check"|"ready_for_release"|"released"|"cancelled";
export type ProductionStage="layout"|"printing"|"heat_press"|"cutting"|"sewing"|"qc";
export type PaymentMethod="cash"|"gcash"|"bank_transfer"|"card"|"other";
