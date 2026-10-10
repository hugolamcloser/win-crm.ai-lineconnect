-- C3b-1: owner-only EVERY8D settings email challenge database foundation.
-- No browser authority, email delivery, session creation, or provider calls.
begin;
set local lock_timeout = '5s';

-- Supabase installs pgcrypto in extensions. Verify the exact trusted dependency;
-- this migration must neither install pgcrypto nor move it between schemas.
do $$
declare
  pgcrypto_extension_oid oid;
  pgcrypto_schema name;
begin
  select e.oid,n.nspname
  into pgcrypto_extension_oid,pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid=e.extnamespace
  where e.extname='pgcrypto';

  if pgcrypto_extension_oid is null then
    raise exception 'C3b-1 migration requires pgcrypto extension'
      using errcode = '55000';
  end if;

  if pgcrypto_schema <> 'extensions' then
    raise exception 'C3b-1 migration requires pgcrypto extension in extensions schema'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    join pg_catalog.pg_depend d
      on d.classid='pg_catalog.pg_proc'::pg_catalog.regclass
      and d.objid=p.oid
      and d.objsubid=0
      and d.refclassid='pg_catalog.pg_extension'::pg_catalog.regclass
      and d.refobjid=pgcrypto_extension_oid
      and d.deptype='e'
    where n.nspname='extensions'
      and p.proname='digest'
      and p.pronargs=2
      and p.proargtypes[0]='pg_catalog.bytea'::pg_catalog.regtype
      and p.proargtypes[1]='pg_catalog.text'::pg_catalog.regtype
      and p.prorettype='pg_catalog.bytea'::pg_catalog.regtype
  ) then
    raise exception 'C3b-1 migration requires extensions.digest(bytea,text)'
      using errcode = '55000';
  end if;
end;
$$;

-- Frozen parent-first migration lock order. Do not rely on implicit DDL locks.
lock table public.ghl_marketplace_installations in share row exclusive mode;
lock table public.every8d_settings_enrollment_grants in share row exclusive mode;
lock table public.every8d_settings_administrators in share row exclusive mode;

do $$
declare
  expected_owner oid;
begin
  select c.relowner into expected_owner
  from pg_catalog.pg_class c
  where c.oid = 'public.ghl_marketplace_installations'::regclass;

  if expected_owner <> current_user::regrole::oid
    or exists (
      select 1
      from pg_catalog.pg_class c
      where c.oid in (
        'public.every8d_settings_enrollment_grants'::regclass,
        'public.every8d_settings_administrators'::regclass
      )
        and c.relowner <> expected_owner
    ) then
    raise exception 'C3b-1 migration requires trusted common ownership'
      using errcode = '42501';
  end if;

  if pg_catalog.current_setting('server_encoding') <> 'UTF8' then
    raise exception 'C3b-1 migration requires UTF8 database encoding'
      using errcode = '22021';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles r
    cross join pg_catalog.pg_namespace n
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and n.nspname = 'public'
      and pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE')
  ) or exists (
    select 1
    from pg_catalog.pg_namespace n,
         lateral pg_catalog.aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    where n.nspname = 'public'
      and a.grantee = 0
      and a.privilege_type = 'CREATE'
  ) then
    raise exception 'C3b-1 migration refuses untrusted CREATE privilege on public'
      using errcode = '42501';
  end if;
end;
$$;

create function public.is_every8d_settings_canonical_email_v1(input_value text)
returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, public
as $$
declare
  local_part text;
  domain_part text;
  label text;
begin
  if octet_length(input_value) not between 3 and 254
    or octet_length(input_value) <> char_length(input_value)
    or length(input_value) - length(replace(input_value, '@', '')) <> 1 then
    return false;
  end if;

  local_part := split_part(input_value, '@', 1);
  domain_part := split_part(input_value, '@', 2);
  if octet_length(local_part) not between 1 and 64
    or octet_length(domain_part) not between 1 and 253
    or local_part collate "C" !~
      '^[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+([.][A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+)*$'
    or domain_part collate "C" <> lower(domain_part collate "C") then
    return false;
  end if;

  foreach label in array string_to_array(domain_part, '.') loop
    if octet_length(label) not between 1 and 63
      or label collate "C" !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- The validator must exist before the compatibility scan. Capture one time.
do $$
declare
  preflight_at timestamptz := clock_timestamp();
begin
  if exists (
    select 1
    from public.every8d_settings_administrators a
    where a.revoked_at is null
      and not public.is_every8d_settings_canonical_email_v1(a.normalized_email)
  ) then
    raise exception 'C3b-1 preflight found a non-canonical active administrator email'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.every8d_settings_enrollment_grants g
    where g.revoked_at is null
      and g.consumed_at is null
      and g.expires_at > preflight_at
      and g.pinned_normalized_email is not null
      and not public.is_every8d_settings_canonical_email_v1(g.pinned_normalized_email)
  ) then
    raise exception 'C3b-1 preflight found a non-canonical live pinned grant email'
      using errcode = '23514';
  end if;
end;
$$;

