-- C3a: durable EVERY8D settings administrator, enrollment-grant, and session foundation.
-- Database/security boundary only: no browser routes, challenges, email, credentials, or provider calls.
begin;
set local lock_timeout = '5s';
lock table public.ghl_marketplace_installations in share row exclusive mode;

create table public.every8d_settings_enrollment_grants (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null,
  installation_id uuid not null,
  installation_generation integer not null,
  method text not null,
  pinned_normalized_email text,
  installer_user_hmac text,
  installer_user_hmac_key_version text,
  oauth_bootstrap_reference uuid,
  operator_issuer text,
  operator_approver text,
  operator_case_reference text,
  operator_reason text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  constraint every8d_settings_enrollment_grants_installation_fk
    foreign key (installation_id)
    references public.ghl_marketplace_installations(id)
    on update restrict on delete restrict,
  constraint every8d_settings_enrollment_grants_oauth_bootstrap_fk
    foreign key (oauth_bootstrap_reference)
    references public.ghl_marketplace_oauth_bootstraps(id)
    on update restrict on delete restrict,
  constraint every8d_settings_enrollment_grants_token_hash_key unique (token_hash),
  constraint every8d_settings_enrollment_grants_generation_check
    check (installation_generation > 0),
  constraint every8d_settings_enrollment_grants_token_hash_check
    check (octet_length(token_hash) = 32),
  constraint every8d_settings_enrollment_grants_method_check
    check (method in ('install_callback', 'operator_initial', 'operator_recovery')),
  constraint every8d_settings_enrollment_grants_email_check
    check (
      pinned_normalized_email is null
      or (
        pinned_normalized_email = btrim(pinned_normalized_email)
        and octet_length(pinned_normalized_email) between 3 and 254
        and pinned_normalized_email !~ '[[:cntrl:]]'
        and length(pinned_normalized_email)
          - length(replace(pinned_normalized_email, '@', '')) = 1
        and position('@' in pinned_normalized_email) > 1
        and position('@' in pinned_normalized_email) < length(pinned_normalized_email)
      )
    ),
  constraint every8d_settings_enrollment_grants_hmac_pair_check
    check (
      (installer_user_hmac is null and installer_user_hmac_key_version is null)
      or (
        installer_user_hmac ~ '^[0-9a-f]{64}$'
        and installer_user_hmac_key_version ~ '^[A-Za-z0-9_.-]{1,128}$'
      )
    ),
  constraint every8d_settings_enrollment_grants_method_fields_check
    check (
      (
        method = 'install_callback'
        and pinned_normalized_email is null
        and operator_issuer is null
        and operator_approver is null
        and operator_case_reference is null
        and operator_reason is null
      )
      or
      (
        method in ('operator_initial', 'operator_recovery')
        and pinned_normalized_email is not null
        and oauth_bootstrap_reference is null
        and operator_issuer is not null
        and operator_issuer = btrim(operator_issuer)
        and octet_length(operator_issuer) between 1 and 128
        and operator_issuer !~ '[[:cntrl:]]'
        and operator_approver is not null
        and operator_approver = btrim(operator_approver)
        and octet_length(operator_approver) between 1 and 128
        and operator_approver !~ '[[:cntrl:]]'
        and operator_issuer <> operator_approver
        and operator_case_reference is not null
        and operator_case_reference = btrim(operator_case_reference)
        and octet_length(operator_case_reference) between 1 and 256
        and operator_case_reference !~ '[[:cntrl:]]'
        and operator_reason is not null
        and operator_reason = btrim(operator_reason)
        and octet_length(operator_reason) between 1 and 1024
        and operator_reason !~ '[[:cntrl:]]'
      )
    ),
  constraint every8d_settings_enrollment_grants_time_check
    check (
      isfinite(created_at)
      and isfinite(expires_at)
      and expires_at > created_at
      and expires_at <= created_at + interval '15 minutes'
      and (consumed_at is null or (
        isfinite(consumed_at) and consumed_at >= created_at and consumed_at < expires_at
      ))
      and (revoked_at is null or (isfinite(revoked_at) and revoked_at >= created_at))
    ),
  constraint every8d_settings_enrollment_grants_state_check
    check (
      (consumed_at is null and revoked_at is null and revocation_reason is null)
      or (consumed_at is not null and revoked_at is null and revocation_reason is null)
      or (
        consumed_at is null
        and revoked_at is not null
        and revocation_reason is not null
        and revocation_reason = btrim(revocation_reason)
        and char_length(revocation_reason) between 1 and 64
        and revocation_reason ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'
      )
    )
);

