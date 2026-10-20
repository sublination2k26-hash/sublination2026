-- Only admins and artists may add client artwork to an order.
drop policy if exists "designers upload files" on public.design_files;
create policy "admins and artists upload files"
on public.design_files for insert to authenticated
with check (public.has_any_role(array['admin','artist']::public.app_role[]));

drop policy if exists "designers upload design storage" on storage.objects;
create policy "admins and artists upload design storage"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'design-files'
  and public.has_any_role(array['admin','artist']::public.app_role[])
);
