-- Guarded rollback for Phase 2G-D D3 lifecycle replay/order repair.
begin;
set local lock_timeout = '5s';
lock table public.ghl_marketplace_installations in access exclusive mode;

do $$
begin
  if exists (select 1 from public.ghl_marketplace_installations
    where not (
      (latest_lifecycle_event_at is null
        and latest_lifecycle_event_id is null
        and latest_lifecycle_event_type is null)
      or
      (latest_lifecycle_event_at is not null
        and latest_lifecycle_event_type = 'INTERNAL_BASELINE'
        and latest_lifecycle_event_id =
          'internal_d3_baseline_' || id::text || '_' || status || '_g' || installation_generation::text)
    )) then
    raise exception 'lifecycle ordering rollback refused: preserve accepted authoritative lifecycle evidence'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)
  from service_role;
drop function public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text);

drop trigger protect_ghl_marketplace_installation on public.ghl_marketplace_installations;
create trigger protect_ghl_marketplace_installation
before insert or update on public.ghl_marketplace_installations
for each row execute function public.protect_ghl_marketplace_installation_v2();
drop function public.protect_ghl_marketplace_installation_v3();

grant update (status, installation_generation) on public.ghl_marketplace_installations
  to service_role;
grant execute on function public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)
  to service_role;

alter table public.ghl_marketplace_installations
  drop constraint ghl_marketplace_installations_lifecycle_watermark_check,
  drop column latest_lifecycle_event_at,
  drop column latest_lifecycle_event_id,
  drop column latest_lifecycle_event_type;

drop table public.ghl_marketplace_app_registrations;
drop function public.protect_ghl_marketplace_app_registration_v1();

commit;
