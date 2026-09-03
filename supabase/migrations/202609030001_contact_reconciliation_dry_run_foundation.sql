create table public.contact_reconciliation_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  location_id text not null check (char_length(location_id) between 1 and 128),
  master_contact_id text not null check (char_length(master_contact_id) between 1 and 128),
  candidate_contact_id text not null check (char_length(candidate_contact_id) between 1 and 128),
  identity_type text not null check (identity_type in ('email', 'phone', 'email_phone')),
  line_identity_fingerprint text not null check (line_identity_fingerprint ~ '^[0-9a-f]{64}$'),
  reconciliation_identity_fingerprint text not null
    check (reconciliation_identity_fingerprint ~ '^[0-9a-f]{64}$'),
  preview_key_fingerprint text not null check (preview_key_fingerprint ~ '^[0-9a-f]{64}$'),
  authorization_token_fingerprint text not null unique
    check (authorization_token_fingerprint ~ '^[0-9a-f]{64}$'),
  authorization_binding_fingerprint text not null
    check (authorization_binding_fingerprint ~ '^[0-9a-f]{64}$'),
  mapping_snapshot_fingerprint text not null check (mapping_snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  master_snapshot_fingerprint text not null check (master_snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_snapshot_fingerprint text not null check (candidate_snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  field_policy_fingerprint text not null check (field_policy_fingerprint ~ '^[0-9a-f]{64}$'),
  initial_semantic_fingerprint text not null check (initial_semantic_fingerprint ~ '^[0-9a-f]{64}$'),
  revalidated_semantic_fingerprint text
    check (revalidated_semantic_fingerprint is null or revalidated_semantic_fingerprint ~ '^[0-9a-f]{64}$'),
  transfer_plan_fingerprint text
    check (transfer_plan_fingerprint is null or transfer_plan_fingerprint ~ '^[0-9a-f]{64}$'),
  transfer_plan_summary jsonb
    check (transfer_plan_summary is null or jsonb_typeof(transfer_plan_summary) = 'object'),
  state text not null default 'PLANNED'
    constraint contact_reconciliation_operations_state_value_check
    check (state in ('PLANNED', 'LOCKED', 'REVALIDATED', 'DRY_RUN_READY', 'FAILED_SAFE', 'EXPIRED')),
  result_decision text check (result_decision is null or result_decision = 'AUTO_SIMPLE'),
  reason_codes text[] not null default '{}'::text[],
  authorization_consumed_at timestamptz,
  locked_at timestamptz,
  revalidated_at timestamptz,
  finalized_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_reconciliation_operations_distinct_contacts_check
    check (master_contact_id <> candidate_contact_id),
  constraint contact_reconciliation_operations_expiry_check
    check (expires_at > created_at),
  constraint contact_reconciliation_operations_state_consistency_check
    check (
      (
        state = 'PLANNED'
        and authorization_consumed_at is null
        and locked_at is null
        and revalidated_at is null
        and finalized_at is null
        and revalidated_semantic_fingerprint is null
        and transfer_plan_fingerprint is null
        and transfer_plan_summary is null
      )
      or (
        state = 'LOCKED'
        and authorization_consumed_at is not null
        and locked_at is not null
        and revalidated_at is null
        and finalized_at is null
      )
      or (
        state = 'REVALIDATED'
        and authorization_consumed_at is not null
        and locked_at is not null
        and revalidated_at is not null
        and finalized_at is null
        and revalidated_semantic_fingerprint is not null
      )
      or (
        state = 'DRY_RUN_READY'
        and authorization_consumed_at is not null
        and locked_at is not null
        and revalidated_at is not null
        and finalized_at is not null
        and revalidated_semantic_fingerprint is not null
        and transfer_plan_fingerprint is not null
        and transfer_plan_summary is not null
        and result_decision = 'AUTO_SIMPLE'
      )
      or (
        state = 'FAILED_SAFE'
        and authorization_consumed_at is not null
        and locked_at is not null
        and finalized_at is not null
        and cardinality(reason_codes) > 0
      )
      or (
        state = 'EXPIRED'
        and authorization_consumed_at is null
        and locked_at is null
        and revalidated_at is null
        and finalized_at is not null
        and cardinality(reason_codes) > 0
      )
    )
);

create table public.contact_reconciliation_locks (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  location_id text not null check (char_length(location_id) between 1 and 128),
  contact_id text not null check (char_length(contact_id) between 1 and 128),
  operation_id uuid not null references public.contact_reconciliation_operations(id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, location_id, contact_id),
  unique (operation_id, contact_id)
);

create index contact_reconciliation_operations_state_expiry_idx
  on public.contact_reconciliation_operations (state, expires_at);

create index contact_reconciliation_operations_pair_idx
  on public.contact_reconciliation_operations (tenant_id, location_id, master_contact_id, candidate_contact_id);

create unique index contact_reconciliation_operations_active_pair_uidx
  on public.contact_reconciliation_operations (
    tenant_id,
    location_id,
    least(master_contact_id, candidate_contact_id),
    greatest(master_contact_id, candidate_contact_id)
  )
  where state in ('PLANNED', 'LOCKED', 'REVALIDATED');

create index contact_reconciliation_locks_operation_idx
  on public.contact_reconciliation_locks (operation_id);

create trigger set_contact_reconciliation_operations_updated_at
before update on public.contact_reconciliation_operations
for each row execute function public.set_updated_at();

create function public.protect_contact_reconciliation_operation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'contact reconciliation operation evidence cannot be deleted'
      using errcode = 'P0001';
  end if;

  if old.state in ('DRY_RUN_READY', 'FAILED_SAFE', 'EXPIRED') then
    raise exception 'finalized contact reconciliation operation evidence is immutable'
      using errcode = 'P0001';
  end if;

  if old.state = 'PLANNED' and new.state not in ('PLANNED', 'LOCKED', 'EXPIRED')
    or old.state = 'LOCKED' and new.state not in ('LOCKED', 'REVALIDATED', 'FAILED_SAFE')
    or old.state = 'REVALIDATED' and new.state not in ('REVALIDATED', 'DRY_RUN_READY', 'FAILED_SAFE')
    or old.state in ('DRY_RUN_READY', 'FAILED_SAFE', 'EXPIRED') and new.state <> old.state then
    raise exception 'invalid contact reconciliation operation state transition'
      using errcode = 'P0001';
  end if;

  if new.tenant_id is distinct from old.tenant_id
    or new.location_id is distinct from old.location_id
    or new.master_contact_id is distinct from old.master_contact_id
    or new.candidate_contact_id is distinct from old.candidate_contact_id
    or new.identity_type is distinct from old.identity_type
    or new.line_identity_fingerprint is distinct from old.line_identity_fingerprint
    or new.reconciliation_identity_fingerprint is distinct from old.reconciliation_identity_fingerprint
    or new.preview_key_fingerprint is distinct from old.preview_key_fingerprint
    or new.authorization_token_fingerprint is distinct from old.authorization_token_fingerprint
    or new.authorization_binding_fingerprint is distinct from old.authorization_binding_fingerprint
    or new.mapping_snapshot_fingerprint is distinct from old.mapping_snapshot_fingerprint
    or new.master_snapshot_fingerprint is distinct from old.master_snapshot_fingerprint
    or new.candidate_snapshot_fingerprint is distinct from old.candidate_snapshot_fingerprint
    or new.field_policy_fingerprint is distinct from old.field_policy_fingerprint
    or new.initial_semantic_fingerprint is distinct from old.initial_semantic_fingerprint
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at then
    raise exception 'contact reconciliation operation binding is immutable'
      using errcode = 'P0001';
  end if;

  if old.authorization_consumed_at is not null
    and new.authorization_consumed_at is distinct from old.authorization_consumed_at then
    raise exception 'contact reconciliation authorization consumption is immutable'
      using errcode = 'P0001';
  end if;

  if old.locked_at is not null and new.locked_at is distinct from old.locked_at then
    raise exception 'contact reconciliation lock evidence is immutable'
      using errcode = 'P0001';
  end if;

  if old.revalidated_at is not null and new.revalidated_at is distinct from old.revalidated_at then
    raise exception 'contact reconciliation revalidation evidence is immutable'
      using errcode = 'P0001';
  end if;

  if old.finalized_at is not null and new.finalized_at is distinct from old.finalized_at then
    raise exception 'contact reconciliation finalization evidence is immutable'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger protect_contact_reconciliation_operation_v1
before update or delete on public.contact_reconciliation_operations
for each row execute function public.protect_contact_reconciliation_operation_v1();

create function public.claim_contact_reconciliation_dry_run_v1(
  p_operation_id uuid,
  p_tenant_id uuid,
  p_location_id text,
  p_master_contact_id text,
  p_candidate_contact_id text,
  p_authorization_token_fingerprint text,
  p_authorization_binding_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed_operation_id uuid;
begin
  select id into claimed_operation_id
  from public.contact_reconciliation_operations
  where id = p_operation_id
    and tenant_id = p_tenant_id
    and location_id = p_location_id
    and master_contact_id = p_master_contact_id
    and candidate_contact_id = p_candidate_contact_id
    and authorization_token_fingerprint = p_authorization_token_fingerprint
    and authorization_binding_fingerprint = p_authorization_binding_fingerprint
    and state = 'PLANNED'
    and authorization_consumed_at is null
    and expires_at > now()
  for update;

  if claimed_operation_id is null then
    return false;
  end if;

  begin
    insert into public.contact_reconciliation_locks (
      tenant_id,
      location_id,
      contact_id,
      operation_id,
      expires_at
    )
    select
      p_tenant_id,
      p_location_id,
      contact_id,
      p_operation_id,
      operation.expires_at
    from (
      values (p_master_contact_id), (p_candidate_contact_id)
    ) as contacts(contact_id)
    cross join (
      select expires_at
      from public.contact_reconciliation_operations
      where id = p_operation_id
    ) as operation
    order by contact_id;

    update public.contact_reconciliation_operations
    set
      state = 'LOCKED',
      authorization_consumed_at = now(),
      locked_at = now()
    where id = p_operation_id
      and state = 'PLANNED'
    returning id into claimed_operation_id;

    if claimed_operation_id is null then
      raise exception 'contact reconciliation operation claim lost its planned state'
        using errcode = 'P0001';
    end if;
  exception
    when unique_violation then
      return false;
  end;

  return true;
end;
$$;

create function public.mark_contact_reconciliation_revalidated_v1(
  p_operation_id uuid,
  p_tenant_id uuid,
  p_location_id text,
  p_revalidated_semantic_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated_operation_id uuid;
begin
  update public.contact_reconciliation_operations
  set
    state = 'REVALIDATED',
    revalidated_at = now(),
    revalidated_semantic_fingerprint = p_revalidated_semantic_fingerprint
  where id = p_operation_id
    and tenant_id = p_tenant_id
    and location_id = p_location_id
    and state = 'LOCKED'
    and expires_at > now()
    and p_revalidated_semantic_fingerprint ~ '^[0-9a-f]{64}$'
  returning id into updated_operation_id;

  return updated_operation_id is not null;
end;
$$;

create function public.finalize_contact_reconciliation_dry_run_v1(
  p_operation_id uuid,
  p_tenant_id uuid,
  p_location_id text,
  p_state text,
  p_result_decision text,
  p_reason_codes text[],
  p_transfer_plan_fingerprint text,
  p_transfer_plan_summary jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated_operation_id uuid;
begin
  if p_state not in ('DRY_RUN_READY', 'FAILED_SAFE') then
    return false;
  end if;

  if p_state = 'DRY_RUN_READY' and (
    p_result_decision <> 'AUTO_SIMPLE'
    or p_transfer_plan_fingerprint is null
    or p_transfer_plan_fingerprint !~ '^[0-9a-f]{64}$'
    or p_transfer_plan_summary is null
    or jsonb_typeof(p_transfer_plan_summary) <> 'object'
  ) then
    return false;
  end if;

  if p_reason_codes is null
    or cardinality(p_reason_codes) = 0
    or array_to_string(p_reason_codes, ',') !~ '^[A-Z0-9_]{1,96}(,[A-Z0-9_]{1,96})*$' then
    return false;
  end if;

  if p_state = 'FAILED_SAFE' and p_result_decision is not null then
    return false;
  end if;

  update public.contact_reconciliation_operations
  set
    state = p_state,
    result_decision = case when p_state = 'DRY_RUN_READY' then p_result_decision else null end,
    reason_codes = p_reason_codes,
    transfer_plan_fingerprint = case when p_state = 'DRY_RUN_READY' then p_transfer_plan_fingerprint else null end,
    transfer_plan_summary = case when p_state = 'DRY_RUN_READY' then p_transfer_plan_summary else null end,
    finalized_at = now()
  where id = p_operation_id
    and tenant_id = p_tenant_id
    and location_id = p_location_id
    and (
      (p_state = 'DRY_RUN_READY' and state = 'REVALIDATED')
      or (p_state = 'FAILED_SAFE' and state in ('LOCKED', 'REVALIDATED'))
    )
  returning id into updated_operation_id;

  if updated_operation_id is null then
    return false;
  end if;

  delete from public.contact_reconciliation_locks
  where operation_id = p_operation_id
    and tenant_id = p_tenant_id
    and location_id = p_location_id;

  return true;
end;
$$;

create function public.expire_contact_reconciliation_authorization_v1(
  p_operation_id uuid,
  p_authorization_token_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated_operation_id uuid;
begin
  update public.contact_reconciliation_operations
  set
    state = 'EXPIRED',
    reason_codes = array['AUTHORIZATION_EXPIRED'],
    finalized_at = now()
  where id = p_operation_id
    and authorization_token_fingerprint = p_authorization_token_fingerprint
    and state = 'PLANNED'
    and authorization_consumed_at is null
    and expires_at <= now()
  returning id into updated_operation_id;

  return updated_operation_id is not null;
end;
$$;

alter table public.contact_reconciliation_operations enable row level security;
alter table public.contact_reconciliation_locks enable row level security;

revoke all on table public.contact_reconciliation_operations from public, anon, authenticated;
revoke all on table public.contact_reconciliation_locks from public, anon, authenticated;
revoke all on table public.contact_reconciliation_operations from service_role;
revoke all on table public.contact_reconciliation_locks from service_role;

grant select, insert on table public.contact_reconciliation_operations to service_role;

revoke all on function public.protect_contact_reconciliation_operation_v1() from public, anon, authenticated;
revoke all on function public.claim_contact_reconciliation_dry_run_v1(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.mark_contact_reconciliation_revalidated_v1(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.finalize_contact_reconciliation_dry_run_v1(uuid, uuid, text, text, text, text[], text, jsonb)
  from public, anon, authenticated;
revoke all on function public.expire_contact_reconciliation_authorization_v1(uuid, text)
  from public, anon, authenticated;

grant execute on function public.claim_contact_reconciliation_dry_run_v1(uuid, uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.mark_contact_reconciliation_revalidated_v1(uuid, uuid, text, text)
  to service_role;
grant execute on function public.finalize_contact_reconciliation_dry_run_v1(uuid, uuid, text, text, text, text[], text, jsonb)
  to service_role;
grant execute on function public.expire_contact_reconciliation_authorization_v1(uuid, text)
  to service_role;

comment on table public.contact_reconciliation_operations is
  'Server-only one-time authorization, semantic snapshot, and sanitized audit evidence for reconciliation Apply dry-runs.';
comment on table public.contact_reconciliation_locks is
  'Server-only durable per-contact locks for reconciliation operations; expired or abandoned locks are never stolen automatically.';
comment on column public.contact_reconciliation_operations.reconciliation_identity_fingerprint is
  'Domain-separated HMAC only; raw Email and Phone are never stored.';
comment on column public.contact_reconciliation_operations.line_identity_fingerprint is
  'Domain-separated HMAC only; raw LINE user IDs are never stored.';
