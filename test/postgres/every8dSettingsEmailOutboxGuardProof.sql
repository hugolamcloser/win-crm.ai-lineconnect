begin;
create schema c3c3_guard_proof;
create function c3c3_guard_proof.capture(input_job uuid,input_sql text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare before_row jsonb; before_challenge jsonb; candidate jsonb; challenge uuid;
begin
  select to_jsonb(o),o.challenge_id into strict before_row,challenge from public.every8d_settings_auth_email_outbox o where job_id=input_job;
  select to_jsonb(c) into before_challenge from public.every8d_settings_auth_challenges c where id=challenge;
  begin
    execute input_sql;
    select to_jsonb(o) into strict candidate from public.every8d_settings_auth_email_outbox o where job_id=input_job;
    if candidate=before_row then raise exception 'guard template did not execute a real transition' using errcode='ZP002'; end if;
    raise exception 'rollback test-only template capture' using errcode='ZP001';
  exception when sqlstate 'ZP001' then null;
  end;
  if (select to_jsonb(o) from public.every8d_settings_auth_email_outbox o where job_id=input_job) is distinct from before_row
    or (select to_jsonb(c) from public.every8d_settings_auth_challenges c where id=challenge) is distinct from before_challenge then
    raise exception 'template capture failed to restore exact source authority' using errcode='ZP003';
  end if;
  return candidate;
end; $$;
create function c3c3_guard_proof.assert_rejected(input_job uuid,input_operation text,input_candidate jsonb) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare before_row jsonb; before_challenge jsonb; before_guard jsonb;
  candidate public.every8d_settings_auth_email_outbox%rowtype; challenge uuid;
  assignments text; rejected boolean:=false; changed integer;
begin
  if exists(select 1 from pg_trigger where tgrelid in
    ('public.every8d_settings_auth_email_outbox'::regclass,'public.every8d_settings_auth_email_outbox_installation_guard'::regclass,
     'public.every8d_settings_auth_challenges'::regclass) and tgenabled<>'O') then
    raise exception 'guard negative requires all protections enabled' using errcode='ZP004';
  end if;
  select to_jsonb(o),o.challenge_id into strict before_row,challenge from public.every8d_settings_auth_email_outbox o where job_id=input_job;
  select to_jsonb(c) into before_challenge from public.every8d_settings_auth_challenges c where id=challenge;
  select to_jsonb(g) into strict before_guard from public.every8d_settings_auth_email_outbox_installation_guard g;
  candidate:=jsonb_populate_record(null::public.every8d_settings_auth_email_outbox,input_candidate);
  select string_agg(format('%1$I=($1).%1$I',attname),',' order by attnum) into assignments
    from pg_attribute where attrelid='public.every8d_settings_auth_email_outbox'::regclass and attnum>0 and not attisdropped;
  begin
    perform set_config('wincrm.c3c3_outbox_operation',input_operation,true);
    execute format('update public.every8d_settings_auth_email_outbox set %s where job_id=$2',assignments) using candidate,input_job;
    get diagnostics changed=row_count;
    if changed<>1 then raise exception 'guard negative source disappeared' using errcode='ZP005'; end if;
    raise exception 'guard admitted forbidden owner mutation' using errcode='ZP100';
  exception when check_violation then rejected:=true;
  end;
  if not rejected
    or (select to_jsonb(o) from public.every8d_settings_auth_email_outbox o where job_id=input_job) is distinct from before_row
    or (select to_jsonb(c) from public.every8d_settings_auth_challenges c where id=challenge) is distinct from before_challenge
    or (select to_jsonb(g) from public.every8d_settings_auth_email_outbox_installation_guard g) is distinct from before_guard then
    raise exception 'owner refusal changed row/challenge/guard authority' using errcode='ZP006';
  end if;
  return true;
end; $$;
revoke all on schema c3c3_guard_proof from public,anon,authenticated,service_role;
revoke all on function c3c3_guard_proof.capture(uuid,text),c3c3_guard_proof.assert_rejected(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
create function c3c3_guard_proof.capture_enqueue(input_job uuid,input_challenge uuid,input_sql text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare before_challenge jsonb; candidate jsonb;
begin
  if exists(select 1 from public.every8d_settings_auth_email_outbox) then raise exception 'enqueue capture needs absent outbox fixture' using errcode='ZP007'; end if;
  select to_jsonb(c) into strict before_challenge from public.every8d_settings_auth_challenges c where id=input_challenge;
  begin
    execute input_sql;
    select to_jsonb(o) into strict candidate from public.every8d_settings_auth_email_outbox o where job_id=input_job;
    raise exception 'rollback test-only enqueue capture' using errcode='ZP001';
  exception when sqlstate 'ZP001' then null;
  end;
  if exists(select 1 from public.every8d_settings_auth_email_outbox)
    or (select to_jsonb(c) from public.every8d_settings_auth_challenges c where id=input_challenge) is distinct from before_challenge then
    raise exception 'enqueue capture changed source authority' using errcode='ZP008';
  end if;
  return candidate;
end; $$;
create function c3c3_guard_proof.assert_insert_rejected(input_operation text,input_candidate jsonb) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare candidate public.every8d_settings_auth_email_outbox%rowtype; before_guard jsonb; before_challenge jsonb; rejected boolean:=false;
begin
  if exists(select 1 from public.every8d_settings_auth_email_outbox) then raise exception 'owner insert negative needs absent fixture' using errcode='ZP009'; end if;
  if exists(select 1 from pg_trigger where tgrelid='public.every8d_settings_auth_email_outbox'::regclass and tgenabled<>'O') then
    raise exception 'owner insert negative requires enabled protection' using errcode='ZP004';
  end if;
  candidate:=jsonb_populate_record(null::public.every8d_settings_auth_email_outbox,input_candidate);
  select to_jsonb(g) into strict before_guard from public.every8d_settings_auth_email_outbox_installation_guard g;
  select to_jsonb(c) into strict before_challenge from public.every8d_settings_auth_challenges c where id=candidate.challenge_id;
  begin
    perform set_config('wincrm.c3c3_outbox_operation',input_operation,true);
    execute 'insert into public.every8d_settings_auth_email_outbox select ($1).*' using candidate;
    raise exception 'guard admitted forbidden owner insert' using errcode='ZP100';
  exception when check_violation then rejected:=true;
  end;
  if not rejected or exists(select 1 from public.every8d_settings_auth_email_outbox)
    or (select to_jsonb(g) from public.every8d_settings_auth_email_outbox_installation_guard g) is distinct from before_guard
    or (select to_jsonb(c) from public.every8d_settings_auth_challenges c where id=candidate.challenge_id) is distinct from before_challenge then
    raise exception 'owner insert refusal changed authority' using errcode='ZP006';
  end if;
  return true;
end; $$;
revoke all on function c3c3_guard_proof.capture_enqueue(uuid,uuid,text),c3c3_guard_proof.assert_insert_rejected(text,jsonb)
  from public,anon,authenticated,service_role;
commit;
