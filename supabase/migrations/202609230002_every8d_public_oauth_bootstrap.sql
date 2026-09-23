-- Post-D3: default-off public OAuth bootstrap and INSTALL/callback rendezvous.
-- Additive only. This migration does not register a Marketplace version or enable OAuth.
begin;
set local lock_timeout = '5s';
lock table public.ghl_marketplace_installations in access exclusive mode;

create table public.ghl_marketplace_app_version_registrations (
  app_namespace text primary key
    references public.ghl_marketplace_app_registrations(app_namespace)
    on delete restrict on update restrict,
  marketplace_version_id text not null
    check (char_length(marketplace_version_id) between 1 and 256
      and marketplace_version_id ~ '^[A-Za-z0-9_.-]+$'),
  registered_at timestamptz not null default transaction_timestamp()
);

create function public.protect_ghl_marketplace_app_version_registration_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'marketplace app version registration is immutable' using errcode = '23514';
end;
$$;

create trigger protect_ghl_marketplace_app_version_registration
before update or delete on public.ghl_marketplace_app_version_registrations
for each row execute function public.protect_ghl_marketplace_app_version_registration_v1();

alter table public.ghl_marketplace_app_version_registrations enable row level security;
revoke all on public.ghl_marketplace_app_version_registrations
  from public, anon, authenticated, service_role;
revoke all on function public.protect_ghl_marketplace_app_version_registration_v1()
  from public, anon, authenticated, service_role;

alter table public.ghl_marketplace_installations
  add column latest_lifecycle_version_id text
  check (
    latest_lifecycle_version_id is null
    or (char_length(latest_lifecycle_version_id) between 1 and 256
      and latest_lifecycle_version_id ~ '^[A-Za-z0-9_.-]+$')
  );

alter table public.ghl_marketplace_installations
  add constraint ghl_marketplace_installations_lifecycle_version_check
  check (
    (latest_lifecycle_event_type = 'INTERNAL_BASELINE' and latest_lifecycle_version_id is null)
    or (latest_lifecycle_event_type in ('INSTALL', 'UNINSTALL') and latest_lifecycle_version_id is not null)
    or (latest_lifecycle_event_type is null and latest_lifecycle_version_id is null)
  );

