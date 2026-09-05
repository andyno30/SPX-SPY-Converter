-- Private fallback cache for Pro-only options tickers.
-- The browser cannot read this table directly; only service-role Edge Functions can.

create table if not exists public.options_cache (
  ticker text primary key,
  payload jsonb not null,
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  last_attempted_at timestamptz,
  refresh_started_at timestamptz,
  constraint options_cache_ticker_format check (ticker ~ '^[A-Z]{1,5}$')
);

alter table public.options_cache
  add column if not exists last_attempted_at timestamptz,
  add column if not exists refresh_started_at timestamptz;

update public.options_cache
set last_attempted_at = fetched_at
where last_attempted_at is null;

alter table public.options_cache enable row level security;

revoke all on table public.options_cache from anon, authenticated;
grant all on table public.options_cache to service_role;

comment on table public.options_cache is
  'Private last-known-good options payloads used by the Pro-gated Edge Function.';

create or replace function public.claim_options_refresh(
  p_ticker text,
  p_interval_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_ticker text;
begin
  insert into public.options_cache (
    ticker,
    payload,
    last_attempted_at,
    refresh_started_at
  )
  values (
    upper(p_ticker),
    '{}'::jsonb,
    now(),
    now()
  )
  on conflict (ticker) do update
  set
    last_attempted_at = now(),
    refresh_started_at = now()
  where
    (
      options_cache.last_attempted_at is null
      or options_cache.last_attempted_at <= now() - make_interval(
        secs => greatest(p_interval_seconds, 60)
      )
    )
    and (
      options_cache.refresh_started_at is null
      or options_cache.refresh_started_at <= now() - interval '2 minutes'
    )
  returning ticker into claimed_ticker;

  return claimed_ticker is not null;
end;
$$;

revoke all on function public.claim_options_refresh(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_options_refresh(text, integer)
  to service_role;
