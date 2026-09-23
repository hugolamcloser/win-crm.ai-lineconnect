-- Phase 2G-D D3: durable HighLevel lifecycle replay and ordering boundary.
-- No provider activation, OAuth enablement, production data, or send authority is added here.
begin;
set local lock_timeout = '5s';

alter table public.ghl_marketplace_installations
  add column latest_lifecycle_event_at timestamptz,
  add column latest_lifecycle_event_id text,
  add column latest_lifecycle_event_type text;

alter table public.ghl_marketplace_installations
  add constraint ghl_marketplace_installations_lifecycle_watermark_check
  check (
    (latest_lifecycle_event_at is null
      and latest_lifecycle_event_id is null
      and latest_lifecycle_event_type is null)
    or
    (latest_lifecycle_event_at is not null
      and isfinite(latest_lifecycle_event_at)
      and latest_lifecycle_event_id ~ '^[A-Za-z0-9_-]{1,256}$'
      and latest_lifecycle_event_type in ('INSTALL', 'UNINSTALL'))
  );

create function public.protect_ghl_marketplace_installation_v3()
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
    if old.latest_lifecycle_event_at is not null then
      if new.latest_lifecycle_event_at is null
        or new.latest_lifecycle_event_at < old.latest_lifecycle_event_at then
        raise exception 'marketplace lifecycle watermark cannot move backward' using errcode = '23514';
      end if;
      if new.latest_lifecycle_event_at = old.latest_lifecycle_event_at
        and row(new.latest_lifecycle_event_id, new.latest_lifecycle_event_type)
          is distinct from row(old.latest_lifecycle_event_id, old.latest_lifecycle_event_type) then
        raise exception 'marketplace lifecycle equal-time evidence is immutable' using errcode = '23514';
      end if;
    end if;
  end if;
  if new.company_id is null and (
    new.status = 'active'
    or new.access_token_ciphertext is not null
    or new.refresh_token_ciphertext is not null
    or new.encryption_key_version is not null
    or new.token_expires_at is not null
    or cardinality(new.granted_scopes) > 0
  ) then
    raise exception 'marketplace installation requires company ownership before activation or credentials'
      using errcode = '23514';
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
for each row execute function public.protect_ghl_marketplace_installation_v3();

