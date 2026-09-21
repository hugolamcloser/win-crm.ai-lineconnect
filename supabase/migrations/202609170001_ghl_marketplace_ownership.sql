-- Phase 2G-A: ownership foundation only. No seeds, routes, or send permission.
begin;
set local lock_timeout = '5s';

-- Deliberately fail on reapplication/partial schema instead of accepting drift.
alter table public.tenants
  add constraint tenants_marketplace_id_location_key unique (id, location_id);

create table public.ghl_marketplace_installations (
  id uuid primary key default gen_random_uuid(),
  app_namespace text not null default 'every8d_connect' check (app_namespace = 'every8d_connect'),
  marketplace_app_id text not null check (marketplace_app_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  oauth_client_id text not null check (char_length(oauth_client_id) between 1 and 256 and oauth_client_id ~ '^[A-Za-z0-9_.-]+$'),
  tenant_id uuid not null,
  location_id text not null check (location_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  conversation_provider_id text not null check (conversation_provider_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  channel text not null default 'sms' check (channel = 'sms'),
  provider text not null default 'every8d' check (provider = 'every8d'),
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled', 'uninstalled')),
  installation_generation integer not null default 1 check (installation_generation > 0),
  access_token_ciphertext bytea,
  refresh_token_ciphertext bytea,
  encryption_key_version text,
  token_expires_at timestamptz,
  granted_scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ghl_marketplace_installations_app_location_key unique (marketplace_app_id, location_id),
  constraint ghl_marketplace_installations_tenant_location_fkey
    foreign key (tenant_id, location_id) references public.tenants(id, location_id) on delete restrict on update restrict,
  constraint ghl_marketplace_installations_credentials_check check (
    (access_token_ciphertext is null and refresh_token_ciphertext is null
      and encryption_key_version is null and token_expires_at is null and cardinality(granted_scopes) = 0)
    or (access_token_ciphertext is not null and octet_length(access_token_ciphertext) > 0
      and refresh_token_ciphertext is not null and octet_length(refresh_token_ciphertext) > 0
      and encryption_key_version is not null and encryption_key_version ~ '^[A-Za-z0-9_.-]{1,128}$'
      and token_expires_at is not null)
  )
);

create function public.protect_ghl_marketplace_installation_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.id, new.app_namespace, new.marketplace_app_id, new.oauth_client_id,
      new.tenant_id, new.location_id, new.conversation_provider_id, new.channel, new.provider, new.created_at)
      is distinct from row(old.id, old.app_namespace, old.marketplace_app_id, old.oauth_client_id,
      old.tenant_id, old.location_id, old.conversation_provider_id, old.channel, old.provider, old.created_at) then
      raise exception 'marketplace installation ownership is immutable' using errcode = '23514';
    end if;
    if new.installation_generation::bigint not in (old.installation_generation::bigint, old.installation_generation::bigint + 1) then
      raise exception 'marketplace generation must remain unchanged or advance once' using errcode = '23514';
    end if;
    if old.status in ('disabled', 'uninstalled') and new.status in ('pending', 'active')
      and new.installation_generation::bigint <> old.installation_generation::bigint + 1 then
      raise exception 'marketplace reactivation requires a new generation' using errcode = '23514';
    end if;
  end if;
  -- Read the exact tenant only; do not use the LINE tenant resolver or token table.
  if exists (select 1 from public.tenants t where t.id = new.tenant_id
    and t.ghl_provider_id = new.conversation_provider_id) then
    raise exception 'marketplace provider must differ from the bound tenant LINE provider' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger protect_ghl_marketplace_installation
before insert or update on public.ghl_marketplace_installations
for each row execute function public.protect_ghl_marketplace_installation_v1();
create trigger set_ghl_marketplace_installations_updated_at
before update on public.ghl_marketplace_installations
for each row execute function public.set_updated_at();

create table public.ghl_marketplace_oauth_states (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.ghl_marketplace_installations(id) on delete restrict on update restrict,
  installation_generation integer not null check (installation_generation > 0),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  browser_binding_hash text not null check (browser_binding_hash ~ '^[0-9a-f]{64}$'),
  -- Structural guard only. Exact configured URI comparison belongs to the future callback.
  redirect_uri text not null check (char_length(redirect_uri) <= 2048
    and redirect_uri ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/' and redirect_uri !~ '[[:space:]#@]'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  constraint ghl_marketplace_oauth_states_lifecycle_check check (
    expires_at > created_at and expires_at <= created_at + interval '15 minutes'
    and not (consumed_at is not null and revoked_at is not null)
    and (consumed_at is null or (consumed_at >= created_at and consumed_at < expires_at))
    and (revoked_at is null or revoked_at >= created_at)
  )
);
create index ghl_marketplace_oauth_states_installation_idx on public.ghl_marketplace_oauth_states(installation_id);

create function public.protect_ghl_marketplace_oauth_state_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  bound_generation integer;
  bound_status text;
begin
  if tg_op = 'INSERT' then
    if new.consumed_at is not null or new.revoked_at is not null then
      raise exception 'OAuth state must start unused' using errcode = '23514';
    end if;
  else
    if row(new.id, new.installation_id, new.installation_generation, new.state_hash,
      new.browser_binding_hash, new.redirect_uri, new.created_at, new.expires_at)
      is distinct from row(old.id, old.installation_id, old.installation_generation, old.state_hash,
      old.browser_binding_hash, old.redirect_uri, old.created_at, old.expires_at) then
      raise exception 'OAuth state context is immutable' using errcode = '23514';
    end if;
    if (old.consumed_at is not null or old.revoked_at is not null)
      and row(new.consumed_at, new.revoked_at) is distinct from row(old.consumed_at, old.revoked_at) then
      raise exception 'OAuth state terminal evidence is immutable' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' or (new.consumed_at is not null and old.consumed_at is null) then
    -- Serialize against reinstall/disable; a plain snapshot read permits stale consumption.
    select installation_generation, status into bound_generation, bound_status
      from public.ghl_marketplace_installations where id = new.installation_id for share;
    if not found then
      raise exception 'OAuth state installation does not exist' using errcode = '23503';
    end if;
    if bound_generation <> new.installation_generation or bound_status not in ('pending', 'active')
      or new.expires_at <= clock_timestamp() or new.created_at > clock_timestamp() then
      raise exception 'OAuth state installation, generation, or expiry is ineligible' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' then
      -- Server clock owns consumption evidence; caller cannot backdate it.
      new.consumed_at := clock_timestamp();
    end if;
  end if;
  return new;
end;
$$;
create trigger protect_ghl_marketplace_oauth_state
before insert or update on public.ghl_marketplace_oauth_states
for each row execute function public.protect_ghl_marketplace_oauth_state_v1();

alter table public.ghl_marketplace_installations enable row level security;
alter table public.ghl_marketplace_oauth_states enable row level security;
revoke all on public.ghl_marketplace_installations, public.ghl_marketplace_oauth_states from public, anon, authenticated, service_role;
grant select, insert, update on public.ghl_marketplace_installations, public.ghl_marketplace_oauth_states to service_role;
create policy marketplace_installations_server_select on public.ghl_marketplace_installations for select to service_role using (true);
create policy marketplace_installations_server_insert on public.ghl_marketplace_installations for insert to service_role with check (true);
create policy marketplace_installations_server_update on public.ghl_marketplace_installations for update to service_role using (true) with check (true);
create policy marketplace_states_server_select on public.ghl_marketplace_oauth_states for select to service_role using (true);
create policy marketplace_states_server_insert on public.ghl_marketplace_oauth_states for insert to service_role with check (true);
create policy marketplace_states_server_update on public.ghl_marketplace_oauth_states for update to service_role using (true) with check (true);
revoke all on function public.protect_ghl_marketplace_installation_v1(), public.protect_ghl_marketplace_oauth_state_v1() from public, anon, authenticated, service_role;

comment on table public.ghl_marketplace_installations is 'Phase 2G-A: EVERY8D app ownership; lifecycle status is never send authorization. No legacy LINE token reuse.';
comment on table public.ghl_marketplace_oauth_states is 'Hashed OAuth state context; future callback must validate browser binding and exact redirect atomically. No OAuth runtime in Phase 2G-A.';
commit;
