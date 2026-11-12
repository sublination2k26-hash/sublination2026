begin;
alter table public.document_routing_entries drop constraint document_routing_entries_stage_check;
update public.document_routing_entries set stage='ADMIN' where stage='BADMIN';
alter table public.document_routing_entries add constraint document_routing_entries_stage_check
  check (stage in ('P.R.', 'P.O.', 'COA', 'BAC', 'GSO', 'ADMIN', 'GSO BODEGA', 'INSPECTOR', 'NUMBERING', 'CHECKING', 'ACCOUNTING', 'ASSESSORS', 'CHEQUE RELEASE'));
notify pgrst,'reload schema';
commit;
