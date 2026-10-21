-- Front Desk can report defects but cannot mark production corrections done.
drop policy if exists "staff update corrections" on public.defects;
create policy "production staff update corrections" on public.defects for update to authenticated
  using (public.has_any_role(array['admin','artist','printing','heat_press','cutting_sewing','qc']::public.app_role[]))
  with check (public.has_any_role(array['admin','artist','printing','heat_press','cutting_sewing','qc']::public.app_role[]));