create function public.is_every8d_settings_email_pseudonym_v1(input_value text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = pg_catalog, public
as $$
  select input_value collate "C" ~ '^[A-Za-z0-9_.-]{1,63}:[0-9a-f]{64}$'
$$;

create function public.every8d_settings_email_lock_word_v1(input_pseudonym text)
returns integer
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, public
as $$
declare
  lock_digest bytea;
  unsigned_word bigint;
begin
  if not public.is_every8d_settings_email_pseudonym_v1(input_pseudonym) then
    raise exception 'EVERY8D settings email pseudonym is invalid'
      using errcode = '23514';
  end if;
  lock_digest := extensions.digest(
    convert_to('wincrm/every8d/settings/email-lock/v1', 'UTF8')
      || decode('00', 'hex') || convert_to(input_pseudonym, 'UTF8'),
    'sha256'
  );
  unsigned_word := get_byte(lock_digest, 0)::bigint * 16777216
    + get_byte(lock_digest, 1)::bigint * 65536
    + get_byte(lock_digest, 2)::bigint * 256
    + get_byte(lock_digest, 3)::bigint;
  return case when unsigned_word < 2147483648 then unsigned_word::integer
    else (unsigned_word - 4294967296)::integer end;
end;
$$;

create table public.every8d_settings_auth_challenges (
  id uuid primary key default gen_random_uuid(),
  request_token_hash bytea not null unique,
  purpose text not null,
  enrollment_grant_id uuid null,
  normalized_email text null,
  email_pseudonym text not null,
  otp_hmac bytea not null,
  otp_hmac_key_version text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  delivery_succeeded_at timestamptz null,
  delivery_failed_at timestamptz null,
  delivery_failure_class text null,
  locked_at timestamptz null,
  superseded_at timestamptz null,
  supersession_reason text null,
  verified_at timestamptz null,
  consumed_at timestamptz null,
  email_scrubbed_at timestamptz null,
  constraint every8d_settings_auth_challenges_grant_fk
    foreign key (enrollment_grant_id)
    references public.every8d_settings_enrollment_grants(id)
    on update restrict on delete restrict,
  constraint every8d_settings_auth_challenges_request_hash_check
    check (octet_length(request_token_hash) = 32),
  constraint every8d_settings_auth_challenges_purpose_check
    check (
      (purpose = 'enrollment' and enrollment_grant_id is not null)
      or (purpose = 'login' and enrollment_grant_id is null)
    ),
  constraint every8d_settings_auth_challenges_email_check
    check (
      normalized_email is null
      or public.is_every8d_settings_canonical_email_v1(normalized_email)
    ),
  constraint every8d_settings_auth_challenges_pseudonym_check
    check (public.is_every8d_settings_email_pseudonym_v1(email_pseudonym)),
  constraint every8d_settings_auth_challenges_otp_check
    check (
      octet_length(otp_hmac) = 32
      and otp_hmac_key_version collate "C" ~ '^[A-Za-z0-9_.-]{1,63}$'
    ),
  constraint every8d_settings_auth_challenges_reason_check
    check (
      (delivery_failed_at is null and delivery_failure_class is null)
      or (
        delivery_failed_at is not null
        and delivery_failure_class in (
          'provider_rejected', 'delivery_outcome_unknown', 'sender_unavailable'
        )
      )
    ),
  constraint every8d_settings_auth_challenges_supersession_check
    check (
      (superseded_at is null and supersession_reason is null)
      or (
        superseded_at is not null
        and supersession_reason in ('resend', 'grant_revoked', 'grant_consumed')
      )
    ),
  constraint every8d_settings_auth_challenges_time_check
    check (
      isfinite(created_at) and isfinite(expires_at) and created_at < expires_at
      and (delivery_succeeded_at is null or (
        isfinite(delivery_succeeded_at) and created_at <= delivery_succeeded_at
        and delivery_succeeded_at < expires_at
      ))
      and (delivery_failed_at is null or (
        isfinite(delivery_failed_at) and created_at <= delivery_failed_at
        and delivery_failed_at < expires_at
      ))
      and (locked_at is null or (
        isfinite(locked_at) and created_at <= locked_at and locked_at < expires_at
        and delivery_succeeded_at is not null
        and locked_at >= delivery_succeeded_at
      ))
      and (superseded_at is null or (
        isfinite(superseded_at) and created_at <= superseded_at
        and superseded_at < expires_at
        and (delivery_succeeded_at is null or superseded_at >= delivery_succeeded_at)
      ))
      and (verified_at is null or (
        isfinite(verified_at) and created_at <= verified_at and verified_at < expires_at
        and delivery_succeeded_at is not null
        and verified_at >= delivery_succeeded_at
      ))
      and (consumed_at is null or (
        isfinite(consumed_at) and created_at <= consumed_at and consumed_at < expires_at
        and verified_at is not null and verified_at <= consumed_at
      ))
      and (email_scrubbed_at is null or isfinite(email_scrubbed_at))
    ),
  constraint every8d_settings_auth_challenges_expiry_check
    check (
      (purpose = 'login' and expires_at = created_at + interval '10 minutes')
      or purpose = 'enrollment'
    ),
  constraint every8d_settings_auth_challenges_state_check
    check (
      -- PENDING_DELIVERY, optionally scrubbed only after derived expiry.
      (
        delivery_succeeded_at is null and delivery_failed_at is null
        and locked_at is null and superseded_at is null and verified_at is null
        and consumed_at is null and (
          (normalized_email is not null and email_scrubbed_at is null)
          or (normalized_email is null and email_scrubbed_at >= expires_at)
        )
      )
      or
      -- LIVE, optionally scrubbed only after derived expiry.
      (
        delivery_succeeded_at is not null and delivery_failed_at is null
        and locked_at is null and superseded_at is null and verified_at is null
        and consumed_at is null and (
          (normalized_email is not null and email_scrubbed_at is null)
          or (normalized_email is null and email_scrubbed_at >= expires_at)
        )
      )
      or
      -- DELIVERY_FAILED.
      (
        delivery_succeeded_at is null and delivery_failed_at is not null
        and locked_at is null and superseded_at is null and verified_at is null
        and consumed_at is null and normalized_email is null
        and email_scrubbed_at = delivery_failed_at
      )
      or
      -- LOCKED.
      (
        delivery_succeeded_at is not null and delivery_failed_at is null
        and locked_at is not null and superseded_at is null and verified_at is null
        and consumed_at is null and normalized_email is null
        and email_scrubbed_at = locked_at
      )
      or
      -- SUPERSEDED. A delivered challenge may retain delivery_succeeded_at.
      (
        delivery_failed_at is null and locked_at is null and superseded_at is not null
        and verified_at is null and consumed_at is null and normalized_email is null
        and email_scrubbed_at = superseded_at
      )
      or
      -- VERIFIED, optionally scrubbed only after derived expiry.
      (
        delivery_succeeded_at is not null and delivery_failed_at is null
        and locked_at is null and superseded_at is null and verified_at is not null
        and consumed_at is null and (
          (normalized_email is not null and email_scrubbed_at is null)
          or (normalized_email is null and email_scrubbed_at >= expires_at)
        )
      )
      or
      -- CONSUMED.
      (
        delivery_succeeded_at is not null and delivery_failed_at is null
        and locked_at is null and superseded_at is null and verified_at is not null
        and consumed_at is not null and normalized_email is null
        and email_scrubbed_at = consumed_at
      )
    )
);

create table public.every8d_settings_auth_challenge_failures (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null,
  attempt_number integer not null,
  failed_at timestamptz not null default clock_timestamp(),
  constraint every8d_settings_auth_challenge_failures_challenge_fk
    foreign key (challenge_id)
    references public.every8d_settings_auth_challenges(id)
    on update restrict on delete restrict,
  constraint every8d_settings_auth_challenge_failures_attempt_key
    unique (challenge_id, attempt_number),
  constraint every8d_settings_auth_challenge_failures_attempt_check
    check (attempt_number between 1 and 5),
  constraint every8d_settings_auth_challenge_failures_time_check
    check (isfinite(failed_at))
);

create index every8d_settings_administrators_c3b_active_email_lookup_idx
  on public.every8d_settings_administrators(
    normalized_email, installation_id, installation_generation
  ) where revoked_at is null;
create index every8d_settings_auth_challenges_email_history_idx
  on public.every8d_settings_auth_challenges(email_pseudonym, created_at desc);
create index every8d_settings_auth_challenges_grant_history_idx
  on public.every8d_settings_auth_challenges(enrollment_grant_id, created_at desc)
  where enrollment_grant_id is not null;
create index every8d_settings_auth_challenges_expired_email_scrub_idx
  on public.every8d_settings_auth_challenges(expires_at, id)
  where normalized_email is not null;
create index every8d_settings_auth_challenge_failures_failed_at_idx
  on public.every8d_settings_auth_challenge_failures(failed_at, challenge_id);

create function public.lock_every8d_settings_email_pseudonyms_v1(
  input_aliases text[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  alias_value text;
  lock_word integer;
begin
  if input_aliases is null or cardinality(input_aliases) < 1
    or cardinality(input_aliases) > 64 then
    raise exception 'EVERY8D settings pseudonym aliases are invalid'
      using errcode = '23514';
  end if;

  -- Validate every exact alias before taking any lock.
  foreach alias_value in array input_aliases loop
    if alias_value is null
      or not public.is_every8d_settings_email_pseudonym_v1(alias_value) then
      raise exception 'EVERY8D settings pseudonym aliases are invalid'
        using errcode = '23514';
    end if;
  end loop;

  -- Exact aliases and projected lock pairs are independently deduplicated.
  for lock_word in
    select distinct public.every8d_settings_email_lock_word_v1(a.alias_value)
    from (select distinct u.alias_value collate "C" as alias_value
          from unnest(input_aliases) u(alias_value)) a
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(1163278404, lock_word);
  end loop;
end;
$$;

create function public.protect_every8d_settings_auth_challenge_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  grant_row record;
begin
  if tg_op = 'DELETE' then
    if current_setting('wincrm.c3b_cleanup', true) is distinct from 'on' then
      raise exception 'EVERY8D settings challenges cannot be deleted directly'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.normalized_email is null or new.email_scrubbed_at is not null
      or new.delivery_succeeded_at is not null
      or new.delivery_failed_at is not null or new.delivery_failure_class is not null
      or new.locked_at is not null
      or new.superseded_at is not null or new.supersession_reason is not null
      or new.verified_at is not null or new.consumed_at is not null then
      raise exception 'EVERY8D settings challenge must be inserted pending delivery'
        using errcode = '23514';
    end if;
    if new.purpose = 'login' then
      if new.expires_at <> new.created_at + interval '10 minutes' then
        raise exception 'EVERY8D login challenge expiry is invalid'
          using errcode = '23514';
      end if;
    else
      select g.* into grant_row
      from public.every8d_settings_enrollment_grants g
      where g.id = new.enrollment_grant_id
      for share of g;
      if not found
        or grant_row.revoked_at is not null or grant_row.consumed_at is not null
        or grant_row.expires_at < new.created_at + interval '2 minutes'
        or new.expires_at <> least(
          new.created_at + interval '10 minutes', grant_row.expires_at
        )
        or (
          grant_row.pinned_normalized_email is not null
          and grant_row.pinned_normalized_email is distinct from new.normalized_email
        ) then
        raise exception 'EVERY8D enrollment challenge grant is invalid'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if row(
    new.id, new.request_token_hash, new.purpose, new.enrollment_grant_id,
    new.email_pseudonym, new.otp_hmac, new.otp_hmac_key_version,
    new.created_at, new.expires_at
  ) is distinct from row(
    old.id, old.request_token_hash, old.purpose, old.enrollment_grant_id,
    old.email_pseudonym, old.otp_hmac, old.otp_hmac_key_version,
    old.created_at, old.expires_at
  ) then
    raise exception 'EVERY8D settings challenge identity is immutable'
      using errcode = '23514';
  end if;

  if row(
    new.delivery_succeeded_at, new.delivery_failed_at, new.delivery_failure_class,
    new.locked_at, new.superseded_at, new.supersession_reason,
    new.verified_at, new.consumed_at, new.normalized_email, new.email_scrubbed_at
  ) is not distinct from row(
    old.delivery_succeeded_at, old.delivery_failed_at, old.delivery_failure_class,
    old.locked_at, old.superseded_at, old.supersession_reason,
    old.verified_at, old.consumed_at, old.normalized_email, old.email_scrubbed_at
  ) then
    return new;
  end if;

  -- The only non-authority transition is an email scrub after derived expiry.
  if row(
    new.delivery_succeeded_at, new.delivery_failed_at, new.delivery_failure_class,
    new.locked_at, new.superseded_at, new.supersession_reason,
    new.verified_at, new.consumed_at
  ) is not distinct from row(
    old.delivery_succeeded_at, old.delivery_failed_at, old.delivery_failure_class,
    old.locked_at, old.superseded_at, old.supersession_reason,
    old.verified_at, old.consumed_at
  ) then
    if old.normalized_email is not null and new.normalized_email is null
      and old.email_scrubbed_at is null and new.email_scrubbed_at >= old.expires_at
      and isfinite(new.email_scrubbed_at)
      and clock_timestamp() >= old.expires_at then
      return new;
    end if;
    raise exception 'EVERY8D settings challenge scrub transition is invalid'
      using errcode = '23514';
  end if;

  if clock_timestamp() >= old.expires_at then
    raise exception 'EVERY8D settings challenge authority cannot change after expiry'
      using errcode = '23514';
  end if;

  -- PENDING_DELIVERY -> LIVE. Only delivery_succeeded_at may change.
  if old.delivery_succeeded_at is null and old.delivery_failed_at is null
    and old.delivery_failure_class is null
    and old.locked_at is null and old.superseded_at is null
    and old.supersession_reason is null and old.verified_at is null
    and old.consumed_at is null and old.normalized_email is not null
    and old.email_scrubbed_at is null
    and new.delivery_succeeded_at is not null
    and new.delivery_succeeded_at < old.expires_at
    and row(
      new.delivery_failed_at, new.delivery_failure_class, new.locked_at,
      new.superseded_at, new.supersession_reason, new.verified_at, new.consumed_at,
      new.normalized_email, new.email_scrubbed_at
    ) is not distinct from row(
      old.delivery_failed_at, old.delivery_failure_class, old.locked_at,
      old.superseded_at, old.supersession_reason, old.verified_at, old.consumed_at,
      old.normalized_email, old.email_scrubbed_at
    ) then
    return new;

  -- PENDING_DELIVERY -> DELIVERY_FAILED.
  elsif old.delivery_succeeded_at is null and old.delivery_failed_at is null
    and old.delivery_failure_class is null
    and old.locked_at is null and old.superseded_at is null
    and old.supersession_reason is null and old.verified_at is null
    and old.consumed_at is null and old.normalized_email is not null
    and old.email_scrubbed_at is null
    and new.delivery_succeeded_at is null
    and new.delivery_failed_at is not null
    and new.delivery_failed_at < old.expires_at
    and new.delivery_failure_class in (
      'provider_rejected', 'delivery_outcome_unknown', 'sender_unavailable'
    )
    and new.locked_at is null and new.superseded_at is null
    and new.supersession_reason is null and new.verified_at is null
    and new.consumed_at is null and new.normalized_email is null
    and new.email_scrubbed_at = new.delivery_failed_at then
    return new;

  -- PENDING_DELIVERY -> SUPERSEDED.
  elsif old.delivery_succeeded_at is null and old.delivery_failed_at is null
    and old.delivery_failure_class is null
    and old.locked_at is null and old.superseded_at is null
    and old.supersession_reason is null and old.verified_at is null
    and old.consumed_at is null and old.normalized_email is not null
    and old.email_scrubbed_at is null
    and new.delivery_succeeded_at is null and new.delivery_failed_at is null
    and new.delivery_failure_class is null and new.locked_at is null
    and new.superseded_at is not null and new.superseded_at < old.expires_at
    and new.supersession_reason in ('resend', 'grant_revoked', 'grant_consumed')
    and new.verified_at is null and new.consumed_at is null
    and new.normalized_email is null
    and new.email_scrubbed_at = new.superseded_at then
    return new;

  -- LIVE -> LOCKED.
  elsif old.delivery_succeeded_at is not null and old.delivery_failed_at is null
    and old.delivery_failure_class is null and old.locked_at is null
    and old.superseded_at is null and old.verified_at is null
    and old.supersession_reason is null and old.consumed_at is null
    and old.normalized_email is not null and old.email_scrubbed_at is null
    and new.delivery_succeeded_at is not distinct from old.delivery_succeeded_at
    and new.delivery_failed_at is null and new.delivery_failure_class is null
    and new.locked_at is not null and new.locked_at >= old.delivery_succeeded_at
    and new.locked_at < old.expires_at
    and new.superseded_at is null and new.supersession_reason is null
    and new.verified_at is null and new.consumed_at is null
    and new.normalized_email is null and new.email_scrubbed_at = new.locked_at then
    return new;

  -- LIVE -> SUPERSEDED.
  elsif old.delivery_succeeded_at is not null and old.delivery_failed_at is null
    and old.delivery_failure_class is null and old.locked_at is null
    and old.superseded_at is null and old.supersession_reason is null
    and old.verified_at is null and old.consumed_at is null
    and old.normalized_email is not null and old.email_scrubbed_at is null
    and new.delivery_succeeded_at is not distinct from old.delivery_succeeded_at
    and new.delivery_failed_at is null and new.delivery_failure_class is null
    and new.locked_at is null and new.superseded_at is not null
    and new.superseded_at >= old.delivery_succeeded_at
    and new.superseded_at < old.expires_at
    and new.supersession_reason in ('resend', 'grant_revoked', 'grant_consumed')
    and new.verified_at is null and new.consumed_at is null
    and new.normalized_email is null
    and new.email_scrubbed_at = new.superseded_at then
    return new;

  -- LIVE -> VERIFIED.
  elsif old.delivery_succeeded_at is not null and old.delivery_failed_at is null
    and old.delivery_failure_class is null and old.locked_at is null
    and old.superseded_at is null and old.supersession_reason is null
    and old.verified_at is null and old.consumed_at is null
    and old.normalized_email is not null and old.email_scrubbed_at is null
    and new.delivery_succeeded_at is not distinct from old.delivery_succeeded_at
    and new.delivery_failed_at is null and new.delivery_failure_class is null
    and new.locked_at is null and new.superseded_at is null
    and new.supersession_reason is null and new.verified_at is not null
    and new.verified_at >= old.delivery_succeeded_at
    and new.verified_at < old.expires_at and new.consumed_at is null
    and new.normalized_email is not distinct from old.normalized_email
    and new.email_scrubbed_at is null then
    return new;

  -- VERIFIED -> CONSUMED.
  elsif old.delivery_succeeded_at is not null and old.delivery_failed_at is null
    and old.delivery_failure_class is null and old.locked_at is null
    and old.superseded_at is null and old.supersession_reason is null
    and old.verified_at is not null and old.consumed_at is null
    and old.normalized_email is not null and old.email_scrubbed_at is null
    and new.delivery_succeeded_at is not distinct from old.delivery_succeeded_at
    and new.delivery_failed_at is null and new.delivery_failure_class is null
    and new.locked_at is null and new.superseded_at is null
    and new.supersession_reason is null
    and new.verified_at is not distinct from old.verified_at
    and new.consumed_at is not null and new.consumed_at >= old.verified_at
    and new.consumed_at < old.expires_at
    and new.normalized_email is null and new.email_scrubbed_at = new.consumed_at then
    return new;
  end if;

  raise exception 'EVERY8D settings challenge transition is invalid'
    using errcode = '23514';
end;
$$;

create function public.protect_every8d_settings_auth_challenge_failure_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  challenge_row public.every8d_settings_auth_challenges%rowtype;
  existing_count integer;
begin
  if tg_op = 'UPDATE' then
    raise exception 'EVERY8D settings challenge failures are append-only'
      using errcode = '23514';
  elsif tg_op = 'DELETE' then
    if current_setting('wincrm.c3b_cleanup', true) is distinct from 'on' then
      raise exception 'EVERY8D settings challenge failures cannot be deleted directly'
        using errcode = '23514';
    end if;
    return old;
  end if;

  select c.* into challenge_row
  from public.every8d_settings_auth_challenges c
  where c.id = new.challenge_id
  for update of c;
  select count(*)::integer into existing_count
  from public.every8d_settings_auth_challenge_failures f
  where f.challenge_id = new.challenge_id;

  if challenge_row.id is null or new.attempt_number <> existing_count + 1
    or existing_count >= 5
    or new.failed_at < challenge_row.delivery_succeeded_at
    or new.failed_at >= challenge_row.expires_at
    or challenge_row.delivery_succeeded_at is null
    or challenge_row.delivery_failed_at is not null
    or challenge_row.locked_at is not null
    or challenge_row.superseded_at is not null
    or challenge_row.verified_at is not null
    or challenge_row.consumed_at is not null
    or clock_timestamp() >= challenge_row.expires_at then
    raise exception 'EVERY8D settings challenge failure append is invalid'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.lock_every8d_settings_challenge_on_fifth_failure_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.attempt_number = 5 then
    update public.every8d_settings_auth_challenges
    set locked_at = new.failed_at,
        normalized_email = null,
        email_scrubbed_at = new.failed_at
    where id = new.challenge_id;
  end if;
  return null;
end;
$$;

create function public.assert_every8d_settings_challenge_integrity_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_id uuid;
  challenge_row public.every8d_settings_auth_challenges%rowtype;
  failure_count integer;
  attempts integer[];
  fifth_failed_at timestamptz;
begin
  if tg_table_name = 'every8d_settings_auth_challenge_failures' then
    target_id := case when tg_op = 'DELETE' then old.challenge_id else new.challenge_id end;
  else
    target_id := case when tg_op = 'DELETE' then old.id else new.id end;
  end if;

  select c.* into challenge_row
  from public.every8d_settings_auth_challenges c where c.id = target_id;
  if not found then
    if current_setting('wincrm.c3b_cleanup', true) = 'on' then return null; end if;
    raise exception 'EVERY8D challenge integrity lost its parent'
      using errcode = '23514';
  end if;

  select count(*)::integer, array_agg(f.attempt_number order by f.attempt_number),
         max(f.failed_at) filter (where f.attempt_number = 5)
  into failure_count, attempts, fifth_failed_at
  from public.every8d_settings_auth_challenge_failures f
  where f.challenge_id = target_id;

  if failure_count > 5
    or (failure_count > 0 and attempts <> array(select generate_series(1, failure_count)))
    or exists (
      select 1 from (
        select f.failed_at, lag(f.failed_at) over (order by f.attempt_number) prior
        from public.every8d_settings_auth_challenge_failures f
        where f.challenge_id = target_id
      ) ordered where prior is not null and failed_at < prior
    )
    or exists (
      select 1 from public.every8d_settings_auth_challenge_failures f
      where f.challenge_id = target_id
        and (challenge_row.delivery_succeeded_at is null
          or f.failed_at < challenge_row.delivery_succeeded_at
          or f.failed_at >= challenge_row.expires_at)
    )
    or ((failure_count = 5) <> (challenge_row.locked_at is not null))
    or (challenge_row.locked_at is not null
      and challenge_row.locked_at is distinct from fifth_failed_at)
    or (challenge_row.verified_at is not null and failure_count >= 5)
    or (challenge_row.consumed_at is not null and failure_count >= 5) then
    raise exception 'EVERY8D settings challenge failure ledger is inconsistent'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create trigger protect_every8d_settings_auth_challenge
before insert or update or delete on public.every8d_settings_auth_challenges
for each row execute function public.protect_every8d_settings_auth_challenge_v1();
create trigger protect_every8d_settings_auth_challenge_failure
before insert or update or delete on public.every8d_settings_auth_challenge_failures
for each row execute function public.protect_every8d_settings_auth_challenge_failure_v1();
create trigger lock_every8d_settings_challenge_on_fifth_failure
after insert on public.every8d_settings_auth_challenge_failures
for each row execute function public.lock_every8d_settings_challenge_on_fifth_failure_v1();
create constraint trigger assert_every8d_settings_challenge_row_integrity
after insert or update or delete on public.every8d_settings_auth_challenges
deferrable initially deferred
for each row execute function public.assert_every8d_settings_challenge_integrity_v1();
create constraint trigger assert_every8d_settings_failure_ledger_integrity
after insert or update or delete on public.every8d_settings_auth_challenge_failures
deferrable initially deferred
for each row execute function public.assert_every8d_settings_challenge_integrity_v1();

create function public.record_every8d_settings_challenge_delivery_v1(
  input_request_token_hash bytea,
  input_succeeded boolean,
  input_failure_class text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  challenge_row public.every8d_settings_auth_challenges%rowtype;
  recorded_at timestamptz;
begin
  if input_request_token_hash is null or octet_length(input_request_token_hash) <> 32
    or input_succeeded is null
    or (input_succeeded and input_failure_class is not null)
    or (not input_succeeded and input_failure_class not in (
      'provider_rejected', 'delivery_outcome_unknown', 'sender_unavailable'
    )) then
    raise exception 'EVERY8D challenge delivery result is invalid'
      using errcode = '23514';
  end if;
  select c.* into challenge_row from public.every8d_settings_auth_challenges c
  where c.request_token_hash = input_request_token_hash for update of c;
  recorded_at := clock_timestamp();
  if not found or challenge_row.delivery_succeeded_at is not null
    or challenge_row.delivery_failed_at is not null
    or challenge_row.locked_at is not null or challenge_row.superseded_at is not null
    or challenge_row.verified_at is not null or challenge_row.consumed_at is not null
    or recorded_at >= challenge_row.expires_at then
    return false;
  end if;
  if input_succeeded then
    update public.every8d_settings_auth_challenges
    set delivery_succeeded_at = recorded_at where id = challenge_row.id;
  else
    update public.every8d_settings_auth_challenges
    set delivery_failed_at = recorded_at, delivery_failure_class = input_failure_class,
        normalized_email = null, email_scrubbed_at = recorded_at
    where id = challenge_row.id;
  end if;
  return true;
end;
$$;

create function public.discover_every8d_settings_challenge_v1(
  input_request_token_hash bytea,
  input_purpose text
)
returns table(
  challenge_id uuid, enrollment_grant_id uuid,
  normalized_email text, email_pseudonym text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select c.id, c.enrollment_grant_id, c.normalized_email, c.email_pseudonym
  from public.every8d_settings_auth_challenges c
  where octet_length(input_request_token_hash) = 32
    and input_purpose in ('enrollment', 'login')
    and c.request_token_hash = input_request_token_hash
    and c.purpose = input_purpose
    and c.normalized_email is not null
    and c.delivery_succeeded_at is not null
    and c.delivery_failed_at is null and c.locked_at is null
    and c.superseded_at is null and c.verified_at is null and c.consumed_at is null
    and c.expires_at > clock_timestamp()
$$;

create function public.assert_every8d_settings_challenge_rate_limits_v1(
  input_aliases text[], input_grant_id uuid, input_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.every8d_settings_auth_challenges c
    where c.email_pseudonym = any(input_aliases)
      and c.created_at > input_now - interval '60 seconds'
  ) or (select count(*) from public.every8d_settings_auth_challenges c
        where c.email_pseudonym = any(input_aliases)
          and c.created_at > input_now - interval '1 hour') >= 3
    or (select count(*) from public.every8d_settings_auth_challenges c
        where c.email_pseudonym = any(input_aliases)
          and c.created_at > input_now - interval '24 hours') >= 10
    or (input_grant_id is not null and (
        select count(*) from public.every8d_settings_auth_challenges c
        where c.enrollment_grant_id = input_grant_id) >= 3)
    or (select count(*)
        from public.every8d_settings_auth_challenge_failures f
        join public.every8d_settings_auth_challenges c on c.id = f.challenge_id
        where c.email_pseudonym = any(input_aliases)
          and f.failed_at > input_now - interval '1 hour') >= 10 then
    raise exception 'EVERY8D settings challenge rate limit exceeded'
      using errcode = 'P0001';
  end if;
end;
$$;

create function public.request_every8d_settings_enrollment_challenge_v1(
  input_enrollment_grant_id uuid,
  input_normalized_email text,
  input_email_pseudonym text,
  input_email_pseudonym_aliases text[],
  input_request_token_hash bytea,
  input_otp_hmac bytea,
  input_otp_hmac_key_version text
)
returns table(challenge_id uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  locked_grant record;
  requested_at timestamptz;
begin
  if not public.is_every8d_settings_canonical_email_v1(input_normalized_email)
    or not public.is_every8d_settings_email_pseudonym_v1(input_email_pseudonym)
    or input_email_pseudonym <> all(input_email_pseudonym_aliases)
    or octet_length(input_request_token_hash) <> 32
    or octet_length(input_otp_hmac) <> 32
    or input_otp_hmac_key_version collate "C" !~ '^[A-Za-z0-9_.-]{1,63}$' then
    raise exception 'EVERY8D enrollment challenge input is invalid'
      using errcode = '23514';
  end if;
  lock table public.ghl_marketplace_installations in row share mode;
  lock table public.every8d_settings_enrollment_grants in row share mode;
  lock table public.every8d_settings_auth_challenges in row exclusive mode;
  lock table public.every8d_settings_auth_challenge_failures in row share mode;
  select g.* into locked_grant from public.every8d_settings_enrollment_grants g
  where g.id = input_enrollment_grant_id;
  if not found then
    raise exception 'EVERY8D enrollment grant is invalid' using errcode='23514';
  end if;
  perform 1 from public.ghl_marketplace_installations i
  where i.id = locked_grant.installation_id for share of i;
  if not found then
    raise exception 'EVERY8D enrollment grant parent is invalid' using errcode='23514';
  end if;
  select g.* into locked_grant from public.every8d_settings_enrollment_grants g
  where g.id = input_enrollment_grant_id for update of g;
  if not found then
    raise exception 'EVERY8D enrollment grant is invalid' using errcode='23514';
  end if;
  perform public.assert_every8d_settings_installation_eligible_v1(
    locked_grant.installation_id, locked_grant.installation_generation
  );
  requested_at := clock_timestamp();
  if locked_grant.id is null or locked_grant.revoked_at is not null
    or locked_grant.consumed_at is not null
    or locked_grant.expires_at < requested_at + interval '2 minutes'
    or (locked_grant.pinned_normalized_email is not null
      and locked_grant.pinned_normalized_email <> input_normalized_email) then
    raise exception 'EVERY8D enrollment grant is not usable' using errcode='23514';
  end if;
  perform public.lock_every8d_settings_email_pseudonyms_v1(input_email_pseudonym_aliases);
  perform public.assert_every8d_settings_challenge_rate_limits_v1(
    input_email_pseudonym_aliases, locked_grant.id, requested_at
  );
  update public.every8d_settings_auth_challenges c
  set superseded_at=requested_at, supersession_reason='resend',
      normalized_email=null, email_scrubbed_at=requested_at
  where c.purpose='enrollment' and c.enrollment_grant_id=locked_grant.id
    and c.email_pseudonym=any(input_email_pseudonym_aliases)
    and c.expires_at > requested_at and c.delivery_failed_at is null
    and c.locked_at is null and c.superseded_at is null
    and c.verified_at is null and c.consumed_at is null;
  return query insert into public.every8d_settings_auth_challenges(
    request_token_hash,purpose,enrollment_grant_id,normalized_email,email_pseudonym,
    otp_hmac,otp_hmac_key_version,created_at,expires_at
  ) values (
    input_request_token_hash,'enrollment',locked_grant.id,input_normalized_email,
    input_email_pseudonym,input_otp_hmac,input_otp_hmac_key_version,requested_at,
    least(requested_at + interval '10 minutes', locked_grant.expires_at)
  ) returning id, every8d_settings_auth_challenges.created_at,
      every8d_settings_auth_challenges.expires_at;
end;
$$;

create function public.request_every8d_settings_login_challenge_v1(
  input_normalized_email text,
  input_email_pseudonym text,
  input_email_pseudonym_aliases text[],
  input_request_token_hash bytea,
  input_otp_hmac bytea,
  input_otp_hmac_key_version text
)
returns table(challenge_id uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare requested_at timestamptz;
begin
  if not public.is_every8d_settings_canonical_email_v1(input_normalized_email)
    or not public.is_every8d_settings_email_pseudonym_v1(input_email_pseudonym)
    or input_email_pseudonym <> all(input_email_pseudonym_aliases)
    or octet_length(input_request_token_hash) <> 32
    or octet_length(input_otp_hmac) <> 32
    or input_otp_hmac_key_version collate "C" !~ '^[A-Za-z0-9_.-]{1,63}$' then
    raise exception 'EVERY8D login challenge input is invalid' using errcode='23514';
  end if;
  perform public.lock_every8d_settings_email_pseudonyms_v1(input_email_pseudonym_aliases);
  lock table public.ghl_marketplace_installations in row share mode;
  lock table public.every8d_settings_administrators in row share mode;
  lock table public.every8d_settings_auth_challenges in row share mode;
  lock table public.every8d_settings_auth_challenge_failures in row share mode;
  requested_at := clock_timestamp();
  if not exists (
    select 1 from public.every8d_settings_administrators a
    join public.ghl_marketplace_installations i on i.id=a.installation_id
      and i.installation_generation=a.installation_generation
    where a.revoked_at is null and a.normalized_email=input_normalized_email
      and a.email_pseudonym=any(input_email_pseudonym_aliases)
      and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
  ) then
    raise exception 'EVERY8D login challenge is unavailable' using errcode='P0001';
  end if;
  perform public.assert_every8d_settings_challenge_rate_limits_v1(
    input_email_pseudonym_aliases, null, requested_at
  );
  update public.every8d_settings_auth_challenges c
  set superseded_at=requested_at, supersession_reason='resend',
      normalized_email=null, email_scrubbed_at=requested_at
  where c.purpose='login' and c.email_pseudonym=any(input_email_pseudonym_aliases)
    and c.expires_at > requested_at and c.delivery_failed_at is null
    and c.locked_at is null and c.superseded_at is null
    and c.verified_at is null and c.consumed_at is null;
  return query insert into public.every8d_settings_auth_challenges(
    request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
    otp_hmac_key_version,created_at,expires_at
  ) values (
    input_request_token_hash,'login',input_normalized_email,input_email_pseudonym,
    input_otp_hmac,input_otp_hmac_key_version,requested_at,
    requested_at + interval '10 minutes'
  ) returning id, every8d_settings_auth_challenges.created_at,
      every8d_settings_auth_challenges.expires_at;
end;
$$;

create function public.verify_every8d_settings_challenge_v1(
  input_challenge_id uuid,
  input_request_token_hash bytea,
  input_purpose text,
  input_enrollment_grant_id uuid,
  input_normalized_email text,
  input_email_pseudonym_aliases text[],
  input_candidate_otp_hmac bytea
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  grant_row record;
  challenge_row record;
  decided_at timestamptz;
  next_attempt integer;
begin
  if input_purpose not in ('enrollment','login')
    or octet_length(input_request_token_hash) <> 32
    or octet_length(input_candidate_otp_hmac) <> 32
    or not public.is_every8d_settings_canonical_email_v1(input_normalized_email) then
    return false;
  end if;
  if input_purpose='enrollment' then
    lock table public.ghl_marketplace_installations in row share mode;
    lock table public.every8d_settings_enrollment_grants in row share mode;
    lock table public.every8d_settings_auth_challenges in row exclusive mode;
    lock table public.every8d_settings_auth_challenge_failures in row exclusive mode;
    select g.* into grant_row from public.every8d_settings_enrollment_grants g
    where g.id=input_enrollment_grant_id;
    if not found then return false; end if;
    perform 1 from public.ghl_marketplace_installations i
      where i.id=grant_row.installation_id for share of i;
    if not found then return false; end if;
    select g.* into grant_row from public.every8d_settings_enrollment_grants g
      where g.id=input_enrollment_grant_id for share of g;
    if not found or grant_row.revoked_at is not null or grant_row.consumed_at is not null
      or grant_row.expires_at <= clock_timestamp() then return false; end if;
    begin
      perform public.assert_every8d_settings_installation_eligible_v1(
        grant_row.installation_id, grant_row.installation_generation
      );
    exception when check_violation then
      return false;
    end;
  elsif input_enrollment_grant_id is not null then
    return false;
  else
    perform public.lock_every8d_settings_email_pseudonyms_v1(
      input_email_pseudonym_aliases
    );
    lock table public.every8d_settings_auth_challenges in row exclusive mode;
    lock table public.every8d_settings_auth_challenge_failures in row exclusive mode;
  end if;

  if input_purpose='enrollment' then
    perform public.lock_every8d_settings_email_pseudonyms_v1(
      input_email_pseudonym_aliases
    );
  end if;
  select c.* into challenge_row from public.every8d_settings_auth_challenges c
  where c.id=input_challenge_id for update of c;
  decided_at := clock_timestamp();
  if not found or challenge_row.request_token_hash<>input_request_token_hash
    or challenge_row.purpose<>input_purpose
    or challenge_row.enrollment_grant_id is distinct from input_enrollment_grant_id
    or challenge_row.normalized_email is distinct from input_normalized_email
    or challenge_row.email_pseudonym<>all(input_email_pseudonym_aliases)
    or challenge_row.delivery_succeeded_at is null
    or challenge_row.delivery_failed_at is not null or challenge_row.locked_at is not null
    or challenge_row.superseded_at is not null or challenge_row.verified_at is not null
    or challenge_row.consumed_at is not null or decided_at>=challenge_row.expires_at then
    return false;
  end if;
  if challenge_row.otp_hmac = input_candidate_otp_hmac then
    update public.every8d_settings_auth_challenges set verified_at=decided_at
    where id=challenge_row.id;
    return true;
  end if;
  if (select count(*) from public.every8d_settings_auth_challenge_failures f
      join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
      where c.email_pseudonym=any(input_email_pseudonym_aliases)
        and f.failed_at>decided_at-interval '1 hour') >= 10 then
    return false;
  end if;
  select count(*)::integer+1 into next_attempt
  from public.every8d_settings_auth_challenge_failures f
  where f.challenge_id=challenge_row.id;
  insert into public.every8d_settings_auth_challenge_failures(
    challenge_id,attempt_number,failed_at
  ) values(challenge_row.id,next_attempt,decided_at);
  return false;
end;
$$;

create function public.invalidate_every8d_settings_challenges_for_grant_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare invalidated_at timestamptz := clock_timestamp(); reason_value text;
begin
  if old.revoked_at is null and new.revoked_at is not null then
    reason_value := 'grant_revoked';
  elsif old.consumed_at is null and new.consumed_at is not null then
    reason_value := 'grant_consumed';
  else
    return null;
  end if;
  update public.every8d_settings_auth_challenges c
  set superseded_at=invalidated_at, supersession_reason=reason_value,
      normalized_email=null, email_scrubbed_at=invalidated_at
  where c.purpose='enrollment' and c.enrollment_grant_id=new.id
    and c.expires_at>invalidated_at and c.delivery_failed_at is null
    and c.locked_at is null and c.superseded_at is null
    and c.verified_at is null and c.consumed_at is null;
  return null;
end;
$$;

create trigger invalidate_every8d_settings_challenges_after_grant_update
after update of revoked_at, consumed_at on public.every8d_settings_enrollment_grants
for each row
when (
  (old.revoked_at is null and new.revoked_at is not null)
  or (old.consumed_at is null and new.consumed_at is not null)
)
execute function public.invalidate_every8d_settings_challenges_for_grant_v1();

create function public.scrub_expired_every8d_settings_challenge_emails_v1(
  batch_size integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare captured_at timestamptz := clock_timestamp(); affected integer;
begin
  if batch_size is null or batch_size not between 1 and 500 then
    raise exception 'EVERY8D challenge scrub batch size must be 1..500'
      using errcode='22023';
  end if;
  with selected as (
    select c.id from public.every8d_settings_auth_challenges c
    where c.normalized_email is not null and c.expires_at<=captured_at
    order by c.expires_at,c.id for update skip locked limit batch_size
  )
  update public.every8d_settings_auth_challenges c
  set normalized_email=null,email_scrubbed_at=captured_at
  from selected s where c.id=s.id;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function public.cleanup_every8d_settings_auth_challenges_v1(
  batch_size integer
)
returns table(deleted_count integer, anomalous_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare captured_at timestamptz := clock_timestamp(); selected_ids uuid[]; deleted_rows integer;
begin
  if batch_size is null or batch_size not between 1 and 500 then
    raise exception 'EVERY8D challenge cleanup batch size must be 1..500'
      using errcode='22023';
  end if;
  select array_agg(q.id order by q.terminal_at,q.id) into selected_ids
  from (
    select c.id, coalesce(c.consumed_at,c.locked_at,c.superseded_at,
      c.delivery_failed_at,c.expires_at) terminal_at
    from public.every8d_settings_auth_challenges c
    where coalesce(c.consumed_at,c.locked_at,c.superseded_at,
      c.delivery_failed_at,c.expires_at) <= captured_at-interval '30 days'
      and (c.consumed_at is not null or c.locked_at is not null
        or c.superseded_at is not null or c.delivery_failed_at is not null
        or c.expires_at<=captured_at)
    order by terminal_at,c.id for update skip locked limit batch_size
  ) q;
  perform set_config('wincrm.c3b_cleanup','on',true);
  if selected_ids is not null then
    delete from public.every8d_settings_auth_challenge_failures
      where challenge_id=any(selected_ids);
    delete from public.every8d_settings_auth_challenges where id=any(selected_ids);
    get diagnostics deleted_rows = row_count;
  else deleted_rows := 0;
  end if;
  return query select deleted_rows, count(*)::integer
  from public.every8d_settings_auth_challenges c
  where c.expires_at<=captured_at-interval '30 days'
    and coalesce(c.consumed_at,c.locked_at,c.superseded_at,
      c.delivery_failed_at,c.expires_at) is null;
end;
$$;

alter table public.every8d_settings_auth_challenges enable row level security;
alter table public.every8d_settings_auth_challenge_failures enable row level security;
revoke all on public.every8d_settings_auth_challenges
  from public, anon, authenticated, service_role;
revoke all on public.every8d_settings_auth_challenge_failures
  from public, anon, authenticated, service_role;
revoke all on function
  public.is_every8d_settings_canonical_email_v1(text),
  public.is_every8d_settings_email_pseudonym_v1(text),
  public.every8d_settings_email_lock_word_v1(text),
  public.lock_every8d_settings_email_pseudonyms_v1(text[]),
  public.protect_every8d_settings_auth_challenge_v1(),
  public.protect_every8d_settings_auth_challenge_failure_v1(),
  public.lock_every8d_settings_challenge_on_fifth_failure_v1(),
  public.assert_every8d_settings_challenge_integrity_v1(),
  public.record_every8d_settings_challenge_delivery_v1(bytea,boolean,text),
  public.discover_every8d_settings_challenge_v1(bytea,text),
  public.assert_every8d_settings_challenge_rate_limits_v1(text[],uuid,timestamptz),
  public.request_every8d_settings_enrollment_challenge_v1(uuid,text,text,text[],bytea,bytea,text),
  public.request_every8d_settings_login_challenge_v1(text,text,text[],bytea,bytea,text),
  public.verify_every8d_settings_challenge_v1(uuid,bytea,text,uuid,text,text[],bytea),
  public.invalidate_every8d_settings_challenges_for_grant_v1(),
  public.scrub_expired_every8d_settings_challenge_emails_v1(integer),
  public.cleanup_every8d_settings_auth_challenges_v1(integer)
from public, anon, authenticated, service_role;

comment on table public.every8d_settings_auth_challenges is
  'C3b-1 owner-only email challenge authority; digests only, with bounded retention.';
comment on table public.every8d_settings_auth_challenge_failures is
  'C3b-1 append-only failed OTP attempt ledger; identity derives through challenge_id.';

commit;
