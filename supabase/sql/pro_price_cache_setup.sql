-- Shared Yahoo quote snapshot and refresh admission for Pro prices only.
-- Run as the database owner before deploying the shared-cache Pro functions.
-- Safe to rerun: an existing snapshot and refresh-attempt history are preserved.
begin;

create table if not exists public.pro_price_cache (
  id smallint primary key default 1 check (id = 1),
  quotes jsonb,
  fetched_at timestamptz,
  last_attempted_minute timestamptz,
  refresh_started_at timestamptz,
  claim_token uuid,
  constraint pro_price_cache_snapshot_pair check (
    (quotes is null and fetched_at is null)
    or (quotes is not null and fetched_at is not null)
  ),
  constraint pro_price_cache_quotes_array check (
    quotes is null or jsonb_typeof(quotes) = 'array'
  ),
  constraint pro_price_cache_claim_pair check (
    (claim_token is null and refresh_started_at is null)
    or (claim_token is not null and refresh_started_at is not null)
  )
);

insert into public.pro_price_cache (id)
values (1)
on conflict (id) do nothing;

alter table public.pro_price_cache enable row level security;
revoke all on table public.pro_price_cache from public, anon, authenticated, service_role;
grant select on table public.pro_price_cache to service_role;

drop policy if exists pro_price_cache_service_read on public.pro_price_cache;
create policy pro_price_cache_service_read
  on public.pro_price_cache for select to service_role using (true);

comment on table public.pro_price_cache is
  'Private singleton Pro quote snapshot; refresh RPCs fence writers and admit at most one attempt per UTC database minute.';
comment on column public.pro_price_cache.last_attempted_minute is
  'UTC minute of the last admitted attempt, retained even when that attempt fails.';

create or replace function public.claim_pro_price_refresh()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_minute timestamptz;
  v_token uuid := gen_random_uuid();
  v_claimed uuid;
begin
  -- Read the database clock only after acquiring the singleton row lock. A
  -- caller waiting across a minute boundary must use its actual claim minute.
  perform 1 from public.pro_price_cache where id = 1 for update;
  if not found then
    return null;
  end if;
  v_now := clock_timestamp();
  v_minute := date_trunc('minute', v_now at time zone 'UTC') at time zone 'UTC';

  -- Mark the attempt before upstream I/O, including failed upstream requests.
  update public.pro_price_cache
  set last_attempted_minute = v_minute,
      refresh_started_at = v_now,
      claim_token = v_token
  where id = 1
    and (last_attempted_minute is null or last_attempted_minute < v_minute)
    and (refresh_started_at is null or refresh_started_at <= v_now - interval '90 seconds')
  returning claim_token into v_claimed;

  return v_claimed;
end;
$$;

create or replace function public.finish_pro_price_refresh(
  p_claim_token uuid,
  p_quotes jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  -- Validate the transport shape here. Runtime quote validation determines
  -- whether prices are usable; individual instruments may lack a market price.
  if p_quotes is null or jsonb_typeof(p_quotes) <> 'array' then
    raise exception 'Pro quotes must be a nonempty JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_quotes) = 0 then
    raise exception 'Pro quotes must be a nonempty JSON array' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_quotes) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or jsonb_typeof(item.value -> 'symbol') is distinct from 'string'
      or btrim(item.value ->> 'symbol') = ''
  ) then
    raise exception 'Each Pro quote must be an object with a nonempty symbol' using errcode = '22023';
  end if;

  -- Token fencing prevents a timed-out/released worker from overwriting a
  -- newer claim. An expired lease cannot publish even if not yet superseded.
  -- Acquire the lock before checking wall-clock lease expiry, as for claim.
  perform 1 from public.pro_price_cache where id = 1 for update;
  update public.pro_price_cache
  set quotes = p_quotes,
      fetched_at = clock_timestamp(),
      refresh_started_at = null,
      claim_token = null
  where id = 1
    and claim_token = p_claim_token
    and refresh_started_at > clock_timestamp() - interval '90 seconds';
  get diagnostics v_updated = row_count;

  return v_updated = 1;
end;
$$;

create or replace function public.release_pro_price_refresh(p_claim_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  -- Preserve both the previous good snapshot and this minute's attempt marker.
  update public.pro_price_cache
  set refresh_started_at = null,
      claim_token = null
  where id = 1 and claim_token = p_claim_token;
  get diagnostics v_updated = row_count;

  return v_updated = 1;
end;
$$;

revoke all on function public.claim_pro_price_refresh()
  from public, anon, authenticated;
revoke all on function public.finish_pro_price_refresh(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.release_pro_price_refresh(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_pro_price_refresh() to service_role;
grant execute on function public.finish_pro_price_refresh(uuid, jsonb) to service_role;
grant execute on function public.release_pro_price_refresh(uuid) to service_role;

commit;
