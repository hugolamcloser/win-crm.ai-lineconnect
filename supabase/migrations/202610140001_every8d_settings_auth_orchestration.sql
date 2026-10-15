begin;
set local lock_timeout = '5s';

lock table public.ghl_marketplace_installations in share row exclusive mode;
lock table public.every8d_settings_enrollment_grants in share row exclusive mode;
lock table public.every8d_settings_administrators in share row exclusive mode;
lock table public.every8d_settings_auth_challenges in share row exclusive mode;
lock table public.every8d_settings_auth_challenge_failures in share row exclusive mode;

do $$
declare
  trusted_common_owner_oid oid;
  required_relation text;
  required_function record;
  required_trigger record;
begin
  if pg_catalog.current_setting('server_encoding') <> 'UTF8' then
    raise exception 'C3b-3 migration requires UTF8 database encoding'
      using errcode = '22021';
  end if;

  foreach required_relation in array array[
    'public.ghl_marketplace_installations',
    'public.ghl_marketplace_app_registrations',
    'public.ghl_marketplace_app_version_registrations',
    'public.every8d_settings_enrollment_grants',
    'public.every8d_settings_administrators',
    'public.every8d_settings_sessions',
    'public.every8d_settings_auth_challenges',
    'public.every8d_settings_auth_challenge_failures'
  ] loop
    if pg_catalog.to_regclass(required_relation) is null then
      raise exception 'C3b-3 migration requires all frozen relations'
        using errcode = '42P01';
    end if;
  end loop;

  select c.relowner into trusted_common_owner_oid
  from pg_catalog.pg_class c
  where c.oid = 'public.ghl_marketplace_installations'::pg_catalog.regclass;

  if trusted_common_owner_oid is null
    or trusted_common_owner_oid <> current_user::pg_catalog.regrole::oid
    or exists (
      select 1
      from pg_catalog.pg_class c
      where c.oid in (
        'public.ghl_marketplace_app_registrations'::pg_catalog.regclass,
        'public.ghl_marketplace_app_version_registrations'::pg_catalog.regclass,
        'public.every8d_settings_enrollment_grants'::pg_catalog.regclass,
        'public.every8d_settings_administrators'::pg_catalog.regclass,
        'public.every8d_settings_sessions'::pg_catalog.regclass,
        'public.every8d_settings_auth_challenges'::pg_catalog.regclass,
        'public.every8d_settings_auth_challenge_failures'::pg_catalog.regclass
      ) and c.relowner <> trusted_common_owner_oid
    ) then
    raise exception 'C3b-3 migration requires trusted common ownership'
      using errcode = '42501';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_roles
      where rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'C3b-3 migration requires application roles'
      using errcode = '42704';
  end if;

  for required_function in
    select * from (values
      ('public.assert_every8d_settings_installation_eligible_v1(uuid,integer)', true),
      ('public.is_every8d_settings_canonical_email_v1(text)', false),
      ('public.is_every8d_settings_email_pseudonym_v1(text)', false),
      ('public.every8d_settings_email_lock_word_v1(text)', false),
      ('public.lock_every8d_settings_email_pseudonyms_v1(text[])', true),
      ('public.assert_every8d_settings_challenge_rate_limits_v1(text[],uuid,timestamptz)', true),
      ('public.record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)', true),
      ('public.protect_every8d_settings_enrollment_grant_v1()', true),
      ('public.protect_every8d_settings_administrator_v1()', true),
      ('public.invalidate_every8d_settings_auth_v1()', true),
      ('public.protect_every8d_settings_auth_challenge_v1()', true),
      ('public.protect_every8d_settings_auth_challenge_failure_v1()', true),
      ('public.lock_every8d_settings_challenge_on_fifth_failure_v1()', true),
      ('public.assert_every8d_settings_challenge_integrity_v1()', true),
      ('public.invalidate_every8d_settings_challenges_for_grant_v1()', true)
    ) expected(signature, security_definer)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure(required_function.signature)
        and p.proowner = trusted_common_owner_oid
        and p.prosecdef = required_function.security_definer
        and p.proconfig = array['search_path=pg_catalog, public']::text[]
    ) then
      raise exception 'C3b-3 migration dependency function contract mismatch'
        using errcode = '55000';
    end if;
  end loop;

  for required_trigger in
    select * from (values
      ('public.every8d_settings_enrollment_grants', 'protect_every8d_settings_enrollment_grant',
        'public.protect_every8d_settings_enrollment_grant_v1()', 31::smallint, false, false, false),
      ('public.every8d_settings_administrators', 'protect_every8d_settings_administrator',
        'public.protect_every8d_settings_administrator_v1()', 31::smallint, false, false, false),
      ('public.ghl_marketplace_installations', 'invalidate_every8d_settings_auth_after_install_update',
        'public.invalidate_every8d_settings_auth_v1()', 17::smallint, false, false, false),
      ('public.every8d_settings_auth_challenges', 'protect_every8d_settings_auth_challenge',
        'public.protect_every8d_settings_auth_challenge_v1()', 31::smallint, false, false, false),
      ('public.every8d_settings_auth_challenge_failures', 'protect_every8d_settings_auth_challenge_failure',
        'public.protect_every8d_settings_auth_challenge_failure_v1()', 31::smallint, false, false, false),
      ('public.every8d_settings_auth_challenge_failures', 'lock_every8d_settings_challenge_on_fifth_failure',
        'public.lock_every8d_settings_challenge_on_fifth_failure_v1()', 5::smallint, false, false, false),
      ('public.every8d_settings_auth_challenges', 'assert_every8d_settings_challenge_row_integrity',
        'public.assert_every8d_settings_challenge_integrity_v1()', 29::smallint, true, true, true),
      ('public.every8d_settings_auth_challenge_failures', 'assert_every8d_settings_failure_ledger_integrity',
        'public.assert_every8d_settings_challenge_integrity_v1()', 29::smallint, true, true, true),
      ('public.every8d_settings_enrollment_grants', 'invalidate_every8d_settings_challenges_after_grant_update',
        'public.invalidate_every8d_settings_challenges_for_grant_v1()', 17::smallint, false, false, false)
    ) expected(
      relation_name, trigger_name, function_signature, trigger_type,
      is_constraint, is_deferrable, initially_deferred
    )
  loop
    if (
      select pg_catalog.count(*)
      from pg_catalog.pg_trigger t
      where t.tgrelid = pg_catalog.to_regclass(required_trigger.relation_name)
        and t.tgname = required_trigger.trigger_name
        and t.tgfoid = pg_catalog.to_regprocedure(required_trigger.function_signature)
        and not t.tgisinternal
        and t.tgenabled = 'O'
        and t.tgtype = required_trigger.trigger_type
        and (t.tgconstraint <> 0) = required_trigger.is_constraint
        and t.tgdeferrable = required_trigger.is_deferrable
        and t.tginitdeferred = required_trigger.initially_deferred
    ) <> 1 then
      raise exception 'C3b-3 migration trigger contract mismatch'
        using errcode = '55000';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid in (
      'public.every8d_settings_enrollment_grants'::pg_catalog.regclass,
      'public.every8d_settings_administrators'::pg_catalog.regclass,
      'public.every8d_settings_sessions'::pg_catalog.regclass,
      'public.every8d_settings_auth_challenges'::pg_catalog.regclass,
      'public.every8d_settings_auth_challenge_failures'::pg_catalog.regclass
    ) and (not c.relrowsecurity or c.relforcerowsecurity)
  ) or exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename in (
      'every8d_settings_enrollment_grants', 'every8d_settings_administrators',
      'every8d_settings_sessions', 'every8d_settings_auth_challenges',
      'every8d_settings_auth_challenge_failures'
    )
  ) then
    raise exception 'C3b-3 migration requires frozen RLS state'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
    cross join (values
      ('public.every8d_settings_enrollment_grants'),
      ('public.every8d_settings_administrators'),
      ('public.every8d_settings_sessions'),
      ('public.every8d_settings_auth_challenges'),
      ('public.every8d_settings_auth_challenge_failures')
    ) relations(relation_name)
    where pg_catalog.has_table_privilege(
      roles.role_name, relations.relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) or exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
    cross join (values
      ('public.every8d_settings_enrollment_grants'),
      ('public.every8d_settings_administrators'),
      ('public.every8d_settings_sessions'),
      ('public.every8d_settings_auth_challenges'),
      ('public.every8d_settings_auth_challenge_failures')
    ) relations(relation_name)
    where pg_catalog.has_any_column_privilege(
      roles.role_name, relations.relation_name,
      'SELECT,INSERT,UPDATE,REFERENCES'
    )
  ) or exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    where c.oid in (
      'public.every8d_settings_enrollment_grants'::pg_catalog.regclass,
      'public.every8d_settings_administrators'::pg_catalog.regclass,
      'public.every8d_settings_sessions'::pg_catalog.regclass,
      'public.every8d_settings_auth_challenges'::pg_catalog.regclass,
      'public.every8d_settings_auth_challenge_failures'::pg_catalog.regclass
    ) and acl.grantee = 0
  ) or exists (
    select 1
    from pg_catalog.pg_attribute a
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
    where a.attrelid in (
      'public.every8d_settings_enrollment_grants'::pg_catalog.regclass,
      'public.every8d_settings_administrators'::pg_catalog.regclass,
      'public.every8d_settings_sessions'::pg_catalog.regclass,
      'public.every8d_settings_auth_challenges'::pg_catalog.regclass,
      'public.every8d_settings_auth_challenge_failures'::pg_catalog.regclass
    ) and a.attnum > 0 and not a.attisdropped and acl.grantee = 0
  ) then
    raise exception 'C3b-3 migration refuses widened table privileges'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
    cross join (values
      ('public.assert_every8d_settings_installation_eligible_v1(uuid,integer)'),
      ('public.is_every8d_settings_canonical_email_v1(text)'),
      ('public.is_every8d_settings_email_pseudonym_v1(text)'),
      ('public.every8d_settings_email_lock_word_v1(text)'),
      ('public.lock_every8d_settings_email_pseudonyms_v1(text[])'),
      ('public.assert_every8d_settings_challenge_rate_limits_v1(text[],uuid,timestamptz)'),
      ('public.record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)'),
      ('public.protect_every8d_settings_enrollment_grant_v1()'),
      ('public.protect_every8d_settings_administrator_v1()'),
      ('public.invalidate_every8d_settings_auth_v1()'),
      ('public.protect_every8d_settings_auth_challenge_v1()'),
      ('public.protect_every8d_settings_auth_challenge_failure_v1()'),
      ('public.lock_every8d_settings_challenge_on_fifth_failure_v1()'),
      ('public.assert_every8d_settings_challenge_integrity_v1()'),
      ('public.invalidate_every8d_settings_challenges_for_grant_v1()')
    ) functions(function_signature)
    where pg_catalog.has_function_privilege(
      roles.role_name, functions.function_signature, 'EXECUTE'
    )
  ) or exists (
    select 1
    from (values
      ('public.assert_every8d_settings_installation_eligible_v1(uuid,integer)'),
      ('public.is_every8d_settings_canonical_email_v1(text)'),
      ('public.is_every8d_settings_email_pseudonym_v1(text)'),
      ('public.every8d_settings_email_lock_word_v1(text)'),
      ('public.lock_every8d_settings_email_pseudonyms_v1(text[])'),
      ('public.assert_every8d_settings_challenge_rate_limits_v1(text[],uuid,timestamptz)'),
      ('public.record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)'),
      ('public.protect_every8d_settings_enrollment_grant_v1()'),
      ('public.protect_every8d_settings_administrator_v1()'),
      ('public.invalidate_every8d_settings_auth_v1()'),
      ('public.protect_every8d_settings_auth_challenge_v1()'),
      ('public.protect_every8d_settings_auth_challenge_failure_v1()'),
      ('public.lock_every8d_settings_challenge_on_fifth_failure_v1()'),
      ('public.assert_every8d_settings_challenge_integrity_v1()'),
      ('public.invalidate_every8d_settings_challenges_for_grant_v1()')
    ) functions(function_signature)
    join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(functions.function_signature)
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'C3b-3 migration refuses widened owner-function execute'
      using errcode = '42501';
  end if;

  if pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')
    or pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
    or pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE')
    or exists (
      select 1
      from pg_catalog.pg_namespace n
      cross join lateral pg_catalog.aclexplode(
        coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
      ) acl
      where n.nspname = 'public' and acl.grantee = 0
        and acl.privilege_type = 'CREATE'
    ) then
    raise exception 'C3b-3 migration refuses untrusted CREATE privilege on public'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'runtime_request_every8d_settings_enrollment_challenge_v1',
      'runtime_request_every8d_settings_login_challenge_v1',
      'runtime_record_every8d_settings_challenge_delivery_v1',
      'runtime_discover_every8d_settings_challenge_v1',
      'runtime_verify_every8d_settings_challenge_v1',
      'request_every8d_settings_enrollment_challenge_core_v2',
      'request_every8d_settings_login_challenge_core_v2',
      'verify_every8d_settings_challenge_core_v2'
    )
  ) then
    raise exception 'C3b-3 migration target function conflict'
      using errcode = '42723';
  end if;

  perform pg_catalog.set_config(
    'wincrm.c3b3_trusted_common_owner_oid', trusted_common_owner_oid::text, true
  );
