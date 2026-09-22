-- Phase 2G-D D1: staged immutable HighLevel company ownership.
-- Nullable preserves pre-D1 rows without inventing ownership; eligible runtime paths require a value.
begin;
set local lock_timeout = '5s';

alter table public.ghl_marketplace_installations
  add column company_id text
  check (company_id is null or company_id ~ '^[A-Za-z0-9_-]{1,128}$');

create function public.protect_ghl_marketplace_installation_v2()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.id, new.app_namespace, new.marketplace_app_id, new.oauth_client_id,
      new.tenant_id, new.location_id, new.conversation_provider_id, new.channel, new.provider, new.created_at)
      is distinct from row(old.id, old.app_namespace, old.marketplace_app_id, old.oauth_client_id,
      old.tenant_id, old.location_id, old.conversation_provider_id, old.channel, old.provider, old.created_at) then
      raise exception 'marketplace installation ownership is immutable' using errcode = '23514';
    end if;
    if old.company_id is not null and new.company_id is distinct from old.company_id then
      raise exception 'marketplace installation company ownership is immutable' using errcode = '23514';
    end if;
    if new.installation_generation::bigint not in (old.installation_generation::bigint, old.installation_generation::bigint + 1) then
      raise exception 'marketplace generation must remain unchanged or advance once' using errcode = '23514';
    end if;
    if old.status in ('disabled', 'uninstalled') and new.status in ('pending', 'active')
      and new.installation_generation::bigint <> old.installation_generation::bigint + 1 then
      raise exception 'marketplace reactivation requires a new generation' using errcode = '23514';
    end if;
  end if;
  if exists (select 1 from public.tenants t where t.id = new.tenant_id
    and t.ghl_provider_id = new.conversation_provider_id) then
    raise exception 'marketplace provider must differ from the bound tenant LINE provider' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger protect_ghl_marketplace_installation on public.ghl_marketplace_installations;
create trigger protect_ghl_marketplace_installation
before insert or update on public.ghl_marketplace_installations
for each row execute function public.protect_ghl_marketplace_installation_v2();

create function public.provision_every8d_ghl_marketplace_installation_v1(
  input_marketplace_app_id text,
  input_oauth_client_id text,
  input_tenant_id uuid,
  input_location_id text,
  input_company_id text,
  input_conversation_provider_id text
)
returns setof public.ghl_marketplace_installations
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  bound public.ghl_marketplace_installations%rowtype;
begin
  if input_marketplace_app_id is null or input_marketplace_app_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_oauth_client_id is null or char_length(input_oauth_client_id) not between 1 and 256
    or input_oauth_client_id !~ '^[A-Za-z0-9_.-]+$'
    or input_location_id is null or input_location_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_company_id is null or input_company_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_conversation_provider_id is null
    or input_conversation_provider_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception 'marketplace provisioning evidence is invalid' using errcode = '23514';
  end if;

  if not exists (select 1 from public.tenants t
    where t.id = input_tenant_id and t.location_id = input_location_id) then
    raise exception 'marketplace provisioning tenant ownership is not exact' using errcode = '23503';
  end if;

  insert into public.ghl_marketplace_installations (
    app_namespace, marketplace_app_id, oauth_client_id, tenant_id, location_id,
    company_id, conversation_provider_id, channel, provider, status
  ) values (
    'every8d_connect', input_marketplace_app_id, input_oauth_client_id, input_tenant_id,
    input_location_id, input_company_id, input_conversation_provider_id, 'sms', 'every8d', 'pending'
  ) on conflict (marketplace_app_id, location_id) do nothing;

  select i.* into strict bound
  from public.ghl_marketplace_installations i
  where i.marketplace_app_id = input_marketplace_app_id
    and i.location_id = input_location_id
  for update;

  if bound.app_namespace <> 'every8d_connect'
    or bound.oauth_client_id <> input_oauth_client_id
    or bound.tenant_id <> input_tenant_id
    or bound.conversation_provider_id <> input_conversation_provider_id
    or bound.channel <> 'sms'
    or bound.provider <> 'every8d'
    or (bound.company_id is not null and bound.company_id <> input_company_id) then
    raise exception 'marketplace provisioning ownership conflicted' using errcode = '23514';
  end if;

  if bound.status in ('disabled', 'uninstalled') then
    update public.ghl_marketplace_installations
      set company_id = coalesce(company_id, input_company_id),
          status = 'pending',
          installation_generation = installation_generation + 1
      where id = bound.id;
  elsif bound.company_id is null then
    update public.ghl_marketplace_installations
      set company_id = input_company_id
      where id = bound.id;
  end if;

  return query select i.* from public.ghl_marketplace_installations i where i.id = bound.id;
end;
$$;

-- Direct service-role INSERT/company mutation is removed; signed lifecycle code must use the narrow RPC.
revoke insert, update on public.ghl_marketplace_installations from service_role;
grant update (
  status, installation_generation, access_token_ciphertext, refresh_token_ciphertext,
  encryption_key_version, token_expires_at, granted_scopes
) on public.ghl_marketplace_installations to service_role;
revoke all on function public.protect_ghl_marketplace_installation_v2(),
  public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)
  to service_role;

comment on column public.ghl_marketplace_installations.company_id is
  'Authoritative signed HighLevel company owner. Nullable only for pre-D1 rows; non-null ownership is immutable.';
comment on function public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text) is
  'Atomic server-only EVERY8D provisioning from verified signed app/company/location evidence; no browser or LINE authority.';
commit;