create table public.every8d_settings_administrators (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  installation_generation integer not null,
  normalized_email text not null,
  email_pseudonym text not null,
  enrollment_method text not null,
  enrollment_grant_id uuid not null,
  installer_user_hmac text,
  installer_user_hmac_key_version text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text,
  constraint every8d_settings_administrators_installation_fk
    foreign key (installation_id)
    references public.ghl_marketplace_installations(id)
    on update restrict on delete restrict,
  constraint every8d_settings_administrators_enrollment_grant_fk
    foreign key (enrollment_grant_id)
    references public.every8d_settings_enrollment_grants(id)
    on update restrict on delete restrict,
  constraint every8d_settings_administrators_authorization_snapshot_key
    unique (id, installation_id, installation_generation),
  constraint every8d_settings_administrators_generation_check
    check (installation_generation > 0),
  constraint every8d_settings_administrators_email_check
    check (
      normalized_email = btrim(normalized_email)
      and octet_length(normalized_email) between 3 and 254
      and normalized_email !~ '[[:cntrl:]]'
      and length(normalized_email) - length(replace(normalized_email, '@', '')) = 1
      and position('@' in normalized_email) > 1
      and position('@' in normalized_email) < length(normalized_email)
    ),
  constraint every8d_settings_administrators_pseudonym_check
    check (
      email_pseudonym = btrim(email_pseudonym)
      and octet_length(email_pseudonym) between 1 and 128
      and email_pseudonym ~ '^[A-Za-z0-9_.:-]+$'
    ),
  constraint every8d_settings_administrators_method_check
    check (enrollment_method in (
      'install_callback', 'operator_initial', 'operator_recovery'
    )),
  constraint every8d_settings_administrators_hmac_pair_check
    check (
      (installer_user_hmac is null and installer_user_hmac_key_version is null)
      or (
        installer_user_hmac ~ '^[0-9a-f]{64}$'
        and installer_user_hmac_key_version ~ '^[A-Za-z0-9_.-]{1,128}$'
      )
    ),
  constraint every8d_settings_administrators_time_check
    check (
      isfinite(created_at)
      and (revoked_at is null or (isfinite(revoked_at) and revoked_at >= created_at))
    ),
  constraint every8d_settings_administrators_state_check
    check (
      (revoked_at is null and revocation_reason is null)
      or (
        revoked_at is not null
        and revocation_reason is not null
        and revocation_reason = btrim(revocation_reason)
        and char_length(revocation_reason) between 1 and 64
        and revocation_reason ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'
      )
    )
);

create table public.every8d_settings_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null,
  administrator_id uuid not null,
  installation_id uuid not null,
  installation_generation integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  constraint every8d_settings_sessions_token_hash_key unique (token_hash),
  constraint every8d_settings_sessions_administrator_snapshot_fk
    foreign key (administrator_id, installation_id, installation_generation)
    references public.every8d_settings_administrators(
      id, installation_id, installation_generation
    )
    on update restrict on delete restrict,
  constraint every8d_settings_sessions_generation_check
    check (installation_generation > 0),
  constraint every8d_settings_sessions_token_hash_check
    check (octet_length(token_hash) = 32),
  constraint every8d_settings_sessions_time_check
    check (
      isfinite(created_at)
      and isfinite(expires_at)
      and expires_at > created_at
      and expires_at <= created_at + interval '1 hour'
      and (revoked_at is null or (isfinite(revoked_at) and revoked_at >= created_at))
    ),
  constraint every8d_settings_sessions_state_check
    check (
      (revoked_at is null and revocation_reason is null)
      or (
        revoked_at is not null
        and revocation_reason is not null
        and revocation_reason = btrim(revocation_reason)
        and char_length(revocation_reason) between 1 and 64
        and revocation_reason ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'
      )
    )
);