create function public.apply_every8d_ghl_marketplace_lifecycle_v1(
  input_event_type text,
  input_marketplace_app_id text,
  input_oauth_client_id text,
  input_tenant_id uuid,
  input_location_id text,
  input_company_id text,
  input_conversation_provider_id text,
  input_event_at timestamptz,
  input_event_id text
)
returns setof public.ghl_marketplace_installations
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  bound public.ghl_marketplace_installations%rowtype;
begin
  if input_event_type is null or input_event_type not in ('INSTALL', 'UNINSTALL')
    or input_marketplace_app_id is null or input_marketplace_app_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_oauth_client_id is null or char_length(input_oauth_client_id) not between 1 and 256
    or input_oauth_client_id !~ '^[A-Za-z0-9_.-]+$'
    or input_location_id is null or input_location_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_conversation_provider_id is null
    or input_conversation_provider_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or input_event_at is null or not isfinite(input_event_at)
    or input_event_id is null or input_event_id !~ '^[A-Za-z0-9_-]{1,256}$' then
    raise exception 'marketplace lifecycle evidence is invalid' using errcode = '23514';
  end if;

  if input_event_type = 'INSTALL' then
    if input_tenant_id is null
      or input_company_id is null or input_company_id !~ '^[A-Za-z0-9_-]{1,128}$' then
      raise exception 'marketplace INSTALL ownership evidence is invalid' using errcode = '23514';
    end if;
    if not exists (select 1 from public.tenants t
      where t.id = input_tenant_id and t.location_id = input_location_id) then
      raise exception 'marketplace lifecycle tenant ownership is not exact' using errcode = '23503';
    end if;

    insert into public.ghl_marketplace_installations (
      app_namespace, marketplace_app_id, oauth_client_id, tenant_id, location_id,
      company_id, conversation_provider_id, channel, provider, status,
      latest_lifecycle_event_at, latest_lifecycle_event_id, latest_lifecycle_event_type
    ) values (
      'every8d_connect', input_marketplace_app_id, input_oauth_client_id, input_tenant_id,
      input_location_id, input_company_id, input_conversation_provider_id, 'sms', 'every8d', 'pending',
      input_event_at, input_event_id, input_event_type
    ) on conflict (marketplace_app_id, location_id) do nothing;

    select i.* into bound
    from public.ghl_marketplace_installations i
    where i.marketplace_app_id = input_marketplace_app_id
      and i.location_id = input_location_id
    for update;

    if not found
      or bound.app_namespace <> 'every8d_connect'
      or bound.oauth_client_id <> input_oauth_client_id
      or bound.tenant_id <> input_tenant_id
      or bound.conversation_provider_id <> input_conversation_provider_id
      or bound.channel <> 'sms'
      or bound.provider <> 'every8d'
      or (bound.company_id is not null and bound.company_id <> input_company_id) then
      raise exception 'marketplace lifecycle ownership conflicted' using errcode = '23514';
    end if;
  else
    if input_tenant_id is not null or input_company_id is not null then
      raise exception 'marketplace UNINSTALL evidence must use stored ownership' using errcode = '23514';
    end if;

    select i.* into bound
    from public.ghl_marketplace_installations i
    where i.app_namespace = 'every8d_connect'
      and i.marketplace_app_id = input_marketplace_app_id
      and i.oauth_client_id = input_oauth_client_id
      and i.location_id = input_location_id
      and i.company_id is not null
      and i.conversation_provider_id = input_conversation_provider_id
      and i.channel = 'sms'
      and i.provider = 'every8d'
    for update;

    if not found then
      raise exception 'marketplace lifecycle ownership conflicted' using errcode = '23514';
    end if;
  end if;

  if bound.latest_lifecycle_event_at is not null then
    if input_event_at < bound.latest_lifecycle_event_at then
      return query select i.* from public.ghl_marketplace_installations i where i.id = bound.id;
      return;
    end if;
    if input_event_at = bound.latest_lifecycle_event_at then
      if input_event_id <> bound.latest_lifecycle_event_id
        or input_event_type <> bound.latest_lifecycle_event_type then
        raise exception 'marketplace lifecycle chronology is ambiguous' using errcode = '23514';
      end if;
      return query select i.* from public.ghl_marketplace_installations i where i.id = bound.id;
      return;
    end if;
  end if;

  if input_event_type = 'INSTALL' then
    update public.ghl_marketplace_installations
      set company_id = coalesce(company_id, input_company_id),
          status = case when status in ('disabled', 'uninstalled') then 'pending' else status end,
          installation_generation = case
            when status in ('disabled', 'uninstalled') then installation_generation + 1
            else installation_generation
          end,
          latest_lifecycle_event_at = input_event_at,
          latest_lifecycle_event_id = input_event_id,
          latest_lifecycle_event_type = input_event_type
      where id = bound.id;
  else
    update public.ghl_marketplace_installations
      set status = 'uninstalled',
          installation_generation = case
            when status = 'uninstalled' then installation_generation
            else installation_generation + 1
          end,
          latest_lifecycle_event_at = input_event_at,
          latest_lifecycle_event_id = input_event_id,
          latest_lifecycle_event_type = input_event_type
      where id = bound.id;
  end if;

  return query select i.* from public.ghl_marketplace_installations i where i.id = bound.id;
end;
$$;

-- Retire the unordered D1 mutation paths before granting the ordered transaction.
revoke execute on function public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)
  from service_role;
revoke update (status, installation_generation) on public.ghl_marketplace_installations
  from service_role;
revoke all on function public.protect_ghl_marketplace_installation_v3(),
  public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)
  to service_role;

comment on column public.ghl_marketplace_installations.latest_lifecycle_event_at is
  'Signed HighLevel event chronology watermark; lifecycle mutation and watermark advancement are one transaction.';
comment on column public.ghl_marketplace_installations.latest_lifecycle_event_id is
  'Identity of the latest accepted HighLevel lifecycle event; never installation identity.';
comment on column public.ghl_marketplace_installations.latest_lifecycle_event_type is
  'Type of the latest accepted HighLevel lifecycle event, constrained to INSTALL or UNINSTALL.';
comment on function public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text) is
  'Server-only atomic lifecycle order/replay boundary. Older events do not mutate; equal-time conflicts fail closed.';

commit;
