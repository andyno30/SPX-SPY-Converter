-- Public journal with one editor: the existing verified spyconverter account.
-- Run once in the linked Spyconverter Pro database (safe to run again).
begin;

create table if not exists public.trading_journal_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade
);
alter table public.trading_journal_owner enable row level security;
revoke all on public.trading_journal_owner from public, anon, authenticated;

do $$
declare owner_id uuid;
begin
  select id into strict owner_id from auth.users
  where lower(email) = 'andyno30@gmail.com' and email_confirmed_at is not null;
  insert into public.trading_journal_owner (singleton, user_id)
  values (true, owner_id)
  on conflict (singleton) do update set user_id = excluded.user_id;
end;
$$;

create or replace function public.is_trading_journal_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.trading_journal_owner where user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_trading_journal_owner() from public, anon;
grant execute on function public.is_trading_journal_owner() to anon, authenticated;

create or replace function public.valid_journal_image_paths(paths text[])
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(cardinality(paths) <= 10 and not exists (
    select 1 from unnest(paths) as image_path
    where image_path is null
      or image_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'
  ), false);
$$;

create table if not exists public.trading_journal_entries (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('options', 'futures')),
  entry_date date not null check (entry_date between '1900-01-01' and '9999-12-31'),
  description text not null default '' check (char_length(description) <= 20000),
  image_paths text[] not null default '{}' check (public.valid_journal_image_paths(image_paths)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(description)) > 0 or cardinality(image_paths) > 0)
);
create index if not exists trading_journal_entries_newest_first
  on public.trading_journal_entries (market, entry_date desc, created_at desc);

alter table public.trading_journal_entries enable row level security;
revoke all on public.trading_journal_entries from public, anon, authenticated;
grant select on public.trading_journal_entries to anon, authenticated;
grant insert (id, market, entry_date, description, image_paths),
      update (entry_date, description, image_paths)
  on public.trading_journal_entries to authenticated;

drop policy if exists "Public journal entries" on public.trading_journal_entries;
create policy "Public journal entries" on public.trading_journal_entries
  for select to anon, authenticated using (true);
drop policy if exists "Journal owner can add entries" on public.trading_journal_entries;
create policy "Journal owner can add entries" on public.trading_journal_entries
  for insert to authenticated with check ((select public.is_trading_journal_owner()));
drop policy if exists "Journal owner can edit entries" on public.trading_journal_entries;
create policy "Journal owner can edit entries" on public.trading_journal_entries
  for update to authenticated using ((select public.is_trading_journal_owner()))
  with check ((select public.is_trading_journal_owner()));

create or replace function public.touch_trading_journal_entry()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists touch_trading_journal_entry on public.trading_journal_entries;
create trigger touch_trading_journal_entry before update on public.trading_journal_entries
  for each row execute function public.touch_trading_journal_entry();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trading-journal', 'trading-journal', true, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public journal images" on storage.objects;
create policy "Public journal images" on storage.objects for select to anon, authenticated
  using (bucket_id = 'trading-journal');
drop policy if exists "Journal owner uploads images" on storage.objects;
create policy "Journal owner uploads images" on storage.objects for insert to authenticated
  with check (bucket_id = 'trading-journal' and (select public.is_trading_journal_owner())
    and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Journal owner removes unsaved images" on storage.objects;
create policy "Journal owner removes unsaved images" on storage.objects for delete to authenticated
  using (bucket_id = 'trading-journal' and (select public.is_trading_journal_owner()));

-- Restrictive guards also block any unrelated, permissive storage write policies.
drop policy if exists "Guard journal image inserts" on storage.objects;
create policy "Guard journal image inserts" on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'trading-journal' or
    ((select auth.role()) = 'authenticated' and (select public.is_trading_journal_owner())
      and (storage.foldername(name))[1] = (select auth.uid())::text));
drop policy if exists "Journal images are immutable" on storage.objects;
create policy "Journal images are immutable" on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'trading-journal') with check (bucket_id <> 'trading-journal');
drop policy if exists "Guard journal image deletes" on storage.objects;
create policy "Guard journal image deletes" on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id <> 'trading-journal' or
    ((select auth.role()) = 'authenticated' and (select public.is_trading_journal_owner())));

notify pgrst, 'reload schema';
commit;