create unique index every8d_settings_administrators_active_email_key
  on public.every8d_settings_administrators(
    installation_id, installation_generation, normalized_email
  )
  where revoked_at is null;
create index every8d_settings_administrators_active_pseudonym_idx
  on public.every8d_settings_administrators(email_pseudonym)
  where revoked_at is null;
create index every8d_settings_administrators_installation_idx
  on public.every8d_settings_administrators(installation_id, installation_generation);

create index every8d_settings_enrollment_grants_live_installation_idx
  on public.every8d_settings_enrollment_grants(installation_id, installation_generation)
  where consumed_at is null and revoked_at is null;
create index every8d_settings_enrollment_grants_live_operator_email_idx
  on public.every8d_settings_enrollment_grants(
    installation_id, installation_generation, pinned_normalized_email, created_at desc
  )
  where method in ('operator_initial', 'operator_recovery')
    and consumed_at is null and revoked_at is null;

create index every8d_settings_sessions_live_installation_idx
  on public.every8d_settings_sessions(installation_id, installation_generation)
  where revoked_at is null;
create index every8d_settings_sessions_live_administrator_idx
  on public.every8d_settings_sessions(administrator_id)
  where revoked_at is null;

create function public.assert_every8d_settings_installation_eligible_v1(
  input_installation_id uuid,
  input_installation_generation integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if input_installation_id is null
    or input_installation_generation is null
    or input_installation_generation <= 0 then
    raise exception 'EVERY8D settings installation identity is invalid'
      using errcode = '23514';
  end if;

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
  where i.id = input_installation_id
    and i.installation_generation = input_installation_generation
    and i.app_namespace = 'every8d_connect'
    and i.channel = 'sms'
    and i.provider = 'every8d'
    and i.company_id is not null
    and i.latest_lifecycle_event_type = 'INSTALL'
    and i.status in ('pending', 'active')
  for share of i;

  if not found then
    raise exception 'EVERY8D settings parent is not currently eligible'
      using errcode = '23514';
  end if;
end;
$$;

create function public.protect_every8d_settings_enrollment_grant_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'EVERY8D settings enrollment grants cannot be deleted'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    perform public.assert_every8d_settings_installation_eligible_v1(
      new.installation_id, new.installation_generation
    );
    return new;
  end if;

  if row(
    new.id, new.token_hash, new.installation_id, new.installation_generation,
    new.method, new.pinned_normalized_email, new.installer_user_hmac,
    new.installer_user_hmac_key_version, new.oauth_bootstrap_reference,
    new.operator_issuer, new.operator_approver, new.operator_case_reference,
    new.operator_reason, new.created_at, new.expires_at
  ) is distinct from row(
    old.id, old.token_hash, old.installation_id, old.installation_generation,
    old.method, old.pinned_normalized_email, old.installer_user_hmac,
    old.installer_user_hmac_key_version, old.oauth_bootstrap_reference,
    old.operator_issuer, old.operator_approver, old.operator_case_reference,
    old.operator_reason, old.created_at, old.expires_at
  ) then
    raise exception 'EVERY8D settings enrollment grant identity is immutable'
      using errcode = '23514';
  end if;

  if old.consumed_at is not null or old.revoked_at is not null then
    if row(new.consumed_at, new.revoked_at, new.revocation_reason)
      is distinct from row(old.consumed_at, old.revoked_at, old.revocation_reason) then
      raise exception 'EVERY8D settings enrollment grant terminal state is immutable'
        using errcode = '23514';
    end if;
  elsif not (
    (new.consumed_at is null and new.revoked_at is null and new.revocation_reason is null)
    or (new.consumed_at is not null and new.revoked_at is null and new.revocation_reason is null)
    or (new.consumed_at is null and new.revoked_at is not null and new.revocation_reason is not null)
  ) then
    raise exception 'EVERY8D settings enrollment grant transition is invalid'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create function public.protect_every8d_settings_administrator_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'EVERY8D settings administrators cannot be deleted'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    perform public.assert_every8d_settings_installation_eligible_v1(
      new.installation_id, new.installation_generation
    );

    perform 1
    from public.every8d_settings_enrollment_grants g
    where g.id = new.enrollment_grant_id
      and g.installation_id = new.installation_id
      and g.installation_generation = new.installation_generation
      and g.method = new.enrollment_method
      and g.consumed_at is not null
      and g.revoked_at is null
      and (
        (g.method = 'install_callback' and g.pinned_normalized_email is null)
        or g.pinned_normalized_email = new.normalized_email
      )
    for share of g;

    if not found then
      raise exception 'EVERY8D settings administrator enrollment grant is invalid'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.installation_id, new.installation_generation,
    new.normalized_email, new.email_pseudonym, new.enrollment_method,
    new.enrollment_grant_id, new.installer_user_hmac,
    new.installer_user_hmac_key_version, new.created_at
  ) is distinct from row(
    old.id, old.installation_id, old.installation_generation,
    old.normalized_email, old.email_pseudonym, old.enrollment_method,
    old.enrollment_grant_id, old.installer_user_hmac,
    old.installer_user_hmac_key_version, old.created_at
  ) then
    raise exception 'EVERY8D settings administrator identity is immutable'
      using errcode = '23514';
  end if;

  if old.revoked_at is not null
    and row(new.revoked_at, new.revocation_reason)
      is distinct from row(old.revoked_at, old.revocation_reason) then
    raise exception 'EVERY8D settings administrator revocation is immutable'
      using errcode = '23514';
  end if;

  if old.revoked_at is null and not (
    (new.revoked_at is null and new.revocation_reason is null)
    or (new.revoked_at is not null and new.revocation_reason is not null)
  ) then
    raise exception 'EVERY8D settings administrator transition is invalid'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create function public.protect_every8d_settings_session_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'EVERY8D settings sessions cannot be deleted'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    perform public.assert_every8d_settings_installation_eligible_v1(
      new.installation_id, new.installation_generation
    );

    perform 1
    from public.every8d_settings_administrators a
    where a.id = new.administrator_id
      and a.installation_id = new.installation_id
      and a.installation_generation = new.installation_generation
      and a.revoked_at is null
    for share of a;

    if not found then
      raise exception 'EVERY8D settings session administrator is not active'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.token_hash, new.administrator_id, new.installation_id,
    new.installation_generation, new.created_at, new.expires_at
  ) is distinct from row(
    old.id, old.token_hash, old.administrator_id, old.installation_id,
    old.installation_generation, old.created_at, old.expires_at
  ) then
    raise exception 'EVERY8D settings session identity is immutable'
      using errcode = '23514';
  end if;

  if old.revoked_at is not null
    and row(new.revoked_at, new.revocation_reason)
      is distinct from row(old.revoked_at, old.revocation_reason) then
    raise exception 'EVERY8D settings session revocation is immutable'
      using errcode = '23514';
  end if;

  if old.revoked_at is null and not (
    (new.revoked_at is null and new.revocation_reason is null)
    or (new.revoked_at is not null and new.revocation_reason is not null)
  ) then
    raise exception 'EVERY8D settings session transition is invalid'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger protect_every8d_settings_enrollment_grant
