\set ON_ERROR_STOP on
-- Disposable synthetic fixtures only. Production migrations never install this schema.
begin;
create schema c3c3_proof;
create function c3c3_proof.pending(n integer,purpose_value text default 'enrollment') returns uuid
language plpgsql as $$
declare parent_id uuid; grant_id uuid; result uuid; issued_at timestamptz:=clock_timestamp();
  email text:='outbox-'||n||'@example.invalid';
begin
  parent_id:=c3c2a_proof.parent(n);
  if purpose_value='enrollment' then
    grant_id:=c3c2a_proof.grant_for(parent_id,email,'outbox-'||n);
  else
    perform c3c2a_proof.enroll(parent_id,email,n,'login-witness-'||n);
  end if;
  insert into public.every8d_settings_auth_challenges(request_token_hash,purpose,enrollment_grant_id,
    normalized_email,email_pseudonym,otp_hmac,otp_hmac_key_version,created_at,expires_at)
  values(c3c2a_proof.hash('outbox-request-'||n),purpose_value,grant_id,email,c3c2a_proof.alias(n),
    c3c2a_proof.hash('outbox-otp-'||n),'proof-key',issued_at,issued_at+interval '10 minutes')
  returning id into result;
  return result;
end; $$;
create function c3c3_proof.shift_job(input_job uuid,delta interval) returns void
language plpgsql as $$
begin
  -- Explicit disposable time fixtures; every production protection is restored before RPCs.
  alter table public.every8d_settings_auth_email_outbox disable trigger protect_every8d_settings_auth_email_outbox;
  alter table public.every8d_settings_auth_challenges disable trigger protect_every8d_settings_auth_challenge;
  alter table public.every8d_settings_auth_challenge_failures disable trigger protect_every8d_settings_auth_challenge_failure;
  update public.every8d_settings_auth_challenge_failures f set failed_at=f.failed_at-delta
    where f.challenge_id=(select o.challenge_id from public.every8d_settings_auth_email_outbox o where o.job_id=input_job);
  update public.every8d_settings_auth_challenges c set created_at=c.created_at-delta,expires_at=c.expires_at-delta,
    delivery_succeeded_at=c.delivery_succeeded_at-delta,delivery_failed_at=c.delivery_failed_at-delta,
    locked_at=c.locked_at-delta,superseded_at=c.superseded_at-delta,verified_at=c.verified_at-delta,
    consumed_at=c.consumed_at-delta,email_scrubbed_at=c.email_scrubbed_at-delta
  where c.id=(select o.challenge_id from public.every8d_settings_auth_email_outbox o where o.job_id=input_job);
  update public.every8d_settings_auth_email_outbox o set created_at=o.created_at-delta,
    delivery_deadline_at=o.delivery_deadline_at-delta,available_at=o.available_at-delta,
    leased_at=o.leased_at-delta,lease_expires_at=o.lease_expires_at-delta,
    last_attempt_started_at=o.last_attempt_started_at-delta,last_provider_deadline_at=o.last_provider_deadline_at-delta,
    terminal_at=o.terminal_at-delta,resolved_at=o.resolved_at-delta where o.job_id=input_job;
  set constraints all immediate;
  alter table public.every8d_settings_auth_challenge_failures enable trigger protect_every8d_settings_auth_challenge_failure;
  alter table public.every8d_settings_auth_email_outbox enable trigger protect_every8d_settings_auth_email_outbox;
  alter table public.every8d_settings_auth_challenges enable trigger protect_every8d_settings_auth_challenge;
end; $$;
create function c3c3_proof.reject_record() returns trigger language plpgsql as $$
begin
  if new.delivery_succeeded_at is distinct from old.delivery_succeeded_at
    or new.delivery_failed_at is distinct from old.delivery_failed_at then
    raise exception 'synthetic recorder boundary failure' using errcode='23514';
  end if;
  return new;
end; $$;
grant usage on schema c3c3_proof to c3a_migration_owner;
grant execute on all functions in schema c3c3_proof to c3a_migration_owner;
commit;
