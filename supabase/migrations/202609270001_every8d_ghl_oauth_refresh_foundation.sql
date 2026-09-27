-- C1a: database-only foundation for single-use HighLevel OAuth refresh tokens.
-- No runtime refresh, provider activation, external call, or production data change is enabled here.
begin;
set local lock_timeout = '5s';
lock table public.ghl_marketplace_installations in access exclusive mode;

-- Fail before adding state when an existing row is neither credential-free nor a
-- complete, usable Gate-B credential tuple. Existing ciphertext is never read or changed.
do $$
begin
  if exists (
    select 1
    from public.ghl_marketplace_installations i
    where not (
      (
        i.access_token_ciphertext is null
        and i.refresh_token_ciphertext is null
        and i.encryption_key_version is null
        and i.token_expires_at is null
        and cardinality(i.granted_scopes) = 0
      )
      or
      (
        i.access_token_ciphertext is not null
        and octet_length(i.access_token_ciphertext) > 0
        and i.refresh_token_ciphertext is not null
        and octet_length(i.refresh_token_ciphertext) > 0
        and i.encryption_key_version is not null
        and i.encryption_key_version ~ '^[A-Za-z0-9_.-]{1,128}$'
        and i.token_expires_at is not null
        and isfinite(i.token_expires_at)
        and cardinality(i.granted_scopes) > 0
        and not exists (
          select 1 from unnest(i.granted_scopes) granted_scope
          where granted_scope is null or btrim(granted_scope) = ''
        )
      )
    )
  ) then
    raise exception 'C1a preflight rejected a partial OAuth credential tuple'
      using errcode = '23514';
  end if;
end;
$$;

alter table public.ghl_marketplace_installations
  add column credential_revision bigint,
  add column credential_state text,
  add column refresh_lease_id uuid,
  add column refresh_started_at timestamptz,
  add column refresh_lease_expires_at timestamptz,
  add column refresh_failure_class text,
  add column refresh_failed_at timestamptz,
  add column last_refreshed_at timestamptz;

update public.ghl_marketplace_installations
set credential_revision = case when access_token_ciphertext is null then 0 else 1 end,
    credential_state = case when access_token_ciphertext is null then 'none' else 'usable' end;

