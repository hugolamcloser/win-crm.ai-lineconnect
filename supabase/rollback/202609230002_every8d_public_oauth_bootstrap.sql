-- Roll back the post-D3 public OAuth bootstrap foundation only while unused.
begin;
set local lock_timeout = '5s';
lock table public.ghl_marketplace_installations,
  public.ghl_marketplace_oauth_bootstraps,
  public.ghl_marketplace_app_version_registrations in access exclusive mode;

do $$
begin
  if exists (select 1 from public.ghl_marketplace_app_version_registrations) then
    raise exception 'public OAuth rollback refused: version registration evidence exists'
      using errcode = '23514';
  end if;
  if exists (select 1 from public.ghl_marketplace_oauth_bootstraps) then
    raise exception 'public OAuth rollback refused: durable OAuth attempt evidence exists'
      using errcode = '23514';
  end if;
  if exists (select 1 from public.ghl_marketplace_installations
      where latest_lifecycle_version_id is not null) then
    raise exception 'public OAuth rollback refused: lifecycle version evidence exists'
      using errcode = '23514';
  end if;
end;
$$;

revoke execute on function
  public.accept_every8d_public_oauth_callback_v1(text,text,text,text,text,text,text,text,text,timestamptz,bytea,text),
  public.apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamptz,text),
  public.list_every8d_oauth_recoverable_v1(text,text,integer),
  public.claim_every8d_oauth_exchange_v1(uuid,text,text),
  public.fail_every8d_oauth_bootstrap_v1(uuid,text),
  public.finalize_every8d_oauth_exchange_v1(uuid,text,text,bytea,bytea,text,timestamptz,text[]),
  public.get_every8d_oauth_bootstrap_status_v1(text,text)
from service_role;

drop function public.get_every8d_oauth_bootstrap_status_v1(text,text);
drop function public.finalize_every8d_oauth_exchange_v1(uuid,text,text,bytea,bytea,text,timestamptz,text[]);
drop function public.fail_every8d_oauth_bootstrap_v1(uuid,text);
drop function public.claim_every8d_oauth_exchange_v1(uuid,text,text);
drop function public.list_every8d_oauth_recoverable_v1(text,text,integer);
drop function public.apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamptz,text);
drop function public.accept_every8d_public_oauth_callback_v1(text,text,text,text,text,text,text,text,text,timestamptz,bytea,text);

drop table public.ghl_marketplace_oauth_bootstraps;
drop function public.protect_ghl_marketplace_oauth_bootstrap_v1();

drop trigger protect_ghl_marketplace_installation on public.ghl_marketplace_installations;
create trigger protect_ghl_marketplace_installation
before insert or update on public.ghl_marketplace_installations
for each row execute function public.protect_ghl_marketplace_installation_v3();
drop function public.protect_ghl_marketplace_installation_v4();

alter table public.ghl_marketplace_installations
  drop constraint ghl_marketplace_installations_lifecycle_version_check;
alter table public.ghl_marketplace_installations
  drop column latest_lifecycle_version_id;

drop table public.ghl_marketplace_app_version_registrations;
drop function public.protect_ghl_marketplace_app_version_registration_v1();

grant execute on function public.apply_every8d_ghl_marketplace_lifecycle_v1(
  text,text,text,uuid,text,text,text,timestamptz,text
) to service_role;
grant update (access_token_ciphertext, refresh_token_ciphertext, encryption_key_version,
  token_expires_at, granted_scopes) on public.ghl_marketplace_installations to service_role;

commit;
