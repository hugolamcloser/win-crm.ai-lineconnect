alter table public.ghl_sms_outbound_operations
  drop constraint if exists ghl_sms_outbound_operations_provider_mode_check;

alter table public.ghl_sms_outbound_operations
  add constraint ghl_sms_outbound_operations_provider_mode_check
  check (provider_mode in ('mock', 'controlled_live'));

alter table public.ghl_sms_outbound_operations
  drop constraint if exists ghl_sms_outbound_operations_state_consistency_check;

alter table public.ghl_sms_outbound_operations
  add constraint ghl_sms_outbound_operations_state_consistency_check
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
      state = 'definitive_failed'
      and (
        (provider_attempts = 0 and send_started_at is null)
        or (provider_attempts = 1 and send_started_at is not null)
      )
      and finalized_at is not null
      and failure_code is not null
    )
    or (
      state = 'ambiguous'
      and provider_attempts = 1
      and send_started_at is not null
      and finalized_at is not null
      and failure_code is not null
    )
  );

comment on column public.ghl_sms_outbound_operations.provider_mode is
  'Server-selected mode restricted to mock or approval-gated controlled_live.';
