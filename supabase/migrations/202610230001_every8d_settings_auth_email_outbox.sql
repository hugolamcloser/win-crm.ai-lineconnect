-- C3c-3 database authority only. Quiescent maintenance apply; no online-apply claim.
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


-- Exact pinned C3c-2a prerequisite manifests; no repair or normalization.
do $preflight$
declare
  trusted_owner oid;
  actual_relations jsonb;
  actual_functions jsonb;
begin
  if current_setting('server_encoding') <> 'UTF8' then
    raise exception 'C3c-3 requires UTF8' using errcode='22021';
  end if;
  if (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception 'C3c-3 requires application roles' using errcode='42704';
  end if;
  select c.relowner into trusted_owner from pg_class c
  where c.oid=to_regclass('public.ghl_marketplace_installations');
  if trusted_owner is null or trusted_owner <> current_user::regrole::oid
    or trusted_owner in ('anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid)
    or exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated','service_role')
      and pg_has_role(r.oid,trusted_owner,'MEMBER'))
    or (select count(*) from pg_class c where c.relnamespace='public'::regnamespace
      and c.relname in ('ghl_marketplace_installations','ghl_marketplace_app_registrations','ghl_marketplace_app_version_registrations','every8d_settings_enrollment_grants','every8d_settings_administrators','every8d_settings_sessions','every8d_settings_auth_challenges','every8d_settings_auth_challenge_failures') and c.relowner=trusted_owner) <> 8 then
    raise exception 'C3c-3 requires trusted common ownership' using errcode='42501';
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
    raise exception 'C3c-3 requires trusted schema and language privileges' using errcode='42501';
  end if;
  if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
      join pg_depend d on d.refclassid='pg_extension'::regclass and d.refobjid=e.oid
        and d.classid='pg_proc'::regclass and d.objid=to_regprocedure('extensions.digest(bytea,text)')
      where e.extname='pgcrypto' and n.nspname='extensions' and d.deptype='e')
    or not has_function_privilege(trusted_owner,'extensions.digest(bytea,text)','EXECUTE') then
    raise exception 'C3c-3 requires extensions.digest(bytea,text)' using errcode='55000';
  end if;
  if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace
      and (p.proname like '%every8d_settings%' or p.proname='every8d_settings_email_lock_word_v1')
      and p.proowner<>trusted_owner) then
    raise exception 'C3c-3 prior settings authority owner mismatch' using errcode='42501';
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
    raise exception 'C3c-3 lifecycle prerequisite authority mismatch' using errcode='42501';
  end if;
  if exists(select 1 from (values ('anon'),('authenticated'),('service_role')) r(role_name)
    cross join (values ('public.every8d_settings_enrollment_grants'),('public.every8d_settings_administrators'),('public.every8d_settings_sessions'),('public.every8d_settings_auth_challenges'),('public.every8d_settings_auth_challenge_failures')) t(relation_name)
    where has_table_privilege(r.role_name,t.relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(r.role_name,t.relation_name,'SELECT,INSERT,UPDATE,REFERENCES')) then
    raise exception 'C3c-3 refuses effective auth table privileges' using errcode='42501';
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
    raise exception 'C3c-3 frozen prerequisite manifest mismatch' using errcode='55000';
  end if;
  perform set_config('wincrm.c3c3_relations',actual_relations::text,true);
  perform set_config('wincrm.c3c3_prior_functions',actual_functions::text,true);
  perform set_config('wincrm.c3c3_owner',trusted_owner::text,true);
  perform set_config('wincrm.c3c3_row_counts',(select jsonb_build_array((select count(*) from public.ghl_marketplace_installations),(select count(*) from public.ghl_marketplace_app_registrations),(select count(*) from public.ghl_marketplace_app_version_registrations),(select count(*) from public.every8d_settings_enrollment_grants),(select count(*) from public.every8d_settings_administrators),(select count(*) from public.every8d_settings_sessions),(select count(*) from public.every8d_settings_auth_challenges),(select count(*) from public.every8d_settings_auth_challenge_failures))::text),true);
  perform set_config('wincrm.c3c3_default_acls',
    (select coalesce(jsonb_agg(to_jsonb(d) order by d.oid),'[]')::text from pg_default_acl d),true);
end;
$preflight$;
do $targets$
declare actual jsonb; trusted_owner oid := current_setting('wincrm.c3c3_owner')::oid;
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
    raise exception 'C3c-3 target definition owner or ACL mismatch' using errcode='55000';
  end if;
end;
$targets$;

-- Refuse every target collision, including overloads and other relation kinds.
do $$
begin
  if exists(select 1 from pg_class where relnamespace='public'::regnamespace and relname in (
    'every8d_settings_auth_email_outbox','every8d_settings_auth_email_outbox_installation_guard',
    'every8d_settings_auth_email_outbox_fence_seq','e8d_settings_email_outbox_pkey',
    'e8d_settings_email_outbox_challenge_key','e8d_settings_email_outbox_ready_idx',
    'e8d_settings_email_outbox_lease_idx','e8d_settings_email_outbox_deadline_idx',
    'e8d_settings_email_outbox_terminal_idx','e8d_settings_email_outbox_guard_pkey'))
    or exists(select 1 from pg_proc where pronamespace='public'::regnamespace and
      (proname like '%every8d_settings_auth_email%' or proname='every8d_settings_auth_email_aad_v1')) then
    raise exception 'C3c-3 target conflict' using errcode='42710';
  end if;
end;
$$;

create sequence public.every8d_settings_auth_email_outbox_fence_seq as bigint
increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle owned by none;

create table public.every8d_settings_auth_email_outbox_installation_guard (
  guard_id boolean not null,
  migration_postmaster_started_at timestamptz not null,
  created_at timestamptz not null,
  constraint e8d_settings_email_outbox_guard_pkey primary key(guard_id),
  constraint e8d_settings_email_outbox_guard_singleton_check check(guard_id=true),
  constraint e8d_settings_email_outbox_guard_time_check check(
    isfinite(migration_postmaster_started_at) and isfinite(created_at)
    and migration_postmaster_started_at<=created_at)
);
insert into public.every8d_settings_auth_email_outbox_installation_guard
values(true,pg_catalog.pg_postmaster_start_time(),pg_catalog.clock_timestamp());

create table public.every8d_settings_auth_email_outbox (
  job_id uuid not null,
  challenge_id uuid not null,
  request_token_hash bytea not null,
  purpose text not null,
  envelope_version smallint not null,
  payload_version smallint not null,
  template_version smallint not null,
  enqueue_fingerprint bytea not null,
  state text not null default 'PENDING',
  attempt_count smallint not null default 0,
  fence_generation bigint not null,
  lease_id uuid,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  available_at timestamptz,
  last_attempt_started_at timestamptz,
  last_provider_deadline_at timestamptz,
  delivery_deadline_at timestamptz not null,
  encryption_key_version text,
  nonce bytea,
  ciphertext bytea,
  authentication_tag bytea,
  created_at timestamptz not null default clock_timestamp(),
  terminal_at timestamptz,
  terminal_disposition text,
  provider_message_id text,
  challenge_recording text not null default 'not_applicable',
  resolution_kind text,
  resolution_provider_outcome text,
  resolution_pre_send_disposition text,
  resolution_non_acceptance_proven boolean,
  resolution_lease_id uuid,
  resolution_fence_generation bigint,
  resolution_attempt_count smallint,
  resolved_at timestamptz,
  constraint e8d_settings_email_outbox_pkey primary key(job_id),
  constraint e8d_settings_email_outbox_challenge_key unique(challenge_id),
  constraint e8d_settings_email_outbox_challenge_fk foreign key(challenge_id)
    references public.every8d_settings_auth_challenges(id) match simple
    on update restrict on delete restrict not deferrable,
  constraint e8d_settings_email_outbox_identity_check check(
    job_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and octet_length(request_token_hash)=32 and octet_length(enqueue_fingerprint)=32
    and purpose in ('login','enrollment')),
  constraint e8d_settings_email_outbox_versions_check check(
    envelope_version=1 and payload_version=1 and template_version=1),
  constraint e8d_settings_email_outbox_state_check check(state in (
    'PENDING','LEASED','SENDING','RETRY_WAIT','ACCEPTED','FAILED_TERMINAL',
    'DELIVERY_OUTCOME_UNKNOWN','CANCELLED','EXPIRED')),
  constraint e8d_settings_email_outbox_counter_check check(
    attempt_count between 0 and 3 and fence_generation>0
    and (state<>'PENDING' or attempt_count=0)
    and (state<>'LEASED' or attempt_count between 0 and 2)
    and (state<>'SENDING' or attempt_count between 1 and 3)
    and (state<>'RETRY_WAIT' or attempt_count between 1 and 2)),
  constraint e8d_settings_email_outbox_payload_check check(
    case when state in ('PENDING','LEASED','SENDING','RETRY_WAIT') then
      encryption_key_version is not null and encryption_key_version ~ '^[A-Za-z0-9_.-]{1,63}$'
      and nonce is not null and octet_length(nonce)=12
      and ciphertext is not null and octet_length(ciphertext) between 1 and 512
      and authentication_tag is not null and octet_length(authentication_tag)=16
    else encryption_key_version is null and nonce is null and ciphertext is null
      and authentication_tag is null end),
  constraint e8d_settings_email_outbox_lease_check check(
    case when state in ('LEASED','SENDING') then
      lease_id is not null and leased_at is not null and lease_expires_at is not null
      and lease_expires_at=leased_at+interval '30 seconds'
    else lease_id is null and leased_at is null and lease_expires_at is null end),
  constraint e8d_settings_email_outbox_schedule_check check(
    case when state in ('PENDING','LEASED','SENDING','RETRY_WAIT') then available_at is not null
    else available_at is null end
    and (state<>'RETRY_WAIT' or (resolved_at is not null and available_at is not null
      and available_at=resolved_at+case attempt_count when 1 then interval '5 seconds'
        else interval '20 seconds' end))),
  constraint e8d_settings_email_outbox_attempt_time_check check(
    case when attempt_count=0 then last_attempt_started_at is null and last_provider_deadline_at is null
    else last_attempt_started_at is not null and last_provider_deadline_at is not null
      and last_provider_deadline_at=last_attempt_started_at+interval '10 seconds' end),
  constraint e8d_settings_email_outbox_terminal_check check(
    case when state in ('PENDING','LEASED','SENDING','RETRY_WAIT') then
      terminal_at is null and terminal_disposition is null
    else terminal_at is not null and terminal_disposition is not null and (
      (state='ACCEPTED' and terminal_disposition='accepted' and attempt_count between 1 and 3)
      or (state='DELIVERY_OUTCOME_UNKNOWN' and terminal_disposition='delivery_outcome_unknown'
        and attempt_count between 1 and 3)
      or (state='CANCELLED' and terminal_disposition='cancelled_pre_send' and attempt_count=0)
      or (state='EXPIRED' and terminal_disposition='expired_pre_send' and attempt_count=0)
      or (state='FAILED_TERMINAL' and (
        (terminal_disposition='provider_rejected' and attempt_count between 1 and 3)
        or (terminal_disposition='sender_unavailable_pre_send' and attempt_count between 0 and 2)
        or (terminal_disposition='retry_budget_exhausted' and attempt_count=3)
        or (terminal_disposition in ('retry_deadline_exhausted','retry_unusable')
          and attempt_count between 1 and 2)))) end),
  constraint e8d_settings_email_outbox_provider_id_check check(
    case when state='ACCEPTED' then provider_message_id is not null
      and octet_length(provider_message_id) between 1 and 255 and provider_message_id ~ '^[!-~]+$'
    else provider_message_id is null end),
  constraint e8d_settings_email_outbox_resolution_check check(
    challenge_recording in ('not_applicable','recorded','not_recorded') and
    case when resolution_kind is null then
      resolution_provider_outcome is null and resolution_pre_send_disposition is null
      and resolution_non_acceptance_proven is null and resolution_lease_id is null
      and resolution_fence_generation is null and resolution_attempt_count is null
      and resolved_at is null and state in ('PENDING','LEASED','SENDING')
      and challenge_recording='not_applicable'
    else resolution_kind in ('provider','pre_send','recovery','unusable')
      and resolved_at is not null and resolution_non_acceptance_proven is not null
      and resolution_attempt_count is not null and resolution_attempt_count between 0 and attempt_count
      and (state in ('LEASED','SENDING') or resolution_attempt_count=attempt_count)
      and (resolution_lease_id is null)=(resolution_fence_generation is null)
      and (resolution_fence_generation is null or resolution_fence_generation>0)
      and (terminal_at is null or resolved_at=terminal_at)
      and case when resolution_kind='provider' then
        resolution_lease_id is not null and resolution_fence_generation is not null
        and resolution_pre_send_disposition is null and resolution_provider_outcome is not null
        and ((resolution_provider_outcome='accepted' and not resolution_non_acceptance_proven
          and state='ACCEPTED' and challenge_recording in ('recorded','not_recorded'))
        or (resolution_provider_outcome='rejected' and not resolution_non_acceptance_proven
          and terminal_disposition='provider_rejected' and challenge_recording in ('recorded','not_recorded'))
        or (resolution_provider_outcome='outcome_unknown' and not resolution_non_acceptance_proven
          and state='DELIVERY_OUTCOME_UNKNOWN' and challenge_recording in ('recorded','not_recorded'))
        or (resolution_provider_outcome='not_accepted_retryable' and resolution_non_acceptance_proven
          and challenge_recording='not_applicable'
          and ((state in ('LEASED','SENDING','RETRY_WAIT') and terminal_at is null)
            or (state='FAILED_TERMINAL' and terminal_disposition in (
              'retry_budget_exhausted','retry_deadline_exhausted','retry_unusable')))))
      when resolution_kind='pre_send' then resolution_provider_outcome is null
        and resolution_pre_send_disposition is not null and resolution_pre_send_disposition='sender_unavailable'
        and not resolution_non_acceptance_proven and resolution_lease_id is not null
        and resolution_fence_generation is not null and state='FAILED_TERMINAL'
        and terminal_disposition='sender_unavailable_pre_send'
        and challenge_recording in ('recorded','not_recorded')
      else resolution_provider_outcome is null and resolution_pre_send_disposition is null
        and terminal_at is not null
        and ((state='DELIVERY_OUTCOME_UNKNOWN' and resolution_kind='recovery'
          and not resolution_non_acceptance_proven and challenge_recording in ('recorded','not_recorded'))
        or (state in ('CANCELLED','EXPIRED') and not resolution_non_acceptance_proven
          and challenge_recording='not_applicable')
        or (state='FAILED_TERMINAL' and terminal_disposition in ('retry_unusable','retry_deadline_exhausted')
          and resolution_non_acceptance_proven and challenge_recording='not_applicable')) end end),
  constraint e8d_settings_email_outbox_time_check check(
    isfinite(created_at) and isfinite(delivery_deadline_at) and created_at<delivery_deadline_at
    and (available_at is null or (isfinite(available_at) and available_at>=created_at))
    and (leased_at is null or (isfinite(leased_at) and leased_at>=created_at))
    and (lease_expires_at is null or isfinite(lease_expires_at))
    and (last_attempt_started_at is null or (isfinite(last_attempt_started_at) and last_attempt_started_at>=created_at))
    and (last_provider_deadline_at is null or (isfinite(last_provider_deadline_at)
      and last_provider_deadline_at<delivery_deadline_at))
    and (terminal_at is null or (isfinite(terminal_at) and terminal_at>=created_at))
    and (resolved_at is null or (isfinite(resolved_at) and resolved_at>=created_at))
    and (state<>'SENDING' or (last_attempt_started_at>=leased_at
      and last_provider_deadline_at<lease_expires_at)))
);
create index e8d_settings_email_outbox_ready_idx on public.every8d_settings_auth_email_outbox(available_at,job_id)
where state in ('PENDING','RETRY_WAIT');
create index e8d_settings_email_outbox_lease_idx on public.every8d_settings_auth_email_outbox(lease_expires_at,job_id)
where state in ('LEASED','SENDING');
create index e8d_settings_email_outbox_deadline_idx on public.every8d_settings_auth_email_outbox(delivery_deadline_at,job_id)
where state in ('PENDING','LEASED','SENDING','RETRY_WAIT');
create index e8d_settings_email_outbox_terminal_idx on public.every8d_settings_auth_email_outbox(terminal_at,job_id)
where state in ('ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN','CANCELLED','EXPIRED');

alter table public.every8d_settings_auth_email_outbox enable row level security;
alter table public.every8d_settings_auth_email_outbox_installation_guard enable row level security;
revoke all on table public.every8d_settings_auth_email_outbox,
  public.every8d_settings_auth_email_outbox_installation_guard from public,anon,authenticated,service_role;
revoke all on sequence public.every8d_settings_auth_email_outbox_fence_seq from public,anon,authenticated,service_role;

create function public.every8d_settings_auth_email_aad_v1(
  input_job_id uuid,input_challenge_id uuid,input_request_token_hash bytea,input_purpose text,
  input_envelope_version smallint,input_payload_version smallint,input_template_version smallint,
  input_encryption_key_version text
) returns bytea language plpgsql security invoker immutable called on null input parallel safe
cost 100 set search_path = pg_catalog, public
as $$
declare domain_bytes bytea:=pg_catalog.convert_to('wincrm/every8d/settings/auth-email-outbox/aad/v1','UTF8');
  key_bytes bytea; purpose_bytes bytea;
begin
  if input_job_id is null or input_challenge_id is null or input_request_token_hash is null
    or pg_catalog.octet_length(input_request_token_hash)<>32
    or input_purpose is null or input_purpose not in ('login','enrollment')
    or input_envelope_version is distinct from 1 or input_payload_version is distinct from 1
    or input_template_version is distinct from 1 or input_encryption_key_version is null
    or input_encryption_key_version !~ '^[A-Za-z0-9_.-]{1,63}$' then
    raise exception 'C3c-3 invalid input' using errcode='22023';
  end if;
  key_bytes:=pg_catalog.convert_to(input_encryption_key_version,'UTF8');
  purpose_bytes:=pg_catalog.convert_to(input_purpose,'UTF8');
  return pg_catalog.int4send(pg_catalog.octet_length(domain_bytes))||domain_bytes
    ||pg_catalog.int2send(input_envelope_version)
    ||pg_catalog.int4send(pg_catalog.octet_length(key_bytes))||key_bytes
    ||pg_catalog.uuid_send(input_job_id)||pg_catalog.uuid_send(input_challenge_id)
    ||input_request_token_hash||pg_catalog.int4send(pg_catalog.octet_length(purpose_bytes))||purpose_bytes
    ||pg_catalog.int2send(input_template_version)||pg_catalog.int2send(input_payload_version);
end;
$$;

create function public.protect_every8d_settings_auth_email_outbox_guard_v1()
returns trigger language plpgsql security definer volatile called on null input parallel unsafe
cost 100 set search_path = pg_catalog, public
as $$
begin
  raise exception 'C3c-3 installation guard is immutable' using errcode='23514';
end;
$$;
create trigger protect_every8d_settings_auth_email_outbox_guard before insert or update or delete
on public.every8d_settings_auth_email_outbox_installation_guard for each row
execute function public.protect_every8d_settings_auth_email_outbox_guard_v1();
create trigger deny_every8d_settings_auth_email_outbox_guard_truncate before truncate
on public.every8d_settings_auth_email_outbox_installation_guard for each statement
execute function public.protect_every8d_settings_auth_email_outbox_guard_v1();

create function public.protect_every8d_settings_auth_email_outbox_v1()
returns trigger language plpgsql security definer volatile called on null input parallel unsafe
cost 100 set search_path = pg_catalog, public
as $$
declare
  operation text:=pg_catalog.current_setting('wincrm.c3c3_outbox_operation',true);
  decision_at timestamptz;
  allowed_columns text[];
  prior_terminal boolean;
  next_terminal boolean;
  prior_positive boolean;
  resolution_matches boolean;
  never_sent_terminal boolean;
  retry_terminal boolean;
  transition_family text;
begin
  if tg_op='TRUNCATE' then
    raise exception 'C3c-3 invalid mutation' using errcode='23514';
  end if;
  if tg_op='DELETE' then
    begin
      decision_at:=pg_catalog.current_setting('wincrm.c3c3_outbox_decision_at',true)::timestamptz;
    exception when others then
      raise exception 'C3c-3 invalid mutation' using errcode='23514';
    end;
    if operation is distinct from 'purge'
      or pg_catalog.current_setting('wincrm.c3c3_outbox_purge',true) is distinct from 'on'
      or decision_at is null or not pg_catalog.isfinite(decision_at)
      or decision_at>pg_catalog.clock_timestamp()
      or old.state not in ('ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN','CANCELLED','EXPIRED')
      or old.terminal_at is null or old.terminal_at>decision_at-interval '24 hours'
      or old.encryption_key_version is not null or old.nonce is not null
      or old.ciphertext is not null or old.authentication_tag is not null
      or not exists(select 1 from public.every8d_settings_auth_challenges c
        where c.id=old.challenge_id and c.expires_at<=decision_at) then
      raise exception 'C3c-3 invalid mutation' using errcode='23514';
    end if;
    return old;
  end if;
  if tg_op='INSERT' then
    if operation is distinct from 'enqueue' or new.state<>'PENDING' or new.attempt_count<>0
      or new.fence_generation is not null or new.resolution_kind is not null
      or new.challenge_recording<>'not_applicable'
      or not exists(select 1 from public.every8d_settings_auth_challenges c
        where c.id=new.challenge_id and c.request_token_hash=new.request_token_hash
        and c.purpose=new.purpose and c.expires_at=new.delivery_deadline_at) then
      raise exception 'C3c-3 invalid mutation' using errcode='23514';
    end if;
    new.fence_generation:=pg_catalog.nextval('public.every8d_settings_auth_email_outbox_fence_seq'::regclass);
    return new;
  end if;
  prior_terminal:=old.state in ('ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN','CANCELLED','EXPIRED');
  next_terminal:=new.state in ('ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN','CANCELLED','EXPIRED');
  if prior_terminal or operation is null or new.state=old.state then
    raise exception 'C3c-3 invalid mutation' using errcode='23514';
  end if;
  -- Operation context selects a closed static provenance family; it is not authority.
  -- Core-only decisions (locks, usability, time, retry precedence, recorder) stay there.
  prior_positive:=old.attempt_count between 1 and 2
    and old.resolution_kind='provider'
    and old.resolution_provider_outcome='not_accepted_retryable'
    and old.resolution_pre_send_disposition is null
    and old.resolution_non_acceptance_proven is true
    and old.resolution_attempt_count=old.attempt_count
    and old.resolution_lease_id is not null and old.resolution_fence_generation is not null
    and old.challenge_recording='not_applicable';
  resolution_matches:=new.resolution_lease_id is not distinct from old.lease_id
    and new.resolution_fence_generation is not distinct from
      (case when old.lease_id is null then null else old.fence_generation end)
    and new.resolution_attempt_count is not distinct from old.attempt_count;
  never_sent_terminal:=old.attempt_count=0 and old.resolution_kind is null
    and ((new.state='EXPIRED' and new.terminal_disposition='expired_pre_send')
      or (new.state='CANCELLED' and new.terminal_disposition='cancelled_pre_send'));
  retry_terminal:=prior_positive and new.state='FAILED_TERMINAL'
    and new.terminal_disposition in ('retry_unusable','retry_deadline_exhausted');

  if operation='claim' and new.state='LEASED'
    and ((old.state='PENDING' and old.attempt_count=0 and old.resolution_kind is null)
      or (old.state='RETRY_WAIT' and prior_positive)) then
    transition_family:='claim';
  elsif operation='begin_send' and old.state='LEASED' then
    if new.state='SENDING' and old.attempt_count between 0 and 2
      and (old.attempt_count=0 or prior_positive)
      and new.attempt_count=old.attempt_count+1 then
      transition_family:='begin_attempt';
    elsif next_terminal and resolution_matches and new.resolution_kind='unusable'
      and new.resolution_provider_outcome is null and new.resolution_pre_send_disposition is null
      and new.provider_message_id is null and new.challenge_recording='not_applicable'
      and ((never_sent_terminal and new.resolution_non_acceptance_proven is false)
        or (retry_terminal and new.resolution_non_acceptance_proven is true)) then
      transition_family:='terminal';
    end if;
  elsif operation='finalize' and resolution_matches then
    if old.state='SENDING' and new.resolution_kind='provider'
      and new.resolution_pre_send_disposition is null then
      if new.resolution_non_acceptance_proven is false
        and new.challenge_recording in ('recorded','not_recorded') and (
          (new.state='ACCEPTED' and new.terminal_disposition='accepted'
            and new.resolution_provider_outcome='accepted' and new.provider_message_id is not null)
          or (new.state='FAILED_TERMINAL' and new.terminal_disposition='provider_rejected'
            and new.resolution_provider_outcome='rejected' and new.provider_message_id is null)
          or (new.state='DELIVERY_OUTCOME_UNKNOWN' and new.terminal_disposition='delivery_outcome_unknown'
            and new.resolution_provider_outcome='outcome_unknown' and new.provider_message_id is null)) then
        transition_family:='terminal';
      elsif new.resolution_provider_outcome='not_accepted_retryable'
        and new.resolution_non_acceptance_proven is true and new.provider_message_id is null
        and new.challenge_recording='not_applicable' then
        if new.state='RETRY_WAIT' and old.attempt_count between 1 and 2
          and new.terminal_at is null and new.terminal_disposition is null then
          transition_family:='retry_final';
        elsif new.state='FAILED_TERMINAL' and (
          (old.attempt_count=3 and new.terminal_disposition='retry_budget_exhausted')
          or (old.attempt_count between 1 and 2 and new.terminal_disposition in
            ('retry_unusable','retry_deadline_exhausted'))) then
          transition_family:='terminal';
        end if;
      end if;
    elsif old.state='LEASED' and (old.attempt_count=0 or prior_positive)
      and new.state='FAILED_TERMINAL' and new.terminal_disposition='sender_unavailable_pre_send'
      and new.resolution_kind='pre_send' and new.resolution_provider_outcome is null
      and new.resolution_pre_send_disposition='sender_unavailable'
      and new.resolution_non_acceptance_proven is false and new.provider_message_id is null
      and new.challenge_recording in ('recorded','not_recorded') then
      transition_family:='terminal';
    end if;
  elsif operation='recover' then
    if old.state='LEASED' and ((old.attempt_count=0 and old.resolution_kind is null and new.state='PENDING')
      or (prior_positive and new.state='RETRY_WAIT')) then
      transition_family:='safe_requeue';
    elsif next_terminal and resolution_matches and new.resolution_kind='recovery'
      and new.resolution_provider_outcome is null and new.resolution_pre_send_disposition is null
      and new.provider_message_id is null then
      if old.state='SENDING' and new.state='DELIVERY_OUTCOME_UNKNOWN'
        and new.terminal_disposition='delivery_outcome_unknown'
        and new.resolution_non_acceptance_proven is false
        and new.challenge_recording in ('recorded','not_recorded') then
        transition_family:='terminal';
      elsif old.state in ('PENDING','LEASED','RETRY_WAIT')
        and new.challenge_recording='not_applicable'
        and ((never_sent_terminal and old.state in ('PENDING','LEASED')
            and new.resolution_non_acceptance_proven is false)
          or (retry_terminal and old.state in ('LEASED','RETRY_WAIT')
            and new.resolution_non_acceptance_proven is true)) then
        transition_family:='terminal';
      end if;
    end if;
  end if;

  case transition_family
    when 'claim' then
      if new.fence_generation is distinct from old.fence_generation
        or new.lease_id is null or new.lease_id is not distinct from old.lease_id then
        raise exception 'C3c-3 invalid mutation' using errcode='23514';
      end if;
      new.fence_generation:=pg_catalog.nextval('public.every8d_settings_auth_email_outbox_fence_seq'::regclass);
      allowed_columns:=array['state','fence_generation','lease_id','leased_at','lease_expires_at'];
    when 'begin_attempt' then
      allowed_columns:=array['state','attempt_count','last_attempt_started_at','last_provider_deadline_at'];
    when 'retry_final' then
      allowed_columns:=array['state','available_at','lease_id','leased_at','lease_expires_at',
        'resolution_kind','resolution_provider_outcome','resolution_pre_send_disposition',
        'resolution_non_acceptance_proven','resolution_lease_id','resolution_fence_generation',
        'resolution_attempt_count','resolved_at'];
    when 'safe_requeue' then
      allowed_columns:=array['state','lease_id','leased_at','lease_expires_at'];
    when 'terminal' then
      if new.encryption_key_version is not null or new.nonce is not null
        or new.ciphertext is not null or new.authentication_tag is not null
        or new.lease_id is not null or new.leased_at is not null
        or new.lease_expires_at is not null or new.available_at is not null then
        raise exception 'C3c-3 invalid mutation' using errcode='23514';
      end if;
      allowed_columns:=array['state','terminal_at','terminal_disposition','provider_message_id',
        'challenge_recording','resolution_kind','resolution_provider_outcome','resolution_pre_send_disposition',
        'resolution_non_acceptance_proven','resolution_lease_id','resolution_fence_generation',
        'resolution_attempt_count','resolved_at','encryption_key_version','nonce','ciphertext',
        'authentication_tag','lease_id','leased_at','lease_expires_at','available_at'];
    else
      raise exception 'C3c-3 invalid mutation' using errcode='23514';
  end case;
  if (pg_catalog.to_jsonb(new)-allowed_columns) is distinct from
     (pg_catalog.to_jsonb(old)-allowed_columns) then
    raise exception 'C3c-3 invalid mutation' using errcode='23514';
  end if;
  if next_terminal then
    new.encryption_key_version:=null; new.nonce:=null; new.ciphertext:=null; new.authentication_tag:=null;
    new.lease_id:=null; new.leased_at:=null; new.lease_expires_at:=null; new.available_at:=null;
  end if;
  return new;
end;
$$;
create trigger protect_every8d_settings_auth_email_outbox before insert or update or delete
on public.every8d_settings_auth_email_outbox for each row
execute function public.protect_every8d_settings_auth_email_outbox_v1();
create trigger deny_every8d_settings_auth_email_outbox_truncate before truncate
on public.every8d_settings_auth_email_outbox for each statement
execute function public.protect_every8d_settings_auth_email_outbox_v1();

create function public.enqueue_every8d_settings_auth_email_core_v1(
input_job_id uuid,input_challenge_id uuid,input_request_token_hash bytea,input_purpose text,
input_envelope_version smallint,input_payload_version smallint,input_template_version smallint,
input_encryption_key_version text,input_nonce bytea,input_ciphertext bytea,input_authentication_tag bytea
) returns table(job_id uuid,state text,created_at timestamptz,delivery_deadline_at timestamptz)
language plpgsql security definer volatile called on null input parallel unsafe
cost 100 rows 1 set search_path = pg_catalog, public
as $$
declare

  challenge_ids uuid[]; job_ids uuid[]; grant_ids uuid[]; administrator_ids uuid[]; installation_ids uuid[];
  locked_challenges uuid[]:=array[]::uuid[]; locked_jobs uuid[]:=array[]::uuid[];
  identifier uuid; selected_id uuid; v_challenge public.every8d_settings_auth_challenges%rowtype;
  v_job public.every8d_settings_auth_email_outbox%rowtype;
  decision_at timestamptz; candidate_at timestamptz; v_usable boolean; v_window boolean;
  previous_state_value text; next_state text; disposition text; recording text;
  failure_class text; succeeded boolean; record_result boolean; fingerprint bytea; aad bytea;
  next_available timestamptz; resolution_kind_value text; non_acceptance boolean;
  old_operation text; old_purge text; old_decision text; deleted_count integer:=0;
begin
if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'C3c-3 requires READ COMMITTED' using errcode='25000'; end if;
  old_operation:=pg_catalog.current_setting('wincrm.c3c3_outbox_operation',true);

  aad:=public.every8d_settings_auth_email_aad_v1(input_job_id,input_challenge_id,input_request_token_hash,
    input_purpose,input_envelope_version,input_payload_version,input_template_version,input_encryption_key_version);
  if input_job_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or input_nonce is null or octet_length(input_nonce)<>12 or input_ciphertext is null
    or octet_length(input_ciphertext) not between 1 and 512 or input_authentication_tag is null
    or octet_length(input_authentication_tag)<>16 then raise exception 'C3c-3 invalid input' using errcode='22023'; end if;
  fingerprint:=extensions.digest(aad||pg_catalog.int4send(octet_length(input_nonce))||input_nonce
    ||pg_catalog.int4send(octet_length(input_ciphertext))||input_ciphertext
    ||pg_catalog.int4send(octet_length(input_authentication_tag))||input_authentication_tag,'sha256');
  challenge_ids:=array[input_challenge_id];
  select array_agg(o.job_id order by o.job_id) into job_ids
  from public.every8d_settings_auth_email_outbox o where o.challenge_id=input_challenge_id;

  -- Freeze the bounded union of parent locators before challenge/outbox locks.
  select array_agg(g.id order by g.id) into grant_ids
  from public.every8d_settings_enrollment_grants g
  where g.id in (select c.enrollment_grant_id from public.every8d_settings_auth_challenges c
    where c.id=any(challenge_ids));
  select array_agg(a.id order by a.id) into administrator_ids
  from public.every8d_settings_administrators a where a.revoked_at is null
    and a.normalized_email in (select c.normalized_email from public.every8d_settings_auth_challenges c
      where c.id=any(challenge_ids) and c.purpose='login');
  select array_agg(x.installation_id order by x.installation_id) into installation_ids from (
    select g.installation_id from public.every8d_settings_enrollment_grants g where g.id=any(grant_ids)
    union select a.installation_id from public.every8d_settings_administrators a where a.id=any(administrator_ids)
  ) x;
  for identifier in select unnest(installation_ids) loop
    perform 1 from public.ghl_marketplace_installations i where i.id=identifier for share of i;
  end loop;
  for identifier in select unnest(grant_ids) loop
    perform 1 from public.every8d_settings_enrollment_grants g where g.id=identifier for share of g;
  end loop;
  for identifier in select unnest(administrator_ids) loop
    perform 1 from public.every8d_settings_administrators a where a.id=identifier for share of a;
  end loop;
  for identifier in select distinct x from unnest(challenge_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_challenges c where c.id=identifier for update of c;
    if found then locked_challenges:=array_append(locked_challenges,identifier); end if;
  end loop;
  for identifier in select distinct x from unnest(job_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_email_outbox o
    where o.job_id=identifier and o.challenge_id=any(locked_challenges) for update of o;
    if found then locked_jobs:=array_append(locked_jobs,identifier); end if;
  end loop;

  if not input_challenge_id=any(locked_challenges) then return; end if;
  select o.* into v_job from public.every8d_settings_auth_email_outbox o
    where o.challenge_id=input_challenge_id or o.job_id=input_job_id order by o.job_id limit 1;
  if found then
    if v_job.job_id=input_job_id and v_job.challenge_id=input_challenge_id
      and v_job.enqueue_fingerprint=fingerprint then
      return query select v_job.job_id,v_job.state,v_job.created_at,v_job.delivery_deadline_at; end if;
    return;
  end if;
  select c.* into v_challenge from public.every8d_settings_auth_challenges c where c.id=input_challenge_id;
  decision_at:=pg_catalog.clock_timestamp();
  select (c.normalized_email is not null and c.email_scrubbed_at is null
and c.delivery_succeeded_at is null and c.delivery_failed_at is null and c.locked_at is null
and c.superseded_at is null and c.verified_at is null and c.consumed_at is null
and ((c.purpose='enrollment' and exists(
  select 1 from public.every8d_settings_enrollment_grants g
  join public.ghl_marketplace_installations i on i.id=g.installation_id
    and i.installation_generation=g.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where g.id=c.enrollment_grant_id and g.revoked_at is null and g.consumed_at is null
    and g.method in ('operator_initial','operator_recovery')
    and (g.pinned_normalized_email is null or g.pinned_normalized_email=c.normalized_email)
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and g.id=any(grant_ids) and i.id=any(installation_ids)))
or (c.purpose='login' and c.enrollment_grant_id is null and exists(
  select 1 from public.every8d_settings_administrators a
  join public.ghl_marketplace_installations i on i.id=a.installation_id
    and i.installation_generation=a.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where a.normalized_email=c.normalized_email and a.revoked_at is null
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and a.id=any(administrator_ids) and i.id=any(installation_ids))))) into v_usable from public.every8d_settings_auth_challenges c
    where c.id=input_challenge_id;
  if not coalesce(v_usable,false) or v_challenge.request_token_hash is distinct from input_request_token_hash
    or v_challenge.purpose is distinct from input_purpose or decision_at>=v_challenge.expires_at then return; end if;
-- A savepoint rolls back a newly inserted row if a uniqueness wait crossed expiry.
  -- This is a single admission attempt, never an automatic RPC/INSERT retry.
  begin
perform set_config('wincrm.c3c3_outbox_operation','enqueue',true);
insert into public.every8d_settings_auth_email_outbox(
    job_id,challenge_id,request_token_hash,purpose,envelope_version,payload_version,template_version,
    enqueue_fingerprint,available_at,delivery_deadline_at,encryption_key_version,nonce,ciphertext,
    authentication_tag,created_at)
  values(input_job_id,input_challenge_id,input_request_token_hash,input_purpose,input_envelope_version,
    input_payload_version,input_template_version,fingerprint,decision_at,v_challenge.expires_at,
    input_encryption_key_version,input_nonce,input_ciphertext,input_authentication_tag,decision_at)
  on conflict do nothing returning * into v_job;
perform set_config('wincrm.c3c3_outbox_operation',coalesce(old_operation,''),true);


  if v_job.job_id is not null then
    decision_at:=pg_catalog.clock_timestamp();
    if decision_at>=v_challenge.expires_at then
      raise exception 'C3c-3 enqueue admission elapsed' using errcode='ZC303';
    end if;
  end if;
  exception when sqlstate 'ZC303' then
    perform set_config('wincrm.c3c3_outbox_operation',coalesce(old_operation,''),true);
    return;
  end;
  -- Fresh snapshot after a possible uniqueness wait; only a stored receipt can be returned.
  if v_job.job_id is null then
    select o.* into v_job from public.every8d_settings_auth_email_outbox o
    where o.job_id=input_job_id and o.challenge_id=input_challenge_id and o.enqueue_fingerprint=fingerprint;
  end if;
  if v_job.job_id is not null then return query select v_job.job_id,v_job.state,v_job.created_at,v_job.delivery_deadline_at; end if;

end;
$$;
create function public.runtime_enqueue_every8d_settings_auth_email_v1(
input_job_id uuid,input_challenge_id uuid,input_request_token_hash bytea,input_purpose text,
input_envelope_version smallint,input_payload_version smallint,input_template_version smallint,
input_encryption_key_version text,input_nonce bytea,input_ciphertext bytea,input_authentication_tag bytea
) returns table(job_id uuid,state text,created_at timestamptz,delivery_deadline_at timestamptz)
language sql security definer volatile called on null input parallel unsafe
cost 100 rows 1 set search_path = pg_catalog, public
as $$
select * from public.enqueue_every8d_settings_auth_email_core_v1(input_job_id,input_challenge_id,input_request_token_hash,input_purpose,input_envelope_version,input_payload_version,input_template_version,input_encryption_key_version,input_nonce,input_ciphertext,input_authentication_tag)
$$;

create function public.claim_every8d_settings_auth_email_core_v1(
input_batch_size integer
) returns table(job_id uuid,challenge_id uuid,request_token_hash bytea,purpose text,envelope_version smallint,
payload_version smallint,template_version smallint,encryption_key_version text,nonce bytea,ciphertext bytea,
authentication_tag bytea,lease_id uuid,fence text,lease_expires_at timestamptz,attempt_count smallint,
available_at timestamptz,delivery_deadline_at timestamptz,leased_at timestamptz,db_now timestamptz)
language plpgsql security definer volatile called on null input parallel unsafe
cost 100 rows 10 set search_path = pg_catalog, public
as $$
declare

  challenge_ids uuid[]; job_ids uuid[]; grant_ids uuid[]; administrator_ids uuid[]; installation_ids uuid[];
  locked_challenges uuid[]:=array[]::uuid[]; locked_jobs uuid[]:=array[]::uuid[];
  identifier uuid; selected_id uuid; v_challenge public.every8d_settings_auth_challenges%rowtype;
  v_job public.every8d_settings_auth_email_outbox%rowtype;
  decision_at timestamptz; candidate_at timestamptz; v_usable boolean; v_window boolean;
  previous_state_value text; next_state text; disposition text; recording text;
  failure_class text; succeeded boolean; record_result boolean; fingerprint bytea; aad bytea;
  next_available timestamptz; resolution_kind_value text; non_acceptance boolean;
  old_operation text; old_purge text; old_decision text; deleted_count integer:=0;
begin
if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'C3c-3 requires READ COMMITTED' using errcode='25000'; end if;
  old_operation:=pg_catalog.current_setting('wincrm.c3c3_outbox_operation',true);
if input_batch_size is null or input_batch_size not between 1 and 10 then raise exception 'C3c-3 invalid input' using errcode='22023'; end if;
candidate_at:=pg_catalog.clock_timestamp();
  select array_agg(x.job_id order by x.position),array_agg(x.challenge_id order by x.position)
  into job_ids,challenge_ids from (
    select o.job_id,o.challenge_id,row_number() over(order by o.available_at,o.job_id) as position
    from public.every8d_settings_auth_email_outbox o
    join public.every8d_settings_auth_challenges c on c.id=o.challenge_id
    where o.state in ('PENDING','RETRY_WAIT') and o.available_at<=candidate_at order by o.available_at,o.job_id limit input_batch_size
  ) x;

  -- Freeze the bounded union of parent locators before challenge/outbox locks.
  select array_agg(g.id order by g.id) into grant_ids
  from public.every8d_settings_enrollment_grants g
  where g.id in (select c.enrollment_grant_id from public.every8d_settings_auth_challenges c
    where c.id=any(challenge_ids));
  select array_agg(a.id order by a.id) into administrator_ids
  from public.every8d_settings_administrators a where a.revoked_at is null
    and a.normalized_email in (select c.normalized_email from public.every8d_settings_auth_challenges c
      where c.id=any(challenge_ids) and c.purpose='login');
  select array_agg(x.installation_id order by x.installation_id) into installation_ids from (
    select g.installation_id from public.every8d_settings_enrollment_grants g where g.id=any(grant_ids)
    union select a.installation_id from public.every8d_settings_administrators a where a.id=any(administrator_ids)
  ) x;
  for identifier in select unnest(installation_ids) loop
    perform 1 from public.ghl_marketplace_installations i where i.id=identifier for share of i;
  end loop;
  for identifier in select unnest(grant_ids) loop
    perform 1 from public.every8d_settings_enrollment_grants g where g.id=identifier for share of g;
  end loop;
  for identifier in select unnest(administrator_ids) loop
    perform 1 from public.every8d_settings_administrators a where a.id=identifier for share of a;
  end loop;
  for identifier in select distinct x from unnest(challenge_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_challenges c where c.id=identifier for update of c skip locked;
    if found then locked_challenges:=array_append(locked_challenges,identifier); end if;
  end loop;
  for identifier in select distinct x from unnest(job_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_email_outbox o
    where o.job_id=identifier and o.challenge_id=any(locked_challenges) for update of o skip locked;
    if found then locked_jobs:=array_append(locked_jobs,identifier); end if;
  end loop;

  for selected_id in select unnest(job_ids) loop
    if not selected_id=any(locked_jobs) then continue; end if;
    select o.* into v_job from public.every8d_settings_auth_email_outbox o where o.job_id=selected_id;
    if not found then continue; end if;
select c.* into v_challenge from public.every8d_settings_auth_challenges c where c.id=v_job.challenge_id;
  decision_at:=pg_catalog.clock_timestamp();
  select (c.normalized_email is not null and c.email_scrubbed_at is null
and c.delivery_succeeded_at is null and c.delivery_failed_at is null and c.locked_at is null
and c.superseded_at is null and c.verified_at is null and c.consumed_at is null
and ((c.purpose='enrollment' and exists(
  select 1 from public.every8d_settings_enrollment_grants g
  join public.ghl_marketplace_installations i on i.id=g.installation_id
    and i.installation_generation=g.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where g.id=c.enrollment_grant_id and g.revoked_at is null and g.consumed_at is null
    and g.method in ('operator_initial','operator_recovery')
    and (g.pinned_normalized_email is null or g.pinned_normalized_email=c.normalized_email)
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and g.id=any(grant_ids) and i.id=any(installation_ids)))
or (c.purpose='login' and c.enrollment_grant_id is null and exists(
  select 1 from public.every8d_settings_administrators a
  join public.ghl_marketplace_installations i on i.id=a.installation_id
    and i.installation_generation=a.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where a.normalized_email=c.normalized_email and a.revoked_at is null
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and a.id=any(administrator_ids) and i.id=any(installation_ids))))) into v_usable from public.every8d_settings_auth_challenges c
    where c.id=v_job.challenge_id;
  v_usable:=coalesce(v_usable,false) and v_challenge.request_token_hash=v_job.request_token_hash
    and v_challenge.purpose=v_job.purpose and v_challenge.expires_at=v_job.delivery_deadline_at;
  v_window:=decision_at+interval '10 seconds'<v_job.delivery_deadline_at;
if v_job.state not in ('PENDING','RETRY_WAIT') or not v_usable or not v_window
      or v_job.available_at>decision_at or v_job.attempt_count>=3 then continue; end if;
perform set_config('wincrm.c3c3_outbox_operation','claim',true);
update public.every8d_settings_auth_email_outbox o set state='LEASED',
      lease_id=pg_catalog.gen_random_uuid(),leased_at=decision_at,lease_expires_at=decision_at+interval '30 seconds'
      where o.job_id=v_job.job_id returning o.* into v_job;
perform set_config('wincrm.c3c3_outbox_operation',coalesce(old_operation,''),true);
return query select v_job.job_id,v_job.challenge_id,v_job.request_token_hash,v_job.purpose,
    v_job.envelope_version,v_job.payload_version,v_job.template_version,v_job.encryption_key_version,
    v_job.nonce,v_job.ciphertext,v_job.authentication_tag,v_job.lease_id,v_job.fence_generation::text,
    v_job.lease_expires_at,v_job.attempt_count,v_job.available_at,v_job.delivery_deadline_at,
    v_job.leased_at,decision_at;
end loop;

end;
$$;
create function public.runtime_claim_every8d_settings_auth_email_v1(
input_batch_size integer
) returns table(job_id uuid,challenge_id uuid,request_token_hash bytea,purpose text,envelope_version smallint,
payload_version smallint,template_version smallint,encryption_key_version text,nonce bytea,ciphertext bytea,
authentication_tag bytea,lease_id uuid,fence text,lease_expires_at timestamptz,attempt_count smallint,
available_at timestamptz,delivery_deadline_at timestamptz,leased_at timestamptz,db_now timestamptz)
language sql security definer volatile called on null input parallel unsafe
cost 100 rows 10 set search_path = pg_catalog, public
as $$
select * from public.claim_every8d_settings_auth_email_core_v1(input_batch_size)
$$;

create function public.begin_every8d_settings_auth_email_send_core_v1(
input_job_id uuid,input_lease_id uuid,input_fence bigint
) returns table(job_id uuid,state text,attempt_count smallint,lease_id uuid,fence text,attempt_started_at timestamptz,
provider_deadline_at timestamptz,lease_expires_at timestamptz,delivery_deadline_at timestamptz,
terminal_disposition text,terminal_at timestamptz,db_now timestamptz)
language plpgsql security definer volatile called on null input parallel unsafe
cost 100 rows 1 set search_path = pg_catalog, public
as $$
declare

  challenge_ids uuid[]; job_ids uuid[]; grant_ids uuid[]; administrator_ids uuid[]; installation_ids uuid[];
  locked_challenges uuid[]:=array[]::uuid[]; locked_jobs uuid[]:=array[]::uuid[];
  identifier uuid; selected_id uuid; v_challenge public.every8d_settings_auth_challenges%rowtype;
  v_job public.every8d_settings_auth_email_outbox%rowtype;
  decision_at timestamptz; candidate_at timestamptz; v_usable boolean; v_window boolean;
  previous_state_value text; next_state text; disposition text; recording text;
  failure_class text; succeeded boolean; record_result boolean; fingerprint bytea; aad bytea;
  next_available timestamptz; resolution_kind_value text; non_acceptance boolean;
  old_operation text; old_purge text; old_decision text; deleted_count integer:=0;
begin
if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'C3c-3 requires READ COMMITTED' using errcode='25000'; end if;
  old_operation:=pg_catalog.current_setting('wincrm.c3c3_outbox_operation',true);
if input_job_id is null or input_job_id::text !~
  '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or input_lease_id is null or input_fence is null or input_fence<=0 then raise exception 'C3c-3 invalid input' using errcode='22023'; end if;
select array[o.challenge_id],array[o.job_id] into challenge_ids,job_ids
    from public.every8d_settings_auth_email_outbox o where o.job_id=input_job_id;
  if not found then return; end if;

  -- Freeze the bounded union of parent locators before challenge/outbox locks.
  select array_agg(g.id order by g.id) into grant_ids
  from public.every8d_settings_enrollment_grants g
  where g.id in (select c.enrollment_grant_id from public.every8d_settings_auth_challenges c
    where c.id=any(challenge_ids));
  select array_agg(a.id order by a.id) into administrator_ids
  from public.every8d_settings_administrators a where a.revoked_at is null
    and a.normalized_email in (select c.normalized_email from public.every8d_settings_auth_challenges c
      where c.id=any(challenge_ids) and c.purpose='login');
  select array_agg(x.installation_id order by x.installation_id) into installation_ids from (
    select g.installation_id from public.every8d_settings_enrollment_grants g where g.id=any(grant_ids)
    union select a.installation_id from public.every8d_settings_administrators a where a.id=any(administrator_ids)
  ) x;
  for identifier in select unnest(installation_ids) loop
    perform 1 from public.ghl_marketplace_installations i where i.id=identifier for share of i;
  end loop;
  for identifier in select unnest(grant_ids) loop
    perform 1 from public.every8d_settings_enrollment_grants g where g.id=identifier for share of g;
  end loop;
  for identifier in select unnest(administrator_ids) loop
    perform 1 from public.every8d_settings_administrators a where a.id=identifier for share of a;
  end loop;
  for identifier in select distinct x from unnest(challenge_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_challenges c where c.id=identifier for update of c;
    if found then locked_challenges:=array_append(locked_challenges,identifier); end if;
  end loop;
  for identifier in select distinct x from unnest(job_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_email_outbox o
    where o.job_id=identifier and o.challenge_id=any(locked_challenges) for update of o;
    if found then locked_jobs:=array_append(locked_jobs,identifier); end if;
  end loop;

  if not input_job_id=any(locked_jobs) then return; end if;
  select o.* into v_job from public.every8d_settings_auth_email_outbox o where o.job_id=input_job_id;
select c.* into v_challenge from public.every8d_settings_auth_challenges c where c.id=v_job.challenge_id;
  decision_at:=pg_catalog.clock_timestamp();
  select (c.normalized_email is not null and c.email_scrubbed_at is null
and c.delivery_succeeded_at is null and c.delivery_failed_at is null and c.locked_at is null
and c.superseded_at is null and c.verified_at is null and c.consumed_at is null
and ((c.purpose='enrollment' and exists(
  select 1 from public.every8d_settings_enrollment_grants g
  join public.ghl_marketplace_installations i on i.id=g.installation_id
    and i.installation_generation=g.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where g.id=c.enrollment_grant_id and g.revoked_at is null and g.consumed_at is null
    and g.method in ('operator_initial','operator_recovery')
    and (g.pinned_normalized_email is null or g.pinned_normalized_email=c.normalized_email)
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and g.id=any(grant_ids) and i.id=any(installation_ids)))
or (c.purpose='login' and c.enrollment_grant_id is null and exists(
  select 1 from public.every8d_settings_administrators a
  join public.ghl_marketplace_installations i on i.id=a.installation_id
    and i.installation_generation=a.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where a.normalized_email=c.normalized_email and a.revoked_at is null
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and a.id=any(administrator_ids) and i.id=any(installation_ids))))) into v_usable from public.every8d_settings_auth_challenges c
    where c.id=v_job.challenge_id;
  v_usable:=coalesce(v_usable,false) and v_challenge.request_token_hash=v_job.request_token_hash
    and v_challenge.purpose=v_job.purpose and v_challenge.expires_at=v_job.delivery_deadline_at;
  v_window:=decision_at+interval '10 seconds'<v_job.delivery_deadline_at;
if v_job.state<>'LEASED' or v_job.lease_id is distinct from input_lease_id
    or v_job.fence_generation<>input_fence or decision_at>=v_job.lease_expires_at then return; end if;
  if not v_usable or not v_window then
    recording:='not_applicable'; resolution_kind_value:='unusable'; non_acceptance:=v_job.attempt_count>0;
    
  if v_job.attempt_count=0 then
    if not v_window then next_state:='EXPIRED'; disposition:='expired_pre_send';
    else next_state:='CANCELLED'; disposition:='cancelled_pre_send'; end if;
  else
    next_state:='FAILED_TERMINAL';
    if not v_usable then disposition:='retry_unusable';
    else disposition:='retry_deadline_exhausted'; end if;
  end if;
perform set_config('wincrm.c3c3_outbox_operation','begin_send',true);
update public.every8d_settings_auth_email_outbox o set
    state=next_state,terminal_at=decision_at,terminal_disposition=disposition,
    provider_message_id=null,
    challenge_recording=recording,resolution_kind=resolution_kind_value,
    resolution_provider_outcome=null,resolution_pre_send_disposition=null,
    resolution_non_acceptance_proven=non_acceptance,
    resolution_lease_id=v_job.lease_id,resolution_fence_generation=
      case when v_job.lease_id is null then null else v_job.fence_generation end,
    resolution_attempt_count=v_job.attempt_count,resolved_at=decision_at,
    encryption_key_version=null,nonce=null,ciphertext=null,authentication_tag=null,
    lease_id=null,leased_at=null,lease_expires_at=null,available_at=null
  where o.job_id=v_job.job_id returning o.* into v_job;
perform set_config('wincrm.c3c3_outbox_operation',coalesce(old_operation,''),true);

  elsif v_job.available_at<=decision_at and v_job.attempt_count<3
    and decision_at+interval '10 seconds'<v_job.lease_expires_at then
    perform set_config('wincrm.c3c3_outbox_operation','begin_send',true);
update public.every8d_settings_auth_email_outbox o set
      state='SENDING',attempt_count=o.attempt_count+1,last_attempt_started_at=decision_at,
      last_provider_deadline_at=decision_at+interval '10 seconds'
      where o.job_id=v_job.job_id returning o.* into v_job;
perform set_config('wincrm.c3c3_outbox_operation',coalesce(old_operation,''),true);

  else return; end if;
  return query select v_job.job_id,v_job.state,v_job.attempt_count,v_job.lease_id,v_job.fence_generation::text,
    case when v_job.state='SENDING' then v_job.last_attempt_started_at else null end,
    case when v_job.state='SENDING' then v_job.last_provider_deadline_at else null end,
    v_job.lease_expires_at,v_job.delivery_deadline_at,v_job.terminal_disposition,v_job.terminal_at,decision_at;
end;
$$;
create function public.runtime_begin_every8d_settings_auth_email_send_v1(
input_job_id uuid,input_lease_id uuid,input_fence bigint
) returns table(job_id uuid,state text,attempt_count smallint,lease_id uuid,fence text,attempt_started_at timestamptz,
provider_deadline_at timestamptz,lease_expires_at timestamptz,delivery_deadline_at timestamptz,
terminal_disposition text,terminal_at timestamptz,db_now timestamptz)
language sql security definer volatile called on null input parallel unsafe
cost 100 rows 1 set search_path = pg_catalog, public
as $$
select * from public.begin_every8d_settings_auth_email_send_core_v1(input_job_id,input_lease_id,input_fence)
$$;

create function public.finalize_every8d_settings_auth_email_core_v1(
input_job_id uuid,input_lease_id uuid,input_fence bigint,input_attempt_count smallint,
input_provider_outcome text,input_pre_send_disposition text,input_non_acceptance_proven boolean,
input_provider_message_id text
) returns table(job_id uuid,state text,attempt_count smallint,terminal_disposition text,terminal_at timestamptz,
available_at timestamptz,provider_message_id text,challenge_recording text,resolved_at timestamptz)
language plpgsql security definer volatile called on null input parallel unsafe
cost 100 rows 1 set search_path = pg_catalog, public
as $$
declare

  challenge_ids uuid[]; job_ids uuid[]; grant_ids uuid[]; administrator_ids uuid[]; installation_ids uuid[];
  locked_challenges uuid[]:=array[]::uuid[]; locked_jobs uuid[]:=array[]::uuid[];
  identifier uuid; selected_id uuid; v_challenge public.every8d_settings_auth_challenges%rowtype;
  v_job public.every8d_settings_auth_email_outbox%rowtype;
  decision_at timestamptz; candidate_at timestamptz; v_usable boolean; v_window boolean;
  previous_state_value text; next_state text; disposition text; recording text;
  failure_class text; succeeded boolean; record_result boolean; fingerprint bytea; aad bytea;
  next_available timestamptz; resolution_kind_value text; non_acceptance boolean;
  old_operation text; old_purge text; old_decision text; deleted_count integer:=0;
begin
if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'C3c-3 requires READ COMMITTED' using errcode='25000'; end if;
  old_operation:=pg_catalog.current_setting('wincrm.c3c3_outbox_operation',true);
if input_job_id is null or input_job_id::text !~
  '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or input_lease_id is null or input_fence is null or input_fence<=0 then raise exception 'C3c-3 invalid input' using errcode='22023'; end if;
if input_attempt_count is null or input_attempt_count not between 0 and 3
      or input_non_acceptance_proven is null or not (
        (input_provider_outcome='accepted' and input_pre_send_disposition is null
          and not input_non_acceptance_proven and input_provider_message_id is not null
          and octet_length(input_provider_message_id) between 1 and 255 and input_provider_message_id ~ '^[!-~]+$')
        or (input_provider_outcome in ('rejected','outcome_unknown') and input_pre_send_disposition is null
          and not input_non_acceptance_proven and input_provider_message_id is null)
        or (input_provider_outcome='not_accepted_retryable' and input_pre_send_disposition is null
          and input_non_acceptance_proven and input_provider_message_id is null)
        or (input_provider_outcome is null and input_pre_send_disposition='sender_unavailable'
          and not input_non_acceptance_proven and input_provider_message_id is null)
      ) is true then raise exception 'C3c-3 invalid input' using errcode='22023'; end if;
    if input_provider_outcome is not null and input_attempt_count=0 then raise exception 'C3c-3 invalid input' using errcode='22023'; end if;
select array[o.challenge_id],array[o.job_id] into challenge_ids,job_ids
    from public.every8d_settings_auth_email_outbox o where o.job_id=input_job_id;
  if not found then return; end if;

  -- Freeze the bounded union of parent locators before challenge/outbox locks.
  select array_agg(g.id order by g.id) into grant_ids
  from public.every8d_settings_enrollment_grants g
  where g.id in (select c.enrollment_grant_id from public.every8d_settings_auth_challenges c
    where c.id=any(challenge_ids));
  select array_agg(a.id order by a.id) into administrator_ids
  from public.every8d_settings_administrators a where a.revoked_at is null
    and a.normalized_email in (select c.normalized_email from public.every8d_settings_auth_challenges c
      where c.id=any(challenge_ids) and c.purpose='login');
  select array_agg(x.installation_id order by x.installation_id) into installation_ids from (
    select g.installation_id from public.every8d_settings_enrollment_grants g where g.id=any(grant_ids)
    union select a.installation_id from public.every8d_settings_administrators a where a.id=any(administrator_ids)
  ) x;
  for identifier in select unnest(installation_ids) loop
    perform 1 from public.ghl_marketplace_installations i where i.id=identifier for share of i;
  end loop;
  for identifier in select unnest(grant_ids) loop
    perform 1 from public.every8d_settings_enrollment_grants g where g.id=identifier for share of g;
  end loop;
  for identifier in select unnest(administrator_ids) loop
    perform 1 from public.every8d_settings_administrators a where a.id=identifier for share of a;
  end loop;
  for identifier in select distinct x from unnest(challenge_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_challenges c where c.id=identifier for update of c;
    if found then locked_challenges:=array_append(locked_challenges,identifier); end if;
  end loop;
  for identifier in select distinct x from unnest(job_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_email_outbox o
    where o.job_id=identifier and o.challenge_id=any(locked_challenges) for update of o;
    if found then locked_jobs:=array_append(locked_jobs,identifier); end if;
  end loop;

  if not input_job_id=any(locked_jobs) then return; end if;
  select o.* into v_job from public.every8d_settings_auth_email_outbox o where o.job_id=input_job_id;
select c.* into v_challenge from public.every8d_settings_auth_challenges c where c.id=v_job.challenge_id;
  decision_at:=pg_catalog.clock_timestamp();
  select (c.normalized_email is not null and c.email_scrubbed_at is null
and c.delivery_succeeded_at is null and c.delivery_failed_at is null and c.locked_at is null
and c.superseded_at is null and c.verified_at is null and c.consumed_at is null
and ((c.purpose='enrollment' and exists(
  select 1 from public.every8d_settings_enrollment_grants g
  join public.ghl_marketplace_installations i on i.id=g.installation_id
    and i.installation_generation=g.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where g.id=c.enrollment_grant_id and g.revoked_at is null and g.consumed_at is null
    and g.method in ('operator_initial','operator_recovery')
    and (g.pinned_normalized_email is null or g.pinned_normalized_email=c.normalized_email)
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and g.id=any(grant_ids) and i.id=any(installation_ids)))
or (c.purpose='login' and c.enrollment_grant_id is null and exists(
  select 1 from public.every8d_settings_administrators a
  join public.ghl_marketplace_installations i on i.id=a.installation_id
    and i.installation_generation=a.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where a.normalized_email=c.normalized_email and a.revoked_at is null
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and a.id=any(administrator_ids) and i.id=any(installation_ids))))) into v_usable from public.every8d_settings_auth_challenges c
    where c.id=v_job.challenge_id;
  v_usable:=coalesce(v_usable,false) and v_challenge.request_token_hash=v_job.request_token_hash
    and v_challenge.purpose=v_job.purpose and v_challenge.expires_at=v_job.delivery_deadline_at;
  v_window:=decision_at+interval '10 seconds'<v_job.delivery_deadline_at;
resolution_kind_value:=case when input_provider_outcome is null then 'pre_send' else 'provider' end;
  -- Compatible duplicates return the original stored receipt without mutation or recorder replay.
  if v_job.resolution_kind=resolution_kind_value
    and v_job.resolution_provider_outcome is not distinct from input_provider_outcome
    and v_job.resolution_pre_send_disposition is not distinct from input_pre_send_disposition
    and v_job.resolution_non_acceptance_proven is not distinct from input_non_acceptance_proven
    and v_job.provider_message_id is not distinct from input_provider_message_id
    and v_job.resolution_lease_id=input_lease_id and v_job.resolution_fence_generation=input_fence
    and v_job.resolution_attempt_count=input_attempt_count
    and ((v_job.state in ('ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN'))
      or (v_job.state='RETRY_WAIT' and v_job.fence_generation=v_job.resolution_fence_generation)) then
    return query select v_job.job_id,v_job.state,v_job.attempt_count,v_job.terminal_disposition,
    v_job.terminal_at,v_job.available_at,v_job.provider_message_id,v_job.challenge_recording,v_job.resolved_at; return;
  end if;
  if v_job.state is distinct from (case when input_provider_outcome is null then 'LEASED' else 'SENDING' end)
    or v_job.lease_id is distinct from input_lease_id or v_job.fence_generation<>input_fence
    or v_job.attempt_count<>input_attempt_count or decision_at>=v_job.lease_expires_at then return; end if;
  recording:='not_applicable'; non_acceptance:=input_non_acceptance_proven;
  if input_provider_outcome='not_accepted_retryable' then
    next_available:=decision_at+case v_job.attempt_count when 1 then interval '5 seconds' else interval '20 seconds' end;
    if v_job.attempt_count=3 then next_state:='FAILED_TERMINAL'; disposition:='retry_budget_exhausted';
    elsif not v_usable then next_state:='FAILED_TERMINAL'; disposition:='retry_unusable';
    elsif next_available+interval '10 seconds'>=v_job.delivery_deadline_at then
      next_state:='FAILED_TERMINAL'; disposition:='retry_deadline_exhausted';
    else
      perform set_config('wincrm.c3c3_outbox_operation','finalize',true);
update public.every8d_settings_auth_email_outbox o set state='RETRY_WAIT',
        available_at=next_available,lease_id=null,leased_at=null,lease_expires_at=null,
        resolution_kind='provider',resolution_provider_outcome=input_provider_outcome,
        resolution_pre_send_disposition=null,resolution_non_acceptance_proven=true,
        resolution_lease_id=v_job.lease_id,resolution_fence_generation=v_job.fence_generation,
        resolution_attempt_count=v_job.attempt_count,resolved_at=decision_at
        where o.job_id=v_job.job_id returning o.* into v_job;
perform set_config('wincrm.c3c3_outbox_operation',coalesce(old_operation,''),true);
return query select v_job.job_id,v_job.state,v_job.attempt_count,v_job.terminal_disposition,
    v_job.terminal_at,v_job.available_at,v_job.provider_message_id,v_job.challenge_recording,v_job.resolved_at; return;
    end if;
  else
    succeeded:=input_provider_outcome='accepted';
    if input_provider_outcome is null then
      next_state:='FAILED_TERMINAL'; disposition:='sender_unavailable_pre_send'; failure_class:='sender_unavailable'; succeeded:=false;
    elsif input_provider_outcome='accepted' then next_state:='ACCEPTED'; disposition:='accepted'; failure_class:=null;
    elsif input_provider_outcome='rejected' then next_state:='FAILED_TERMINAL'; disposition:='provider_rejected'; failure_class:='provider_rejected';
    else next_state:='DELIVERY_OUTCOME_UNKNOWN'; disposition:='delivery_outcome_unknown'; failure_class:='delivery_outcome_unknown'; end if;
    select public.runtime_record_every8d_settings_challenge_delivery_v1(v_job.request_token_hash,succeeded,failure_class)
      into record_result;
    recording:=case when record_result then 'recorded' else 'not_recorded' end;
  end if;
  perform set_config('wincrm.c3c3_outbox_operation','finalize',true);
update public.every8d_settings_auth_email_outbox o set
    state=next_state,terminal_at=decision_at,terminal_disposition=disposition,
    provider_message_id=case when next_state='ACCEPTED' then input_provider_message_id else null end,
    challenge_recording=recording,resolution_kind=resolution_kind_value,
    resolution_provider_outcome=input_provider_outcome,resolution_pre_send_disposition=input_pre_send_disposition,
    resolution_non_acceptance_proven=non_acceptance,
    resolution_lease_id=v_job.lease_id,resolution_fence_generation=
      case when v_job.lease_id is null then null else v_job.fence_generation end,
    resolution_attempt_count=v_job.attempt_count,resolved_at=decision_at,
    encryption_key_version=null,nonce=null,ciphertext=null,authentication_tag=null,
    lease_id=null,leased_at=null,lease_expires_at=null,available_at=null
  where o.job_id=v_job.job_id returning o.* into v_job;
perform set_config('wincrm.c3c3_outbox_operation',coalesce(old_operation,''),true);
return query select v_job.job_id,v_job.state,v_job.attempt_count,v_job.terminal_disposition,
    v_job.terminal_at,v_job.available_at,v_job.provider_message_id,v_job.challenge_recording,v_job.resolved_at;
end;
$$;
create function public.runtime_finalize_every8d_settings_auth_email_v1(
input_job_id uuid,input_lease_id uuid,input_fence bigint,input_attempt_count smallint,
input_provider_outcome text,input_pre_send_disposition text,input_non_acceptance_proven boolean,
input_provider_message_id text
) returns table(job_id uuid,state text,attempt_count smallint,terminal_disposition text,terminal_at timestamptz,
available_at timestamptz,provider_message_id text,challenge_recording text,resolved_at timestamptz)
language sql security definer volatile called on null input parallel unsafe
cost 100 rows 1 set search_path = pg_catalog, public
as $$
select * from public.finalize_every8d_settings_auth_email_core_v1(input_job_id,input_lease_id,input_fence,input_attempt_count,input_provider_outcome,input_pre_send_disposition,input_non_acceptance_proven,input_provider_message_id)
$$;

create function public.recover_every8d_settings_auth_email_core_v1(
input_batch_size integer
) returns table(job_id uuid,previous_state text,state text,attempt_count smallint,terminal_disposition text,
terminal_at timestamptz,available_at timestamptz,challenge_recording text,recovered_at timestamptz)
language plpgsql security definer volatile called on null input parallel unsafe
cost 100 rows 100 set search_path = pg_catalog, public
as $$
declare

  challenge_ids uuid[]; job_ids uuid[]; grant_ids uuid[]; administrator_ids uuid[]; installation_ids uuid[];
  locked_challenges uuid[]:=array[]::uuid[]; locked_jobs uuid[]:=array[]::uuid[];
  identifier uuid; selected_id uuid; v_challenge public.every8d_settings_auth_challenges%rowtype;
  v_job public.every8d_settings_auth_email_outbox%rowtype;
  decision_at timestamptz; candidate_at timestamptz; v_usable boolean; v_window boolean;
  previous_state_value text; next_state text; disposition text; recording text;
  failure_class text; succeeded boolean; record_result boolean; fingerprint bytea; aad bytea;
  next_available timestamptz; resolution_kind_value text; non_acceptance boolean;
  old_operation text; old_purge text; old_decision text; deleted_count integer:=0;
begin
if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'C3c-3 requires READ COMMITTED' using errcode='25000'; end if;
  old_operation:=pg_catalog.current_setting('wincrm.c3c3_outbox_operation',true);
if input_batch_size is null or input_batch_size not between 1 and 100 then raise exception 'C3c-3 invalid input' using errcode='22023'; end if;
candidate_at:=pg_catalog.clock_timestamp();
  select array_agg(x.job_id order by x.position),array_agg(x.challenge_id order by x.position)
  into job_ids,challenge_ids from (
    select o.job_id,o.challenge_id,row_number() over(order by coalesce(o.lease_expires_at,o.delivery_deadline_at),o.job_id) as position
    from public.every8d_settings_auth_email_outbox o
    join public.every8d_settings_auth_challenges c on c.id=o.challenge_id
    where ((o.state in ('LEASED','SENDING') and o.lease_expires_at<=candidate_at)
          or (o.state in ('PENDING','RETRY_WAIT') and
            (o.delivery_deadline_at<=candidate_at+interval '10 seconds' or not (c.normalized_email is not null and c.email_scrubbed_at is null
and c.delivery_succeeded_at is null and c.delivery_failed_at is null and c.locked_at is null
and c.superseded_at is null and c.verified_at is null and c.consumed_at is null
and ((c.purpose='enrollment' and exists(
  select 1 from public.every8d_settings_enrollment_grants g
  join public.ghl_marketplace_installations i on i.id=g.installation_id
    and i.installation_generation=g.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where g.id=c.enrollment_grant_id and g.revoked_at is null and g.consumed_at is null
    and g.method in ('operator_initial','operator_recovery')
    and (g.pinned_normalized_email is null or g.pinned_normalized_email=c.normalized_email)
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    ))
or (c.purpose='login' and c.enrollment_grant_id is null and exists(
  select 1 from public.every8d_settings_administrators a
  join public.ghl_marketplace_installations i on i.id=a.installation_id
    and i.installation_generation=a.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where a.normalized_email=c.normalized_email and a.revoked_at is null
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    ))))))) order by coalesce(o.lease_expires_at,o.delivery_deadline_at),o.job_id limit input_batch_size
  ) x;

  -- Freeze the bounded union of parent locators before challenge/outbox locks.
  select array_agg(g.id order by g.id) into grant_ids
  from public.every8d_settings_enrollment_grants g
  where g.id in (select c.enrollment_grant_id from public.every8d_settings_auth_challenges c
    where c.id=any(challenge_ids));
  select array_agg(a.id order by a.id) into administrator_ids
  from public.every8d_settings_administrators a where a.revoked_at is null
    and a.normalized_email in (select c.normalized_email from public.every8d_settings_auth_challenges c
      where c.id=any(challenge_ids) and c.purpose='login');
  select array_agg(x.installation_id order by x.installation_id) into installation_ids from (
    select g.installation_id from public.every8d_settings_enrollment_grants g where g.id=any(grant_ids)
    union select a.installation_id from public.every8d_settings_administrators a where a.id=any(administrator_ids)
  ) x;
  for identifier in select unnest(installation_ids) loop
    perform 1 from public.ghl_marketplace_installations i where i.id=identifier for share of i;
  end loop;
  for identifier in select unnest(grant_ids) loop
    perform 1 from public.every8d_settings_enrollment_grants g where g.id=identifier for share of g;
  end loop;
  for identifier in select unnest(administrator_ids) loop
    perform 1 from public.every8d_settings_administrators a where a.id=identifier for share of a;
  end loop;
  for identifier in select distinct x from unnest(challenge_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_challenges c where c.id=identifier for update of c skip locked;
    if found then locked_challenges:=array_append(locked_challenges,identifier); end if;
  end loop;
  for identifier in select distinct x from unnest(job_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_email_outbox o
    where o.job_id=identifier and o.challenge_id=any(locked_challenges) for update of o skip locked;
    if found then locked_jobs:=array_append(locked_jobs,identifier); end if;
  end loop;

  for selected_id in select unnest(job_ids) loop
    if not selected_id=any(locked_jobs) then continue; end if;
    select o.* into v_job from public.every8d_settings_auth_email_outbox o where o.job_id=selected_id;
    if not found then continue; end if;
select c.* into v_challenge from public.every8d_settings_auth_challenges c where c.id=v_job.challenge_id;
  decision_at:=pg_catalog.clock_timestamp();
  select (c.normalized_email is not null and c.email_scrubbed_at is null
and c.delivery_succeeded_at is null and c.delivery_failed_at is null and c.locked_at is null
and c.superseded_at is null and c.verified_at is null and c.consumed_at is null
and ((c.purpose='enrollment' and exists(
  select 1 from public.every8d_settings_enrollment_grants g
  join public.ghl_marketplace_installations i on i.id=g.installation_id
    and i.installation_generation=g.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where g.id=c.enrollment_grant_id and g.revoked_at is null and g.consumed_at is null
    and g.method in ('operator_initial','operator_recovery')
    and (g.pinned_normalized_email is null or g.pinned_normalized_email=c.normalized_email)
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and g.id=any(grant_ids) and i.id=any(installation_ids)))
or (c.purpose='login' and c.enrollment_grant_id is null and exists(
  select 1 from public.every8d_settings_administrators a
  join public.ghl_marketplace_installations i on i.id=a.installation_id
    and i.installation_generation=a.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where a.normalized_email=c.normalized_email and a.revoked_at is null
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and a.id=any(administrator_ids) and i.id=any(installation_ids))))) into v_usable from public.every8d_settings_auth_challenges c
    where c.id=v_job.challenge_id;
  v_usable:=coalesce(v_usable,false) and v_challenge.request_token_hash=v_job.request_token_hash
    and v_challenge.purpose=v_job.purpose and v_challenge.expires_at=v_job.delivery_deadline_at;
  v_window:=decision_at+interval '10 seconds'<v_job.delivery_deadline_at;
previous_state_value:=v_job.state; recording:='not_applicable';
    resolution_kind_value:='recovery'; non_acceptance:=v_job.attempt_count>0;
    if v_job.state in ('LEASED','SENDING') and decision_at<v_job.lease_expires_at then continue; end if;
    if v_job.state='SENDING' then
      next_state:='DELIVERY_OUTCOME_UNKNOWN'; disposition:='delivery_outcome_unknown'; non_acceptance:=false;
      select public.runtime_record_every8d_settings_challenge_delivery_v1(v_job.request_token_hash,false,
        'delivery_outcome_unknown') into record_result;
      recording:=case when record_result then 'recorded' else 'not_recorded' end;
      perform set_config('wincrm.c3c3_outbox_operation','recover',true);
update public.every8d_settings_auth_email_outbox o set
    state=next_state,terminal_at=decision_at,terminal_disposition=disposition,
    provider_message_id=null,
    challenge_recording=recording,resolution_kind=resolution_kind_value,
    resolution_provider_outcome=null,resolution_pre_send_disposition=null,
    resolution_non_acceptance_proven=non_acceptance,
    resolution_lease_id=v_job.lease_id,resolution_fence_generation=
      case when v_job.lease_id is null then null else v_job.fence_generation end,
    resolution_attempt_count=v_job.attempt_count,resolved_at=decision_at,
    encryption_key_version=null,nonce=null,ciphertext=null,authentication_tag=null,
    lease_id=null,leased_at=null,lease_expires_at=null,available_at=null
  where o.job_id=v_job.job_id returning o.* into v_job;
perform set_config('wincrm.c3c3_outbox_operation',coalesce(old_operation,''),true);

    elsif v_job.state='LEASED' and v_usable and v_window then
      perform set_config('wincrm.c3c3_outbox_operation','recover',true);
update public.every8d_settings_auth_email_outbox o set
        state=case when v_job.attempt_count=0 then 'PENDING' else 'RETRY_WAIT' end,
        lease_id=null,leased_at=null,lease_expires_at=null where o.job_id=v_job.job_id returning o.* into v_job;
perform set_config('wincrm.c3c3_outbox_operation',coalesce(old_operation,''),true);

    elsif v_job.state in ('PENDING','LEASED','RETRY_WAIT') and (not v_usable or not v_window) then
      
  if v_job.attempt_count=0 then
    if not v_window then next_state:='EXPIRED'; disposition:='expired_pre_send';
    else next_state:='CANCELLED'; disposition:='cancelled_pre_send'; end if;
  else
    next_state:='FAILED_TERMINAL';
    if not v_usable then disposition:='retry_unusable';
    else disposition:='retry_deadline_exhausted'; end if;
  end if;
perform set_config('wincrm.c3c3_outbox_operation','recover',true);
update public.every8d_settings_auth_email_outbox o set
    state=next_state,terminal_at=decision_at,terminal_disposition=disposition,
    provider_message_id=null,
    challenge_recording=recording,resolution_kind=resolution_kind_value,
    resolution_provider_outcome=null,resolution_pre_send_disposition=null,
    resolution_non_acceptance_proven=non_acceptance,
    resolution_lease_id=v_job.lease_id,resolution_fence_generation=
      case when v_job.lease_id is null then null else v_job.fence_generation end,
    resolution_attempt_count=v_job.attempt_count,resolved_at=decision_at,
    encryption_key_version=null,nonce=null,ciphertext=null,authentication_tag=null,
    lease_id=null,leased_at=null,lease_expires_at=null,available_at=null
  where o.job_id=v_job.job_id returning o.* into v_job;
perform set_config('wincrm.c3c3_outbox_operation',coalesce(old_operation,''),true);

    else continue; end if;
    return query select v_job.job_id,previous_state_value,v_job.state,v_job.attempt_count,
    v_job.terminal_disposition,v_job.terminal_at,v_job.available_at,v_job.challenge_recording,decision_at;
end loop;

end;
$$;
create function public.runtime_recover_every8d_settings_auth_email_v1(
input_batch_size integer
) returns table(job_id uuid,previous_state text,state text,attempt_count smallint,terminal_disposition text,
terminal_at timestamptz,available_at timestamptz,challenge_recording text,recovered_at timestamptz)
language sql security definer volatile called on null input parallel unsafe
cost 100 rows 100 set search_path = pg_catalog, public
as $$
select * from public.recover_every8d_settings_auth_email_core_v1(input_batch_size)
$$;

create function public.purge_every8d_settings_auth_email_core_v1(
input_batch_size integer
) returns table(purged_count integer)
language plpgsql security definer volatile called on null input parallel unsafe
cost 100 rows 1 set search_path = pg_catalog, public
as $$
declare

  challenge_ids uuid[]; job_ids uuid[]; grant_ids uuid[]; administrator_ids uuid[]; installation_ids uuid[];
  locked_challenges uuid[]:=array[]::uuid[]; locked_jobs uuid[]:=array[]::uuid[];
  identifier uuid; selected_id uuid; v_challenge public.every8d_settings_auth_challenges%rowtype;
  v_job public.every8d_settings_auth_email_outbox%rowtype;
  decision_at timestamptz; candidate_at timestamptz; v_usable boolean; v_window boolean;
  previous_state_value text; next_state text; disposition text; recording text;
  failure_class text; succeeded boolean; record_result boolean; fingerprint bytea; aad bytea;
  next_available timestamptz; resolution_kind_value text; non_acceptance boolean;
  old_operation text; old_purge text; old_decision text; deleted_count integer:=0;
begin
if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'C3c-3 requires READ COMMITTED' using errcode='25000'; end if;
  old_operation:=pg_catalog.current_setting('wincrm.c3c3_outbox_operation',true);
if input_batch_size is null or input_batch_size not between 1 and 100 then raise exception 'C3c-3 invalid input' using errcode='22023'; end if;
candidate_at:=pg_catalog.clock_timestamp();
  select array_agg(x.job_id order by x.position),array_agg(x.challenge_id order by x.position)
  into job_ids,challenge_ids from (
    select o.job_id,o.challenge_id,row_number() over(order by o.terminal_at,o.job_id) as position
    from public.every8d_settings_auth_email_outbox o
    join public.every8d_settings_auth_challenges c on c.id=o.challenge_id
    where o.state in ('ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN','CANCELLED','EXPIRED') and o.terminal_at<=candidate_at-interval '24 hours' order by o.terminal_at,o.job_id limit input_batch_size
  ) x;

  -- Freeze the bounded union of parent locators before challenge/outbox locks.
  select array_agg(g.id order by g.id) into grant_ids
  from public.every8d_settings_enrollment_grants g
  where g.id in (select c.enrollment_grant_id from public.every8d_settings_auth_challenges c
    where c.id=any(challenge_ids));
  select array_agg(a.id order by a.id) into administrator_ids
  from public.every8d_settings_administrators a where a.revoked_at is null
    and a.normalized_email in (select c.normalized_email from public.every8d_settings_auth_challenges c
      where c.id=any(challenge_ids) and c.purpose='login');
  select array_agg(x.installation_id order by x.installation_id) into installation_ids from (
    select g.installation_id from public.every8d_settings_enrollment_grants g where g.id=any(grant_ids)
    union select a.installation_id from public.every8d_settings_administrators a where a.id=any(administrator_ids)
  ) x;
  for identifier in select unnest(installation_ids) loop
    perform 1 from public.ghl_marketplace_installations i where i.id=identifier for share of i;
  end loop;
  for identifier in select unnest(grant_ids) loop
    perform 1 from public.every8d_settings_enrollment_grants g where g.id=identifier for share of g;
  end loop;
  for identifier in select unnest(administrator_ids) loop
    perform 1 from public.every8d_settings_administrators a where a.id=identifier for share of a;
  end loop;
  for identifier in select distinct x from unnest(challenge_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_challenges c where c.id=identifier for update of c skip locked;
    if found then locked_challenges:=array_append(locked_challenges,identifier); end if;
  end loop;
  for identifier in select distinct x from unnest(job_ids) x order by x loop
    perform 1 from public.every8d_settings_auth_email_outbox o
    where o.job_id=identifier and o.challenge_id=any(locked_challenges) for update of o skip locked;
    if found then locked_jobs:=array_append(locked_jobs,identifier); end if;
  end loop;

  for selected_id in select unnest(job_ids) loop
    if not selected_id=any(locked_jobs) then continue; end if;
    select o.* into v_job from public.every8d_settings_auth_email_outbox o where o.job_id=selected_id;
    if not found then continue; end if;
select c.* into v_challenge from public.every8d_settings_auth_challenges c where c.id=v_job.challenge_id;
  decision_at:=pg_catalog.clock_timestamp();
  select (c.normalized_email is not null and c.email_scrubbed_at is null
and c.delivery_succeeded_at is null and c.delivery_failed_at is null and c.locked_at is null
and c.superseded_at is null and c.verified_at is null and c.consumed_at is null
and ((c.purpose='enrollment' and exists(
  select 1 from public.every8d_settings_enrollment_grants g
  join public.ghl_marketplace_installations i on i.id=g.installation_id
    and i.installation_generation=g.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where g.id=c.enrollment_grant_id and g.revoked_at is null and g.consumed_at is null
    and g.method in ('operator_initial','operator_recovery')
    and (g.pinned_normalized_email is null or g.pinned_normalized_email=c.normalized_email)
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and g.id=any(grant_ids) and i.id=any(installation_ids)))
or (c.purpose='login' and c.enrollment_grant_id is null and exists(
  select 1 from public.every8d_settings_administrators a
  join public.ghl_marketplace_installations i on i.id=a.installation_id
    and i.installation_generation=a.installation_generation
  join public.ghl_marketplace_app_registrations r on r.app_namespace=i.app_namespace
    and r.marketplace_app_id=i.marketplace_app_id and r.oauth_client_id=i.oauth_client_id
    and r.conversation_provider_id=i.conversation_provider_id and r.channel=i.channel and r.provider=i.provider
  join public.ghl_marketplace_app_version_registrations v on v.app_namespace=i.app_namespace
    and v.marketplace_version_id=i.latest_lifecycle_version_id
  where a.normalized_email=c.normalized_email and a.revoked_at is null
    and i.app_namespace='every8d_connect' and i.channel='sms' and i.provider='every8d'
    and i.company_id is not null and i.latest_lifecycle_event_type='INSTALL' and i.status in ('pending','active')
    and a.id=any(administrator_ids) and i.id=any(installation_ids))))) into v_usable from public.every8d_settings_auth_challenges c
    where c.id=v_job.challenge_id;
  v_usable:=coalesce(v_usable,false) and v_challenge.request_token_hash=v_job.request_token_hash
    and v_challenge.purpose=v_job.purpose and v_challenge.expires_at=v_job.delivery_deadline_at;
  v_window:=decision_at+interval '10 seconds'<v_job.delivery_deadline_at;
if v_job.state not in ('ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN','CANCELLED','EXPIRED')
      or v_job.terminal_at>decision_at-interval '24 hours' or v_challenge.expires_at>decision_at
      or v_job.encryption_key_version is not null or v_job.nonce is not null
      or v_job.ciphertext is not null or v_job.authentication_tag is not null then continue; end if;
    old_purge:=pg_catalog.current_setting('wincrm.c3c3_outbox_purge',true);
    old_decision:=pg_catalog.current_setting('wincrm.c3c3_outbox_decision_at',true);
    perform set_config('wincrm.c3c3_outbox_purge','on',true);
    perform set_config('wincrm.c3c3_outbox_decision_at',decision_at::text,true);
perform set_config('wincrm.c3c3_outbox_operation','purge',true);
delete from public.every8d_settings_auth_email_outbox o where o.job_id=v_job.job_id;
perform set_config('wincrm.c3c3_outbox_operation',coalesce(old_operation,''),true);

    perform set_config('wincrm.c3c3_outbox_purge',coalesce(old_purge,''),true);
    perform set_config('wincrm.c3c3_outbox_decision_at',coalesce(old_decision,''),true);
    deleted_count:=deleted_count+1;

end loop;
return query select deleted_count;

end;
$$;
create function public.runtime_purge_every8d_settings_auth_email_v1(
input_batch_size integer
) returns table(purged_count integer)
language sql security definer volatile called on null input parallel unsafe
cost 100 rows 1 set search_path = pg_catalog, public
as $$
select * from public.purge_every8d_settings_auth_email_core_v1(input_batch_size)
$$;
revoke all on function public.enqueue_every8d_settings_auth_email_core_v1(uuid,uuid,bytea,text,smallint,smallint,smallint,text,bytea,bytea,bytea) from public,anon,authenticated,service_role;
revoke all on function public.runtime_enqueue_every8d_settings_auth_email_v1(uuid,uuid,bytea,text,smallint,smallint,smallint,text,bytea,bytea,bytea) from public,anon,authenticated,service_role;
grant execute on function public.runtime_enqueue_every8d_settings_auth_email_v1(uuid,uuid,bytea,text,smallint,smallint,smallint,text,bytea,bytea,bytea) to service_role;
revoke all on function public.claim_every8d_settings_auth_email_core_v1(integer) from public,anon,authenticated,service_role;
revoke all on function public.runtime_claim_every8d_settings_auth_email_v1(integer) from public,anon,authenticated,service_role;
grant execute on function public.runtime_claim_every8d_settings_auth_email_v1(integer) to service_role;
revoke all on function public.begin_every8d_settings_auth_email_send_core_v1(uuid,uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.runtime_begin_every8d_settings_auth_email_send_v1(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.runtime_begin_every8d_settings_auth_email_send_v1(uuid,uuid,bigint) to service_role;
revoke all on function public.finalize_every8d_settings_auth_email_core_v1(uuid,uuid,bigint,smallint,text,text,boolean,text) from public,anon,authenticated,service_role;
revoke all on function public.runtime_finalize_every8d_settings_auth_email_v1(uuid,uuid,bigint,smallint,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.runtime_finalize_every8d_settings_auth_email_v1(uuid,uuid,bigint,smallint,text,text,boolean,text) to service_role;
revoke all on function public.recover_every8d_settings_auth_email_core_v1(integer) from public,anon,authenticated,service_role;
revoke all on function public.runtime_recover_every8d_settings_auth_email_v1(integer) from public,anon,authenticated,service_role;
grant execute on function public.runtime_recover_every8d_settings_auth_email_v1(integer) to service_role;
revoke all on function public.purge_every8d_settings_auth_email_core_v1(integer) from public,anon,authenticated,service_role;
revoke all on function public.runtime_purge_every8d_settings_auth_email_v1(integer) from public,anon,authenticated,service_role;
grant execute on function public.runtime_purge_every8d_settings_auth_email_v1(integer) to service_role;
revoke all on function public.every8d_settings_auth_email_aad_v1(uuid,uuid,bytea,text,smallint,smallint,smallint,text) from public,anon,authenticated,service_role;
revoke all on function public.protect_every8d_settings_auth_email_outbox_v1() from public,anon,authenticated,service_role;
revoke all on function public.protect_every8d_settings_auth_email_outbox_guard_v1() from public,anon,authenticated,service_role;

-- Exact PG17-derived literal postflight; metadata only, no nextval.

do $$ begin
  if (select jsonb_build_array((select count(*) from public.ghl_marketplace_installations),
    (select count(*) from public.ghl_marketplace_app_registrations),
    (select count(*) from public.ghl_marketplace_app_version_registrations),
    (select count(*) from public.every8d_settings_enrollment_grants),
    (select count(*) from public.every8d_settings_administrators),
    (select count(*) from public.every8d_settings_sessions),
    (select count(*) from public.every8d_settings_auth_challenges),
    (select count(*) from public.every8d_settings_auth_challenge_failures))::text)
      is distinct from current_setting('wincrm.c3c3_row_counts')
    or (select coalesce(jsonb_agg(to_jsonb(d) order by d.oid),'[]')::text from pg_default_acl d)
      is distinct from current_setting('wincrm.c3c3_default_acls') then
    raise exception 'C3c-3 prior data or default ACL changed' using errcode='55000';
  end if;
end; $$;

do $fk$
declare fk_oid oid; actual jsonb;
begin
  select k.oid into fk_oid from pg_catalog.pg_constraint k
  where k.conname='e8d_settings_email_outbox_challenge_fk' and k.connamespace='public'::regnamespace
    and k.contype='f' and k.conrelid='public.every8d_settings_auth_email_outbox'::regclass
    and k.confrelid='public.every8d_settings_auth_challenges'::regclass
    and k.conkey=array[(select attnum from pg_attribute where attrelid=k.conrelid and attname='challenge_id')]::smallint[]
    and k.confkey=array[(select attnum from pg_attribute where attrelid=k.confrelid and attname='id')]::smallint[]
    and k.confmatchtype='s' and k.confupdtype='r' and k.confdeltype='r'
    and k.convalidated and not k.condeferrable and not k.condeferred and k.conparentid=0;
  if fk_oid is null then raise exception 'C3c-3 FK contract mismatch' using errcode='55000'; end if;
  select jsonb_agg(jsonb_build_array(c.relname,p.proname,t.tgtype,t.tgenabled) order by c.relname,p.proname)
    into actual from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace
    where t.tgconstraint=fk_oid and t.tgisinternal and n.nspname='pg_catalog'
      and not t.tgdeferrable and not t.tginitdeferred and t.tgparentid=0
      and t.tgnargs=0 and octet_length(t.tgargs)=0 and t.tgqual is null
      and t.tgoldtable is null and t.tgnewtable is null and t.tgattr=''::int2vector
      and ((c.oid='public.every8d_settings_auth_challenges'::regclass
        and t.tgconstrrelid='public.every8d_settings_auth_email_outbox'::regclass)
        or (c.oid='public.every8d_settings_auth_email_outbox'::regclass
          and t.tgconstrrelid='public.every8d_settings_auth_challenges'::regclass));
  if actual is distinct from '[
    ["every8d_settings_auth_challenges","RI_FKey_restrict_del",9,"O"],
    ["every8d_settings_auth_challenges","RI_FKey_restrict_upd",17,"O"],
    ["every8d_settings_auth_email_outbox","RI_FKey_check_ins",5,"O"],
    ["every8d_settings_auth_email_outbox","RI_FKey_check_upd",17,"O"]]'::jsonb
    or (select count(*) from pg_trigger where tgconstraint=fk_oid)<>4 then
    raise exception 'C3c-3 FK trigger vector mismatch' using errcode='55000';
  end if;
end;
$fk$;

do $inventory$
declare actual_relations jsonb; actual_functions jsonb; owner_id oid:=current_user::regrole::oid;
  sequence_oid oid:='public.every8d_settings_auth_email_outbox_fence_seq'::regclass;
begin
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
  from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('every8d_settings_auth_email_outbox','every8d_settings_auth_email_outbox_installation_guard','every8d_settings_auth_challenges')) v;
  select jsonb_object_agg(v.signature,v.fingerprint) into actual_functions from (select p.oid, p.proname, p.oid::regprocedure::text as signature,
  md5(jsonb_build_array(p.prokind, l.lanname, p.prosecdef,p.provolatile,p.proisstrict,
    p.proparallel,p.proleakproof,p.procost,p.prorows,p.prosupport::text,p.protrftypes::text,
    p.proconfig,p.proretset,pg_get_function_result(p.oid),pg_get_function_arguments(p.oid),
    p.proargnames,p.proargmodes,p.pronargdefaults,p.probin,p.prosqlbody::text,
    p.prosrc,(select jsonb_agg(jsonb_build_array(case when x.grantor=p.proowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=p.proowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) order by x.grantor<>p.proowner,case when x.grantor=p.proowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=p.proowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x))::text) as fingerprint
  from pg_proc p join pg_language l on l.oid=p.prolang
  where p.pronamespace='public'::regnamespace and p.proname in ('begin_every8d_settings_auth_email_send_core_v1','claim_every8d_settings_auth_email_core_v1','enqueue_every8d_settings_auth_email_core_v1','every8d_settings_auth_email_aad_v1','finalize_every8d_settings_auth_email_core_v1','protect_every8d_settings_auth_email_outbox_guard_v1','protect_every8d_settings_auth_email_outbox_v1','purge_every8d_settings_auth_email_core_v1','recover_every8d_settings_auth_email_core_v1','runtime_begin_every8d_settings_auth_email_send_v1','runtime_claim_every8d_settings_auth_email_v1','runtime_enqueue_every8d_settings_auth_email_v1','runtime_finalize_every8d_settings_auth_email_v1','runtime_purge_every8d_settings_auth_email_v1','runtime_recover_every8d_settings_auth_email_v1')) v;
  if actual_relations is distinct from $new_relations${"every8d_settings_auth_challenges":"8f5cf5a11741535af40d0654728d0760","every8d_settings_auth_email_outbox":"c397c27fecf869b9507a868f5cc25fbe","every8d_settings_auth_email_outbox_installation_guard":"3fffc07cca6af241d10b17e509e04e2b"}$new_relations$::jsonb
    or actual_functions is distinct from $new_functions${"begin_every8d_settings_auth_email_send_core_v1(uuid,uuid,bigint)":"e9a7076daab955c850cf9bc76684a0e7","claim_every8d_settings_auth_email_core_v1(integer)":"dcbb3f0998e661a39939b7cd08c280dd","enqueue_every8d_settings_auth_email_core_v1(uuid,uuid,bytea,text,smallint,smallint,smallint,text,bytea,bytea,bytea)":"4bed6d8eb9bc8970580b1c1ca74d14e4","every8d_settings_auth_email_aad_v1(uuid,uuid,bytea,text,smallint,smallint,smallint,text)":"2d304f40ad341c56a5293413d0082714","finalize_every8d_settings_auth_email_core_v1(uuid,uuid,bigint,smallint,text,text,boolean,text)":"1f9e21a914860e043616a7e0dbd8455d","protect_every8d_settings_auth_email_outbox_guard_v1()":"a59b3ea30158360cc32582202fee6dd2","protect_every8d_settings_auth_email_outbox_v1()":"748d827b62aeab8dd2eb867544a2eb84","purge_every8d_settings_auth_email_core_v1(integer)":"b4322c026a88fa0332b6ee157268e0e6","recover_every8d_settings_auth_email_core_v1(integer)":"7671507688f703bb0cf0febaf98e2049","runtime_begin_every8d_settings_auth_email_send_v1(uuid,uuid,bigint)":"80110ff167bc0d14e8931cac3490c05d","runtime_claim_every8d_settings_auth_email_v1(integer)":"0e846c855f5a1be1ebd930643a612df2","runtime_enqueue_every8d_settings_auth_email_v1(uuid,uuid,bytea,text,smallint,smallint,smallint,text,bytea,bytea,bytea)":"7cbd9772a31c3e2ee57b8eedc590fd71","runtime_finalize_every8d_settings_auth_email_v1(uuid,uuid,bigint,smallint,text,text,boolean,text)":"87f569eaa6963a23ac843fe61059d757","runtime_purge_every8d_settings_auth_email_v1(integer)":"f4c2a3df839d212a5f8420c9ee02b64f","runtime_recover_every8d_settings_auth_email_v1(integer)":"42cdea65696409b32dba396039cdfb1b"}$new_functions$::jsonb
    or (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('begin_every8d_settings_auth_email_send_core_v1','claim_every8d_settings_auth_email_core_v1','enqueue_every8d_settings_auth_email_core_v1','every8d_settings_auth_email_aad_v1','finalize_every8d_settings_auth_email_core_v1','protect_every8d_settings_auth_email_outbox_guard_v1','protect_every8d_settings_auth_email_outbox_v1','purge_every8d_settings_auth_email_core_v1','recover_every8d_settings_auth_email_core_v1','runtime_begin_every8d_settings_auth_email_send_v1','runtime_claim_every8d_settings_auth_email_v1','runtime_enqueue_every8d_settings_auth_email_v1','runtime_finalize_every8d_settings_auth_email_v1','runtime_purge_every8d_settings_auth_email_v1','runtime_recover_every8d_settings_auth_email_v1'))<>15
    or exists(select 1 from pg_proc where pronamespace='public'::regnamespace
      and proname in ('begin_every8d_settings_auth_email_send_core_v1','claim_every8d_settings_auth_email_core_v1','enqueue_every8d_settings_auth_email_core_v1','every8d_settings_auth_email_aad_v1','finalize_every8d_settings_auth_email_core_v1','protect_every8d_settings_auth_email_outbox_guard_v1','protect_every8d_settings_auth_email_outbox_v1','purge_every8d_settings_auth_email_core_v1','recover_every8d_settings_auth_email_core_v1','runtime_begin_every8d_settings_auth_email_send_v1','runtime_claim_every8d_settings_auth_email_v1','runtime_enqueue_every8d_settings_auth_email_v1','runtime_finalize_every8d_settings_auth_email_v1','runtime_purge_every8d_settings_auth_email_v1','runtime_recover_every8d_settings_auth_email_v1') and proowner<>owner_id)
    or exists(select 1 from pg_class where oid in (
      'public.every8d_settings_auth_email_outbox'::regclass,
      'public.every8d_settings_auth_email_outbox_installation_guard'::regclass,sequence_oid)
      and relowner<>owner_id) then
    raise exception 'C3c-3 target inventory mismatch' using errcode='55000';
  end if;
  if exists(select 1 from (values('anon'),('authenticated'),('service_role')) r(role_name)
    cross join (values('public.every8d_settings_auth_email_outbox'),
      ('public.every8d_settings_auth_email_outbox_installation_guard')) t(relation_name)
    where has_table_privilege(r.role_name,t.relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(r.role_name,t.relation_name,'SELECT,INSERT,UPDATE,REFERENCES'))
    or exists(select 1 from (values('anon'),('authenticated'),('service_role')) r(role_name)
      where has_sequence_privilege(r.role_name,sequence_oid,'SELECT,USAGE,UPDATE'))
    or exists(select 1 from pg_proc p cross join (values('anon'),('authenticated'),('service_role')) r(role_name)
      where p.pronamespace='public'::regnamespace and p.proname in ('begin_every8d_settings_auth_email_send_core_v1','claim_every8d_settings_auth_email_core_v1','enqueue_every8d_settings_auth_email_core_v1','every8d_settings_auth_email_aad_v1','finalize_every8d_settings_auth_email_core_v1','protect_every8d_settings_auth_email_outbox_guard_v1','protect_every8d_settings_auth_email_outbox_v1','purge_every8d_settings_auth_email_core_v1','recover_every8d_settings_auth_email_core_v1','runtime_begin_every8d_settings_auth_email_send_v1','runtime_claim_every8d_settings_auth_email_v1','runtime_enqueue_every8d_settings_auth_email_v1','runtime_finalize_every8d_settings_auth_email_v1','runtime_purge_every8d_settings_auth_email_v1','runtime_recover_every8d_settings_auth_email_v1')
        and has_function_privilege(r.role_name,p.oid,'EXECUTE')<>
          (r.role_name='service_role' and p.proname like 'runtime\_%' escape '\')) then
    raise exception 'C3c-3 effective ACL mismatch' using errcode='55000';
  end if;
  if not exists(select 1 from pg_sequence q join pg_class c on c.oid=q.seqrelid
    where q.seqrelid=sequence_oid and q.seqtypid='bigint'::regtype and q.seqstart=1
      and q.seqincrement=1 and q.seqmin=1 and q.seqmax=9223372036854775807
      and q.seqcache=1 and not q.seqcycle and c.relkind='S' and c.relpersistence='p'
      and c.relowner=owner_id and c.reloptions is null)
    or exists(select 1 from pg_depend where classid='pg_class'::regclass
      and objid=sequence_oid and deptype in ('a','i'))
    or exists(select 1 from pg_class c cross join lateral
      aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) a
      where c.oid=sequence_oid and (a.grantee<>owner_id or a.grantor<>owner_id or a.is_grantable))
    or (select count(*) from pg_class c cross join lateral
      aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) a where c.oid=sequence_oid)<>3 then
    raise exception 'C3c-3 sequence definition mismatch' using errcode='55000';
  end if;
  if (select count(*) from public.every8d_settings_auth_email_outbox_installation_guard)<>1
    or not exists(select 1 from public.every8d_settings_auth_email_outbox_installation_guard g
      where g.guard_id and isfinite(g.created_at) and g.created_at<=clock_timestamp()
        and g.migration_postmaster_started_at=pg_postmaster_start_time()
        and g.migration_postmaster_started_at<=g.created_at) then
    raise exception 'C3c-3 server epoch guard mismatch' using errcode='55000';
  end if;
end;
$inventory$;
do $preflight$
declare
  trusted_owner oid;
  actual_relations jsonb;
  actual_functions jsonb;
begin
  if current_setting('server_encoding') <> 'UTF8' then
    raise exception 'C3c-3 requires UTF8' using errcode='22021';
  end if;
  if (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception 'C3c-3 requires application roles' using errcode='42704';
  end if;
  select c.relowner into trusted_owner from pg_class c
  where c.oid=to_regclass('public.ghl_marketplace_installations');
  if trusted_owner is null or trusted_owner <> current_user::regrole::oid
    or trusted_owner in ('anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid)
    or exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated','service_role')
      and pg_has_role(r.oid,trusted_owner,'MEMBER'))
    or (select count(*) from pg_class c where c.relnamespace='public'::regnamespace
      and c.relname in ('ghl_marketplace_installations','ghl_marketplace_app_registrations','ghl_marketplace_app_version_registrations','every8d_settings_enrollment_grants','every8d_settings_administrators','every8d_settings_sessions','every8d_settings_auth_challenges','every8d_settings_auth_challenge_failures') and c.relowner=trusted_owner) <> 8 then
    raise exception 'C3c-3 requires trusted common ownership' using errcode='42501';
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
    raise exception 'C3c-3 requires trusted schema and language privileges' using errcode='42501';
  end if;
  if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
      join pg_depend d on d.refclassid='pg_extension'::regclass and d.refobjid=e.oid
        and d.classid='pg_proc'::regclass and d.objid=to_regprocedure('extensions.digest(bytea,text)')
      where e.extname='pgcrypto' and n.nspname='extensions' and d.deptype='e')
    or not has_function_privilege(trusted_owner,'extensions.digest(bytea,text)','EXECUTE') then
    raise exception 'C3c-3 requires extensions.digest(bytea,text)' using errcode='55000';
  end if;
  if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace
      and (p.proname like '%every8d_settings%' or p.proname='every8d_settings_email_lock_word_v1')
      and p.proowner<>trusted_owner) then
    raise exception 'C3c-3 prior settings authority owner mismatch' using errcode='42501';
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
    raise exception 'C3c-3 lifecycle prerequisite authority mismatch' using errcode='42501';
  end if;
  if exists(select 1 from (values ('anon'),('authenticated'),('service_role')) r(role_name)
    cross join (values ('public.every8d_settings_enrollment_grants'),('public.every8d_settings_administrators'),('public.every8d_settings_sessions'),('public.every8d_settings_auth_challenges'),('public.every8d_settings_auth_challenge_failures')) t(relation_name)
    where has_table_privilege(r.role_name,t.relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(r.role_name,t.relation_name,'SELECT,INSERT,UPDATE,REFERENCES')) then
    raise exception 'C3c-3 refuses effective auth table privileges' using errcode='42501';
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
      where t.tgrelid=c.oid and t.tgisinternal and not (c.relname='every8d_settings_auth_challenges' and t.tgconstraint=(select k.oid from pg_constraint k where k.conrelid='public.every8d_settings_auth_email_outbox'::regclass and k.conname='e8d_settings_email_outbox_challenge_fk'))) s),
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
  where p.pronamespace='public'::regnamespace and p.proname not in ('begin_every8d_settings_auth_email_send_core_v1','claim_every8d_settings_auth_email_core_v1','enqueue_every8d_settings_auth_email_core_v1','every8d_settings_auth_email_aad_v1','finalize_every8d_settings_auth_email_core_v1','protect_every8d_settings_auth_email_outbox_guard_v1','protect_every8d_settings_auth_email_outbox_v1','purge_every8d_settings_auth_email_core_v1','recover_every8d_settings_auth_email_core_v1','runtime_begin_every8d_settings_auth_email_send_v1','runtime_claim_every8d_settings_auth_email_v1','runtime_enqueue_every8d_settings_auth_email_v1','runtime_finalize_every8d_settings_auth_email_v1','runtime_purge_every8d_settings_auth_email_v1','runtime_recover_every8d_settings_auth_email_v1') and p.proname not in ('runtime_discover_every8d_settings_verified_challenge_v1','consume_every8d_settings_enrollment_challenge_core_v1','consume_every8d_settings_login_challenge_core_v1','authenticate_every8d_settings_session_core_v1','revoke_every8d_settings_session_core_v1','runtime_consume_every8d_settings_enrollment_challenge_v1','runtime_consume_every8d_settings_login_challenge_v1','runtime_authenticate_every8d_settings_session_v1','runtime_revoke_every8d_settings_session_v1')) v;
  if actual_relations is distinct from $relations${"every8d_settings_administrators":"22310a057aae8c919d5f133686b06c12","every8d_settings_auth_challenge_failures":"1c3aa7ad43c10fbeaa3da35919c5f603","every8d_settings_auth_challenges":"ad3214c353186228d0f17e2f115f15fb","every8d_settings_enrollment_grants":"2bc87966915bd44aa80793cc9bb1b3d7","every8d_settings_sessions":"3ea40301cf1743c7fc3f33e754db1705","ghl_marketplace_app_registrations":"0360ec6e4309027f40c03b1087c17b53","ghl_marketplace_app_version_registrations":"5b6cc4f57acd2edd376949b63d579574","ghl_marketplace_installations":"b29aca9663dc2fefce200a5b21518ec9"}$relations$::jsonb
    or actual_functions is distinct from $functions${"accept_every8d_public_oauth_callback_v1(text,text,text,text,text,text,text,text,text,timestamp with time zone,bytea,text)":"280c19d7a14ad9f038abfddde1bb95d7","apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamp with time zone,text)":"156a63069c245a4d7ff01d27ccc79295","apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamp with time zone,text)":"15c74c360b0efc3ef9495962da106a55","assert_every8d_settings_challenge_integrity_v1()":"8d53b0e843b9e4378a68d17a870f8a47","assert_every8d_settings_challenge_rate_limits_v1(text[],uuid,timestamp with time zone)":"322dfb58deae74ab638530d9949ccc41","assert_every8d_settings_installation_eligible_v1(uuid,integer)":"0d401cd53ebac6fb89a6d0495e2708b3","claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer)":"a2a18fb8ed6add638d7aaf1968e4c232","claim_every8d_oauth_exchange_v1(uuid,text,text)":"93d275946b8f75cd783c3554246edd8c","cleanup_every8d_settings_auth_challenges_v1(integer)":"87a0b33bc5e6237b355d4aeae2f01a8c","consume_ghl_sms_controlled_live_authorization_v1(uuid,uuid,uuid,text,text,text,text,text,text)":"0964c7032835a4386efc1639852aebea","discover_every8d_settings_challenge_v1(bytea,text)":"6287d410887f45c4c76636c824b986ea","every8d_settings_email_lock_word_v1(text)":"fb169d9bdbca09c8a02d863673cccea9","fail_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,text)":"e8febfc51ad1b76413ae6c89829c6f19","fail_every8d_oauth_bootstrap_v1(uuid,text)":"ac3d1cd76fda1873e76da5bfaf13ff5f","finalize_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,bytea,bytea,text,timestamp with time zone,text[])":"fc3aa929cba31fb1022ba8b7f31f8e1c","finalize_every8d_oauth_exchange_v1(uuid,text,text,bytea,bytea,text,timestamp with time zone,text[])":"6e3b7d8f9ce739b4eb8eb8cfb4310b6b","get_every8d_oauth_bootstrap_status_v1(text,text)":"d68c479fc7229d8a2b72421015f08ba0","invalidate_every8d_provider_configuration_v1()":"39b9f1419206797772393bba0a182683","invalidate_every8d_settings_auth_v1()":"49824966600c91397de235783b39d2ed","invalidate_every8d_settings_challenges_for_grant_v1()":"0b6a3bce1ef8208fe2355ce6255aa142","is_every8d_settings_canonical_email_v1(text)":"5206d9483c15206c1146edb48d79b91f","is_every8d_settings_email_pseudonym_v1(text)":"d3a726234333158db9649a6946611eb1","issue_every8d_settings_install_callback_enrollment_grant_v1(uuid,integer,uuid,bytea,timestamp with time zone,text,text)":"952e0dcc80d9c96a455213623c58609d","issue_every8d_settings_operator_enrollment_grant_v1(uuid,integer,text,bytea,text,timestamp with time zone,text,text,text,text)":"0f0e31f641855ce101327f6e78804926","list_every8d_oauth_recoverable_v1(text,text,integer)":"cba53a79d6fcabc4fe3c2d76a8c85169","lock_every8d_settings_challenge_on_fifth_failure_v1()":"d9c441bddd3a0ca00a4dce18977839b8","lock_every8d_settings_email_pseudonyms_v1(text[])":"802d175e6187ba53f0c862e55f3220e7","protect_every8d_provider_configuration_v1()":"d2a82e30277a8c8c1cb93a375429872f","protect_every8d_settings_administrator_v1()":"fbc49d905c8506d713763071a8cc69b1","protect_every8d_settings_auth_challenge_failure_v1()":"24a7fe69d20598c67f389d6a8b6a729d","protect_every8d_settings_auth_challenge_v1()":"462080468c4aa84c32351c50b4ac3a11","protect_every8d_settings_enrollment_grant_v1()":"8c0023fabf66daca4164820ec967742d","protect_every8d_settings_session_v1()":"afb097c1e17f0330180b50d36cc60d62","protect_ghl_marketplace_app_registration_v1()":"f8598449bbc9f4f88408d1aa49b6901f","protect_ghl_marketplace_app_version_registration_v1()":"627e6716da0182226e7d81c2a558729f","protect_ghl_marketplace_installation_v1()":"62bc35bdb7e6a66a805d84ca50e1f593","protect_ghl_marketplace_installation_v2()":"a8c615386c7deb2b61a2a47f735db444","protect_ghl_marketplace_installation_v3()":"9fe58ca382eae446b1aace10b6692835","protect_ghl_marketplace_installation_v4()":"962e721d9b8adef62add5670da33c938","protect_ghl_marketplace_installation_v5()":"f7e0fae9fed8181904656198fd677e44","protect_ghl_marketplace_oauth_bootstrap_v1()":"00a7a25ae3a881d19c51a5ea7935edd3","protect_ghl_marketplace_oauth_state_v1()":"866ad815eed6a1a88905524c4e9e6aae","protect_ghl_sms_controlled_live_authorization_v1()":"8e46afe31ee7e0ab1ebbde4328b97b5f","provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)":"100ed0bf0a16fe5ceac6de3572952228","record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)":"13709926d0fb3719ad903fac77be4956","redeem_every8d_settings_enrollment_grant_v1(bytea,text,text)":"99994ca583226c3151556d0f3957a26f","request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)":"1f1735df19ce0c4fa4fab122561de195","request_every8d_settings_enrollment_challenge_v1(uuid,text,text,text[],bytea,bytea,text)":"6f9c3b9a01e7af717ed07c1b54b15a9b","request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)":"7573d7ddd043d50f271d4ae7e12d4ea7","request_every8d_settings_login_challenge_v1(text,text,text[],bytea,bytea,text)":"43ec37c1f3f278f480bc58691e5855ac","runtime_discover_every8d_settings_challenge_v1(bytea,text)":"f28d1763dd9941843e5740308d3525f3","runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)":"501fafae0e74d19ce254f6ccaca9d24f","runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)":"484ff4cf4372c330e3ef98e990fb118b","runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)":"6216d5f617668fbd7cafdb3e795df84e","runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)":"a21710035659f27cebc70f80bcff3c64","scrub_expired_every8d_settings_challenge_emails_v1(integer)":"094cec38bc5380b1a49d20008da6f17a","set_updated_at()":"f3271401fb26bf01db885936c35cd3f2","verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)":"c5aa8e2a77921385f6002fbe9f98ab5b","verify_every8d_settings_challenge_v1(uuid,bytea,text,uuid,text,text[],bytea)":"2074def2fdc693ac3c0b44d9046ed491"}$functions$::jsonb then
    raise exception 'C3c-3 frozen prerequisite manifest mismatch' using errcode='55000';
  end if;
  perform set_config('wincrm.c3c3_relations',actual_relations::text,true);
  perform set_config('wincrm.c3c3_prior_functions',actual_functions::text,true);
  perform set_config('wincrm.c3c3_owner',trusted_owner::text,true);
  perform set_config('wincrm.c3c3_row_counts',(select jsonb_build_array((select count(*) from public.ghl_marketplace_installations),(select count(*) from public.ghl_marketplace_app_registrations),(select count(*) from public.ghl_marketplace_app_version_registrations),(select count(*) from public.every8d_settings_enrollment_grants),(select count(*) from public.every8d_settings_administrators),(select count(*) from public.every8d_settings_sessions),(select count(*) from public.every8d_settings_auth_challenges),(select count(*) from public.every8d_settings_auth_challenge_failures))::text),true);
  perform set_config('wincrm.c3c3_default_acls',
    (select coalesce(jsonb_agg(to_jsonb(d) order by d.oid),'[]')::text from pg_default_acl d),true);
end;
$preflight$;
do $targets$
declare actual jsonb; trusted_owner oid := current_setting('wincrm.c3c3_owner')::oid;
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
    raise exception 'C3c-3 target definition owner or ACL mismatch' using errcode='55000';
  end if;
end;
$targets$;

do $$ begin
  if exists(select 1 from public.every8d_settings_auth_email_outbox)
    or not exists(select 1 from public.every8d_settings_auth_email_outbox_fence_seq
      where last_value=1 and not is_called) then
    raise exception 'C3c-3 pre-use boundary violated' using errcode='55000';
  end if;
end; $$;

commit;
