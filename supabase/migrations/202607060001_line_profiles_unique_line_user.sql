do $$
declare
  duplicate_group_count integer := 0;
  deleted_duplicate_count integer := 0;
  unique_constraint_exists boolean := false;
begin
  select count(*)
  into duplicate_group_count
  from (
    select tenant_id, line_user_id
    from public.line_profiles
    group by tenant_id, line_user_id
    having count(*) > 1
  ) duplicate_groups;

  raise notice 'line_profiles duplicate tenant/user groups before cleanup: %', duplicate_group_count;

  with ranked_line_profiles as (
    select
      id,
      row_number() over (
        partition by tenant_id, line_user_id
        order by
          (ghl_contact_id is not null) desc,
          (ghl_conversation_id is not null) desc,
          coalesce(updated_at, created_at) desc,
          created_at desc,
          id desc
      ) as row_rank
    from public.line_profiles
  )
  delete from public.line_profiles line_profile
  using ranked_line_profiles ranked
  where line_profile.id = ranked.id
    and ranked.row_rank > 1;

  get diagnostics deleted_duplicate_count = row_count;
  raise notice 'line_profiles duplicate rows deleted before unique constraint: %', deleted_duplicate_count;

  alter table public.line_profiles
    drop constraint if exists line_profiles_tenant_id_line_source_id_line_user_id_key;

  select exists (
    select 1
    from pg_constraint
    where conrelid = 'public.line_profiles'::regclass
      and conname = 'line_profiles_tenant_line_user_key'
  )
  into unique_constraint_exists;

  if not unique_constraint_exists then
    alter table public.line_profiles
      add constraint line_profiles_tenant_line_user_key unique (tenant_id, line_user_id);

    raise notice 'line_profiles unique constraint added: line_profiles_tenant_line_user_key';
  else
    raise notice 'line_profiles unique constraint already exists: line_profiles_tenant_line_user_key';
  end if;
end $$;
