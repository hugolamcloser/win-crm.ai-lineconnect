begin;
set local lock_timeout = '5s';

do $$
declare
  trusted_common_owner_oid oid;
begin
  select c.relowner into trusted_common_owner_oid
  from pg_catalog.pg_class c
  where c.oid = pg_catalog.to_regclass('public.ghl_marketplace_installations');

  if trusted_common_owner_oid is null
    or trusted_common_owner_oid <> current_user::pg_catalog.regrole::oid
    or (
      select pg_catalog.count(*)
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
    ) <> 8 then
    raise exception 'C3b-3 rollback refused: target ownership or inventory mismatch'
      using errcode = '55000';
  end if;

  if (
    select pg_catalog.count(*)
    from (values
      ('public.runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)', 'runtime_request_every8d_settings_enrollment_challenge_v1', 'sql', 0, null::text,
        array['input_enrollment_grant_token_hash','input_challenge_id','input_normalized_email','input_email_pseudonym','input_email_pseudonym_aliases','input_request_token_hash','input_otp_hmac','input_otp_hmac_key_version','challenge_id','created_at','expires_at']::text[],
        array['bytea'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text[]'::regtype::oid,'bytea'::regtype::oid,'bytea'::regtype::oid,'text'::regtype::oid]::oid[],
        array['bytea'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text[]'::regtype::oid,'bytea'::regtype::oid,'bytea'::regtype::oid,'text'::regtype::oid,'uuid'::regtype::oid,'timestamptz'::regtype::oid,'timestamptz'::regtype::oid]::oid[],
        array['i','i','i','i','i','i','i','i','t','t','t']::"char"[], 'record', true,
        'TABLE(challenge_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)', '8dbacb2e70fd6889ff0f3ecb4fb8a007'),
      ('public.runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)', 'runtime_request_every8d_settings_login_challenge_v1', 'sql', 0, null::text,
        array['input_challenge_id','input_normalized_email','input_email_pseudonym','input_email_pseudonym_aliases','input_request_token_hash','input_otp_hmac','input_otp_hmac_key_version','challenge_id','created_at','expires_at']::text[],
        array['uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text[]'::regtype::oid,'bytea'::regtype::oid,'bytea'::regtype::oid,'text'::regtype::oid]::oid[],
        array['uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text[]'::regtype::oid,'bytea'::regtype::oid,'bytea'::regtype::oid,'text'::regtype::oid,'uuid'::regtype::oid,'timestamptz'::regtype::oid,'timestamptz'::regtype::oid]::oid[],
        array['i','i','i','i','i','i','i','t','t','t']::"char"[], 'record', true,
        'TABLE(challenge_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)', 'f3c0565962423369d967d43f49890b5a'),
      ('public.runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)', 'runtime_record_every8d_settings_challenge_delivery_v1', 'sql', 1, 'NULL::text',
        array['input_request_token_hash','input_succeeded','input_failure_class']::text[],
        array['bytea'::regtype::oid,'boolean'::regtype::oid,'text'::regtype::oid]::oid[], null::oid[], null::"char"[], 'boolean', false,
        'boolean', 'f430dd79d662e5f153efd79deff73529'),
      ('public.runtime_discover_every8d_settings_challenge_v1(bytea,text)', 'runtime_discover_every8d_settings_challenge_v1', 'sql', 0, null::text,
        array['input_request_token_hash','input_purpose','challenge_id','enrollment_grant_id','normalized_email','email_pseudonym','otp_hmac_key_version']::text[],
        array['bytea'::regtype::oid,'text'::regtype::oid]::oid[],
        array['bytea'::regtype::oid,'text'::regtype::oid,'uuid'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid]::oid[],
        array['i','i','t','t','t','t','t']::"char"[], 'record', true,
        'TABLE(challenge_id uuid, enrollment_grant_id uuid, normalized_email text, email_pseudonym text, otp_hmac_key_version text)', '1ebb4631133d210ffa477b47edf04b89'),
      ('public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)', 'runtime_verify_every8d_settings_challenge_v1', 'sql', 0, null::text,
        array['input_request_token_hash','input_purpose','input_email_pseudonym_aliases','input_candidate_otp_hmac']::text[],
        array['bytea'::regtype::oid,'text'::regtype::oid,'text[]'::regtype::oid,'bytea'::regtype::oid]::oid[], null::oid[], null::"char"[], 'boolean', false,
        'boolean', '847a9a7b369a4a8d44792e920a79878f'),
      ('public.request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)', 'request_every8d_settings_enrollment_challenge_core_v2', 'plpgsql', 0, null::text,
        array['input_enrollment_grant_token_hash','input_challenge_id','input_normalized_email','input_email_pseudonym','input_email_pseudonym_aliases','input_request_token_hash','input_otp_hmac','input_otp_hmac_key_version','challenge_id','created_at','expires_at']::text[],
        array['bytea'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text[]'::regtype::oid,'bytea'::regtype::oid,'bytea'::regtype::oid,'text'::regtype::oid]::oid[],
        array['bytea'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text[]'::regtype::oid,'bytea'::regtype::oid,'bytea'::regtype::oid,'text'::regtype::oid,'uuid'::regtype::oid,'timestamptz'::regtype::oid,'timestamptz'::regtype::oid]::oid[],
        array['i','i','i','i','i','i','i','i','t','t','t']::"char"[], 'record', true,
        'TABLE(challenge_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)', 'b6d7fe686a0dece0bcc8724f90a210b5'),
      ('public.request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)', 'request_every8d_settings_login_challenge_core_v2', 'plpgsql', 0, null::text,
        array['input_challenge_id','input_normalized_email','input_email_pseudonym','input_email_pseudonym_aliases','input_request_token_hash','input_otp_hmac','input_otp_hmac_key_version','challenge_id','created_at','expires_at']::text[],
        array['uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text[]'::regtype::oid,'bytea'::regtype::oid,'bytea'::regtype::oid,'text'::regtype::oid]::oid[],
        array['uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text[]'::regtype::oid,'bytea'::regtype::oid,'bytea'::regtype::oid,'text'::regtype::oid,'uuid'::regtype::oid,'timestamptz'::regtype::oid,'timestamptz'::regtype::oid]::oid[],
        array['i','i','i','i','i','i','i','t','t','t']::"char"[], 'record', true,
        'TABLE(challenge_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)', 'ce5468a69ccd8af369045a16359a57f9'),
      ('public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)', 'verify_every8d_settings_challenge_core_v2', 'plpgsql', 0, null::text,
        array['input_request_token_hash','input_purpose','input_email_pseudonym_aliases','input_candidate_otp_hmac']::text[],
        array['bytea'::regtype::oid,'text'::regtype::oid,'text[]'::regtype::oid,'bytea'::regtype::oid]::oid[], null::oid[], null::"char"[], 'boolean', false,
        'boolean', '598326fff45f553210619f009513057f')
    ) expected(signature, function_name, language_name, default_count, default_expression,
      all_names, input_types, all_types, argument_modes, return_type, returns_set,
      result_shape, body_md5)
    join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(expected.signature)
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.proname = expected.function_name
      and p.prokind = 'f'
      and p.prorettype = expected.return_type::pg_catalog.regtype::oid
      and p.proretset = expected.returns_set
      and array(
        select pg_catalog.unnest(p.proargtypes::pg_catalog.oid[])
      ) = expected.input_types
      and p.proallargtypes is not distinct from expected.all_types
      and p.proargmodes is not distinct from expected.argument_modes
      and p.proargnames is not distinct from expected.all_names
      and p.pronargdefaults = expected.default_count
      and pg_catalog.pg_get_expr(p.proargdefaults, 0) is not distinct from expected.default_expression
      and p.proowner = trusted_common_owner_oid
      and p.prosecdef
      and p.provolatile = 'v'
      and not p.proisstrict
      and p.proparallel = 'u'
      and not p.proleakproof
      and p.procost = 100
      and p.prorows = case when expected.returns_set then 1000 else 0 end
      and p.prosupport = 0
      and p.protrftypes is null
      and p.proconfig = array['search_path=pg_catalog, public']::text[]
      and l.lanname = expected.language_name
      and pg_catalog.pg_get_function_result(p.oid) = expected.result_shape
      and p.probin is null
      and p.prosqlbody is null
      and pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')) = expected.body_md5
      and pg_catalog.has_function_privilege(
        'service_role', p.oid, 'execute'
      ) = (p.proname like 'runtime\_%' escape '\')
      and not exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) acl
        where acl.privilege_type = 'EXECUTE'
          and (
            acl.grantee = 0
            or acl.grantee in (
              'anon'::pg_catalog.regrole::oid,
              'authenticated'::pg_catalog.regrole::oid
            )
            or acl.grantee not in (
              p.proowner,
              'service_role'::pg_catalog.regrole::oid
            )
          )
      )
  ) <> 8 then
    raise exception 'C3b-3 rollback refused: target definition mismatch'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_depend d
    where d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
      and d.refobjid in (
        pg_catalog.to_regprocedure('public.runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)'),
        pg_catalog.to_regprocedure('public.runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)'),
        pg_catalog.to_regprocedure('public.runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)'),
        pg_catalog.to_regprocedure('public.runtime_discover_every8d_settings_challenge_v1(bytea,text)'),
        pg_catalog.to_regprocedure('public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)'),
        pg_catalog.to_regprocedure('public.request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)'),
        pg_catalog.to_regprocedure('public.request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)'),
        pg_catalog.to_regprocedure('public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)')
      )
      and not (
        d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        and d.objid in (
          pg_catalog.to_regprocedure('public.runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)'),
          pg_catalog.to_regprocedure('public.runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)'),
          pg_catalog.to_regprocedure('public.runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)'),
          pg_catalog.to_regprocedure('public.runtime_discover_every8d_settings_challenge_v1(bytea,text)'),
          pg_catalog.to_regprocedure('public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)'),
          pg_catalog.to_regprocedure('public.request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)'),
          pg_catalog.to_regprocedure('public.request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)'),
          pg_catalog.to_regprocedure('public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)')
        )
      )
      and d.deptype in ('n', 'a')
  ) then
    raise exception 'C3b-3 rollback refused: unexpected target dependency'
      using errcode = '2BP01';
  end if;
end;
$$;

revoke execute on function
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    bytea, uuid, text, text, text[], bytea, bytea, text
  ),
  public.runtime_request_every8d_settings_login_challenge_v1(
    uuid, text, text, text[], bytea, bytea, text
  ),
  public.runtime_record_every8d_settings_challenge_delivery_v1(bytea, boolean, text),
  public.runtime_discover_every8d_settings_challenge_v1(bytea, text),
  public.runtime_verify_every8d_settings_challenge_v1(bytea, text, text[], bytea)
from service_role, public, anon, authenticated;

drop function public.runtime_verify_every8d_settings_challenge_v1(
  bytea, text, text[], bytea
);
drop function public.runtime_discover_every8d_settings_challenge_v1(bytea, text);
drop function public.runtime_record_every8d_settings_challenge_delivery_v1(
  bytea, boolean, text
);
drop function public.runtime_request_every8d_settings_login_challenge_v1(
  uuid, text, text, text[], bytea, bytea, text
);
drop function public.runtime_request_every8d_settings_enrollment_challenge_v1(
  bytea, uuid, text, text, text[], bytea, bytea, text
);
drop function public.verify_every8d_settings_challenge_core_v2(
  bytea, text, text[], bytea
);
drop function public.request_every8d_settings_login_challenge_core_v2(
  uuid, text, text, text[], bytea, bytea, text
);
drop function public.request_every8d_settings_enrollment_challenge_core_v2(
  bytea, uuid, text, text, text[], bytea, bytea, text
);

commit;
