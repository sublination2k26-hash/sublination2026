-- One cash advance summary per document. Existing documents start at zero.
alter table public.routing_documents
  add column cash_advance_amount numeric(12,2) not null default 0
    check (cash_advance_amount >= 0 and cash_advance_amount <= 9999999999.99),
  add column cash_advance_date date,
  add column cash_advance_recipient text not null default '' check (length(cash_advance_recipient) <= 200),
  add column cash_advance_reference text not null default '' check (length(cash_advance_reference) <= 100),
  add column cash_advance_liquidated numeric(12,2) not null default 0
    check (cash_advance_liquidated >= 0 and cash_advance_liquidated <= cash_advance_amount),
  add column cash_advance_balance numeric(12,2)
    generated always as (cash_advance_amount - cash_advance_liquidated) stored,
  add constraint document_cash_advance_details check (
    (cash_advance_amount = 0 and cash_advance_date is null
      and trim(cash_advance_recipient) = '' and trim(cash_advance_reference) = '')
    or (cash_advance_amount > 0 and cash_advance_date is not null
      and cash_advance_date >= request_date and length(trim(cash_advance_recipient)) > 0
      and length(trim(cash_advance_reference)) > 0)
  );
-- Existing admin RLS, timestamp/actor trigger and stale-edit protection also cover these fields.
