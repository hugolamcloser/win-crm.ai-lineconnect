-- C2: durable per-installation EVERY8D provider credential foundation.
-- Database/security boundary only: no runtime resolver, provider activation, or external call.
begin;
set local lock_timeout = '5s';
lock table public.ghl_marketplace_installations in share row exclusive mode;

create table public.every8d_provider_configurations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  installation_generation integer not null,
  site_url text not null,
  timeout_ms integer not null default 10000,
  credential_state text not null,
  uid_ciphertext bytea,
  password_ciphertext bytea,
  encryption_key_version text,
  credential_revision bigint not null,
  safesay_enabled boolean not null default false,
  safesay_event_id text,
  configured_at timestamptz not null default now(),
  replaced_at timestamptz,
  disconnected_at timestamptz,
  last_validation_at timestamptz,
  validation_failure_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint every8d_provider_configurations_installation_fk
    foreign key (installation_id)
    references public.ghl_marketplace_installations(id)
    on update restrict on delete restrict,
  constraint every8d_provider_configurations_installation_generation_key
    unique (installation_id, installation_generation),
  constraint every8d_provider_configurations_generation_check
    check (installation_generation > 0),
  constraint every8d_provider_configurations_site_url_check
    check (site_url = btrim(site_url) and char_length(site_url) between 1 and 2048),
  constraint every8d_provider_configurations_timeout_check
    check (timeout_ms between 100 and 60000),
  constraint every8d_provider_configurations_state_value_check
    check (credential_state in ('configured', 'validated', 'invalid', 'disconnected')),
  constraint every8d_provider_configurations_revision_check
    check (credential_revision > 0),
  constraint every8d_provider_configurations_key_version_check
    check (
      encryption_key_version is null
      or encryption_key_version ~ '^[A-Za-z0-9_.-]{1,128}$'
    ),
  constraint every8d_provider_configurations_failure_class_check
    check (
      validation_failure_class is null
      or (
        validation_failure_class = btrim(validation_failure_class)
        and char_length(validation_failure_class) between 1 and 64
        and validation_failure_class ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'
      )
    ),
  constraint every8d_provider_configurations_safesay_event_check
    check (
      safesay_event_id is null
      or (
        safesay_event_id = btrim(safesay_event_id)
        and char_length(safesay_event_id) between 1 and 256
      )
    ),
  constraint every8d_provider_configurations_safesay_enabled_check
    check (not safesay_enabled or safesay_event_id is not null),
  constraint every8d_provider_configurations_timestamp_check
    check (
      isfinite(configured_at)
      and (replaced_at is null or isfinite(replaced_at))
      and (disconnected_at is null or isfinite(disconnected_at))
      and (last_validation_at is null or isfinite(last_validation_at))
      and isfinite(created_at)
      and isfinite(updated_at)
    ),
  constraint every8d_provider_configurations_state_check
    check (
      (
        credential_state = 'configured'
        and uid_ciphertext is not null and octet_length(uid_ciphertext) > 0
        and password_ciphertext is not null and octet_length(password_ciphertext) > 0
        and encryption_key_version is not null
        and last_validation_at is null
        and validation_failure_class is null
        and disconnected_at is null
      )
      or
      (
        credential_state = 'validated'
        and uid_ciphertext is not null and octet_length(uid_ciphertext) > 0
        and password_ciphertext is not null and octet_length(password_ciphertext) > 0
        and encryption_key_version is not null
        and last_validation_at is not null
        and validation_failure_class is null
        and disconnected_at is null
      )
      or
      (
        credential_state = 'invalid'
        and uid_ciphertext is not null and octet_length(uid_ciphertext) > 0
        and password_ciphertext is not null and octet_length(password_ciphertext) > 0
        and encryption_key_version is not null
        and last_validation_at is not null
        and validation_failure_class is not null
        and disconnected_at is null
      )
      or
      (
        credential_state = 'disconnected'
        and uid_ciphertext is null
        and password_ciphertext is null
        and encryption_key_version is null
        and last_validation_at is null
        and validation_failure_class is null
        and disconnected_at is not null
        and not safesay_enabled
      )
    )
);

