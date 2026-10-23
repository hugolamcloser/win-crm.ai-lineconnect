-- C3c-2a database authority only. Quiescent maintenance apply; no online-apply claim.
-- No production execution is authorized by this artifact. Fail on any lock error; no retry.
begin;
set local lock_timeout = '5s';
set local search_path = pg_catalog, public;
lock table public.ghl_marketplace_installations in share row exclusive mode;
lock table public.ghl_marketplace_app_registrations in share row exclusive mode;
lock table public.ghl_marketplace_app_version_registrations in share row exclusive mode;
lock table public.every8d_settings_enrollment_grants in share row exclusive mode;
lock table public.every8d_settings_administrators in share row exclusive mode;
lock table public.every8d_settings_sessions in share row exclusive mode;
lock table public.every8d_settings_auth_challenges in share row exclusive mode;
lock table public.every8d_settings_auth_challenge_failures in share row exclusive mode;

-- Frozen from exact main ef50706d0787bdb5414cc52d7b3f40898138fbd6 on PostgreSQL 17.
-- Relation fingerprints cover columns/defaults, constraints, indexes, noninternal
-- trigger definitions/enabled state, RLS/policies and normalized table/column ACLs.
-- Function fingerprints cover full input/result/default metadata, owner-normalized
-- ACLs, language, security/search_path, execution metadata and literal stored source bodies.
-- OIDs and physical storage identifiers are deliberately excluded for portability.
-- Policy role identities use sorted exact role names, never cluster-local role OIDs.
do $preflight$
declare
  trusted_owner oid;
  actual_relations jsonb;
  actual_functions jsonb;