end;
$$;

create function public.request_every8d_settings_enrollment_challenge_core_v2(
  input_enrollment_grant_token_hash bytea,
  input_challenge_id uuid,
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
  alias_value text;
  discovered_grant record;
  locked_grant public.every8d_settings_enrollment_grants%rowtype;
  requested_at timestamptz;
begin
  if input_enrollment_grant_token_hash is null
    or pg_catalog.octet_length(input_enrollment_grant_token_hash) <> 32
    or input_challenge_id is null
    or input_challenge_id::text collate "C"
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or input_normalized_email is null
    or not public.is_every8d_settings_canonical_email_v1(input_normalized_email)
    or input_email_pseudonym is null
    or not public.is_every8d_settings_email_pseudonym_v1(input_email_pseudonym)
    or input_email_pseudonym_aliases is null
    or pg_catalog.cardinality(input_email_pseudonym_aliases) not between 1 and 64
    or input_email_pseudonym <> all(input_email_pseudonym_aliases)
    or input_request_token_hash is null
    or pg_catalog.octet_length(input_request_token_hash) <> 32
    or input_otp_hmac is null or pg_catalog.octet_length(input_otp_hmac) <> 32
    or input_otp_hmac_key_version is null
    or input_otp_hmac_key_version collate "C" !~ '^[A-Za-z0-9_.-]{1,63}$' then
    raise exception 'EVERY8D enrollment challenge input is invalid'
      using errcode = '23514';
  end if;
  foreach alias_value in array input_email_pseudonym_aliases loop
    if alias_value is null
      or not public.is_every8d_settings_email_pseudonym_v1(alias_value) then
      raise exception 'EVERY8D enrollment challenge aliases are invalid'
        using errcode = '23514';
    end if;
  end loop;

  lock table public.ghl_marketplace_installations in row share mode;
  lock table public.every8d_settings_enrollment_grants in row share mode;
  lock table public.every8d_settings_auth_challenges in row exclusive mode;
  lock table public.every8d_settings_auth_challenge_failures in row share mode;

  select g.id, g.installation_id, g.installation_generation
  into discovered_grant
  from public.every8d_settings_enrollment_grants g
  where g.token_hash = input_enrollment_grant_token_hash;
  if not found then return; end if;

  perform 1
  from public.ghl_marketplace_installations i
  where i.id = discovered_grant.installation_id
    and i.installation_generation = discovered_grant.installation_generation
  for share of i;
  if not found then return; end if;

  select g.* into locked_grant
  from public.every8d_settings_enrollment_grants g
  where g.id = discovered_grant.id
    and g.token_hash = input_enrollment_grant_token_hash
    and g.installation_id = discovered_grant.installation_id
    and g.installation_generation = discovered_grant.installation_generation
  for update of g;
  if not found then return; end if;

  begin
    perform public.assert_every8d_settings_installation_eligible_v1(
      locked_grant.installation_id, locked_grant.installation_generation
    );
  exception when check_violation then
    return;
  end;

  requested_at := pg_catalog.clock_timestamp();
  if locked_grant.revoked_at is not null
    or locked_grant.consumed_at is not null
    or locked_grant.expires_at < requested_at + interval '2 minutes'
    or (locked_grant.pinned_normalized_email is not null
      and locked_grant.pinned_normalized_email is distinct from input_normalized_email) then
    return;
  end if;

  perform public.lock_every8d_settings_email_pseudonyms_v1(
    input_email_pseudonym_aliases
  );
  begin
    perform public.assert_every8d_settings_challenge_rate_limits_v1(
      input_email_pseudonym_aliases, locked_grant.id, requested_at
    );
  exception when raise_exception then
    return;
  end;

  update public.every8d_settings_auth_challenges c
  set superseded_at = requested_at,
      supersession_reason = 'resend',
      normalized_email = null,
      email_scrubbed_at = requested_at
  where c.purpose = 'enrollment'
    and c.enrollment_grant_id = locked_grant.id
    and c.email_pseudonym = any(input_email_pseudonym_aliases)
    and c.expires_at > requested_at
    and c.delivery_failed_at is null
    and c.locked_at is null and c.superseded_at is null
    and c.verified_at is null and c.consumed_at is null;

  return query
  insert into public.every8d_settings_auth_challenges(
    id, request_token_hash, purpose, enrollment_grant_id, normalized_email,
    email_pseudonym, otp_hmac, otp_hmac_key_version, created_at, expires_at
  ) values (
    input_challenge_id, input_request_token_hash, 'enrollment', locked_grant.id,
    input_normalized_email, input_email_pseudonym, input_otp_hmac,
    input_otp_hmac_key_version, requested_at,
    least(requested_at + interval '10 minutes', locked_grant.expires_at)
  )
  returning id, every8d_settings_auth_challenges.created_at,
    every8d_settings_auth_challenges.expires_at;
end;
$$;

create function public.request_every8d_settings_login_challenge_core_v2(
  input_challenge_id uuid,
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
  alias_value text;
  candidate record;
  candidate_administrator_ids uuid[] := '{}'::uuid[];
  requested_at timestamptz;
begin
  if input_challenge_id is null
    or input_challenge_id::text collate "C"
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or input_normalized_email is null
    or not public.is_every8d_settings_canonical_email_v1(input_normalized_email)
    or input_email_pseudonym is null
    or not public.is_every8d_settings_email_pseudonym_v1(input_email_pseudonym)
    or input_email_pseudonym_aliases is null
    or pg_catalog.cardinality(input_email_pseudonym_aliases) not between 1 and 64
    or input_email_pseudonym <> all(input_email_pseudonym_aliases)
    or input_request_token_hash is null
    or pg_catalog.octet_length(input_request_token_hash) <> 32
    or input_otp_hmac is null or pg_catalog.octet_length(input_otp_hmac) <> 32
    or input_otp_hmac_key_version is null
    or input_otp_hmac_key_version collate "C" !~ '^[A-Za-z0-9_.-]{1,63}$' then
    raise exception 'EVERY8D login challenge input is invalid'
      using errcode = '23514';
  end if;
  foreach alias_value in array input_email_pseudonym_aliases loop
    if alias_value is null
      or not public.is_every8d_settings_email_pseudonym_v1(alias_value) then
      raise exception 'EVERY8D login challenge aliases are invalid'
        using errcode = '23514';
    end if;
  end loop;

  perform public.lock_every8d_settings_email_pseudonyms_v1(
    input_email_pseudonym_aliases
  );
  lock table public.ghl_marketplace_installations in row share mode;
  lock table public.every8d_settings_administrators in row share mode;
  lock table public.every8d_settings_auth_challenges in row share mode;
  lock table public.every8d_settings_auth_challenge_failures in row share mode;

  select coalesce(pg_catalog.array_agg(a.id order by a.id), '{}'::uuid[])
  into candidate_administrator_ids
  from public.every8d_settings_administrators a
  where a.revoked_at is null
    and a.normalized_email = input_normalized_email
    and a.email_pseudonym = any(input_email_pseudonym_aliases);
  if pg_catalog.cardinality(candidate_administrator_ids) = 0 then return; end if;

  for candidate in
    select distinct a.installation_id, a.installation_generation
    from public.every8d_settings_administrators a
    where a.id = any(candidate_administrator_ids)
    order by a.installation_id, a.installation_generation
  loop
    perform 1 from public.ghl_marketplace_installations i
    where i.id = candidate.installation_id
      and i.installation_generation = candidate.installation_generation
    for share of i;
  end loop;

  for candidate in
    select a.id from public.every8d_settings_administrators a
    where a.id = any(candidate_administrator_ids)
    order by a.id
  loop
    perform 1 from public.every8d_settings_administrators a
    where a.id = candidate.id for share of a;
  end loop;

  requested_at := pg_catalog.clock_timestamp();
  if not exists (
    select 1
    from public.every8d_settings_administrators a
    join public.ghl_marketplace_installations i
      on i.id = a.installation_id
      and i.installation_generation = a.installation_generation
    join public.ghl_marketplace_app_registrations r
      on r.app_namespace = i.app_namespace
      and r.marketplace_app_id = i.marketplace_app_id
      and r.oauth_client_id = i.oauth_client_id
      and r.conversation_provider_id = i.conversation_provider_id
      and r.channel = i.channel and r.provider = i.provider
    join public.ghl_marketplace_app_version_registrations v
      on v.app_namespace = i.app_namespace
      and v.marketplace_version_id = i.latest_lifecycle_version_id
    where a.id = any(candidate_administrator_ids)
      and a.revoked_at is null
      and a.normalized_email = input_normalized_email
      and a.email_pseudonym = any(input_email_pseudonym_aliases)
      and i.app_namespace = 'every8d_connect'
      and i.channel = 'sms' and i.provider = 'every8d'
      and i.company_id is not null
      and i.latest_lifecycle_event_type = 'INSTALL'
      and i.status in ('pending', 'active')
  ) then
    return;
  end if;

  begin
    perform public.assert_every8d_settings_challenge_rate_limits_v1(
      input_email_pseudonym_aliases, null, requested_at
    );
  exception when raise_exception then
    return;
  end;

  update public.every8d_settings_auth_challenges c
  set superseded_at = requested_at,
      supersession_reason = 'resend',
      normalized_email = null,
      email_scrubbed_at = requested_at
  where c.purpose = 'login'
    and c.email_pseudonym = any(input_email_pseudonym_aliases)
    and c.expires_at > requested_at
    and c.delivery_failed_at is null
    and c.locked_at is null and c.superseded_at is null
    and c.verified_at is null and c.consumed_at is null;

  return query
  insert into public.every8d_settings_auth_challenges(
    id, request_token_hash, purpose, normalized_email, email_pseudonym,
    otp_hmac, otp_hmac_key_version, created_at, expires_at
  ) values (
    input_challenge_id, input_request_token_hash, 'login', input_normalized_email,
    input_email_pseudonym, input_otp_hmac, input_otp_hmac_key_version,
    requested_at, requested_at + interval '10 minutes'
  )
  returning id, every8d_settings_auth_challenges.created_at,
    every8d_settings_auth_challenges.expires_at;
end;
$$;

create function public.verify_every8d_settings_challenge_core_v2(
  input_request_token_hash bytea,
  input_purpose text,
  input_email_pseudonym_aliases text[],
  input_candidate_otp_hmac bytea
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  alias_value text;
  challenge_locator record;
  challenge_row public.every8d_settings_auth_challenges%rowtype;
  grant_locator record;
  grant_row public.every8d_settings_enrollment_grants%rowtype;
  candidate record;
  candidate_administrator_ids uuid[] := '{}'::uuid[];
  decided_at timestamptz;
  next_attempt integer;
begin
  if input_purpose is null or input_purpose not in ('enrollment', 'login')
    or input_request_token_hash is null
    or pg_catalog.octet_length(input_request_token_hash) <> 32
    or input_candidate_otp_hmac is null
    or pg_catalog.octet_length(input_candidate_otp_hmac) <> 32
    or input_email_pseudonym_aliases is null
    or pg_catalog.cardinality(input_email_pseudonym_aliases) not between 1 and 64 then
    return false;
  end if;
  foreach alias_value in array input_email_pseudonym_aliases loop
    if alias_value is null
      or not public.is_every8d_settings_email_pseudonym_v1(alias_value) then
      return false;
    end if;
  end loop;

  if input_purpose = 'enrollment' then
    lock table public.ghl_marketplace_installations in row share mode;
    lock table public.every8d_settings_enrollment_grants in row share mode;
    lock table public.every8d_settings_auth_challenges in row exclusive mode;
    lock table public.every8d_settings_auth_challenge_failures in row exclusive mode;

    select c.id, c.enrollment_grant_id, c.normalized_email, c.email_pseudonym
    into challenge_locator
    from public.every8d_settings_auth_challenges c
    where c.request_token_hash = input_request_token_hash
      and c.purpose = 'enrollment';
    if not found or challenge_locator.enrollment_grant_id is null
      or challenge_locator.normalized_email is null
      or challenge_locator.email_pseudonym <> all(input_email_pseudonym_aliases) then
      return false;
    end if;

    select g.id, g.installation_id, g.installation_generation
    into grant_locator
    from public.every8d_settings_enrollment_grants g
    where g.id = challenge_locator.enrollment_grant_id;
    if not found then return false; end if;

    perform 1 from public.ghl_marketplace_installations i
    where i.id = grant_locator.installation_id
      and i.installation_generation = grant_locator.installation_generation
    for share of i;
    if not found then return false; end if;

    select g.* into grant_row
    from public.every8d_settings_enrollment_grants g
    where g.id = grant_locator.id
      and g.installation_id = grant_locator.installation_id
      and g.installation_generation = grant_locator.installation_generation
    for share of g;
    if not found or grant_row.revoked_at is not null or grant_row.consumed_at is not null
      or grant_row.expires_at <= pg_catalog.clock_timestamp()
      or (grant_row.pinned_normalized_email is not null
        and grant_row.pinned_normalized_email is distinct from challenge_locator.normalized_email) then
      return false;
    end if;
    begin
      perform public.assert_every8d_settings_installation_eligible_v1(
        grant_row.installation_id, grant_row.installation_generation
      );
    exception when check_violation then
      return false;
    end;

    perform public.lock_every8d_settings_email_pseudonyms_v1(
      input_email_pseudonym_aliases
    );
    select c.* into challenge_row
    from public.every8d_settings_auth_challenges c
    where c.request_token_hash = input_request_token_hash
    for update of c;
    decided_at := pg_catalog.clock_timestamp();
    if not found
      or challenge_row.id is distinct from challenge_locator.id
      or challenge_row.purpose is distinct from 'enrollment'
      or challenge_row.enrollment_grant_id is distinct from grant_row.id
      or challenge_row.normalized_email is null
      or challenge_row.normalized_email is distinct from challenge_locator.normalized_email
      or challenge_row.email_pseudonym <> all(input_email_pseudonym_aliases)
      or challenge_row.delivery_succeeded_at is null
      or challenge_row.delivery_failed_at is not null or challenge_row.locked_at is not null
      or challenge_row.superseded_at is not null or challenge_row.verified_at is not null
      or challenge_row.consumed_at is not null or decided_at >= challenge_row.expires_at
      or grant_row.revoked_at is not null or grant_row.consumed_at is not null
      or grant_row.expires_at <= decided_at
      or (grant_row.pinned_normalized_email is not null
        and grant_row.pinned_normalized_email is distinct from challenge_row.normalized_email) then
      return false;
    end if;
    begin
      perform public.assert_every8d_settings_installation_eligible_v1(
        grant_row.installation_id, grant_row.installation_generation
      );
    exception when check_violation then
      return false;
    end;
  else
    perform public.lock_every8d_settings_email_pseudonyms_v1(
      input_email_pseudonym_aliases
    );
    lock table public.ghl_marketplace_installations in row share mode;
    lock table public.every8d_settings_administrators in row share mode;
    lock table public.every8d_settings_auth_challenges in row exclusive mode;
    lock table public.every8d_settings_auth_challenge_failures in row exclusive mode;

    select c.id, c.enrollment_grant_id, c.normalized_email, c.email_pseudonym
    into challenge_locator
    from public.every8d_settings_auth_challenges c
    where c.request_token_hash = input_request_token_hash
      and c.purpose = 'login';
    if not found or challenge_locator.enrollment_grant_id is not null
      or challenge_locator.normalized_email is null
      or challenge_locator.email_pseudonym <> all(input_email_pseudonym_aliases) then
      return false;
    end if;

    select coalesce(pg_catalog.array_agg(a.id order by a.id), '{}'::uuid[])
    into candidate_administrator_ids
    from public.every8d_settings_administrators a
    where a.revoked_at is null
      and a.normalized_email = challenge_locator.normalized_email
      and a.email_pseudonym = any(input_email_pseudonym_aliases);
    if pg_catalog.cardinality(candidate_administrator_ids) = 0 then return false; end if;

    for candidate in
      select distinct a.installation_id, a.installation_generation
      from public.every8d_settings_administrators a
      where a.id = any(candidate_administrator_ids)
      order by a.installation_id, a.installation_generation
    loop
      perform 1 from public.ghl_marketplace_installations i
      where i.id = candidate.installation_id
        and i.installation_generation = candidate.installation_generation
      for share of i;
    end loop;

    for candidate in
      select a.id from public.every8d_settings_administrators a
      where a.id = any(candidate_administrator_ids)
      order by a.id
    loop
      perform 1 from public.every8d_settings_administrators a
      where a.id = candidate.id for share of a;
    end loop;

    select c.* into challenge_row
    from public.every8d_settings_auth_challenges c
    where c.request_token_hash = input_request_token_hash
    for update of c;
    decided_at := pg_catalog.clock_timestamp();
    if not found
      or challenge_row.id is distinct from challenge_locator.id
      or challenge_row.purpose is distinct from 'login'
      or challenge_row.enrollment_grant_id is not null
      or challenge_row.normalized_email is null
      or challenge_row.normalized_email is distinct from challenge_locator.normalized_email
      or challenge_row.email_pseudonym <> all(input_email_pseudonym_aliases)
      or challenge_row.delivery_succeeded_at is null
      or challenge_row.delivery_failed_at is not null or challenge_row.locked_at is not null
      or challenge_row.superseded_at is not null or challenge_row.verified_at is not null
      or challenge_row.consumed_at is not null or decided_at >= challenge_row.expires_at then
      return false;
    end if;

    if not exists (
      select 1
      from public.every8d_settings_administrators a
      join public.ghl_marketplace_installations i
        on i.id = a.installation_id
        and i.installation_generation = a.installation_generation
      join public.ghl_marketplace_app_registrations r
        on r.app_namespace = i.app_namespace
        and r.marketplace_app_id = i.marketplace_app_id
        and r.oauth_client_id = i.oauth_client_id
        and r.conversation_provider_id = i.conversation_provider_id
        and r.channel = i.channel and r.provider = i.provider
      join public.ghl_marketplace_app_version_registrations v
        on v.app_namespace = i.app_namespace
        and v.marketplace_version_id = i.latest_lifecycle_version_id
      where a.id = any(candidate_administrator_ids)
        and a.revoked_at is null
        and a.normalized_email = challenge_row.normalized_email
        and a.email_pseudonym = any(input_email_pseudonym_aliases)
        and i.app_namespace = 'every8d_connect'
        and i.channel = 'sms' and i.provider = 'every8d'
        and i.company_id is not null
        and i.latest_lifecycle_event_type = 'INSTALL'
        and i.status in ('pending', 'active')
    ) then
      return false;
    end if;
  end if;

  if challenge_row.otp_hmac = input_candidate_otp_hmac then
    update public.every8d_settings_auth_challenges
    set verified_at = decided_at where id = challenge_row.id;
    return true;
  end if;

  if (
    select pg_catalog.count(*)
    from public.every8d_settings_auth_challenge_failures f
    join public.every8d_settings_auth_challenges c on c.id = f.challenge_id
    where c.email_pseudonym = any(input_email_pseudonym_aliases)
      and f.failed_at > decided_at - interval '1 hour'
  ) >= 10 then
    return false;
  end if;

  select pg_catalog.count(*)::integer + 1 into next_attempt
  from public.every8d_settings_auth_challenge_failures f
  where f.challenge_id = challenge_row.id;
  insert into public.every8d_settings_auth_challenge_failures(
    challenge_id, attempt_number, failed_at
  ) values (challenge_row.id, next_attempt, decided_at);
  return false;
end;
$$;

create function public.runtime_request_every8d_settings_enrollment_challenge_v1(
  input_enrollment_grant_token_hash bytea,
  input_challenge_id uuid,
  input_normalized_email text,
  input_email_pseudonym text,
  input_email_pseudonym_aliases text[],
  input_request_token_hash bytea,
  input_otp_hmac bytea,
  input_otp_hmac_key_version text
)
returns table(challenge_id uuid, created_at timestamptz, expires_at timestamptz)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select * from public.request_every8d_settings_enrollment_challenge_core_v2(
    input_enrollment_grant_token_hash, input_challenge_id, input_normalized_email,
    input_email_pseudonym, input_email_pseudonym_aliases, input_request_token_hash,
    input_otp_hmac, input_otp_hmac_key_version
  )
$$;

create function public.runtime_request_every8d_settings_login_challenge_v1(
  input_challenge_id uuid,
  input_normalized_email text,
  input_email_pseudonym text,
  input_email_pseudonym_aliases text[],
  input_request_token_hash bytea,
  input_otp_hmac bytea,
  input_otp_hmac_key_version text
)
returns table(challenge_id uuid, created_at timestamptz, expires_at timestamptz)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select * from public.request_every8d_settings_login_challenge_core_v2(
    input_challenge_id, input_normalized_email, input_email_pseudonym,
    input_email_pseudonym_aliases, input_request_token_hash, input_otp_hmac,
    input_otp_hmac_key_version
  )
$$;

create function public.runtime_record_every8d_settings_challenge_delivery_v1(
  input_request_token_hash bytea,
  input_succeeded boolean,
  input_failure_class text default null
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.record_every8d_settings_challenge_delivery_v1(
    input_request_token_hash, input_succeeded, input_failure_class
  )
$$;

create function public.runtime_discover_every8d_settings_challenge_v1(
  input_request_token_hash bytea,
  input_purpose text
)
returns table(
  challenge_id uuid,
  enrollment_grant_id uuid,
  normalized_email text,
  email_pseudonym text,
  otp_hmac_key_version text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select c.id, c.enrollment_grant_id, c.normalized_email,
    c.email_pseudonym, c.otp_hmac_key_version
  from public.every8d_settings_auth_challenges c
  where pg_catalog.octet_length(input_request_token_hash) = 32
    and input_purpose in ('enrollment', 'login')
    and c.request_token_hash = input_request_token_hash
    and c.purpose = input_purpose
    and c.normalized_email is not null
    and c.delivery_succeeded_at is not null
    and c.delivery_failed_at is null and c.locked_at is null
    and c.superseded_at is null and c.verified_at is null and c.consumed_at is null
    and c.expires_at > pg_catalog.clock_timestamp()
$$;

create function public.runtime_verify_every8d_settings_challenge_v1(
  input_request_token_hash bytea,
  input_purpose text,
  input_email_pseudonym_aliases text[],
  input_candidate_otp_hmac bytea
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.verify_every8d_settings_challenge_core_v2(
    input_request_token_hash, input_purpose, input_email_pseudonym_aliases,
    input_candidate_otp_hmac
  )
$$;

alter function public.request_every8d_settings_enrollment_challenge_core_v2(
  bytea, uuid, text, text, text[], bytea, bytea, text
) owner to current_user;
alter function public.request_every8d_settings_login_challenge_core_v2(
  uuid, text, text, text[], bytea, bytea, text
) owner to current_user;
alter function public.verify_every8d_settings_challenge_core_v2(
  bytea, text, text[], bytea
) owner to current_user;
alter function public.runtime_request_every8d_settings_enrollment_challenge_v1(
  bytea, uuid, text, text, text[], bytea, bytea, text
) owner to current_user;
alter function public.runtime_request_every8d_settings_login_challenge_v1(
  uuid, text, text, text[], bytea, bytea, text
) owner to current_user;
alter function public.runtime_record_every8d_settings_challenge_delivery_v1(
  bytea, boolean, text
) owner to current_user;
alter function public.runtime_discover_every8d_settings_challenge_v1(
  bytea, text
) owner to current_user;
alter function public.runtime_verify_every8d_settings_challenge_v1(
  bytea, text, text[], bytea
) owner to current_user;

revoke all on function
  public.request_every8d_settings_enrollment_challenge_core_v2(
    bytea, uuid, text, text, text[], bytea, bytea, text
  ),
  public.request_every8d_settings_login_challenge_core_v2(
    uuid, text, text, text[], bytea, bytea, text
  ),
  public.verify_every8d_settings_challenge_core_v2(bytea, text, text[], bytea),
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    bytea, uuid, text, text, text[], bytea, bytea, text
  ),
  public.runtime_request_every8d_settings_login_challenge_v1(
    uuid, text, text, text[], bytea, bytea, text
  ),
  public.runtime_record_every8d_settings_challenge_delivery_v1(bytea, boolean, text),
  public.runtime_discover_every8d_settings_challenge_v1(bytea, text),
  public.runtime_verify_every8d_settings_challenge_v1(bytea, text, text[], bytea)
from public, anon, authenticated, service_role;

grant execute on function
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    bytea, uuid, text, text, text[], bytea, bytea, text
  ),
  public.runtime_request_every8d_settings_login_challenge_v1(
    uuid, text, text, text[], bytea, bytea, text
  ),
  public.runtime_record_every8d_settings_challenge_delivery_v1(bytea, boolean, text),
  public.runtime_discover_every8d_settings_challenge_v1(bytea, text),
  public.runtime_verify_every8d_settings_challenge_v1(bytea, text, text[], bytea)
to service_role;

do $$
declare
  trusted_common_owner_oid oid :=
    pg_catalog.current_setting('wincrm.c3b3_trusted_common_owner_oid')::oid;
  target_count integer;
begin
  select pg_catalog.count(*) into target_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'runtime_request_every8d_settings_enrollment_challenge_v1',
    'runtime_request_every8d_settings_login_challenge_v1',
    'runtime_record_every8d_settings_challenge_delivery_v1',
    'runtime_discover_every8d_settings_challenge_v1',
    'runtime_verify_every8d_settings_challenge_v1',
    'request_every8d_settings_enrollment_challenge_core_v2',
    'request_every8d_settings_login_challenge_core_v2',
    'verify_every8d_settings_challenge_core_v2'
  );
  if target_count <> 8 then
    raise exception 'C3b-3 postflight expected exactly eight target functions'
      using errcode = '55000';
  end if;

  if (
    select pg_catalog.count(*)
    from (values
      ('public.runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)', 'sql'),
      ('public.runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)', 'sql'),
      ('public.runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)', 'sql'),
      ('public.runtime_discover_every8d_settings_challenge_v1(bytea,text)', 'sql'),
      ('public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)', 'sql'),
      ('public.request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)', 'plpgsql'),
      ('public.request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)', 'plpgsql'),
      ('public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)', 'plpgsql')
    ) expected(signature, language_name)
    join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(expected.signature)
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.proowner = trusted_common_owner_oid
      and p.prosecdef
      and p.proconfig = array['search_path=pg_catalog, public']::text[]
      and l.lanname = expected.language_name
  ) <> 8 then
    raise exception 'C3b-3 postflight function authority mismatch'
      using errcode = '55000';
  end if;

  if trusted_common_owner_oid in (
    'anon'::pg_catalog.regrole::oid,
    'authenticated'::pg_catalog.regrole::oid,
    'service_role'::pg_catalog.regrole::oid
  ) then
    raise exception 'C3b-3 postflight found untrusted function owner'
      using errcode = '42501';
  end if;

  if (
    select pg_catalog.count(*)
    from (values
      ('public.runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)'),
      ('public.runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)'),
      ('public.runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)'),
      ('public.runtime_discover_every8d_settings_challenge_v1(bytea,text)'),
      ('public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)')
    ) wrappers(signature)
    where pg_catalog.has_function_privilege('service_role', wrappers.signature, 'EXECUTE')
  ) <> 5 or exists (
    select 1
    from (values
      ('public.request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)'),
      ('public.request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)'),
      ('public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)')
    ) cores(signature)
    where pg_catalog.has_function_privilege('service_role', cores.signature, 'EXECUTE')
  ) or exists (
    select 1
    from (values ('anon'), ('authenticated')) roles(role_name)
    cross join (values
      ('public.runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)'),
      ('public.runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)'),
      ('public.runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)'),
      ('public.runtime_discover_every8d_settings_challenge_v1(bytea,text)'),
      ('public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)'),
      ('public.request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)'),
      ('public.request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)'),
      ('public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)')
    ) functions(signature)
    where pg_catalog.has_function_privilege(roles.role_name, functions.signature, 'EXECUTE')
  ) or exists (
    select 1
    from (values
      ('public.runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)'),
      ('public.runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)'),
      ('public.runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)'),
      ('public.runtime_discover_every8d_settings_challenge_v1(bytea,text)'),
      ('public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)'),
      ('public.request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)'),
      ('public.request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)'),
      ('public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)')
    ) functions(signature)
    join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(functions.signature)
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where acl.privilege_type = 'EXECUTE'
      and acl.grantee not in (trusted_common_owner_oid, 'service_role'::pg_catalog.regrole::oid)
  ) then
    raise exception 'C3b-3 postflight function ACL mismatch'
      using errcode = '42501';
  end if;
end;
$$;

commit;