before insert or update or delete on public.every8d_settings_enrollment_grants
for each row execute function public.protect_every8d_settings_enrollment_grant_v1();

create trigger protect_every8d_settings_administrator
before insert or update or delete on public.every8d_settings_administrators
for each row execute function public.protect_every8d_settings_administrator_v1();

create trigger protect_every8d_settings_session
before insert or update or delete on public.every8d_settings_sessions
for each row execute function public.protect_every8d_settings_session_v1();

create function public.issue_every8d_settings_operator_enrollment_grant_v1(
  input_installation_id uuid,
  input_installation_generation integer,
  input_pinned_normalized_email text,
  input_token_hash bytea,
  input_method text,
  input_expires_at timestamptz,
  input_operator_issuer text,
  input_operator_approver text,
  input_operator_case_reference text,
  input_operator_reason text
)
returns table(grant_id uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  issued_at timestamptz := clock_timestamp();
begin
  if input_method is null
    or input_method not in ('operator_initial', 'operator_recovery') then
    raise exception 'EVERY8D operator enrollment grant method is invalid'
      using errcode = '23514';
  end if;
  if input_token_hash is null or octet_length(input_token_hash) <> 32 then
    raise exception 'EVERY8D operator enrollment grant hash is invalid'
      using errcode = '23514';
  end if;
  if input_pinned_normalized_email is null
    or input_pinned_normalized_email <> btrim(input_pinned_normalized_email)
    or octet_length(input_pinned_normalized_email) not between 3 and 254
    or input_pinned_normalized_email ~ '[[:cntrl:]]'
    or length(input_pinned_normalized_email)
      - length(replace(input_pinned_normalized_email, '@', '')) <> 1
    or position('@' in input_pinned_normalized_email) <= 1
    or position('@' in input_pinned_normalized_email)
      >= length(input_pinned_normalized_email) then
    raise exception 'EVERY8D operator enrollment email is structurally invalid'
      using errcode = '23514';
  end if;
  if input_operator_issuer is null
    or input_operator_issuer <> btrim(input_operator_issuer)
    or octet_length(input_operator_issuer) not between 1 and 128
    or input_operator_issuer ~ '[[:cntrl:]]'
    or input_operator_approver is null
    or input_operator_approver <> btrim(input_operator_approver)
    or octet_length(input_operator_approver) not between 1 and 128
    or input_operator_approver ~ '[[:cntrl:]]'
    or input_operator_issuer = input_operator_approver then
    raise exception 'EVERY8D operator enrollment dual control is invalid'
      using errcode = '23514';
  end if;
  if input_operator_case_reference is null
    or input_operator_case_reference <> btrim(input_operator_case_reference)
    or octet_length(input_operator_case_reference) not between 1 and 256
    or input_operator_case_reference ~ '[[:cntrl:]]'
    or input_operator_reason is null
    or input_operator_reason <> btrim(input_operator_reason)
    or octet_length(input_operator_reason) not between 1 and 1024
    or input_operator_reason ~ '[[:cntrl:]]' then
    raise exception 'EVERY8D operator enrollment audit metadata is invalid'
      using errcode = '23514';
  end if;
  if input_expires_at is null
    or not isfinite(input_expires_at)
    or input_expires_at <= issued_at
    or input_expires_at > issued_at + interval '15 minutes' then
    raise exception 'EVERY8D operator enrollment grant expiry is invalid'
      using errcode = '23514';
  end if;

  -- Frozen lock order: exact parent first, then the tuple-scoped reissue lock,
  -- then C3 child rows. The advisory lock closes the concurrent first-issue gap.
  perform public.assert_every8d_settings_installation_eligible_v1(
    input_installation_id, input_installation_generation
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    input_installation_id::text || ':' || input_installation_generation::text
      || ':' || input_pinned_normalized_email,
    73001
  ));

  update public.every8d_settings_enrollment_grants g
  set revoked_at = issued_at,
      revocation_reason = 'operator_grant_superseded'
  where g.installation_id = input_installation_id
    and g.installation_generation = input_installation_generation
    and g.pinned_normalized_email = input_pinned_normalized_email
    and g.method in ('operator_initial', 'operator_recovery')
    and g.consumed_at is null
    and g.revoked_at is null
    and g.expires_at > issued_at;

  return query
  insert into public.every8d_settings_enrollment_grants (
    token_hash, installation_id, installation_generation, method,
    pinned_normalized_email, operator_issuer, operator_approver,
    operator_case_reference, operator_reason, created_at, expires_at
  ) values (
    input_token_hash, input_installation_id, input_installation_generation,
    input_method, input_pinned_normalized_email, input_operator_issuer,
    input_operator_approver, input_operator_case_reference,
    input_operator_reason, issued_at, input_expires_at
  )
  returning id, every8d_settings_enrollment_grants.created_at,
    every8d_settings_enrollment_grants.expires_at;
