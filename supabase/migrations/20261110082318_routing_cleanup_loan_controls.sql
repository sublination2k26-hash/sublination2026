begin;
grant delete on public.routing_documents, public.document_routing_entries, public.personal_loans to authenticated;
create policy routing_documents_admin_delete on public.routing_documents for delete to authenticated using ((select public.current_app_role()) = 'admin');
create policy routing_entries_admin_delete on public.document_routing_entries for delete to authenticated using ((select public.current_app_role()) = 'admin');
create policy personal_loans_admin_delete on public.personal_loans for delete to authenticated using ((select public.current_app_role()) = 'admin');

create function public.delete_routing_document(p_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then raise exception 'Admin access required.'; end if;
  perform 1 from public.routing_documents where id=p_id for update;
  if not found then raise exception 'Document not found. Refresh and retry.'; end if;
  delete from public.document_routing_entries where document_id=p_id;
  delete from public.routing_documents where id=p_id;
end $$;

create function public.delete_personal_loan(p_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'admin'::public.app_role then raise exception 'Admin access required.'; end if;
  perform 1 from public.personal_loans where id=p_id for update;
  if not found then raise exception 'Loan not found. Refresh and retry.'; end if;
  update public.personal_loans set archived_at=null where id=p_id;
  delete from public.personal_loan_payments where loan_id=p_id;
  delete from public.personal_loans where id=p_id;
end $$;
grant update(borrower_name) on public.personal_loans to authenticated;
revoke all on function public.delete_routing_document(uuid), public.delete_personal_loan(uuid) from public,anon;
grant execute on function public.delete_routing_document(uuid), public.delete_personal_loan(uuid) to authenticated;
create schema if not exists sewing_rate_private;
revoke all on schema sewing_rate_private from public,anon;
grant usage on schema sewing_rate_private to authenticated;
create function sewing_rate_private.own_rate() returns table(piece_rate numeric,salary_basis text)
language sql stable security definer set search_path='' as $$
  select c.piece_rate,c.salary_basis::text from public.employee_compensation c
  where auth.uid() is not null and c.employee_id=auth.uid() and public.current_app_role()='cutting_sewing'
$$;
revoke all on function sewing_rate_private.own_rate() from public,anon;
grant execute on function sewing_rate_private.own_rate() to authenticated;
create function public.get_own_sewing_rate() returns table(piece_rate numeric,salary_basis text)
language sql stable security invoker set search_path='' as $$ select * from sewing_rate_private.own_rate() $$;
revoke all on function public.get_own_sewing_rate() from public,anon;
grant execute on function public.get_own_sewing_rate() to authenticated;
notify pgrst,'reload schema';
commit;
