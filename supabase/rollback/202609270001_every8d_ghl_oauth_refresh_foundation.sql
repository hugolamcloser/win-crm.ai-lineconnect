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

-- Restore the pre-C1a authorization-code finalizer exactly: same signature,
-- validation, locking, eligibility, credential write, and bootstrap transition.
create or replace function public.finalize_every8d_oauth_exchange_v1(
  input_bootstrap_id uuid,
  input_marketplace_version_id text,
  input_config_fingerprint text,
  input_access_token_ciphertext bytea,
  input_refresh_token_ciphertext bytea,
  input_encryption_key_version text,
  input_token_expires_at timestamptz,
  input_granted_scopes text[]
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  bootstrap_snapshot public.ghl_marketplace_oauth_bootstraps%rowtype;
  bootstrap public.ghl_marketplace_oauth_bootstraps%rowtype;
  installation public.ghl_marketplace_installations%rowtype;
begin
  if input_bootstrap_id is null
    or input_marketplace_version_id is null
    or char_length(input_marketplace_version_id) not between 1 and 256
    or input_marketplace_version_id !~ '^[A-Za-z0-9_.-]+$'
    or input_config_fingerprint is null
    or input_config_fingerprint !~ '^[0-9a-f]{64}$'
    or input_access_token_ciphertext is null
    or octet_length(input_access_token_ciphertext) = 0
    or input_refresh_token_ciphertext is null
    or octet_length(input_refresh_token_ciphertext) = 0
    or input_encryption_key_version is null
    or input_encryption_key_version !~ '^[A-Za-z0-9_.-]{1,128}$'
    or input_token_expires_at is null
    or not isfinite(input_token_expires_at)
    or input_token_expires_at <= clock_timestamp()
    or input_granted_scopes is null
    or cardinality(input_granted_scopes) = 0
    or exists (
      select 1 from unnest(input_granted_scopes) granted_scope
      where granted_scope is null or btrim(granted_scope) = ''
    ) then
    return false;
  end if;

  select * into bootstrap_snapshot from public.ghl_marketplace_oauth_bootstraps
    where id = input_bootstrap_id;
  if not found or bootstrap_snapshot.claimed_installation_id is null then return false; end if;

  select * into installation from public.ghl_marketplace_installations
    where id = bootstrap_snapshot.claimed_installation_id for update;
  select * into bootstrap from public.ghl_marketplace_oauth_bootstraps
    where id = input_bootstrap_id for update;

  if not found or installation.id is null
    or bootstrap.status is distinct from 'exchanging'
    or bootstrap.config_fingerprint is distinct from input_config_fingerprint
    or bootstrap.marketplace_version_id is distinct from input_marketplace_version_id
    or bootstrap.expected_location_id is distinct from installation.location_id
    or bootstrap.target_installation_generation is distinct from installation.installation_generation
    or bootstrap.claimed_installation_id is distinct from installation.id
    or bootstrap.claimed_installation_generation is distinct from installation.installation_generation
    or installation.status not in ('pending', 'active')
    or installation.latest_lifecycle_event_type is distinct from 'INSTALL'
    or installation.latest_lifecycle_version_id is distinct from input_marketplace_version_id
    or not exists (
      select 1 from public.ghl_marketplace_app_version_registrations v
      where v.app_namespace = bootstrap.app_namespace
        and v.marketplace_version_id = input_marketplace_version_id
    ) then
    return false;
  end if;

  update public.ghl_marketplace_installations
  set access_token_ciphertext = input_access_token_ciphertext,
      refresh_token_ciphertext = input_refresh_token_ciphertext,
      encryption_key_version = input_encryption_key_version,
      token_expires_at = input_token_expires_at,
      granted_scopes = input_granted_scopes
  where id = installation.id;

  update public.ghl_marketplace_oauth_bootstraps
  set status = 'succeeded', terminal_at = clock_timestamp(),
      authorization_code_ciphertext = null, authorization_code_key_version = null
  where id = bootstrap.id;
  return true;
end;
$$;

drop index public.ghl_marketplace_installations_refresh_lease_key;

-- Restore the exact pre-C1a table-level installation UPDATE grant. The guarded
-- evidence checks above must pass before this broader historical grant returns.
revoke update (
  access_token_ciphertext,
  refresh_token_ciphertext,
  encryption_key_version,
  token_expires_at,
  granted_scopes
) on public.ghl_marketplace_installations from service_role;
grant update on public.ghl_marketplace_installations to service_role;

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
