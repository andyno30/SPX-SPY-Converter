-- Private fallback cache for Pro-only options tickers.
-- The browser cannot read this table directly; only service-role Edge Functions can.

create table if not exists public.options_cache (
  ticker text primary key,
  payload jsonb not null,
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  constraint options_cache_ticker_format check (ticker ~ '^[A-Z]{1,5}$')
);

alter table public.options_cache enable row level security;

revoke all on table public.options_cache from anon, authenticated;
grant all on table public.options_cache to service_role;

comment on table public.options_cache is
  'Private last-known-good options payloads used by the Pro-gated Edge Function.';
