-- Guarded C1a rollback. Refuses to discard any evidence that refresh runtime
-- was claimed, failed, finalized, or otherwise advanced beyond the baseline.
begin;
set local lock_timeout = '5s';
lock table public.ghl_marketplace_installations in access exclusive mode;

do $$
begin
  if exists (
    select 1 from public.ghl_marketplace_installations
    where credential_revision > 1
       or refresh_lease_id is not null
       or refresh_started_at is not null
       or refresh_lease_expires_at is not null
       or credential_state in ('refreshing', 'reauth_required')
       or last_refreshed_at is not null
       or refresh_failure_class is not null
       or refresh_failed_at is not null
  ) then
    raise exception 'C1a rollback refused: refresh-runtime evidence exists'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.ghl_marketplace_installations
    where not (
      (credential_state = 'none' and credential_revision in (0, 1)
        and access_token_ciphertext is null and refresh_token_ciphertext is null
        and encryption_key_version is null and token_expires_at is null
        and cardinality(granted_scopes) = 0)
      or
      (credential_state = 'usable' and credential_revision = 1
        and access_token_ciphertext is not null and refresh_token_ciphertext is not null
        and encryption_key_version is not null and token_expires_at is not null
        and cardinality(granted_scopes) > 0)
    )
  ) then
    raise exception 'C1a rollback refused: credential state is not safely representable before C1a'
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function
  public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer),
  public.finalize_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,bytea,bytea,text,timestamptz,text[]),
  public.fail_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,text)
from public, anon, authenticated, service_role;

drop function public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer);
drop function public.finalize_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,bytea,bytea,text,timestamptz,text[]);
drop function public.fail_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,text);

drop trigger protect_ghl_marketplace_installation on public.ghl_marketplace_installations;
create trigger protect_ghl_marketplace_installation
before insert or update on public.ghl_marketplace_installations
for each row execute function public.protect_ghl_marketplace_installation_v4();

drop function public.protect_ghl_marketplace_installation_v5();

drop index public.ghl_marketplace_installations_refresh_lease_key;

alter table public.ghl_marketplace_installations
  drop constraint ghl_marketplace_installations_credential_revision_check,
  drop constraint ghl_marketplace_installations_credential_state_value_check,
  drop constraint ghl_marketplace_installations_refresh_failure_value_check,
  drop constraint ghl_marketplace_installations_refresh_lease_check,
  drop constraint ghl_marketplace_installations_refresh_failure_pair_check,
  drop constraint ghl_marketplace_installations_last_refresh_check,
  drop constraint ghl_marketplace_installations_refresh_state_check,
  drop column credential_revision,
  drop column credential_state,
  drop column refresh_lease_id,
  drop column refresh_started_at,
  drop column refresh_lease_expires_at,
  drop column refresh_failure_class,
  drop column refresh_failed_at,
  drop column last_refreshed_at;

commit;
