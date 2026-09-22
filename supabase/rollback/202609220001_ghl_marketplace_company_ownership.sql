-- Manual D1 rollback only. Refuses to discard any authoritative company ownership evidence.
begin;
set local lock_timeout = '5s';
lock table public.ghl_marketplace_installations in access exclusive mode;

do $$
begin
  if exists (select 1 from public.ghl_marketplace_installations where company_id is not null) then
    raise exception 'company ownership rollback refused: preserve bound installation evidence' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)
  from service_role;
drop function public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text);
drop trigger protect_ghl_marketplace_installation on public.ghl_marketplace_installations;
create trigger protect_ghl_marketplace_installation
before insert or update on public.ghl_marketplace_installations
for each row execute function public.protect_ghl_marketplace_installation_v1();
drop function public.protect_ghl_marketplace_installation_v2();

revoke update (
  status, installation_generation, access_token_ciphertext, refresh_token_ciphertext,
  encryption_key_version, token_expires_at, granted_scopes
) on public.ghl_marketplace_installations from service_role;
grant insert, update on public.ghl_marketplace_installations to service_role;
alter table public.ghl_marketplace_installations
  drop constraint ghl_marketplace_installations_null_company_safety_check;
alter table public.ghl_marketplace_installations drop column company_id;
commit;
