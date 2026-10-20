-- Add non-production destinations (for example, correcting order details at Front Desk).
alter table public.defects add column if not exists return_destination text;

create or replace function public.log_defect_history()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.defect_history(defect_id,actor_id,event,details)
    values(new.id,new.reported_by,'reported',jsonb_build_object('origin_stage',new.origin_stage,'return_stage',new.return_stage,'return_destination',new.return_destination,'required_action',new.required_action,'affected_component',new.affected_component));
  else
    if old.return_stage is distinct from new.return_stage or old.return_destination is distinct from new.return_destination then
      insert into public.defect_history(defect_id,actor_id,event,details)
      values(new.id,new.reported_by,'destination_changed',jsonb_build_object('from',coalesce(old.return_destination,old.return_stage::text),'to',coalesce(new.return_destination,new.return_stage::text)));
    end if;
    if old.correction_status is distinct from new.correction_status or old.approval_to_resume is distinct from new.approval_to_resume then
      insert into public.defect_history(defect_id,actor_id,event,details)
      values(new.id,coalesce(new.corrected_by,new.qc_verified_by),'status_changed',jsonb_build_object('from',old.correction_status,'to',new.correction_status,'approval_to_resume',new.approval_to_resume));
    end if;
  end if;
  return new;
end $$;