alter table public.ghl_marketplace_installations
  alter column credential_revision set not null,
  alter column credential_revision set default 0,
  alter column credential_state set not null,
  alter column credential_state set default 'none',
  add constraint ghl_marketplace_installations_credential_revision_check
    check (credential_revision >= 0),
  add constraint ghl_marketplace_installations_credential_state_value_check
    check (credential_state in ('none', 'usable', 'refreshing', 'reauth_required')),
  add constraint ghl_marketplace_installations_refresh_failure_value_check
    check (refresh_failure_class is null or refresh_failure_class in (
      'invalid_grant',
      'token_response_rejected',
      'refresh_outcome_unknown',
      'credential_persistence_failed'
    )),
  add constraint ghl_marketplace_installations_refresh_lease_check
    check (
      (refresh_lease_id is null and refresh_started_at is null and refresh_lease_expires_at is null)
      or (
        refresh_lease_id is not null
        and refresh_started_at is not null and isfinite(refresh_started_at)
        and refresh_lease_expires_at is not null and isfinite(refresh_lease_expires_at)
        and refresh_lease_expires_at > refresh_started_at
        and refresh_lease_expires_at <= refresh_started_at + interval '5 minutes'
      )
    ),
  add constraint ghl_marketplace_installations_refresh_failure_pair_check
    check (
      (refresh_failure_class is null and refresh_failed_at is null)
      or (refresh_failure_class is not null and refresh_failed_at is not null
        and isfinite(refresh_failed_at))
    ),
  add constraint ghl_marketplace_installations_last_refresh_check
    check (last_refreshed_at is null or isfinite(last_refreshed_at)),
  add constraint ghl_marketplace_installations_refresh_state_check
    check (
      (
        credential_state = 'none'
        and access_token_ciphertext is null and refresh_token_ciphertext is null
        and encryption_key_version is null and token_expires_at is null
        and cardinality(granted_scopes) = 0
        and refresh_lease_id is null and refresh_started_at is null
        and refresh_lease_expires_at is null
      )
      or
      (
        credential_state = 'usable'
        and credential_revision > 0
        and access_token_ciphertext is not null and octet_length(access_token_ciphertext) > 0
        and refresh_token_ciphertext is not null and octet_length(refresh_token_ciphertext) > 0
        and encryption_key_version is not null
        and token_expires_at is not null and isfinite(token_expires_at)
        and cardinality(granted_scopes) > 0
        and refresh_lease_id is null and refresh_started_at is null
        and refresh_lease_expires_at is null
        and refresh_failure_class is null and refresh_failed_at is null
      )
      or
      (
        credential_state = 'refreshing'
        and credential_revision > 0
        and access_token_ciphertext is not null and octet_length(access_token_ciphertext) > 0
        and refresh_token_ciphertext is not null and octet_length(refresh_token_ciphertext) > 0
        and encryption_key_version is not null
        and token_expires_at is not null and isfinite(token_expires_at)
        and cardinality(granted_scopes) > 0
        and refresh_lease_id is not null and refresh_started_at is not null
        and refresh_lease_expires_at is not null
        and refresh_failure_class is null and refresh_failed_at is null
      )
      or
      (
        credential_state = 'reauth_required'
        and credential_revision > 0
        and access_token_ciphertext is null and refresh_token_ciphertext is null
        and encryption_key_version is null and token_expires_at is null
        and cardinality(granted_scopes) = 0
        and refresh_lease_id is null and refresh_started_at is null
        and refresh_lease_expires_at is null
        and refresh_failure_class is not null and refresh_failed_at is not null
      )
    );

create unique index ghl_marketplace_installations_refresh_lease_key
  on public.ghl_marketplace_installations(refresh_lease_id)
  where refresh_lease_id is not null;

create function public.protect_ghl_marketplace_installation_v5()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  credential_tuple_changed boolean := false;
  refresh_metadata_unchanged boolean := false;
