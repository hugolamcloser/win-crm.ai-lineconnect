create table if not exists public.line_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  webhook_key text not null,
  channel_access_token text not null,
  channel_secret text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_line_channels_updated_at on public.line_channels;
create trigger set_line_channels_updated_at
before update on public.line_channels
for each row execute function public.set_updated_at();

create unique index if not exists line_channels_tenant_id_uidx
  on public.line_channels (tenant_id);

create unique index if not exists line_channels_webhook_key_uidx
  on public.line_channels (webhook_key);

alter table public.line_profiles
  add column if not exists line_channel_id uuid references public.line_channels(id) on delete set null;

create index if not exists line_profiles_line_channel_user_idx
  on public.line_profiles (line_channel_id, line_user_id)
  where line_channel_id is not null;

comment on table public.line_channels is 'LINE Official Account channel credentials and routing metadata for a tenant.';
comment on column public.line_channels.tenant_id is 'Current business rule: one active LINE Official Account per tenant.';
comment on column public.line_channels.webhook_key is 'Opaque webhook routing key for identifying a LINE channel without exposing credentials.';
