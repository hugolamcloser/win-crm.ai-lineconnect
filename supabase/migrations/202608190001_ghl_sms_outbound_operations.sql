create table if not exists public.ghl_sms_outbound_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  location_id text not null check (char_length(location_id) between 1 and 128),
  ghl_message_id text not null check (char_length(ghl_message_id) between 1 and 128),
  provider text not null default 'every8d' check (provider = 'every8d'),
  provider_mode text not null default 'mock' check (provider_mode = 'mock'),
  state text not null default 'processing'
    constraint ghl_sms_outbound_operations_state_value_check
    check (state in ('processing', 'accepted', 'definitive_failed', 'ambiguous')),
  send_started_at timestamptz,
  provider_attempts smallint not null default 0 check (provider_attempts in (0, 1)),
  provider_http_status integer,
  provider_status text check (provider_status is null or char_length(provider_status) between 1 and 64),
  provider_sent_count integer check (provider_sent_count is null or provider_sent_count >= 0),
  provider_unsent_count integer check (provider_unsent_count is null or provider_unsent_count >= 0),
  failure_code text check (failure_code is null or char_length(failure_code) between 1 and 64),
  provider_batch_id text check (provider_batch_id is null or char_length(provider_batch_id) between 1 and 256),
  provider_bid text check (provider_bid is null or char_length(provider_bid) between 1 and 256),
  provider_bid_source text
    check (provider_bid_source is null or provider_bid_source in ('provider', 'batch_id')),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ghl_sms_outbound_operations_identity_key
    unique (tenant_id, location_id, ghl_message_id),
  constraint ghl_sms_outbound_operations_send_start_check
    check (
      (send_started_at is null and provider_attempts = 0)
      or (send_started_at is not null and provider_attempts = 1)
    ),
  constraint ghl_sms_outbound_operations_state_consistency_check
    check (
      (state = 'processing' and finalized_at is null and failure_code is null)
      or (
        state = 'accepted'
        and send_started_at is not null
        and provider_attempts = 1
        and finalized_at is not null
        and failure_code is null
      )
      or (
        state in ('definitive_failed', 'ambiguous')
        and send_started_at is not null
        and provider_attempts = 1
        and finalized_at is not null
        and failure_code is not null
      )
    )
);

drop trigger if exists set_ghl_sms_outbound_operations_updated_at
  on public.ghl_sms_outbound_operations;
create trigger set_ghl_sms_outbound_operations_updated_at
before update on public.ghl_sms_outbound_operations
for each row execute function public.set_updated_at();

create index if not exists ghl_sms_outbound_operations_state_updated_idx
  on public.ghl_sms_outbound_operations (state, updated_at);

create index if not exists ghl_sms_outbound_operations_provider_batch_idx
  on public.ghl_sms_outbound_operations (provider, provider_batch_id)
  where provider_batch_id is not null;

create index if not exists ghl_sms_outbound_operations_provider_bid_idx
  on public.ghl_sms_outbound_operations (provider, provider_bid)
  where provider_bid is not null;

alter table public.ghl_sms_outbound_operations enable row level security;

revoke all on table public.ghl_sms_outbound_operations from anon, authenticated;

comment on table public.ghl_sms_outbound_operations is
  'Server-only durable idempotency and sanitized provider correlation for signed HighLevel outbound SMS callbacks.';
comment on column public.ghl_sms_outbound_operations.provider_mode is
  'Phase 2D is constrained to mock provider evidence; live activation requires a separately approved migration.';