begin
  if not (
    (new.latest_lifecycle_event_at is null and new.latest_lifecycle_event_id is null
      and new.latest_lifecycle_event_type is null and new.latest_lifecycle_version_id is null)
    or
    (new.latest_lifecycle_event_at is not null and new.latest_lifecycle_event_id is not null
      and new.latest_lifecycle_event_type is not null
      and (
        (new.latest_lifecycle_event_type = 'INTERNAL_BASELINE' and new.latest_lifecycle_version_id is null)
        or (new.latest_lifecycle_event_type in ('INSTALL', 'UNINSTALL')
          and new.latest_lifecycle_version_id is not null)
      ))
  ) then
    raise exception 'marketplace lifecycle watermark/version is invalid' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.latest_lifecycle_event_type = 'INTERNAL_BASELINE' then
    raise exception 'marketplace internal baseline is migration-owned' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if row(new.id, new.app_namespace, new.marketplace_app_id, new.oauth_client_id,
      new.tenant_id, new.location_id, new.conversation_provider_id, new.channel, new.provider, new.created_at)
      is distinct from row(old.id, old.app_namespace, old.marketplace_app_id, old.oauth_client_id,
      old.tenant_id, old.location_id, old.conversation_provider_id, old.channel, old.provider, old.created_at) then
      raise exception 'marketplace installation ownership is immutable' using errcode = '23514';
    end if;
    if old.company_id is not null and new.company_id is distinct from old.company_id then
      raise exception 'marketplace installation company ownership is immutable' using errcode = '23514';
    end if;
    if new.installation_generation::bigint not in
      (old.installation_generation::bigint, old.installation_generation::bigint + 1) then
      raise exception 'marketplace generation must remain unchanged or advance once' using errcode = '23514';
    end if;
    if old.status in ('disabled', 'uninstalled') and new.status in ('pending', 'active')
      and new.installation_generation::bigint <> old.installation_generation::bigint + 1 then
      raise exception 'marketplace reactivation requires a new generation' using errcode = '23514';
    end if;
    if new.latest_lifecycle_event_type = 'INTERNAL_BASELINE'
      and row(new.latest_lifecycle_event_at, new.latest_lifecycle_event_id,
        new.latest_lifecycle_event_type, new.latest_lifecycle_version_id)
        is distinct from row(old.latest_lifecycle_event_at, old.latest_lifecycle_event_id,
          old.latest_lifecycle_event_type, old.latest_lifecycle_version_id) then
      raise exception 'marketplace internal baseline is migration-owned' using errcode = '23514';
    end if;
    if old.latest_lifecycle_event_at is not null then
      if new.latest_lifecycle_event_at is null
        or new.latest_lifecycle_event_at < old.latest_lifecycle_event_at then
        raise exception 'marketplace lifecycle watermark cannot move backward' using errcode = '23514';
      end if;
      if new.latest_lifecycle_event_at = old.latest_lifecycle_event_at
        and row(new.latest_lifecycle_event_id, new.latest_lifecycle_event_type,
          new.latest_lifecycle_version_id)
          is distinct from row(old.latest_lifecycle_event_id, old.latest_lifecycle_event_type,
            old.latest_lifecycle_version_id) then
        raise exception 'marketplace lifecycle equal-time evidence is immutable' using errcode = '23514';
      end if;
    end if;

    credential_tuple_changed := row(
      new.access_token_ciphertext, new.refresh_token_ciphertext,
      new.encryption_key_version, new.token_expires_at, new.granted_scopes
    ) is distinct from row(
      old.access_token_ciphertext, old.refresh_token_ciphertext,
      old.encryption_key_version, old.token_expires_at, old.granted_scopes
    );
    refresh_metadata_unchanged := row(
      new.credential_revision, new.credential_state, new.refresh_lease_id,
      new.refresh_started_at, new.refresh_lease_expires_at,
      new.refresh_failure_class, new.refresh_failed_at, new.last_refreshed_at
    ) is not distinct from row(
      old.credential_revision, old.credential_state, old.refresh_lease_id,
      old.refresh_started_at, old.refresh_lease_expires_at,
      old.refresh_failure_class, old.refresh_failed_at, old.last_refreshed_at
    );

    -- Preserve both deployed authorization-code persistence paths without changing
    -- their SQL/TypeScript signatures. The trigger owns their new metadata.
    if credential_tuple_changed and refresh_metadata_unchanged
      and new.access_token_ciphertext is not null
      and new.refresh_token_ciphertext is not null
      and new.encryption_key_version is not null
      and new.token_expires_at is not null
      and cardinality(new.granted_scopes) > 0
      and new.company_id is not null
      and new.status in ('pending', 'active')
      and new.latest_lifecycle_event_type = 'INSTALL'
      and new.latest_lifecycle_version_id is not null
      and old.credential_state in ('none', 'usable', 'reauth_required') then
      new.credential_revision := old.credential_revision + 1;
      new.credential_state := 'usable';
      new.refresh_lease_id := null;
      new.refresh_started_at := null;
      new.refresh_lease_expires_at := null;
      new.refresh_failure_class := null;
      new.refresh_failed_at := null;
      new.last_refreshed_at := null;
    elsif refresh_metadata_unchanged
      and new.status = 'uninstalled'
      and new.latest_lifecycle_event_type = 'UNINSTALL'
      and new.access_token_ciphertext is null
      and new.refresh_token_ciphertext is null
      and new.encryption_key_version is null
      and new.token_expires_at is null
      and cardinality(new.granted_scopes) = 0 then
      -- Extend lifecycle-v2's existing credential scrub in the same transaction.
      new.credential_state := 'none';
      new.refresh_lease_id := null;
      new.refresh_started_at := null;
      new.refresh_lease_expires_at := null;
      if old.credential_state = 'refreshing' then
        -- UNINSTALL makes authorization unusable, but retain a terminal marker
        -- so rollback cannot erase evidence of an in-flight single-use attempt.
        new.refresh_failure_class := 'refresh_outcome_unknown';
        new.refresh_failed_at := clock_timestamp();
      elsif old.credential_state <> 'reauth_required' then
        new.refresh_failure_class := null;
        new.refresh_failed_at := null;
      end if;
    end if;

    if new.credential_revision not in (old.credential_revision, old.credential_revision + 1) then
      raise exception 'credential revision must remain unchanged or advance exactly once'
        using errcode = '23514';
    end if;
    if new.installation_generation <> old.installation_generation
      and (new.credential_state <> 'none'
        or new.access_token_ciphertext is not null or new.refresh_token_ciphertext is not null
        or new.refresh_lease_id is not null) then
      raise exception 'new installation generation cannot inherit refresh authorization'
        using errcode = '23514';
    end if;
    if old.credential_state = 'refreshing' and new.credential_state = 'usable'
      and new.credential_revision <> old.credential_revision + 1 then
      raise exception 'refresh finalize must advance the credential revision exactly once'
        using errcode = '23514';
    end if;
    if new.credential_state = 'refreshing'
      and (old.credential_state <> 'usable'
        or new.credential_revision <> old.credential_revision) then
      raise exception 'refresh claim requires the current usable credential revision'
        using errcode = '23514';
    end if;
    if old.credential_state = 'refreshing'
      and new.credential_state not in ('refreshing', 'usable', 'reauth_required', 'none') then
      raise exception 'refresh transition is invalid' using errcode = '23514';
    end if;
  end if;

  if new.company_id is null and (
    new.status = 'active' or new.access_token_ciphertext is not null
    or new.refresh_token_ciphertext is not null or new.encryption_key_version is not null
    or new.token_expires_at is not null or cardinality(new.granted_scopes) > 0
    or new.credential_state <> 'none' or new.refresh_lease_id is not null
  ) then
    raise exception 'marketplace installation requires company ownership before activation or credentials'
      using errcode = '23514';
  end if;
  if new.status = 'uninstalled' and (
    new.credential_state <> 'none'
    or new.access_token_ciphertext is not null or new.refresh_token_ciphertext is not null
    or new.refresh_lease_id is not null
  ) then
    raise exception 'uninstalled marketplace installation cannot retain refresh authorization'
      using errcode = '23514';
  end if;
  if new.credential_state in ('usable', 'refreshing') and exists (
    select 1 from unnest(new.granted_scopes) granted_scope
    where granted_scope is null or btrim(granted_scope) = ''
  ) then
    raise exception 'usable OAuth scopes must be non-empty and non-blank'
      using errcode = '23514';
  end if;
  if exists (select 1 from public.tenants t where t.id = new.tenant_id
    and t.ghl_provider_id = new.conversation_provider_id) then
    raise exception 'marketplace provider must differ from the bound tenant LINE provider' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger protect_ghl_marketplace_installation on public.ghl_marketplace_installations;
