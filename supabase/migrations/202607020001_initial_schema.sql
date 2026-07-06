create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  location_id text not null,
  ghl_provider_id text not null,
  line_channel_id text not null default 'default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, ghl_provider_id, line_channel_id)
);

drop trigger if exists set_tenants_updated_at on public.tenants;
create trigger set_tenants_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

create table if not exists public.line_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  line_user_id text not null,
  line_source_type text not null check (line_source_type in ('user', 'group', 'room')),
  line_source_id text not null,
  display_name text,
  picture_url text,
  ghl_contact_id text,
  ghl_conversation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_profiles_tenant_line_user_key unique (tenant_id, line_user_id)
);

drop trigger if exists set_line_profiles_updated_at on public.line_profiles;
create trigger set_line_profiles_updated_at
before update on public.line_profiles
for each row execute function public.set_updated_at();

create index if not exists line_profiles_line_user_idx
  on public.line_profiles (tenant_id, line_user_id);

create index if not exists line_profiles_ghl_contact_idx
  on public.line_profiles (tenant_id, ghl_contact_id)
  where ghl_contact_id is not null;

create index if not exists line_profiles_ghl_conversation_idx
  on public.line_profiles (tenant_id, ghl_conversation_id)
  where ghl_conversation_id is not null;

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('line', 'ghl')),
  direction text not null check (direction in ('inbound', 'outbound')),
  external_message_id text,
  line_user_id text,
  ghl_message_id text,
  ghl_conversation_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('received', 'sent', 'skipped', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create unique index if not exists message_events_provider_external_message_uidx
  on public.message_events (tenant_id, provider, external_message_id)
  where external_message_id is not null;

create index if not exists message_events_line_user_idx
  on public.message_events (tenant_id, line_user_id)
  where line_user_id is not null;

create index if not exists message_events_ghl_conversation_idx
  on public.message_events (tenant_id, ghl_conversation_id)
  where ghl_conversation_id is not null;

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('line', 'ghl')),
  event_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists webhook_events_source_event_uidx
  on public.webhook_events (source, event_id)
  where event_id is not null;

comment on table public.tenants is 'One HighLevel location and LINE channel/provider pairing.';
comment on table public.line_profiles is 'Mapping between LINE identities and HighLevel contacts/conversations.';
comment on table public.message_events is 'Idempotency and audit log for synced LINE and HighLevel messages.';
comment on table public.webhook_events is 'Optional raw webhook audit log for replay and debugging.';
