-- Guarded C3b-1 rollback. Refuse before destructive DDL if either table has rows.
begin;
set local lock_timeout = '5s';
lock table public.ghl_marketplace_installations in access exclusive mode;
lock table public.every8d_settings_enrollment_grants in access exclusive mode;
lock table public.every8d_settings_administrators in access exclusive mode;
lock table public.every8d_settings_auth_challenges in access exclusive mode;
lock table public.every8d_settings_auth_challenge_failures in access exclusive mode;

do $$
begin
  if exists(select 1 from public.every8d_settings_auth_challenges)
    or exists(select 1 from public.every8d_settings_auth_challenge_failures) then
    raise exception 'C3b-1 rollback refused: challenge rows exist'
      using errcode='23514';
  end if;
end;
$$;

drop trigger invalidate_every8d_settings_challenges_after_grant_update
  on public.every8d_settings_enrollment_grants;
drop index public.every8d_settings_administrators_c3b_active_email_lookup_idx;
drop trigger assert_every8d_settings_failure_ledger_integrity
  on public.every8d_settings_auth_challenge_failures;
drop trigger assert_every8d_settings_challenge_row_integrity
  on public.every8d_settings_auth_challenges;
drop trigger lock_every8d_settings_challenge_on_fifth_failure
  on public.every8d_settings_auth_challenge_failures;
drop trigger protect_every8d_settings_auth_challenge_failure
  on public.every8d_settings_auth_challenge_failures;
drop trigger protect_every8d_settings_auth_challenge
  on public.every8d_settings_auth_challenges;

drop table public.every8d_settings_auth_challenge_failures;
drop table public.every8d_settings_auth_challenges;

drop function public.cleanup_every8d_settings_auth_challenges_v1(integer);
drop function public.scrub_expired_every8d_settings_challenge_emails_v1(integer);
drop function public.invalidate_every8d_settings_challenges_for_grant_v1();
drop function public.verify_every8d_settings_challenge_v1(uuid,bytea,text,uuid,text,text[],bytea);
drop function public.request_every8d_settings_login_challenge_v1(text,text,text[],bytea,bytea,text);
drop function public.request_every8d_settings_enrollment_challenge_v1(uuid,text,text,text[],bytea,bytea,text);
drop function public.assert_every8d_settings_challenge_rate_limits_v1(text[],uuid,timestamptz);
drop function public.discover_every8d_settings_challenge_v1(bytea,text);
drop function public.record_every8d_settings_challenge_delivery_v1(bytea,boolean,text);
drop function public.assert_every8d_settings_challenge_integrity_v1();
drop function public.lock_every8d_settings_challenge_on_fifth_failure_v1();
drop function public.protect_every8d_settings_auth_challenge_failure_v1();
drop function public.protect_every8d_settings_auth_challenge_v1();
drop function public.lock_every8d_settings_email_pseudonyms_v1(text[]);
drop function public.every8d_settings_email_lock_word_v1(text);
drop function public.is_every8d_settings_email_pseudonym_v1(text);
drop function public.is_every8d_settings_canonical_email_v1(text);
commit;