create trigger protect_ghl_marketplace_installation
before insert or update on public.ghl_marketplace_installations
for each row execute function public.protect_ghl_marketplace_installation_v5();

create function public.claim_every8d_ghl_oauth_refresh_v1(
  input_installation_id uuid,
  input_marketplace_app_id text,
  input_oauth_client_id text,
  input_tenant_id uuid,
  input_location_id text,
  input_company_id text,
  input_conversation_provider_id text,
  input_marketplace_version_id text,
  input_installation_generation integer
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  installation public.ghl_marketplace_installations%rowtype;
  lease_id uuid;
  started_at timestamptz;
begin
  if input_installation_id is null or input_tenant_id is null
    or input_installation_generation is null or input_installation_generation <= 0
    or input_marketplace_app_id is null or input_marketplace_app_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_oauth_client_id is null or char_length(input_oauth_client_id) not between 1 and 256
    or input_oauth_client_id !~ '^[A-Za-z0-9_.-]+$'
    or input_location_id is null or input_location_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_company_id is null or input_company_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_conversation_provider_id is null
    or input_conversation_provider_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_marketplace_version_id is null
    or char_length(input_marketplace_version_id) not between 1 and 256
    or input_marketplace_version_id !~ '^[A-Za-z0-9_.-]+$' then
    return null;
  end if;

  select i.* into installation
  from public.ghl_marketplace_installations i
  join public.ghl_marketplace_app_registrations r
    on r.app_namespace = i.app_namespace
   and r.marketplace_app_id = i.marketplace_app_id
   and r.oauth_client_id = i.oauth_client_id
   and r.conversation_provider_id = i.conversation_provider_id
   and r.channel = i.channel and r.provider = i.provider
  join public.ghl_marketplace_app_version_registrations v
    on v.app_namespace = i.app_namespace
   and v.marketplace_version_id = input_marketplace_version_id
  where i.id = input_installation_id
    and i.app_namespace = 'every8d_connect'
    and i.marketplace_app_id = input_marketplace_app_id
    and i.oauth_client_id = input_oauth_client_id
    and i.tenant_id = input_tenant_id
    and i.location_id = input_location_id
    and i.company_id = input_company_id
    and i.conversation_provider_id = input_conversation_provider_id
    and i.channel = 'sms' and i.provider = 'every8d'
    and i.installation_generation = input_installation_generation
  for update of i;
  if not found then return null; end if;

  if installation.credential_state = 'refreshing'
    and installation.refresh_lease_expires_at <= clock_timestamp() then
    update public.ghl_marketplace_installations
    set credential_state = 'reauth_required',
        access_token_ciphertext = null, refresh_token_ciphertext = null,
        encryption_key_version = null, token_expires_at = null, granted_scopes = '{}',
        refresh_lease_id = null, refresh_started_at = null, refresh_lease_expires_at = null,
        refresh_failure_class = 'refresh_outcome_unknown',
        refresh_failed_at = clock_timestamp()
    where id = installation.id;
    return null;
  end if;

  if installation.status not in ('pending', 'active')
    or installation.latest_lifecycle_event_type is distinct from 'INSTALL'
    or installation.latest_lifecycle_version_id is distinct from input_marketplace_version_id
    or installation.credential_state is distinct from 'usable'
    or installation.access_token_ciphertext is null
    or installation.refresh_token_ciphertext is null
    or installation.encryption_key_version is null
    or installation.token_expires_at is null
    or cardinality(installation.granted_scopes) = 0
    -- Server-owned, fixed due horizon: no caller-provided refresh window.
    or installation.token_expires_at > clock_timestamp() + interval '5 minutes' then
    return null;
  end if;

  lease_id := gen_random_uuid();
  started_at := clock_timestamp();
  update public.ghl_marketplace_installations
  set credential_state = 'refreshing',
      refresh_lease_id = lease_id,
      refresh_started_at = started_at,
      refresh_lease_expires_at = started_at + interval '5 minutes'
  where id = installation.id;

  return jsonb_build_object(
    'installationId', installation.id,
    'installationGeneration', installation.installation_generation,
    'credentialRevision', installation.credential_revision,
    'refreshLeaseId', lease_id,
    'refreshLeaseExpiresAt', started_at + interval '5 minutes',
    'refreshTokenCiphertext', installation.refresh_token_ciphertext,
    'encryptionKeyVersion', installation.encryption_key_version,
    'grantedScopes', to_jsonb(installation.granted_scopes)
  );
end;
$$;

create function public.finalize_every8d_ghl_oauth_refresh_v1(
  input_installation_id uuid,
  input_marketplace_app_id text,
  input_oauth_client_id text,
  input_tenant_id uuid,
  input_location_id text,
  input_company_id text,
  input_conversation_provider_id text,
  input_marketplace_version_id text,
  input_installation_generation integer,
  input_prior_credential_revision bigint,
  input_refresh_lease_id uuid,
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
  installation public.ghl_marketplace_installations%rowtype;
begin
  if input_installation_id is null or input_tenant_id is null
    or input_installation_generation is null or input_installation_generation <= 0
    or input_prior_credential_revision is null or input_prior_credential_revision <= 0
    or input_refresh_lease_id is null
    or input_access_token_ciphertext is null or octet_length(input_access_token_ciphertext) = 0
    or input_refresh_token_ciphertext is null or octet_length(input_refresh_token_ciphertext) = 0
    or input_encryption_key_version is null
    or input_encryption_key_version !~ '^[A-Za-z0-9_.-]{1,128}$'
    or input_token_expires_at is null or not isfinite(input_token_expires_at)
    or input_token_expires_at <= clock_timestamp()
    or input_granted_scopes is null or cardinality(input_granted_scopes) = 0
    or exists (select 1 from unnest(input_granted_scopes) granted_scope
      where granted_scope is null or btrim(granted_scope) = '') then
    return false;
  end if;

  select i.* into installation
  from public.ghl_marketplace_installations i
  join public.ghl_marketplace_app_registrations r
    on r.app_namespace = i.app_namespace
   and r.marketplace_app_id = i.marketplace_app_id
   and r.oauth_client_id = i.oauth_client_id
   and r.conversation_provider_id = i.conversation_provider_id
   and r.channel = i.channel and r.provider = i.provider
  join public.ghl_marketplace_app_version_registrations v
    on v.app_namespace = i.app_namespace
   and v.marketplace_version_id = input_marketplace_version_id
  where i.id = input_installation_id
    and i.app_namespace = 'every8d_connect'
    and i.marketplace_app_id = input_marketplace_app_id
    and i.oauth_client_id = input_oauth_client_id
    and i.tenant_id = input_tenant_id
    and i.location_id = input_location_id
    and i.company_id = input_company_id
    and i.conversation_provider_id = input_conversation_provider_id
    and i.channel = 'sms' and i.provider = 'every8d'
    and i.installation_generation = input_installation_generation
  for update of i;
  if not found then return false; end if;

  if installation.credential_state = 'refreshing'
    and installation.credential_revision = input_prior_credential_revision
    and installation.refresh_lease_id = input_refresh_lease_id
    and installation.refresh_lease_expires_at <= clock_timestamp() then
    update public.ghl_marketplace_installations
    set credential_state = 'reauth_required',
        access_token_ciphertext = null, refresh_token_ciphertext = null,
        encryption_key_version = null, token_expires_at = null, granted_scopes = '{}',
        refresh_lease_id = null, refresh_started_at = null, refresh_lease_expires_at = null,
        refresh_failure_class = 'refresh_outcome_unknown',
        refresh_failed_at = clock_timestamp()
    where id = installation.id;
    return false;
  end if;

  if installation.status not in ('pending', 'active')
    or installation.latest_lifecycle_event_type is distinct from 'INSTALL'
    or installation.latest_lifecycle_version_id is distinct from input_marketplace_version_id
    or installation.credential_state is distinct from 'refreshing'
    or installation.credential_revision is distinct from input_prior_credential_revision
    or installation.refresh_lease_id is distinct from input_refresh_lease_id then
    return false;
  end if;

  update public.ghl_marketplace_installations
  set access_token_ciphertext = input_access_token_ciphertext,
      refresh_token_ciphertext = input_refresh_token_ciphertext,
      encryption_key_version = input_encryption_key_version,
      token_expires_at = input_token_expires_at,
      granted_scopes = input_granted_scopes,
      credential_revision = credential_revision + 1,
      credential_state = 'usable',
      refresh_lease_id = null, refresh_started_at = null, refresh_lease_expires_at = null,
      refresh_failure_class = null, refresh_failed_at = null,
      last_refreshed_at = clock_timestamp()
  where id = installation.id;
  return true;
end;
$$;

create function public.fail_every8d_ghl_oauth_refresh_v1(
  input_installation_id uuid,
  input_marketplace_app_id text,
  input_oauth_client_id text,
  input_tenant_id uuid,
  input_location_id text,
  input_company_id text,
  input_conversation_provider_id text,
  input_marketplace_version_id text,
  input_installation_generation integer,
  input_prior_credential_revision bigint,
  input_refresh_lease_id uuid,
  input_failure_class text
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  installation public.ghl_marketplace_installations%rowtype;
begin
  if input_failure_class is null or input_failure_class not in (
      'invalid_grant', 'token_response_rejected',
      'refresh_outcome_unknown', 'credential_persistence_failed'
    ) then
    return false;
  end if;

  select i.* into installation
  from public.ghl_marketplace_installations i
  join public.ghl_marketplace_app_registrations r
    on r.app_namespace = i.app_namespace
   and r.marketplace_app_id = i.marketplace_app_id
   and r.oauth_client_id = i.oauth_client_id
   and r.conversation_provider_id = i.conversation_provider_id
   and r.channel = i.channel and r.provider = i.provider
  join public.ghl_marketplace_app_version_registrations v
    on v.app_namespace = i.app_namespace
   and v.marketplace_version_id = input_marketplace_version_id
  where i.id = input_installation_id
    and i.app_namespace = 'every8d_connect'
    and i.marketplace_app_id = input_marketplace_app_id
    and i.oauth_client_id = input_oauth_client_id
    and i.tenant_id = input_tenant_id
    and i.location_id = input_location_id
    and i.company_id = input_company_id
    and i.conversation_provider_id = input_conversation_provider_id
    and i.channel = 'sms' and i.provider = 'every8d'
    and i.installation_generation = input_installation_generation
  for update of i;
  if not found
    or installation.status not in ('pending', 'active')
    or installation.latest_lifecycle_event_type is distinct from 'INSTALL'
    or installation.latest_lifecycle_version_id is distinct from input_marketplace_version_id
    or installation.credential_state is distinct from 'refreshing'
    or installation.credential_revision is distinct from input_prior_credential_revision
    or installation.refresh_lease_id is distinct from input_refresh_lease_id then
    return false;
  end if;

  update public.ghl_marketplace_installations
  set credential_state = 'reauth_required',
      access_token_ciphertext = null, refresh_token_ciphertext = null,
      encryption_key_version = null, token_expires_at = null, granted_scopes = '{}',
      refresh_lease_id = null, refresh_started_at = null, refresh_lease_expires_at = null,
      refresh_failure_class = input_failure_class,
      refresh_failed_at = clock_timestamp()
  where id = installation.id;
  return true;
end;
$$;

revoke all on function
  public.protect_ghl_marketplace_installation_v5(),
  public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer),
  public.finalize_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,bytea,bytea,text,timestamptz,text[]),
  public.fail_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,text)
from public, anon, authenticated, service_role;

grant execute on function
  public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer),
  public.finalize_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,bytea,bytea,text,timestamptz,text[]),
  public.fail_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,text)
to service_role;

comment on column public.ghl_marketplace_installations.credential_revision is
  'Monotonic CAS version for the current installation row; refresh finalize advances it exactly once.';
comment on column public.ghl_marketplace_installations.credential_state is
  'Database-authoritative OAuth credential state: none, usable, refreshing, or reauth_required.';
comment on function public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer) is
  'Claims one due credential revision under a row lock with a fixed five-minute lease; expired leases burn the single-use token.';
comment on function public.finalize_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,bytea,bytea,text,timestamptz,text[]) is
  'Exact generation/revision/lease CAS that atomically replaces both encrypted rotating OAuth tokens.';
comment on function public.fail_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,text) is
  'Terminal fail-closed refresh transition with an enumerated sanitized failure class and credential scrub.';

commit;