end;
$$;

create function public.invalidate_every8d_settings_auth_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reason_class text;
  invalidated_at timestamptz := clock_timestamp();
begin
  reason_class := case
    when new.status = 'uninstalled' then 'installation_uninstalled'
    when new.status = 'disabled' then 'installation_disabled'
    else 'installation_generation_changed'
  end;

  update public.every8d_settings_sessions
  set revoked_at = invalidated_at,
      revocation_reason = reason_class
  where installation_id = new.id
    and installation_generation = old.installation_generation
    and revoked_at is null;

  update public.every8d_settings_enrollment_grants
  set revoked_at = invalidated_at,
      revocation_reason = reason_class
  where installation_id = new.id
    and installation_generation = old.installation_generation
    and consumed_at is null
    and revoked_at is null;

  update public.every8d_settings_administrators
  set revoked_at = invalidated_at,
      revocation_reason = reason_class
  where installation_id = new.id
    and installation_generation = old.installation_generation
    and revoked_at is null;

  if exists (
    select 1 from public.every8d_settings_administrators
    where installation_id = new.id
      and installation_generation = old.installation_generation
      and revoked_at is null
  ) or exists (
    select 1 from public.every8d_settings_enrollment_grants
    where installation_id = new.id
      and installation_generation = old.installation_generation
      and consumed_at is null
      and revoked_at is null
  ) or exists (
    select 1 from public.every8d_settings_sessions
    where installation_id = new.id
      and installation_generation = old.installation_generation
      and revoked_at is null
  ) then
    raise exception 'EVERY8D settings lifecycle invalidation failed'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create trigger invalidate_every8d_settings_auth_after_install_update
