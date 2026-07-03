create table if not exists public.ghl_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  location_id text not null unique,
  company_id text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scopes text[] not null default '{}'::text[],
  token_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_ghl_oauth_tokens_updated_at on public.ghl_oauth_tokens;
create trigger set_ghl_oauth_tokens_updated_at
before update on public.ghl_oauth_tokens
for each row execute function public.set_updated_at();

create index if not exists ghl_oauth_tokens_location_idx
  on public.ghl_oauth_tokens (location_id);

alter table public.message_events
  add column if not exists ghl_status_code integer,
  add column if not exists ghl_response_body text,
  add column if not exists request_payload jsonb;

alter table public.message_events
  drop constraint if exists message_events_status_check;

alter table public.message_events
  add constraint message_events_status_check
  check (status in ('received', 'sent', 'success', 'skipped', 'failed'));

comment on table public.ghl_oauth_tokens is 'Server-side storage for installed HighLevel marketplace OAuth tokens. Never expose these values to clients.';
comment on column public.message_events.ghl_status_code is 'HighLevel HTTP status code for message sync attempts when available.';
comment on column public.message_events.ghl_response_body is 'HighLevel response body for message sync attempts when available.';
comment on column public.message_events.request_payload is 'Redacted request payload sent to HighLevel for debugging.';
