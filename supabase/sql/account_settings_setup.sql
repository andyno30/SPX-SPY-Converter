-- Public account identity for comments and account settings.
-- Billing/subscription fields stay in public.profiles and are never exposed here.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  avatar_url text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_nickname_format check (
    nickname is null
    or (
      char_length(nickname) between 3 and 30
      and nickname ~ '^[A-Za-z0-9][A-Za-z0-9_.-]*$'
    )
  )
);

create unique index if not exists user_profiles_nickname_unique_ci
  on public.user_profiles (lower(nickname))
  where nickname is not null;

alter table public.user_profiles enable row level security;

drop policy if exists "Public profiles are readable" on public.user_profiles;
create policy "Public profiles are readable"
  on public.user_profiles for select
  using (true);

drop policy if exists "Users can create their public profile" on public.user_profiles;
create policy "Users can create their public profile"
  on public.user_profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their public profile" on public.user_profiles;
create policy "Users can update their public profile"
  on public.user_profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their public profile" on public.user_profiles;
create policy "Users can delete their public profile"
  on public.user_profiles for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.set_user_profiles_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_user_profiles_updated_at();

-- Needed for Stripe's customer portal. Existing profile rows are preserved.
alter table public.profiles
  add column if not exists stripe_customer_id text;

-- Public avatar files. Users can only write inside their own UUID folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can replace their own avatar" on storage.objects;
create policy "Users can replace their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
