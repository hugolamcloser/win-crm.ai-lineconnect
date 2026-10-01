-- Guarded C2 rollback. Refuse whenever any provider configuration row exists.
begin;
set local lock_timeout = '5s';
lock table public.every8d_provider_configurations in access exclusive mode;

do $$
begin
  if exists (select 1 from public.every8d_provider_configurations) then
    raise exception 'C2 rollback refused: EVERY8D provider configuration rows exist'
      using errcode = '23514';
  end if;
end;
$$;

drop trigger invalidate_every8d_provider_cfg_after_install_update
  on public.ghl_marketplace_installations;
drop trigger protect_every8d_provider_configuration
  on public.every8d_provider_configurations;
drop trigger set_every8d_provider_configurations_updated_at
  on public.every8d_provider_configurations;
drop policy every8d_provider_configurations_service_role_select
  on public.every8d_provider_configurations;
drop table public.every8d_provider_configurations;
drop function public.protect_every8d_provider_configuration_v1();
drop function public.invalidate_every8d_provider_configuration_v1();

commit;
