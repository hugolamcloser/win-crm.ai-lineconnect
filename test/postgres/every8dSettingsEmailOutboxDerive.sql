
select 'RELATIONS',jsonb_object_agg(v.relname,v.fingerprint) from (select c.oid,c.relname,
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
select 'FUNCTIONS',jsonb_object_agg(v.signature,v.fingerprint) from (select p.oid, p.proname, p.oid::regprocedure::text as signature,
  md5(jsonb_build_array(p.prokind, l.lanname, p.prosecdef,p.provolatile,p.proisstrict,
    p.proparallel,p.proleakproof,p.procost,p.prorows,p.prosupport::text,p.protrftypes::text,
    p.proconfig,p.proretset,pg_get_function_result(p.oid),pg_get_function_arguments(p.oid),
    p.proargnames,p.proargmodes,p.pronargdefaults,p.probin,p.prosqlbody::text,
    p.prosrc,(select jsonb_agg(jsonb_build_array(case when x.grantor=p.proowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=p.proowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) order by x.grantor<>p.proowner,case when x.grantor=p.proowner then '@owner' else pg_get_userbyid(x.grantor) end,case when x.grantee=0 then 'PUBLIC' when x.grantee=p.proowner then '@owner' else pg_get_userbyid(x.grantee) end,x.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x))::text) as fingerprint
  from pg_proc p join pg_language l on l.oid=p.prolang
  where p.pronamespace='public'::regnamespace and (p.proname like '%every8d_settings_auth_email%' or p.proname='every8d_settings_auth_email_aad_v1')) v;
rollback;