begin
  if current_setting('server_encoding') <> 'UTF8' then
    raise exception 'C3c-2a requires UTF8' using errcode='22021';
  end if;
  if (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception 'C3c-2a requires application roles' using errcode='42704';
  end if;
  select c.relowner into trusted_owner from pg_class c
  where c.oid=to_regclass('public.ghl_marketplace_installations');
  if trusted_owner is null or trusted_owner <> current_user::regrole::oid
    or trusted_owner in ('anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid)
    or exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated','service_role')
      and pg_has_role(r.oid,trusted_owner,'MEMBER'))
    or (select count(*) from pg_class c where c.relnamespace='public'::regnamespace
      and c.relname in ('ghl_marketplace_installations','ghl_marketplace_app_registrations','ghl_marketplace_app_version_registrations','every8d_settings_enrollment_grants','every8d_settings_administrators','every8d_settings_sessions','every8d_settings_auth_challenges','every8d_settings_auth_challenge_failures') and c.relowner=trusted_owner) <> 8 then
    raise exception 'C3c-2a requires trusted common ownership' using errcode='42501';
  end if;
  if exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated','service_role')
      and (has_schema_privilege(r.oid,'public','CREATE')
        or has_schema_privilege(r.oid,'extensions','CREATE')))
    or exists(select 1 from pg_namespace n cross join lateral
      aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      where n.nspname in ('public','extensions') and a.grantee=0 and a.privilege_type='CREATE')
    or not has_schema_privilege(trusted_owner,'public','USAGE,CREATE')
    or not has_schema_privilege(trusted_owner,'extensions','USAGE')
    or not has_language_privilege(trusted_owner,'sql','USAGE')
    or not has_language_privilege(trusted_owner,'plpgsql','USAGE') then
    raise exception 'C3c-2a requires trusted schema and language privileges' using errcode='42501';
  end if;
  if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
      join pg_depend d on d.refclassid='pg_extension'::regclass and d.refobjid=e.oid
        and d.classid='pg_proc'::regclass and d.objid=to_regprocedure('extensions.digest(bytea,text)')
      where e.extname='pgcrypto' and n.nspname='extensions' and d.deptype='e')
    or not has_function_privilege(trusted_owner,'extensions.digest(bytea,text)','EXECUTE') then
    raise exception 'C3c-2a requires extensions.digest(bytea,text)' using errcode='55000';
  end if;
  if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace
      and (p.proname like '%every8d_settings%' or p.proname='every8d_settings_email_lock_word_v1')
      and p.proowner<>trusted_owner) then
    raise exception 'C3c-2a prior settings authority owner mismatch' using errcode='42501';
  end if;
  -- Lifecycle-v2 is prerequisite authority too. Owner-normalized fingerprints
  -- below preserve its exact metadata/ACL/body, but cannot establish ownership.
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid=p.prolang
    where p.oid=pg_catalog.to_regprocedure(
      'public.apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamptz,text)')
      and p.prokind='f' and p.proowner=trusted_owner
      and p.prosecdef and p.proconfig=array['search_path=pg_catalog, public']::text[]
      and l.lanname='plpgsql' and p.provolatile='v' and not p.proisstrict
      and p.proparallel='u' and not p.proleakproof
  ) then
    raise exception 'C3c-2a lifecycle prerequisite authority mismatch' using errcode='42501';
  end if;
  if exists(select 1 from (values ('anon'),('authenticated'),('service_role')) r(role_name)
    cross join (values ('public.every8d_settings_enrollment_grants'),('public.every8d_settings_administrators'),('public.every8d_settings_sessions'),('public.every8d_settings_auth_challenges'),('public.every8d_settings_auth_challenge_failures')) t(relation_name)
    where has_table_privilege(r.role_name,t.relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(r.role_name,t.relation_name,'SELECT,INSERT,UPDATE,REFERENCES')) then
    raise exception 'C3c-2a refuses effective auth table privileges' using errcode='42501';
  end if;
  select jsonb_object_agg(v.relname,v.fingerprint) into actual_relations from (select c.oid,c.relname,
  md5(jsonb_build_array(c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,
    c.relreplident,c.reloptions,(select jsonb_agg(jsonb_build_array(case when x.grantor=c.relowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=c.relowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) order by x.grantor<>c.relowner,case when x.grantor=c.relowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=c.relowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x),
    (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),
      a.attnotnull,a.attidentity,a.attgenerated,a.attisdropped,
      case when a.attcollation=0 then null else a.attcollation::regcollation::text end,
      pg_get_expr(d.adbin,d.adrelid),(select jsonb_agg(jsonb_build_array(case when x.grantor=c.relowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=c.relowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) order by x.grantor<>c.relowner,case when x.grantor=c.relowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=c.relowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type) from aclexplode(a.attacl) x)) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0),
    (select jsonb_agg(jsonb_build_array(k.conname,k.contype,k.convalidated,
      pg_get_constraintdef(k.oid,true)) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
    (select jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready)
      order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid=c.oid),
    (select jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true))
      order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
    (select jsonb_agg(s.identity order by s.identity::text collate "C") from (
      select jsonb_build_array(kn.nspname,k.conname,k.contype,pg_get_constraintdef(k.oid,true),
        rn.nspname,rc.relname,fn.nspname,fc.relname,
        pn.nspname,p.proname,pg_get_function_identity_arguments(p.oid),
        t.tgtype,t.tgenabled,t.tgdeferrable,t.tginitdeferred,t.tgconstraint<>0,t.tgparentid<>0,
        cn.nspname,cc.relname,ixn.nspname,ix.relname,pg_get_indexdef(nullif(t.tgconstrindid,0)),
        (select jsonb_agg(a.attname order by u.ordinality) from unnest(t.tgattr::smallint[]) with ordinality u(attnum,ordinality)
          join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=u.attnum),
        t.tgnargs,encode(t.tgargs,'hex'),pg_get_expr(t.tgqual,t.tgrelid,true),t.tgoldtable,t.tgnewtable) as identity
      from pg_trigger t left join pg_constraint k on k.oid=t.tgconstraint
      left join pg_namespace kn on kn.oid=k.connamespace
      left join pg_class rc on rc.oid=k.conrelid left join pg_namespace rn on rn.oid=rc.relnamespace
      left join pg_class fc on fc.oid=k.confrelid left join pg_namespace fn on fn.oid=fc.relnamespace
      join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
      left join pg_class cc on cc.oid=t.tgconstrrelid left join pg_namespace cn on cn.oid=cc.relnamespace
      left join pg_class ix on ix.oid=t.tgconstrindid left join pg_namespace ixn on ixn.oid=ix.relnamespace
      where t.tgrelid=c.oid and t.tgisinternal) s),
    (select jsonb_agg((to_jsonb(pol)-'oid'-'polrelid'-'polroles') || jsonb_build_object('polroles',
        (select jsonb_agg(case when r.role_oid=0 then 'PUBLIC' else pg_get_userbyid(r.role_oid)::text end
          order by (case when r.role_oid=0 then 'PUBLIC' else pg_get_userbyid(r.role_oid)::text end) collate "C")
         from unnest(pol.polroles) r(role_oid))) order by pol.polname)
      from pg_policy pol where pol.polrelid=c.oid))::text) as fingerprint
  from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('ghl_marketplace_installations','ghl_marketplace_app_registrations','ghl_marketplace_app_version_registrations','every8d_settings_enrollment_grants','every8d_settings_administrators','every8d_settings_sessions','every8d_settings_auth_challenges','every8d_settings_auth_challenge_failures')) v;
  select jsonb_object_agg(v.signature,v.fingerprint) into actual_functions from (select p.oid, p.proname, p.oid::regprocedure::text as signature,
  md5(jsonb_build_array(p.prokind, l.lanname, p.prosecdef,p.provolatile,p.proisstrict,
    p.proparallel,p.proleakproof,p.procost,p.prorows,p.prosupport::text,p.protrftypes::text,
    p.proconfig,p.proretset,pg_get_function_result(p.oid),pg_get_function_arguments(p.oid),
    p.proargnames,p.proargmodes,p.pronargdefaults,p.probin,p.prosqlbody::text,
    p.prosrc,(select jsonb_agg(jsonb_build_array(case when x.grantor=p.proowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=p.proowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) order by x.grantor<>p.proowner,case when x.grantor=p.proowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=p.proowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x))::text) as fingerprint
  from pg_proc p join pg_language l on l.oid=p.prolang
  where p.pronamespace='public'::regnamespace and p.proname not in ('runtime_discover_every8d_settings_verified_challenge_v1','consume_every8d_settings_enrollment_challenge_core_v1','consume_every8d_settings_login_challenge_core_v1','authenticate_every8d_settings_session_core_v1','revoke_every8d_settings_session_core_v1','runtime_consume_every8d_settings_enrollment_challenge_v1','runtime_consume_every8d_settings_login_challenge_v1','runtime_authenticate_every8d_settings_session_v1','runtime_revoke_every8d_settings_session_v1')) v;
  if actual_relations is distinct from $relations${"every8d_settings_administrators":"22310a057aae8c919d5f133686b06c12","every8d_settings_auth_challenge_failures":"1c3aa7ad43c10fbeaa3da35919c5f603","every8d_settings_auth_challenges":"ad3214c353186228d0f17e2f115f15fb","every8d_settings_enrollment_grants":"2bc87966915bd44aa80793cc9bb1b3d7","every8d_settings_sessions":"3ea40301cf1743c7fc3f33e754db1705","ghl_marketplace_app_registrations":"0360ec6e4309027f40c03b1087c17b53","ghl_marketplace_app_version_registrations":"5b6cc4f57acd2edd376949b63d579574","ghl_marketplace_installations":"b29aca9663dc2fefce200a5b21518ec9"}$relations$::jsonb
    or actual_functions is distinct from $functions${"accept_every8d_public_oauth_callback_v1(text,text,text,text,text,text,text,text,text,timestamp with time zone,bytea,text)":"280c19d7a14ad9f038abfddde1bb95d7","apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamp with time zone,text)":"156a63069c245a4d7ff01d27ccc79295","apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamp with time zone,text)":"15c74c360b0efc3ef9495962da106a55","assert_every8d_settings_challenge_integrity_v1()":"8d53b0e843b9e4378a68d17a870f8a47","assert_every8d_settings_challenge_rate_limits_v1(text[],uuid,timestamp with time zone)":"322dfb58deae74ab638530d9949ccc41","assert_every8d_settings_installation_eligible_v1(uuid,integer)":"0d401cd53ebac6fb89a6d0495e2708b3","claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer)":"a2a18fb8ed6add638d7aaf1968e4c232","claim_every8d_oauth_exchange_v1(uuid,text,text)":"93d275946b8f75cd783c3554246edd8c","cleanup_every8d_settings_auth_challenges_v1(integer)":"87a0b33bc5e6237b355d4aeae2f01a8c","consume_ghl_sms_controlled_live_authorization_v1(uuid,uuid,uuid,text,text,text,text,text,text)":"0964c7032835a4386efc1639852aebea","discover_every8d_settings_challenge_v1(bytea,text)":"6287d410887f45c4c76636c824b986ea","every8d_settings_email_lock_word_v1(text)":"fb169d9bdbca09c8a02d863673cccea9","fail_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,text)":"e8febfc51ad1b76413ae6c89829c6f19","fail_every8d_oauth_bootstrap_v1(uuid,text)":"ac3d1cd76fda1873e76da5bfaf13ff5f","finalize_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,bytea,bytea,text,timestamp with time zone,text[])":"fc3aa929cba31fb1022ba8b7f31f8e1c","finalize_every8d_oauth_exchange_v1(uuid,text,text,bytea,bytea,text,timestamp with time zone,text[])":"6e3b7d8f9ce739b4eb8eb8cfb4310b6b","get_every8d_oauth_bootstrap_status_v1(text,text)":"d68c479fc7229d8a2b72421015f08ba0","invalidate_every8d_provider_configuration_v1()":"39b9f1419206797772393bba0a182683","invalidate_every8d_settings_auth_v1()":"49824966600c91397de235783b39d2ed","invalidate_every8d_settings_challenges_for_grant_v1()":"0b6a3bce1ef8208fe2355ce6255aa142","is_every8d_settings_canonical_email_v1(text)":"5206d9483c15206c1146edb48d79b91f","is_every8d_settings_email_pseudonym_v1(text)":"d3a726234333158db9649a6946611eb1","issue_every8d_settings_install_callback_enrollment_grant_v1(uuid,integer,uuid,bytea,timestamp with time zone,text,text)":"952e0dcc80d9c96a455213623c58609d","issue_every8d_settings_operator_enrollment_grant_v1(uuid,integer,text,bytea,text,timestamp with time zone,text,text,text,text)":"0f0e31f641855ce101327f6e78804926","list_every8d_oauth_recoverable_v1(text,text,integer)":"cba53a79d6fcabc4fe3c2d76a8c85169","lock_every8d_settings_challenge_on_fifth_failure_v1()":"d9c441bddd3a0ca00a4dce18977839b8","lock_every8d_settings_email_pseudonyms_v1(text[])":"802d175e6187ba53f0c862e55f3220e7","protect_every8d_provider_configuration_v1()":"d2a82e30277a8c8c1cb93a375429872f","protect_every8d_settings_administrator_v1()":"fbc49d905c8506d713763071a8cc69b1","protect_every8d_settings_auth_challenge_failure_v1()":"24a7fe69d20598c67f389d6a8b6a729d","protect_every8d_settings_auth_challenge_v1()":"462080468c4aa84c32351c50b4ac3a11","protect_every8d_settings_enrollment_grant_v1()":"8c0023fabf66daca4164820ec967742d","protect_every8d_settings_session_v1()":"afb097c1e17f0330180b50d36cc60d62","protect_ghl_marketplace_app_registration_v1()":"f8598449bbc9f4f88408d1aa49b6901f","protect_ghl_marketplace_app_version_registration_v1()":"627e6716da0182226e7d81c2a558729f","protect_ghl_marketplace_installation_v1()":"62bc35bdb7e6a66a805d84ca50e1f593","protect_ghl_marketplace_installation_v2()":"a8c615386c7deb2b61a2a47f735db444","protect_ghl_marketplace_installation_v3()":"9fe58ca382eae446b1aace10b6692835","protect_ghl_marketplace_installation_v4()":"962e721d9b8adef62add5670da33c938","protect_ghl_marketplace_installation_v5()":"f7e0fae9fed8181904656198fd677e44","protect_ghl_marketplace_oauth_bootstrap_v1()":"00a7a25ae3a881d19c51a5ea7935edd3","protect_ghl_marketplace_oauth_state_v1()":"866ad815eed6a1a88905524c4e9e6aae","protect_ghl_sms_controlled_live_authorization_v1()":"8e46afe31ee7e0ab1ebbde4328b97b5f","provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)":"100ed0bf0a16fe5ceac6de3572952228","record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)":"13709926d0fb3719ad903fac77be4956","redeem_every8d_settings_enrollment_grant_v1(bytea,text,text)":"99994ca583226c3151556d0f3957a26f","request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)":"1f1735df19ce0c4fa4fab122561de195","request_every8d_settings_enrollment_challenge_v1(uuid,text,text,text[],bytea,bytea,text)":"6f9c3b9a01e7af717ed07c1b54b15a9b","request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)":"7573d7ddd043d50f271d4ae7e12d4ea7","request_every8d_settings_login_challenge_v1(text,text,text[],bytea,bytea,text)":"43ec37c1f3f278f480bc58691e5855ac","runtime_discover_every8d_settings_challenge_v1(bytea,text)":"f28d1763dd9941843e5740308d3525f3","runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)":"501fafae0e74d19ce254f6ccaca9d24f","runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)":"484ff4cf4372c330e3ef98e990fb118b","runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)":"6216d5f617668fbd7cafdb3e795df84e","runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)":"a21710035659f27cebc70f80bcff3c64","scrub_expired_every8d_settings_challenge_emails_v1(integer)":"094cec38bc5380b1a49d20008da6f17a","set_updated_at()":"f3271401fb26bf01db885936c35cd3f2","verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)":"c5aa8e2a77921385f6002fbe9f98ab5b","verify_every8d_settings_challenge_v1(uuid,bytea,text,uuid,text,text[],bytea)":"2074def2fdc693ac3c0b44d9046ed491"}$functions$::jsonb then
    raise exception 'C3c-2a frozen prerequisite manifest mismatch' using errcode='55000';
  end if;
  perform set_config('wincrm.c3c2a_relations',actual_relations::text,true);
  perform set_config('wincrm.c3c2a_prior_functions',actual_functions::text,true);
  perform set_config('wincrm.c3c2a_owner',trusted_owner::text,true);
  perform set_config('wincrm.c3c2a_row_counts',(select jsonb_build_array((select count(*) from public.ghl_marketplace_installations),(select count(*) from public.ghl_marketplace_app_registrations),(select count(*) from public.ghl_marketplace_app_version_registrations),(select count(*) from public.every8d_settings_enrollment_grants),(select count(*) from public.every8d_settings_administrators),(select count(*) from public.every8d_settings_sessions),(select count(*) from public.every8d_settings_auth_challenges),(select count(*) from public.every8d_settings_auth_challenge_failures))::text),true);
  perform set_config('wincrm.c3c2a_default_acls',
    (select coalesce(jsonb_agg(to_jsonb(d) order by d.oid),'[]')::text from pg_default_acl d),true);
end;
$preflight$;
do $targets$
declare actual jsonb; trusted_owner oid := current_setting('wincrm.c3c2a_owner')::oid;
begin
  select jsonb_object_agg(v.signature,v.fingerprint) into actual
  from (select p.oid, p.proname, p.oid::regprocedure::text as signature,
  md5(jsonb_build_array(p.prokind, l.lanname, p.prosecdef,p.provolatile,p.proisstrict,
    p.proparallel,p.proleakproof,p.procost,p.prorows,p.prosupport::text,p.protrftypes::text,
    p.proconfig,p.proretset,pg_get_function_result(p.oid),pg_get_function_arguments(p.oid),
    p.proargnames,p.proargmodes,p.pronargdefaults,p.probin,p.prosqlbody::text,
    p.prosrc,(select jsonb_agg(jsonb_build_array(case when x.grantor=p.proowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=p.proowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) order by x.grantor<>p.proowner,case when x.grantor=p.proowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=p.proowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x))::text) as fingerprint
  from pg_proc p join pg_language l on l.oid=p.prolang
  where p.pronamespace='public'::regnamespace and p.proname in ('runtime_discover_every8d_settings_verified_challenge_v1','consume_every8d_settings_enrollment_challenge_core_v1','consume_every8d_settings_login_challenge_core_v1','authenticate_every8d_settings_session_core_v1','revoke_every8d_settings_session_core_v1','runtime_consume_every8d_settings_enrollment_challenge_v1','runtime_consume_every8d_settings_login_challenge_v1','runtime_authenticate_every8d_settings_session_v1','runtime_revoke_every8d_settings_session_v1')) v;
  if actual is distinct from $targets_manifest${"authenticate_every8d_settings_session_core_v1(bytea)":"aa8508dd2eed58f4599a646c9e6bb006","consume_every8d_settings_enrollment_challenge_core_v1(bytea,text[],bytea)":"94c37cdcb647d796ca73defe6c55fd8b","consume_every8d_settings_login_challenge_core_v1(bytea,text[],bytea)":"fcc66bfc3be0ac9e8a2e49fdd122167d","revoke_every8d_settings_session_core_v1(bytea)":"6ee321cd2c92d59b3a1e26b2871c8ddc","runtime_authenticate_every8d_settings_session_v1(bytea)":"4852420731eddac3d81eb43d21f77b35","runtime_consume_every8d_settings_enrollment_challenge_v1(bytea,text[],bytea)":"d04516b872e27651f92752c24f1f1702","runtime_consume_every8d_settings_login_challenge_v1(bytea,text[],bytea)":"62058af9f022a7fd8455329e91513f2b","runtime_discover_every8d_settings_verified_challenge_v1(bytea,text)":"0ed1d07c4abf059f55343ef7bc792aab","runtime_revoke_every8d_settings_session_v1(bytea)":"27e0e7fa6ad88ddfce32c5e773857e1d"}$targets_manifest$::jsonb
    or (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in ('runtime_discover_every8d_settings_verified_challenge_v1','consume_every8d_settings_enrollment_challenge_core_v1','consume_every8d_settings_login_challenge_core_v1','authenticate_every8d_settings_session_core_v1','revoke_every8d_settings_session_core_v1','runtime_consume_every8d_settings_enrollment_challenge_v1','runtime_consume_every8d_settings_login_challenge_v1','runtime_authenticate_every8d_settings_session_v1','runtime_revoke_every8d_settings_session_v1'))<>9
    or exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in ('runtime_discover_every8d_settings_verified_challenge_v1','consume_every8d_settings_enrollment_challenge_core_v1','consume_every8d_settings_login_challenge_core_v1','authenticate_every8d_settings_session_core_v1','revoke_every8d_settings_session_core_v1','runtime_consume_every8d_settings_enrollment_challenge_v1','runtime_consume_every8d_settings_login_challenge_v1','runtime_authenticate_every8d_settings_session_v1','runtime_revoke_every8d_settings_session_v1') and p.proowner<>trusted_owner)
    or exists(select 1 from pg_proc p cross join (values ('anon'),('authenticated'),('service_role')) r(role_name)
      where p.pronamespace='public'::regnamespace and p.proname in ('runtime_discover_every8d_settings_verified_challenge_v1','consume_every8d_settings_enrollment_challenge_core_v1','consume_every8d_settings_login_challenge_core_v1','authenticate_every8d_settings_session_core_v1','revoke_every8d_settings_session_core_v1','runtime_consume_every8d_settings_enrollment_challenge_v1','runtime_consume_every8d_settings_login_challenge_v1','runtime_authenticate_every8d_settings_session_v1','runtime_revoke_every8d_settings_session_v1')
        and has_function_privilege(r.role_name,p.oid,'EXECUTE')
          <> (r.role_name='service_role' and p.proname like 'runtime\_%' escape '\')) then
    raise exception 'C3c-2a target definition owner or ACL mismatch' using errcode='55000';
  end if;
end;
$targets$;

-- Every refusal is evaluated before REVOKE or DROP. Historical C3a usage counts.
do $guards$
begin
  if exists(select 1 from public.every8d_settings_administrators)
    or exists(select 1 from public.every8d_settings_sessions)
    or exists(select 1 from public.every8d_settings_auth_challenges where consumed_at is not null) then
    raise exception 'C3c-2a rollback refused: authority has been used' using errcode='55000';
  end if;
  if exists(select 1 from pg_depend d where d.refclassid='pg_proc'::regclass
    and d.refobjid in (select p.oid from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in ('runtime_discover_every8d_settings_verified_challenge_v1','consume_every8d_settings_enrollment_challenge_core_v1','consume_every8d_settings_login_challenge_core_v1','authenticate_every8d_settings_session_core_v1','revoke_every8d_settings_session_core_v1','runtime_consume_every8d_settings_enrollment_challenge_v1','runtime_consume_every8d_settings_login_challenge_v1','runtime_authenticate_every8d_settings_session_v1','runtime_revoke_every8d_settings_session_v1'))) then
    raise exception 'C3c-2a rollback refused: unexpected dependency' using errcode='55000';
  end if;
  -- String-literal/dynamic routine bodies are not necessarily tracked by pg_depend.
  -- Conservatively scan all non-system schemas, every routine kind, before DDL.
  if exists(select 1 from pg_proc caller join pg_namespace n on n.oid=caller.pronamespace
    cross join (values ('authenticate_every8d_settings_session_core_v1'),('consume_every8d_settings_enrollment_challenge_core_v1'),('consume_every8d_settings_login_challenge_core_v1'),('revoke_every8d_settings_session_core_v1'),('runtime_authenticate_every8d_settings_session_v1'),('runtime_consume_every8d_settings_enrollment_challenge_v1'),('runtime_consume_every8d_settings_login_challenge_v1'),('runtime_discover_every8d_settings_verified_challenge_v1'),('runtime_revoke_every8d_settings_session_v1')) target(name)
    where n.nspname<>'information_schema' and n.nspname !~ '^pg_'
      and caller.oid not in ('public.authenticate_every8d_settings_session_core_v1(bytea)'::regprocedure,'public.consume_every8d_settings_enrollment_challenge_core_v1(bytea,text[],bytea)'::regprocedure,'public.consume_every8d_settings_login_challenge_core_v1(bytea,text[],bytea)'::regprocedure,'public.revoke_every8d_settings_session_core_v1(bytea)'::regprocedure,'public.runtime_authenticate_every8d_settings_session_v1(bytea)'::regprocedure,'public.runtime_consume_every8d_settings_enrollment_challenge_v1(bytea,text[],bytea)'::regprocedure,'public.runtime_consume_every8d_settings_login_challenge_v1(bytea,text[],bytea)'::regprocedure,'public.runtime_discover_every8d_settings_verified_challenge_v1(bytea,text)'::regprocedure,'public.runtime_revoke_every8d_settings_session_v1(bytea)'::regprocedure)
      and strpos(lower(caller.prosrc collate "C"),target.name)>0) then
    raise exception 'C3c-2a rollback refused: later routine body reference' using errcode='55000';
  end if;
end;
$guards$;
revoke all on function public.runtime_discover_every8d_settings_verified_challenge_v1(bytea,text) from service_role;
drop function public.runtime_discover_every8d_settings_verified_challenge_v1(bytea,text);
revoke all on function public.runtime_consume_every8d_settings_enrollment_challenge_v1(bytea,text[],bytea) from service_role;
drop function public.runtime_consume_every8d_settings_enrollment_challenge_v1(bytea,text[],bytea);
revoke all on function public.runtime_consume_every8d_settings_login_challenge_v1(bytea,text[],bytea) from service_role;
drop function public.runtime_consume_every8d_settings_login_challenge_v1(bytea,text[],bytea);
revoke all on function public.runtime_authenticate_every8d_settings_session_v1(bytea) from service_role;
drop function public.runtime_authenticate_every8d_settings_session_v1(bytea);
revoke all on function public.runtime_revoke_every8d_settings_session_v1(bytea) from service_role;
drop function public.runtime_revoke_every8d_settings_session_v1(bytea);
drop function public.consume_every8d_settings_enrollment_challenge_core_v1(bytea,text[],bytea);
drop function public.consume_every8d_settings_login_challenge_core_v1(bytea,text[],bytea);
drop function public.authenticate_every8d_settings_session_core_v1(bytea);
drop function public.revoke_every8d_settings_session_core_v1(bytea);
do $postflight$
declare actual jsonb;
begin
  select jsonb_object_agg(v.relname,v.fingerprint) into actual from (select c.oid,c.relname,
  md5(jsonb_build_array(c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,
    c.relreplident,c.reloptions,(select jsonb_agg(jsonb_build_array(case when x.grantor=c.relowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=c.relowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) order by x.grantor<>c.relowner,case when x.grantor=c.relowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=c.relowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x),
    (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),
      a.attnotnull,a.attidentity,a.attgenerated,a.attisdropped,
      case when a.attcollation=0 then null else a.attcollation::regcollation::text end,
      pg_get_expr(d.adbin,d.adrelid),(select jsonb_agg(jsonb_build_array(case when x.grantor=c.relowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=c.relowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) order by x.grantor<>c.relowner,case when x.grantor=c.relowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=c.relowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type) from aclexplode(a.attacl) x)) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0),
    (select jsonb_agg(jsonb_build_array(k.conname,k.contype,k.convalidated,
      pg_get_constraintdef(k.oid,true)) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
    (select jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready)
      order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid=c.oid),
    (select jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true))
      order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
    (select jsonb_agg(s.identity order by s.identity::text collate "C") from (
      select jsonb_build_array(kn.nspname,k.conname,k.contype,pg_get_constraintdef(k.oid,true),
        rn.nspname,rc.relname,fn.nspname,fc.relname,
        pn.nspname,p.proname,pg_get_function_identity_arguments(p.oid),
        t.tgtype,t.tgenabled,t.tgdeferrable,t.tginitdeferred,t.tgconstraint<>0,t.tgparentid<>0,
        cn.nspname,cc.relname,ixn.nspname,ix.relname,pg_get_indexdef(nullif(t.tgconstrindid,0)),
        (select jsonb_agg(a.attname order by u.ordinality) from unnest(t.tgattr::smallint[]) with ordinality u(attnum,ordinality)
          join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=u.attnum),
        t.tgnargs,encode(t.tgargs,'hex'),pg_get_expr(t.tgqual,t.tgrelid,true),t.tgoldtable,t.tgnewtable) as identity
      from pg_trigger t left join pg_constraint k on k.oid=t.tgconstraint
      left join pg_namespace kn on kn.oid=k.connamespace
      left join pg_class rc on rc.oid=k.conrelid left join pg_namespace rn on rn.oid=rc.relnamespace
      left join pg_class fc on fc.oid=k.confrelid left join pg_namespace fn on fn.oid=fc.relnamespace
      join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
      left join pg_class cc on cc.oid=t.tgconstrrelid left join pg_namespace cn on cn.oid=cc.relnamespace
      left join pg_class ix on ix.oid=t.tgconstrindid left join pg_namespace ixn on ixn.oid=ix.relnamespace
      where t.tgrelid=c.oid and t.tgisinternal) s),
    (select jsonb_agg((to_jsonb(pol)-'oid'-'polrelid'-'polroles') || jsonb_build_object('polroles',
        (select jsonb_agg(case when r.role_oid=0 then 'PUBLIC' else pg_get_userbyid(r.role_oid)::text end
          order by (case when r.role_oid=0 then 'PUBLIC' else pg_get_userbyid(r.role_oid)::text end) collate "C")
         from unnest(pol.polroles) r(role_oid))) order by pol.polname)
      from pg_policy pol where pol.polrelid=c.oid))::text) as fingerprint
  from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('ghl_marketplace_installations','ghl_marketplace_app_registrations','ghl_marketplace_app_version_registrations','every8d_settings_enrollment_grants','every8d_settings_administrators','every8d_settings_sessions','every8d_settings_auth_challenges','every8d_settings_auth_challenge_failures')) v;
  if actual::text is distinct from current_setting('wincrm.c3c2a_relations') then
    raise exception 'C3c-2a relation boundary changed' using errcode='55000';
  end if;
  select jsonb_object_agg(v.signature,v.fingerprint) into actual from (select p.oid, p.proname, p.oid::regprocedure::text as signature,
  md5(jsonb_build_array(p.prokind, l.lanname, p.prosecdef,p.provolatile,p.proisstrict,
    p.proparallel,p.proleakproof,p.procost,p.prorows,p.prosupport::text,p.protrftypes::text,
    p.proconfig,p.proretset,pg_get_function_result(p.oid),pg_get_function_arguments(p.oid),
    p.proargnames,p.proargmodes,p.pronargdefaults,p.probin,p.prosqlbody::text,
    p.prosrc,(select jsonb_agg(jsonb_build_array(case when x.grantor=p.proowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=p.proowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) order by x.grantor<>p.proowner,case when x.grantor=p.proowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=p.proowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x))::text) as fingerprint
  from pg_proc p join pg_language l on l.oid=p.prolang
  where p.pronamespace='public'::regnamespace and p.proname not in ('runtime_discover_every8d_settings_verified_challenge_v1','consume_every8d_settings_enrollment_challenge_core_v1','consume_every8d_settings_login_challenge_core_v1','authenticate_every8d_settings_session_core_v1','revoke_every8d_settings_session_core_v1','runtime_consume_every8d_settings_enrollment_challenge_v1','runtime_consume_every8d_settings_login_challenge_v1','runtime_authenticate_every8d_settings_session_v1','runtime_revoke_every8d_settings_session_v1')) v;
  if actual::text is distinct from current_setting('wincrm.c3c2a_prior_functions')
    or (select jsonb_build_array((select count(*) from public.ghl_marketplace_installations),(select count(*) from public.ghl_marketplace_app_registrations),(select count(*) from public.ghl_marketplace_app_version_registrations),(select count(*) from public.every8d_settings_enrollment_grants),(select count(*) from public.every8d_settings_administrators),(select count(*) from public.every8d_settings_sessions),(select count(*) from public.every8d_settings_auth_challenges),(select count(*) from public.every8d_settings_auth_challenge_failures))::text) is distinct from current_setting('wincrm.c3c2a_row_counts')
    or (select coalesce(jsonb_agg(to_jsonb(d) order by d.oid),'[]')::text from pg_default_acl d)
      is distinct from current_setting('wincrm.c3c2a_default_acls') then
    raise exception 'C3c-2a prior authority data or default ACL boundary changed' using errcode='55000';
  end if;
end;
$postflight$;
do $$ begin
  if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace
    and p.proname in ('runtime_discover_every8d_settings_verified_challenge_v1','consume_every8d_settings_enrollment_challenge_core_v1','consume_every8d_settings_login_challenge_core_v1','authenticate_every8d_settings_session_core_v1','revoke_every8d_settings_session_core_v1','runtime_consume_every8d_settings_enrollment_challenge_v1','runtime_consume_every8d_settings_login_challenge_v1','runtime_authenticate_every8d_settings_session_v1','runtime_revoke_every8d_settings_session_v1')) then
    raise exception 'C3c-2a rollback target removal mismatch' using errcode='55000';
  end if;
end; $$;
commit;
