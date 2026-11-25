alter table public.routing_documents
  add column suppliers text[] not null default '{}'::text[]
  check (suppliers in (
    '{}'::text[],
    array['MAGNUS'],
    array['SUBLI-NATION'],
    array['MAGNUS', 'SUBLI-NATION'],
    array['SUBLI-NATION', 'MAGNUS']
  ));

-- Preserve the original payee and audit fields while recovering known supplier selections.
do $$
begin
  alter table public.routing_documents disable trigger stamp_routing_document;
  update public.routing_documents
  set suppliers = array[payee]
  where payee in ('MAGNUS', 'SUBLI-NATION');
  alter table public.routing_documents enable trigger stamp_routing_document;
end;
$$;

notify pgrst, 'reload schema';
