create table public.ghl_sms_controlled_live_authorizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  location_id text not null check (char_length(location_id) between 1 and 128),
  contact_id text not null check (char_length(contact_id) between 1 and 128),
  provider text not null default 'every8d' check (provider = 'every8d'),
  provider_mode text not null default 'controlled_live'
    check (provider_mode = 'controlled_live'),
  destination_fingerprint text not null
    check (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  message_fingerprint text not null
    check (message_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null default 'created'
    constraint ghl_sms_controlled_live_authorizations_state_value_check
    check (state in ('created', 'armed', 'consumed', 'revoked')),
  armed_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  consumed_by_operation_id uuid
    references public.ghl_sms_outbound_operations(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ghl_sms_controlled_live_authorizations_state_consistency_check
    check (
      (
        state = 'created'
        and armed_at is null
        and consumed_at is null
        and revoked_at is null
        and consumed_by_operation_id is null
      )
      or (
        state = 'armed'
        and armed_at is not null
        and consumed_at is null
        and revoked_at is null
        and consumed_by_operation_id is null
      )
      or (
        state = 'consumed'
        and armed_at is not null
        and consumed_at is not null
        and revoked_at is null
        and consumed_by_operation_id is not null
      )
      or (
        state = 'revoked'
        and consumed_at is null
        and revoked_at is not null
        and consumed_by_operation_id is null
      )
    ),
  constraint ghl_sms_controlled_live_authorizations_operation_unique
    unique (consumed_by_operation_id)
);

create function public.protect_ghl_sms_controlled_live_authorization_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if old.state = 'consumed' then
      raise exception 'consumed controlled-live authorization evidence cannot be deleted'
        using errcode = 'P0001';
    end if;

    return old;
  end if;

  if (old.state = 'created' and new.state not in ('created', 'armed', 'revoked'))
    or (old.state = 'armed' and new.state not in ('armed', 'consumed', 'revoked'))
    or (old.state = 'consumed' and new.state <> 'consumed')
    or (old.state = 'revoked' and new.state <> 'revoked') then
    raise exception 'invalid controlled-live authorization state transition'
      using errcode = 'P0001';
  end if;

  if old.state in ('armed', 'consumed', 'revoked')
    and (
      new.tenant_id is distinct from old.tenant_id
      or new.location_id is distinct from old.location_id
      or new.contact_id is distinct from old.contact_id
      or new.provider is distinct from old.provider
      or new.provider_mode is distinct from old.provider_mode
      or new.destination_fingerprint is distinct from old.destination_fingerprint
      or new.message_fingerprint is distinct from old.message_fingerprint
    ) then
    raise exception 'armed controlled-live authorization scope is immutable'
      using errcode = 'P0001';
  end if;

  if old.armed_at is not null and new.armed_at is distinct from old.armed_at then
    raise exception 'controlled-live authorization armed evidence is immutable'
      using errcode = 'P0001';
  end if;

  if old.consumed_at is not null
    and new.consumed_at is distinct from old.consumed_at then
    raise exception 'controlled-live authorization consumed evidence is immutable'
      using errcode = 'P0001';
  end if;

  if old.consumed_by_operation_id is not null
    and new.consumed_by_operation_id is distinct from old.consumed_by_operation_id then
    raise exception 'controlled-live authorization operation binding is immutable'
      using errcode = 'P0001';
  end if;

  if old.revoked_at is not null
    and new.revoked_at is distinct from old.revoked_at then
    raise exception 'controlled-live authorization revocation evidence is immutable'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger protect_ghl_sms_controlled_live_authorization_v1
before update or delete on public.ghl_sms_controlled_live_authorizations
for each row execute function public.protect_ghl_sms_controlled_live_authorization_v1();

create trigger set_ghl_sms_controlled_live_authorizations_updated_at
before update on public.ghl_sms_controlled_live_authorizations
for each row execute function public.set_updated_at();

create function public.consume_ghl_sms_controlled_live_authorization_v1(
  p_authorization_id uuid,
  p_operation_id uuid,
  p_tenant_id uuid,
  p_location_id text,
  p_contact_id text,
  p_provider text,
  p_provider_mode text,
  p_destination_fingerprint text,
  p_message_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  consumed_authorization_id uuid;
  updated_operation_id uuid;
begin
  if p_provider <> 'every8d' or p_provider_mode <> 'controlled_live' then
    return false;
  end if;

  update public.ghl_sms_controlled_live_authorizations
  set
    state = 'consumed',
    consumed_at = now(),
    consumed_by_operation_id = p_operation_id
  where id = p_authorization_id
    and tenant_id = p_tenant_id
    and location_id = p_location_id
    and contact_id = p_contact_id
    and provider = 'every8d'
    and provider_mode = 'controlled_live'
    and destination_fingerprint = p_destination_fingerprint
    and message_fingerprint = p_message_fingerprint
    and state = 'armed'
    and consumed_at is null
    and consumed_by_operation_id is null
  returning id into consumed_authorization_id;

  if consumed_authorization_id is null then
    return false;
  end if;

  update public.ghl_sms_outbound_operations
  set
    send_started_at = now(),
    provider_attempts = 1
  where id = p_operation_id
    and tenant_id = p_tenant_id
    and location_id = p_location_id
    and provider = 'every8d'
    and provider_mode = 'controlled_live'
    and state = 'processing'
    and send_started_at is null
    and provider_attempts = 0
  returning id into updated_operation_id;

  if updated_operation_id is null then
    raise exception 'controlled-live outbound operation cannot acquire send permission'
      using errcode = 'P0001';
  end if;

  return true;
end;
$$;

alter table public.ghl_sms_controlled_live_authorizations enable row level security;

revoke all on table public.ghl_sms_controlled_live_authorizations from public;
revoke all on table public.ghl_sms_controlled_live_authorizations from anon, authenticated;
revoke all on function public.protect_ghl_sms_controlled_live_authorization_v1()
  from public, anon, authenticated;
revoke all on function public.consume_ghl_sms_controlled_live_authorization_v1(
  uuid, uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.consume_ghl_sms_controlled_live_authorization_v1(
  uuid, uuid, uuid, text, text, text, text, text, text
) to service_role;

comment on table public.ghl_sms_controlled_live_authorizations is
  'Service-only, one-time controlled-live SMS authorization evidence bound by keyed fingerprints.';
comment on function public.consume_ghl_sms_controlled_live_authorization_v1(
  uuid, uuid, uuid, text, text, text, text, text, text
) is
  'Atomically consumes one exact armed authorization and starts one exact controlled-live outbound operation.';