after update of status, installation_generation on public.ghl_marketplace_installations
for each row
when (
  new.status in ('disabled', 'uninstalled')
  or old.installation_generation is distinct from new.installation_generation
)
execute function public.invalidate_every8d_settings_auth_v1();

alter table public.every8d_settings_administrators enable row level security;
alter table public.every8d_settings_administrators force row level security;
alter table public.every8d_settings_enrollment_grants enable row level security;
alter table public.every8d_settings_enrollment_grants force row level security;
alter table public.every8d_settings_sessions enable row level security;
alter table public.every8d_settings_sessions force row level security;

revoke all on public.every8d_settings_administrators
  from public, anon, authenticated, service_role;
revoke all on public.every8d_settings_enrollment_grants
  from public, anon, authenticated, service_role;
revoke all on public.every8d_settings_sessions
  from public, anon, authenticated, service_role;

revoke all on function
  public.assert_every8d_settings_installation_eligible_v1(uuid, integer),
  public.protect_every8d_settings_enrollment_grant_v1(),
  public.protect_every8d_settings_administrator_v1(),
  public.protect_every8d_settings_session_v1(),
  public.issue_every8d_settings_operator_enrollment_grant_v1(
    uuid, integer, text, bytea, text, timestamptz, text, text, text, text
  ),
  public.invalidate_every8d_settings_auth_v1()
from public, anon, authenticated, service_role;

comment on table public.every8d_settings_administrators is
  'C3a generation-bound WinCRM settings administrator bindings; no browser authority.';
comment on table public.every8d_settings_enrollment_grants is
  'C3a one-time settings enrollment capabilities. Only SHA-256 token hashes are stored.';
comment on table public.every8d_settings_sessions is
  'C3a server-side settings authorization sessions. Only SHA-256 token hashes are stored.';
comment on function public.issue_every8d_settings_operator_enrollment_grant_v1(
  uuid, integer, text, bytea, text, timestamptz, text, text, text, text
) is
  'Owner-only dual-control operator grant issuance. Accepts a SHA-256 token hash and returns safe metadata only.';

commit;
