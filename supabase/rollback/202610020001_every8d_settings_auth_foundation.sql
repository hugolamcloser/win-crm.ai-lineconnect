-- Guarded C3a rollback. Refuse before destructive DDL if any C3a row exists.
begin;
set local lock_timeout = '5s';
-- DROP TRIGGER requires ACCESS EXCLUSIVE on its parent relation. Acquire that
-- final mode first so rollback never holds a C3 child lock while waiting on a
-- lifecycle writer that already owns the parent.
lock table public.ghl_marketplace_installations in access exclusive mode;
lock table public.every8d_settings_administrators in access exclusive mode;
lock table public.every8d_settings_enrollment_grants in access exclusive mode;
lock table public.every8d_settings_sessions in access exclusive mode;

do $$
begin
  if exists (select 1 from public.every8d_settings_administrators)
    or exists (select 1 from public.every8d_settings_enrollment_grants)
    or exists (select 1 from public.every8d_settings_sessions) then
    raise exception 'C3a rollback refused: EVERY8D settings auth rows exist'
      using errcode = '23514';
  end if;
end;
$$;

drop trigger invalidate_every8d_settings_auth_after_install_update
  on public.ghl_marketplace_installations;
drop trigger protect_every8d_settings_session
  on public.every8d_settings_sessions;
drop trigger protect_every8d_settings_administrator
  on public.every8d_settings_administrators;
drop trigger protect_every8d_settings_enrollment_grant
  on public.every8d_settings_enrollment_grants;

drop table public.every8d_settings_sessions;
drop table public.every8d_settings_administrators;
drop table public.every8d_settings_enrollment_grants;

drop function public.redeem_every8d_settings_enrollment_grant_v1(bytea, text, text);
drop function public.issue_every8d_settings_install_callback_enrollment_grant_v1(
  uuid, integer, uuid, bytea, timestamptz, text, text
);
drop function public.issue_every8d_settings_operator_enrollment_grant_v1(
  uuid, integer, text, bytea, text, timestamptz, text, text, text, text
);
drop function public.protect_every8d_settings_session_v1();
drop function public.protect_every8d_settings_administrator_v1();
drop function public.protect_every8d_settings_enrollment_grant_v1();
drop function public.invalidate_every8d_settings_auth_v1();
drop function public.assert_every8d_settings_installation_eligible_v1(uuid, integer);

commit;