create table public.ghl_marketplace_oauth_bootstraps (
  id uuid primary key default gen_random_uuid(),
  app_namespace text not null default 'every8d_connect'
    check (app_namespace = 'every8d_connect'),
  marketplace_version_id text not null
    check (char_length(marketplace_version_id) between 1 and 256
      and marketplace_version_id ~ '^[A-Za-z0-9_.-]+$'),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  browser_binding_hash text not null check (browser_binding_hash ~ '^[0-9a-f]{64}$'),
  redirect_uri text not null check (
    char_length(redirect_uri) <= 2048
    and redirect_uri ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/'
    and redirect_uri !~ '[[:space:]#@]'
  ),
  config_fingerprint text not null check (config_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'awaiting_callback'
    check (status in ('awaiting_callback', 'waiting_install', 'ready', 'exchanging', 'succeeded', 'failed')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  callback_received_at timestamptz,
  authorization_code_ciphertext bytea,
  authorization_code_key_version text,
  claimed_installation_id uuid
    references public.ghl_marketplace_installations(id) on delete restrict on update restrict,
  claimed_installation_generation integer check (claimed_installation_generation > 0),
  exchange_started_at timestamptz,
  terminal_at timestamptz,
  failure_class text check (failure_class in (
    'admission_rejected',
    'bootstrap_expired',
    'authorization_code_invalid',
    'configuration_drift',
    'lifecycle_invalidated',
    'invalid_grant',
    'token_response_rejected',
    'credential_persistence_failed',
    'exchange_outcome_unknown'
  )),
  constraint ghl_marketplace_oauth_bootstraps_expiry_check check (
    isfinite(created_at) and isfinite(expires_at)
    and expires_at > created_at
    and expires_at <= created_at + interval '15 minutes'
  ),
  constraint ghl_marketplace_oauth_bootstraps_code_pair_check check (
    (authorization_code_ciphertext is null and authorization_code_key_version is null)
    or (
      authorization_code_ciphertext is not null
      and octet_length(authorization_code_ciphertext) > 0
      and authorization_code_key_version is not null
      and authorization_code_key_version ~ '^[A-Za-z0-9_.-]{1,128}$'
    )
  ),
  constraint ghl_marketplace_oauth_bootstraps_claim_pair_check check (
    (claimed_installation_id is null and claimed_installation_generation is null)
    or (claimed_installation_id is not null and claimed_installation_generation is not null)
  ),
  constraint ghl_marketplace_oauth_bootstraps_state_check check (
    (
      status = 'awaiting_callback'
      and callback_received_at is null
      and authorization_code_ciphertext is null
      and exchange_started_at is null and terminal_at is null and failure_class is null
    )
    or (
      status = 'waiting_install'
      and callback_received_at is not null
      and authorization_code_ciphertext is not null
      and claimed_installation_id is null
      and exchange_started_at is null and terminal_at is null and failure_class is null
    )
    or (
      status = 'ready'
      and callback_received_at is not null
      and authorization_code_ciphertext is not null
      and claimed_installation_id is not null
      and exchange_started_at is null and terminal_at is null and failure_class is null
    )
    or (
      status = 'exchanging'
      and callback_received_at is not null
      and authorization_code_ciphertext is not null
      and claimed_installation_id is not null
      and exchange_started_at is not null and terminal_at is null and failure_class is null
    )
    or (
      status = 'succeeded'
      and callback_received_at is not null
      and authorization_code_ciphertext is null
      and claimed_installation_id is not null
      and exchange_started_at is not null and terminal_at is not null and failure_class is null
    )
    or (
      status = 'failed'
      and authorization_code_ciphertext is null
      and authorization_code_key_version is null
      and terminal_at is not null and failure_class is not null
    )
  ),
  constraint ghl_marketplace_oauth_bootstraps_timestamp_check check (
    (callback_received_at is null or callback_received_at >= created_at)
    and (exchange_started_at is null or (
      callback_received_at is not null and exchange_started_at >= callback_received_at
    ))
    and (terminal_at is null or terminal_at >= created_at)
  )
);

create index ghl_marketplace_oauth_bootstraps_active_idx
  on public.ghl_marketplace_oauth_bootstraps(app_namespace, config_fingerprint, status, expires_at);
create index ghl_marketplace_oauth_bootstraps_claim_idx
  on public.ghl_marketplace_oauth_bootstraps(claimed_installation_id, claimed_installation_generation);
create index ghl_marketplace_oauth_bootstraps_binding_idx
  on public.ghl_marketplace_oauth_bootstraps(browser_binding_hash, created_at desc);

create function public.protect_ghl_marketplace_oauth_bootstrap_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'awaiting_callback'
      or new.callback_received_at is not null
      or new.authorization_code_ciphertext is not null
      or new.claimed_installation_id is not null
      or new.exchange_started_at is not null
      or new.terminal_at is not null
      or new.failure_class is not null then
      raise exception 'OAuth bootstrap must start awaiting callback' using errcode = '23514';
    end if;
    return new;
  end if;

  if row(new.id, new.app_namespace, new.marketplace_version_id, new.state_hash,
    new.browser_binding_hash, new.redirect_uri, new.config_fingerprint,
    new.created_at, new.expires_at)
    is distinct from
    row(old.id, old.app_namespace, old.marketplace_version_id, old.state_hash,
    old.browser_binding_hash, old.redirect_uri, old.config_fingerprint,
    old.created_at, old.expires_at) then
    raise exception 'OAuth bootstrap context is immutable' using errcode = '23514';
  end if;

  if old.claimed_installation_id is not null and
    row(new.claimed_installation_id, new.claimed_installation_generation)
      is distinct from row(old.claimed_installation_id, old.claimed_installation_generation) then
    raise exception 'OAuth bootstrap installation claim is immutable' using errcode = '23514';
  end if;
  if old.callback_received_at is not null
    and new.callback_received_at is distinct from old.callback_received_at then
    raise exception 'OAuth bootstrap callback evidence is immutable' using errcode = '23514';
  end if;
  if old.exchange_started_at is not null
    and new.exchange_started_at is distinct from old.exchange_started_at then
    raise exception 'OAuth bootstrap exchange evidence is immutable' using errcode = '23514';
  end if;
  if old.terminal_at is not null
    and row(new.status, new.terminal_at, new.failure_class)
      is distinct from row(old.status, old.terminal_at, old.failure_class) then
    raise exception 'OAuth bootstrap terminal evidence is immutable' using errcode = '23514';
  end if;

  if not (
    (old.status = 'awaiting_callback' and new.status in ('awaiting_callback', 'waiting_install', 'ready', 'failed'))
    or (old.status = 'waiting_install' and new.status in ('ready', 'failed'))
    or (old.status = 'ready' and new.status in ('exchanging', 'failed'))
    or (old.status = 'exchanging' and new.status in ('succeeded', 'failed'))
    or (old.status in ('succeeded', 'failed') and new.status = old.status)
  ) then
    raise exception 'OAuth bootstrap status transition is invalid' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger protect_ghl_marketplace_oauth_bootstrap
before insert or update on public.ghl_marketplace_oauth_bootstraps
for each row execute function public.protect_ghl_marketplace_oauth_bootstrap_v1();

alter table public.ghl_marketplace_oauth_bootstraps enable row level security;
revoke all on public.ghl_marketplace_oauth_bootstraps
  from public, anon, authenticated, service_role;
revoke all on function public.protect_ghl_marketplace_oauth_bootstrap_v1()
  from public, anon, authenticated, service_role;

create function public.protect_ghl_marketplace_installation_v4()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
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
  end if;
  if new.company_id is null and (
    new.status = 'active' or new.access_token_ciphertext is not null
    or new.refresh_token_ciphertext is not null or new.encryption_key_version is not null
    or new.token_expires_at is not null or cardinality(new.granted_scopes) > 0
  ) then
    raise exception 'marketplace installation requires company ownership before activation or credentials'
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
for each row execute function public.protect_ghl_marketplace_installation_v4();

create function public.create_every8d_public_oauth_bootstrap_v1(
  input_marketplace_app_id text,
  input_oauth_client_id text,
  input_conversation_provider_id text,
  input_marketplace_version_id text,
  input_state_hash text,
  input_browser_binding_hash text,
  input_redirect_uri text,
  input_config_fingerprint text,
  input_ttl_seconds integer
)
returns table(id uuid, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  registration public.ghl_marketplace_app_registrations%rowtype;
  approved_version public.ghl_marketplace_app_version_registrations%rowtype;
  created_at_value timestamptz := clock_timestamp();
begin
  if input_state_hash !~ '^[0-9a-f]{64}$'
    or input_browser_binding_hash !~ '^[0-9a-f]{64}$'
    or input_config_fingerprint !~ '^[0-9a-f]{64}$'
    or input_ttl_seconds is null or input_ttl_seconds < 60 or input_ttl_seconds > 900 then
    raise exception 'OAuth bootstrap request is invalid' using errcode = '23514';
  end if;

  select * into registration from public.ghl_marketplace_app_registrations
    where app_namespace = 'every8d_connect';
  select * into approved_version from public.ghl_marketplace_app_version_registrations
    where app_namespace = 'every8d_connect';
  if not found
    or registration.marketplace_app_id <> input_marketplace_app_id
    or registration.oauth_client_id <> input_oauth_client_id
    or registration.conversation_provider_id <> input_conversation_provider_id
    or registration.channel <> 'sms' or registration.provider <> 'every8d'
    or approved_version.marketplace_version_id <> input_marketplace_version_id then
    raise exception 'OAuth bootstrap registration is not approved' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('every8d_public_oauth_bootstrap_admission_v1', 0));

  update public.ghl_marketplace_oauth_bootstraps b
  set status = 'failed', terminal_at = clock_timestamp(), failure_class = 'bootstrap_expired',
      authorization_code_ciphertext = null, authorization_code_key_version = null
  where b.status in ('awaiting_callback', 'waiting_install', 'ready')
    and b.expires_at <= clock_timestamp();

  update public.ghl_marketplace_oauth_bootstraps b
  set status = 'failed', terminal_at = clock_timestamp(), failure_class = 'exchange_outcome_unknown',
      authorization_code_ciphertext = null, authorization_code_key_version = null
  where b.status = 'exchanging'
    and b.exchange_started_at <= clock_timestamp() - interval '2 minutes';

  if (select count(*) from public.ghl_marketplace_oauth_bootstraps
      where status in ('awaiting_callback', 'waiting_install', 'ready', 'exchanging')) >= 32
    or exists (
      select 1 from public.ghl_marketplace_oauth_bootstraps
      where app_namespace = 'every8d_connect'
        and status in ('awaiting_callback', 'waiting_install', 'ready', 'exchanging')
    ) then
    raise exception 'OAuth bootstrap admission rejected' using errcode = 'P0001';
  end if;

  return query
  insert into public.ghl_marketplace_oauth_bootstraps (
    app_namespace, marketplace_version_id, state_hash, browser_binding_hash,
    redirect_uri, config_fingerprint, status, created_at, expires_at
  ) values (
    'every8d_connect', input_marketplace_version_id, input_state_hash,
    input_browser_binding_hash, input_redirect_uri, input_config_fingerprint,
    'awaiting_callback', created_at_value,
    created_at_value + make_interval(secs => input_ttl_seconds)
  ) returning ghl_marketplace_oauth_bootstraps.id, ghl_marketplace_oauth_bootstraps.expires_at;
end;
$$;

create function public.inspect_every8d_public_oauth_callback_v1(
  input_state_hash text,
  input_browser_binding_hash text,
  input_redirect_uri text,
  input_config_fingerprint text
)
returns table(
  id uuid,
  app_namespace text,
  marketplace_version_id text,
  state_hash text,
  redirect_uri text,
  config_fingerprint text
)
language sql security definer
set search_path = pg_catalog, public
as $$
  select b.id, b.app_namespace, b.marketplace_version_id, b.state_hash,
    b.redirect_uri, b.config_fingerprint
  from public.ghl_marketplace_oauth_bootstraps b
  join public.ghl_marketplace_app_version_registrations v
    on v.app_namespace = b.app_namespace
   and v.marketplace_version_id = b.marketplace_version_id
  where b.state_hash = input_state_hash
    and b.browser_binding_hash = input_browser_binding_hash
    and b.redirect_uri = input_redirect_uri
    and b.config_fingerprint = input_config_fingerprint
    and b.status = 'awaiting_callback'
    and b.expires_at > clock_timestamp();
$$;

create function public.accept_every8d_public_oauth_callback_v1(
  input_bootstrap_id uuid,
  input_state_hash text,
  input_browser_binding_hash text,
  input_redirect_uri text,
  input_config_fingerprint text,
  input_authorization_code_ciphertext bytea,
  input_authorization_code_key_version text
)
returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  bootstrap public.ghl_marketplace_oauth_bootstraps%rowtype;
begin
  select * into bootstrap from public.ghl_marketplace_oauth_bootstraps
    where id = input_bootstrap_id for update;
  if not found or bootstrap.status <> 'awaiting_callback'
    or bootstrap.state_hash <> input_state_hash
    or bootstrap.browser_binding_hash <> input_browser_binding_hash
    or bootstrap.redirect_uri <> input_redirect_uri
    or bootstrap.config_fingerprint <> input_config_fingerprint
    or bootstrap.expires_at <= clock_timestamp()
    or not exists (
      select 1 from public.ghl_marketplace_app_version_registrations v
      where v.app_namespace = bootstrap.app_namespace
        and v.marketplace_version_id = bootstrap.marketplace_version_id
    ) then
    return null;
  end if;
  if input_authorization_code_ciphertext is null
    or octet_length(input_authorization_code_ciphertext) = 0
    or input_authorization_code_key_version !~ '^[A-Za-z0-9_.-]{1,128}$' then
    return null;
  end if;

  update public.ghl_marketplace_oauth_bootstraps
  set callback_received_at = clock_timestamp(),
      authorization_code_ciphertext = input_authorization_code_ciphertext,
      authorization_code_key_version = input_authorization_code_key_version,
      status = case when claimed_installation_id is null then 'waiting_install' else 'ready' end
  where id = bootstrap.id
  returning status into bootstrap.status;
  return bootstrap.status;
end;
$$;

create function public.apply_every8d_ghl_marketplace_lifecycle_v2(
  input_event_type text,
  input_marketplace_app_id text,
  input_oauth_client_id text,
  input_tenant_id uuid,
  input_location_id text,
  input_company_id text,
  input_conversation_provider_id text,
  input_marketplace_version_id text,
  input_event_at timestamptz,
  input_event_id text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  registration public.ghl_marketplace_app_registrations%rowtype;
  approved_version public.ghl_marketplace_app_version_registrations%rowtype;
  bound public.ghl_marketplace_installations%rowtype;
  inserted boolean := false;
  lifecycle_outcome text := 'applied';
begin
  if input_event_type is null or input_event_type not in ('INSTALL', 'UNINSTALL')
    or input_marketplace_app_id is null or input_marketplace_app_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_oauth_client_id is null or char_length(input_oauth_client_id) not between 1 and 256
    or input_oauth_client_id !~ '^[A-Za-z0-9_.-]+$'
    or input_location_id is null or input_location_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_conversation_provider_id is null
    or input_conversation_provider_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_marketplace_version_id is null
    or char_length(input_marketplace_version_id) not between 1 and 256
    or input_marketplace_version_id !~ '^[A-Za-z0-9_.-]+$'
    or input_event_at is null or not isfinite(input_event_at)
    or input_event_id is null or char_length(input_event_id) not between 1 and 256
    or input_event_id !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'marketplace lifecycle evidence is invalid' using errcode = '23514';
  end if;

  select * into registration from public.ghl_marketplace_app_registrations
    where app_namespace = 'every8d_connect';
  select * into approved_version from public.ghl_marketplace_app_version_registrations
    where app_namespace = 'every8d_connect';
  if not found
    or registration.marketplace_app_id <> input_marketplace_app_id
    or registration.oauth_client_id <> input_oauth_client_id
    or registration.conversation_provider_id <> input_conversation_provider_id
    or registration.channel <> 'sms' or registration.provider <> 'every8d'
    or approved_version.marketplace_version_id <> input_marketplace_version_id then
    raise exception 'marketplace lifecycle identity/version is not registered' using errcode = '23514';
  end if;

  if input_event_type = 'INSTALL' then
    if input_tenant_id is null or input_company_id is null
      or input_company_id !~ '^[A-Za-z0-9_-]{1,128}$' then
      raise exception 'marketplace INSTALL ownership evidence is invalid' using errcode = '23514';
    end if;
    if not exists (select 1 from public.tenants t
      where t.id = input_tenant_id and t.location_id = input_location_id) then
      raise exception 'marketplace lifecycle tenant ownership is not exact' using errcode = '23503';
    end if;

    insert into public.ghl_marketplace_installations (
      app_namespace, marketplace_app_id, oauth_client_id, tenant_id, location_id,
      company_id, conversation_provider_id, channel, provider, status,
      latest_lifecycle_event_at, latest_lifecycle_event_id, latest_lifecycle_event_type,
      latest_lifecycle_version_id
    ) values (
      registration.app_namespace, registration.marketplace_app_id, registration.oauth_client_id,
      input_tenant_id, input_location_id, input_company_id, registration.conversation_provider_id,
      registration.channel, registration.provider, 'pending', input_event_at, input_event_id,
      input_event_type, approved_version.marketplace_version_id
    ) on conflict (marketplace_app_id, location_id) do nothing
    returning * into bound;
    inserted := found;

    if not inserted then
      select * into bound from public.ghl_marketplace_installations
      where marketplace_app_id = registration.marketplace_app_id
        and location_id = input_location_id
      for update;
    end if;

    if not found
      or bound.app_namespace <> registration.app_namespace
      or bound.oauth_client_id <> registration.oauth_client_id
      or bound.tenant_id <> input_tenant_id
      or bound.conversation_provider_id <> registration.conversation_provider_id
      or bound.channel <> registration.channel or bound.provider <> registration.provider
      or (bound.company_id is not null and bound.company_id <> input_company_id) then
      raise exception 'marketplace lifecycle ownership conflicted' using errcode = '23514';
    end if;
  else
    if input_tenant_id is not null or input_company_id is not null then
      raise exception 'marketplace UNINSTALL evidence must use stored ownership' using errcode = '23514';
    end if;
    select * into bound from public.ghl_marketplace_installations
    where app_namespace = registration.app_namespace
      and marketplace_app_id = registration.marketplace_app_id
      and oauth_client_id = registration.oauth_client_id
      and location_id = input_location_id
      and company_id is not null
      and conversation_provider_id = registration.conversation_provider_id
      and channel = registration.channel and provider = registration.provider
    for update;
    if not found then
      raise exception 'marketplace lifecycle ownership conflicted' using errcode = '23514';
    end if;
  end if;

  if not inserted and bound.latest_lifecycle_event_at is not null then
    if input_event_at < bound.latest_lifecycle_event_at then
      lifecycle_outcome := 'stale_ignored';
      return jsonb_build_object('outcome', lifecycle_outcome, 'installation', to_jsonb(bound));
    end if;
    if input_event_at = bound.latest_lifecycle_event_at then
      if input_event_id <> bound.latest_lifecycle_event_id
        or input_event_type <> bound.latest_lifecycle_event_type
        or input_marketplace_version_id is distinct from bound.latest_lifecycle_version_id then
        raise exception 'marketplace lifecycle chronology is ambiguous' using errcode = '23514';
      end if;
      lifecycle_outcome := 'exact_replay';
      return jsonb_build_object('outcome', lifecycle_outcome, 'installation', to_jsonb(bound));
    end if;
  end if;

  if input_event_type = 'INSTALL' and not inserted then
    update public.ghl_marketplace_installations
    set company_id = coalesce(company_id, input_company_id),
        status = case when status in ('disabled', 'uninstalled') then 'pending' else status end,
        installation_generation = case
          when status in ('disabled', 'uninstalled') then installation_generation + 1
          else installation_generation end,
        latest_lifecycle_event_at = input_event_at,
        latest_lifecycle_event_id = input_event_id,
        latest_lifecycle_event_type = input_event_type,
        latest_lifecycle_version_id = approved_version.marketplace_version_id
    where id = bound.id returning * into bound;
  elsif input_event_type = 'UNINSTALL' then
    update public.ghl_marketplace_installations
    set status = 'uninstalled',
        installation_generation = case
          when status = 'uninstalled' then installation_generation
          else installation_generation + 1 end,
        access_token_ciphertext = null, refresh_token_ciphertext = null,
        encryption_key_version = null, token_expires_at = null, granted_scopes = '{}',
        latest_lifecycle_event_at = input_event_at,
        latest_lifecycle_event_id = input_event_id,
        latest_lifecycle_event_type = input_event_type,
        latest_lifecycle_version_id = approved_version.marketplace_version_id
    where id = bound.id returning * into bound;
  end if;

  if input_event_type = 'INSTALL' then
    update public.ghl_marketplace_oauth_bootstraps
    set claimed_installation_id = bound.id,
        claimed_installation_generation = bound.installation_generation,
        status = case when status = 'waiting_install' then 'ready' else status end
    where id = (
      select b.id from public.ghl_marketplace_oauth_bootstraps b
      where b.app_namespace = registration.app_namespace
        and b.marketplace_version_id = approved_version.marketplace_version_id
        and b.status in ('awaiting_callback', 'waiting_install')
        and b.claimed_installation_id is null
        and b.expires_at > clock_timestamp()
      order by b.created_at
      for update skip locked
      limit 1
    );
  else
    update public.ghl_marketplace_oauth_bootstraps
    set status = 'failed', terminal_at = clock_timestamp(), failure_class = 'lifecycle_invalidated',
        authorization_code_ciphertext = null, authorization_code_key_version = null
    where app_namespace = registration.app_namespace
      and status in ('awaiting_callback', 'waiting_install', 'ready', 'exchanging')
      and (claimed_installation_id is null or claimed_installation_id = bound.id);
  end if;

  return jsonb_build_object('outcome', lifecycle_outcome, 'installation', to_jsonb(bound));
end;
$$;

create function public.list_every8d_oauth_recoverable_v1(
  input_marketplace_version_id text,
  input_config_fingerprint text,
  input_limit integer
)
returns setof uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if input_config_fingerprint !~ '^[0-9a-f]{64}$'
    or input_limit is null or input_limit < 1 or input_limit > 16
    or not exists (
      select 1 from public.ghl_marketplace_app_version_registrations v
      where v.app_namespace = 'every8d_connect'
        and v.marketplace_version_id = input_marketplace_version_id
    ) then
    return;
  end if;

  update public.ghl_marketplace_oauth_bootstraps
  set status = 'failed', terminal_at = clock_timestamp(), failure_class = 'bootstrap_expired',
      authorization_code_ciphertext = null, authorization_code_key_version = null
  where status in ('awaiting_callback', 'waiting_install', 'ready')
    and expires_at <= clock_timestamp();

  update public.ghl_marketplace_oauth_bootstraps
  set status = 'failed', terminal_at = clock_timestamp(), failure_class = 'exchange_outcome_unknown',
      authorization_code_ciphertext = null, authorization_code_key_version = null
  where status = 'exchanging'
    and exchange_started_at <= clock_timestamp() - interval '2 minutes';

  return query select b.id from public.ghl_marketplace_oauth_bootstraps b
  where b.marketplace_version_id = input_marketplace_version_id
    and b.config_fingerprint = input_config_fingerprint
    and b.status = 'ready' and b.expires_at > clock_timestamp()
  order by b.created_at
  limit input_limit;
end;
$$;

create function public.claim_every8d_oauth_exchange_v1(
  input_bootstrap_id uuid,
  input_marketplace_version_id text,
  input_config_fingerprint text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  bootstrap_snapshot public.ghl_marketplace_oauth_bootstraps%rowtype;
  bootstrap public.ghl_marketplace_oauth_bootstraps%rowtype;
  installation public.ghl_marketplace_installations%rowtype;
begin
  select * into bootstrap_snapshot from public.ghl_marketplace_oauth_bootstraps
    where id = input_bootstrap_id;
  if not found or bootstrap_snapshot.claimed_installation_id is null then return null; end if;

  select * into installation from public.ghl_marketplace_installations
    where id = bootstrap_snapshot.claimed_installation_id for update;
  select * into bootstrap from public.ghl_marketplace_oauth_bootstraps
    where id = input_bootstrap_id for update;

  if not found or bootstrap.status <> 'ready'
    or bootstrap.config_fingerprint <> input_config_fingerprint
    or bootstrap.marketplace_version_id <> input_marketplace_version_id
    or bootstrap.expires_at <= clock_timestamp()
    or bootstrap.claimed_installation_id <> installation.id
    or bootstrap.claimed_installation_generation <> installation.installation_generation
    or installation.status not in ('pending', 'active')
    or installation.latest_lifecycle_event_type <> 'INSTALL'
    or installation.latest_lifecycle_version_id <> input_marketplace_version_id
    or not exists (
      select 1 from public.ghl_marketplace_app_version_registrations v
      where v.app_namespace = bootstrap.app_namespace
        and v.marketplace_version_id = input_marketplace_version_id
    ) then
    return null;
  end if;

  update public.ghl_marketplace_oauth_bootstraps
  set status = 'exchanging', exchange_started_at = clock_timestamp()
  where id = bootstrap.id returning * into bootstrap;

  return jsonb_build_object('bootstrap', to_jsonb(bootstrap), 'installation', to_jsonb(installation));
end;
$$;

create function public.fail_every8d_oauth_bootstrap_v1(
  input_bootstrap_id uuid,
  input_failure_class text
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if input_failure_class not in (
    'bootstrap_expired', 'authorization_code_invalid', 'configuration_drift',
    'lifecycle_invalidated', 'invalid_grant', 'token_response_rejected',
    'credential_persistence_failed', 'exchange_outcome_unknown'
  ) then return false; end if;

  update public.ghl_marketplace_oauth_bootstraps
  set status = 'failed', terminal_at = clock_timestamp(), failure_class = input_failure_class,
      authorization_code_ciphertext = null, authorization_code_key_version = null
  where id = input_bootstrap_id
    and status in ('awaiting_callback', 'waiting_install', 'ready', 'exchanging');
  return found;
end;
$$;

create function public.finalize_every8d_oauth_exchange_v1(
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
  select * into bootstrap_snapshot from public.ghl_marketplace_oauth_bootstraps
    where id = input_bootstrap_id;
  if not found or bootstrap_snapshot.claimed_installation_id is null then return false; end if;

  select * into installation from public.ghl_marketplace_installations
    where id = bootstrap_snapshot.claimed_installation_id for update;
  select * into bootstrap from public.ghl_marketplace_oauth_bootstraps
    where id = input_bootstrap_id for update;

  if not found or bootstrap.status <> 'exchanging'
    or bootstrap.config_fingerprint <> input_config_fingerprint
    or bootstrap.marketplace_version_id <> input_marketplace_version_id
    or bootstrap.claimed_installation_id <> installation.id
    or bootstrap.claimed_installation_generation <> installation.installation_generation
    or installation.status not in ('pending', 'active')
    or installation.latest_lifecycle_event_type <> 'INSTALL'
    or installation.latest_lifecycle_version_id <> input_marketplace_version_id
    or not exists (
      select 1 from public.ghl_marketplace_app_version_registrations v
      where v.app_namespace = bootstrap.app_namespace
        and v.marketplace_version_id = input_marketplace_version_id
    )
    or input_access_token_ciphertext is null or octet_length(input_access_token_ciphertext) = 0
    or input_refresh_token_ciphertext is null or octet_length(input_refresh_token_ciphertext) = 0
    or input_encryption_key_version !~ '^[A-Za-z0-9_.-]{1,128}$'
    or input_token_expires_at <= clock_timestamp()
    or input_granted_scopes is null or cardinality(input_granted_scopes) = 0 then
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

create function public.get_every8d_oauth_bootstrap_status_v1(
  input_browser_binding_hash text,
  input_config_fingerprint text
)
returns text
language sql security definer
set search_path = pg_catalog, public
as $$
  select b.status from public.ghl_marketplace_oauth_bootstraps b
  where b.browser_binding_hash = input_browser_binding_hash
    and b.config_fingerprint = input_config_fingerprint
  order by b.created_at desc limit 1;
$$;

-- The old unordered lifecycle RPC is no longer a runtime path. The narrowly
-- filtered installed/reconnect OAuth path retains its existing credential-column
-- grant; the public bootstrap finalizes only through the atomic RPC below.
revoke execute on function public.apply_every8d_ghl_marketplace_lifecycle_v1(
  text,text,text,uuid,text,text,text,timestamptz,text
) from service_role;

revoke all on function public.protect_ghl_marketplace_installation_v4(),
  public.create_every8d_public_oauth_bootstrap_v1(text,text,text,text,text,text,text,text,integer),
  public.inspect_every8d_public_oauth_callback_v1(text,text,text,text),
  public.accept_every8d_public_oauth_callback_v1(uuid,text,text,text,text,bytea,text),
  public.apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamptz,text),
  public.list_every8d_oauth_recoverable_v1(text,text,integer),
  public.claim_every8d_oauth_exchange_v1(uuid,text,text),
  public.fail_every8d_oauth_bootstrap_v1(uuid,text),
  public.finalize_every8d_oauth_exchange_v1(uuid,text,text,bytea,bytea,text,timestamptz,text[]),
  public.get_every8d_oauth_bootstrap_status_v1(text,text)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_every8d_public_oauth_bootstrap_v1(text,text,text,text,text,text,text,text,integer),
  public.inspect_every8d_public_oauth_callback_v1(text,text,text,text),
  public.accept_every8d_public_oauth_callback_v1(uuid,text,text,text,text,bytea,text),
  public.apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamptz,text),
  public.list_every8d_oauth_recoverable_v1(text,text,integer),
  public.claim_every8d_oauth_exchange_v1(uuid,text,text),
  public.fail_every8d_oauth_bootstrap_v1(uuid,text),
  public.finalize_every8d_oauth_exchange_v1(uuid,text,text,bytea,bytea,text,timestamptz,text[]),
  public.get_every8d_oauth_bootstrap_status_v1(text,text)
to service_role;

comment on table public.ghl_marketplace_app_version_registrations is
  'Owner-only immutable approved signed HighLevel Marketplace version. The migration intentionally inserts no value.';
comment on table public.ghl_marketplace_oauth_bootstraps is
  'Ownership-free, hash-bound public first-install OAuth rendezvous. No browser-supplied tenant/location/company ownership.';
comment on column public.ghl_marketplace_installations.latest_lifecycle_version_id is
  'Exact owner-approved Marketplace version from current signed INSTALL/UNINSTALL evidence; null only for pre-feature baselines.';
comment on function public.apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamptz,text) is
  'Ordered signed lifecycle boundary returning applied/exact_replay/stale_ignored and atomically rendezvousing or invalidating OAuth attempts.';

commit;
