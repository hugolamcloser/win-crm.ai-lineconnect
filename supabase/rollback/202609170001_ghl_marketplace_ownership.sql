-- Manual, separately approved rollback only. Never part of forward discovery.
begin;
set local lock_timeout = '5s';
-- Lock before checking so an insert cannot race the empty-schema guard.
lock table public.ghl_marketplace_installations, public.ghl_marketplace_oauth_states in access exclusive mode;
do $$
begin
  if exists (select 1 from public.ghl_marketplace_installations)
    or exists (select 1 from public.ghl_marketplace_oauth_states) then
    raise exception 'marketplace rollback refused: preserve nonempty ownership schema' using errcode = 'P0001';
  end if;
end;
$$;
drop table public.ghl_marketplace_oauth_states;
drop table public.ghl_marketplace_installations;
drop function public.protect_ghl_marketplace_oauth_state_v1();
drop function public.protect_ghl_marketplace_installation_v1();
alter table public.tenants drop constraint tenants_marketplace_id_location_key;
commit;