create function public.protect_every8d_provider_configuration_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  authority_changed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'EVERY8D provider configurations cannot be deleted'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.credential_state <> 'configured'
      or new.credential_revision <> 1
      or new.uid_ciphertext is null or octet_length(new.uid_ciphertext) = 0
      or new.password_ciphertext is null or octet_length(new.password_ciphertext) = 0
      or new.encryption_key_version is null
      or new.replaced_at is not null
      or new.last_validation_at is not null
      or new.validation_failure_class is not null
      or new.disconnected_at is not null then
      raise exception 'initial EVERY8D provider configuration is invalid'
        using errcode = '23514';
    end if;
  else
    if row(
      new.id, new.installation_id, new.installation_generation,
      new.configured_at, new.created_at
    ) is distinct from row(
      old.id, old.installation_id, old.installation_generation,
      old.configured_at, old.created_at
    ) then
      raise exception 'EVERY8D provider configuration identity is immutable'
        using errcode = '23514';
    end if;

    authority_changed := row(
      new.site_url, new.timeout_ms, new.uid_ciphertext,
      new.password_ciphertext, new.encryption_key_version
    ) is distinct from row(
      old.site_url, old.timeout_ms, old.uid_ciphertext,
      old.password_ciphertext, old.encryption_key_version
    );

    if authority_changed then
      if new.credential_revision <> old.credential_revision + 1 then
        raise exception 'EVERY8D authority change must advance credential revision exactly once'
          using errcode = '23514';
      end if;

      if new.credential_state = 'disconnected' then
        if old.credential_state = 'disconnected'
          or new.site_url is distinct from old.site_url
          or new.timeout_ms is distinct from old.timeout_ms
          or new.uid_ciphertext is not null
          or new.password_ciphertext is not null
          or new.encryption_key_version is not null
          or new.last_validation_at is not null
          or new.validation_failure_class is not null
          or new.disconnected_at is null
          or new.safesay_enabled
          or new.safesay_event_id is distinct from old.safesay_event_id
          or new.replaced_at is distinct from old.replaced_at then
          raise exception 'EVERY8D provider disconnect is invalid'
            using errcode = '23514';
        end if;
      elsif new.credential_state <> 'configured'
        or new.uid_ciphertext is null or octet_length(new.uid_ciphertext) = 0
        or new.password_ciphertext is null or octet_length(new.password_ciphertext) = 0
        or new.encryption_key_version is null
        or new.last_validation_at is not null
        or new.validation_failure_class is not null
        or new.disconnected_at is not null
        or new.replaced_at is null
        or (
          old.replaced_at is null
          and new.replaced_at <= old.configured_at
        )
        or (
          old.replaced_at is not null
          and new.replaced_at <= old.replaced_at
        ) then
        raise exception 'EVERY8D authority replacement is invalid'
          using errcode = '23514';
      end if;
    else
      if new.credential_revision <> old.credential_revision then
        raise exception 'EVERY8D non-authority change cannot advance credential revision'
          using errcode = '23514';
      end if;
      if new.replaced_at is distinct from old.replaced_at then
        raise exception 'EVERY8D replacement timestamp requires an authority change'
          using errcode = '23514';
      end if;
    end if;
  end if;

  if new.credential_state in ('configured', 'validated', 'invalid') then
    perform 1
    from public.ghl_marketplace_installations i
    join public.ghl_marketplace_app_registrations r
      on r.app_namespace = i.app_namespace
     and r.marketplace_app_id = i.marketplace_app_id
     and r.oauth_client_id = i.oauth_client_id
     and r.conversation_provider_id = i.conversation_provider_id
     and r.channel = i.channel
     and r.provider = i.provider
    join public.ghl_marketplace_app_version_registrations v
      on v.app_namespace = i.app_namespace
     and v.marketplace_version_id = i.latest_lifecycle_version_id
    where i.id = new.installation_id
      and i.installation_generation = new.installation_generation
      and i.app_namespace = 'every8d_connect'
      and i.channel = 'sms'
      and i.provider = 'every8d'
      and i.company_id is not null
      and i.latest_lifecycle_event_type = 'INSTALL'
      and i.status in ('pending', 'active')
    for key share of i;

    if not found then
      raise exception 'EVERY8D provider configuration parent is not currently eligible'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger protect_every8d_provider_configuration
before insert or update or delete on public.every8d_provider_configurations
for each row execute function public.protect_every8d_provider_configuration_v1();

create trigger set_every8d_provider_configurations_updated_at
before update on public.every8d_provider_configurations
for each row execute function public.set_updated_at();

create function public.invalidate_every8d_provider_configuration_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.every8d_provider_configurations
  set credential_state = 'disconnected',
      uid_ciphertext = null,
      password_ciphertext = null,
      encryption_key_version = null,
      credential_revision = credential_revision + 1,
      last_validation_at = null,
      validation_failure_class = null,
      disconnected_at = clock_timestamp(),
      safesay_enabled = false
  where installation_id = new.id
    and installation_generation = old.installation_generation
    and credential_state <> 'disconnected';

  if exists (
    select 1
    from public.every8d_provider_configurations c
    where c.installation_id = new.id
      and c.installation_generation = old.installation_generation
      and (
        c.credential_state <> 'disconnected'
        or c.uid_ciphertext is not null
        or c.password_ciphertext is not null
        or c.encryption_key_version is not null
        or c.safesay_enabled
      )
  ) then
    raise exception 'EVERY8D provider configuration lifecycle invalidation failed'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create trigger invalidate_every8d_provider_configuration_after_installation_update
after update of status, installation_generation on public.ghl_marketplace_installations
for each row
when (
  new.status in ('disabled', 'uninstalled')
  or old.installation_generation is distinct from new.installation_generation
)
execute function public.invalidate_every8d_provider_configuration_v1();

alter table public.every8d_provider_configurations enable row level security;
revoke all on public.every8d_provider_configurations
  from public, anon, authenticated, service_role;
grant select on public.every8d_provider_configurations to service_role;

create policy every8d_provider_configurations_service_role_select
on public.every8d_provider_configurations
for select
to service_role
using (true);

revoke all on function
  public.protect_every8d_provider_configuration_v1(),
  public.invalidate_every8d_provider_configuration_v1()
from public, anon, authenticated, service_role;

comment on table public.every8d_provider_configurations is
  'C2 per-installation EVERY8D provider authority. Ciphertext only; no runtime mutation API is granted.';
comment on column public.every8d_provider_configurations.installation_generation is
  'Frozen generation ownership. No credentials are inherited by a later installation generation.';
comment on column public.every8d_provider_configurations.credential_revision is
  'Structural authority revision only; caller expected-revision CAS belongs to C4.';
comment on column public.every8d_provider_configurations.safesay_event_id is
  'Optional non-secret historical SafeSay configuration; no default or runtime behavior is implied.';

commit;
