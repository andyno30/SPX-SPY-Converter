-- NEW Arpia project only. This migration is never applied from the root-linked Supabase project.
-- Private client-authoritative prototype snapshots; not an authoritative public economy.
begin;

create table public.arpia_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  created_at timestamptz not null default now()
);
alter table public.arpia_profiles enable row level security;
revoke all on public.arpia_profiles from anon, authenticated;
grant select, insert, update, delete on public.arpia_profiles to authenticated;
create policy profiles_read_own on public.arpia_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy profiles_insert_own on public.arpia_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy profiles_update_own on public.arpia_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy profiles_delete_own on public.arpia_profiles for delete to authenticated using ((select auth.uid()) = user_id);

create table public.arpia_saves (
  character_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0 and revision <= 9007199254740991),
  save_schema_version integer not null check (save_schema_version = 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  constraint payload_identity check (payload->>'characterId' = character_id::text),
  constraint payload_revision check ((payload->>'revision')::bigint = revision),
  constraint payload_version check ((payload->>'saveSchemaVersion')::integer = save_schema_version)
);
create index arpia_saves_user_id_idx on public.arpia_saves(user_id);
alter table public.arpia_saves enable row level security;
revoke all on public.arpia_saves from anon, authenticated;
grant select on public.arpia_saves to authenticated;
create policy saves_read_own on public.arpia_saves for select to authenticated using ((select auth.uid()) = user_id);

-- Only this transaction can write a snapshot. Direct REST mutations are not granted.
-- SECURITY DEFINER deliberately enforces ownership explicitly as well as expected revision.
create function public.commit_arpia_save(p_character_id uuid, p_expected_revision bigint, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  next_payload jsonb;
  committed jsonb;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 9007199254740991 then
    raise exception 'Invalid revision' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or (p_payload->>'characterId') is distinct from p_character_id::text
     or (p_payload->>'saveSchemaVersion') is distinct from '1'
     or (p_payload->>'revision') is distinct from p_expected_revision::text then
    raise exception 'Invalid save envelope' using errcode = '22023';
  end if;
  next_payload := jsonb_set(p_payload, '{revision}', to_jsonb(p_expected_revision + 1));
  if p_expected_revision = 0 then
    insert into public.arpia_saves(character_id,user_id,revision,save_schema_version,payload)
    values (p_character_id,caller,1,1,next_payload)
    on conflict (character_id) do nothing
    returning payload into committed;
  else
    update public.arpia_saves
    set revision = p_expected_revision + 1, payload = next_payload, updated_at = now()
    where character_id = p_character_id and user_id = caller and revision = p_expected_revision
    returning payload into committed;
  end if;
  if committed is null then raise exception 'Save conflict' using errcode = '40001'; end if;
  return committed;
end;
$$;
revoke all on function public.commit_arpia_save(uuid,bigint,jsonb) from public, anon;
grant execute on function public.commit_arpia_save(uuid,bigint,jsonb) to authenticated;

comment on table public.arpia_saves is 'Private reconstruction prototype. Client values are not proof of earned currency, items, ranks or pets. Do not connect to a public competitive economy.';
commit;
