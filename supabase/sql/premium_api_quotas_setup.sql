-- PROPOSAL ONLY: production migration requires explicit approval.
-- Deploy before enabling either Edge Function quota flag. No existing data,
-- policies, entitlement fields, refresh claims, or schedules are changed here.
begin;

create table if not exists public.premium_api_quota_control (
  resource text primary key check (resource in ('pro-prices', 'premium-options')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.premium_api_quota_control(resource)
  values ('pro-prices'), ('premium-options')
  on conflict (resource) do nothing;
alter table public.premium_api_quota_control enable row level security;
revoke all on table public.premium_api_quota_control
  from public, anon, authenticated, service_role;

create or replace function public.read_premium_api_quota_control(p_resource text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('enabled', enabled)
  from public.premium_api_quota_control where resource = p_resource;
$$;

create table if not exists public.premium_api_quota_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  resource text not null check (resource in ('pro-prices', 'premium-options')),
  minute_start timestamptz not null,
  minute_count integer not null default 0 check (minute_count between 0 and 60),
  hour_start timestamptz not null,
  hour_count integer not null default 0 check (hour_count between 0 and 1200),
  updated_at timestamptz not null,
  primary key (user_id, resource)
);
create index if not exists premium_api_quota_counters_updated_at_idx
  on public.premium_api_quota_counters(updated_at);
alter table public.premium_api_quota_counters enable row level security;
revoke all on table public.premium_api_quota_counters
  from public, anon, authenticated, service_role;

create or replace function public.consume_premium_api_quota(
  p_user_id uuid, p_resource text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '3s'
as $$
declare
  v_now timestamptz;
  v_minute timestamptz;
  v_hour timestamptz;
  v_row public.premium_api_quota_counters%rowtype;
  v_hour_limit integer;
  v_retry integer := 0;
  v_locked boolean := false;
  v_enabled boolean;
begin
  if p_user_id is null or p_resource is null
     or p_resource not in ('pro-prices', 'premium-options') then
    raise exception 'Invalid premium quota subject or resource' using errcode = '22023';
  end if;
  -- Serialize each accounting decision with owner/admin disable commits. A
  -- request that read enabled=true at the Edge before disable must recheck here.
  -- Shared locks allow different users to consume concurrently, while a disable
  -- UPDATE waits for earlier decisions and blocks later readers until commit.
  select enabled into v_enabled from public.premium_api_quota_control
    where resource = p_resource for share;
  if not found or v_enabled is not true then
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
  end if;
  -- Limits are server-defined, never accepted from request parameters.
  v_hour_limit := case when p_resource = 'pro-prices' then 1200 else 600 end;
  -- Cleanup may remove a long-inactive row between conflict detection and the
  -- lock. Retry initialization once; a newly inserted row cannot be expired.
  for v_attempt in 1..2 loop
    v_now := clock_timestamp();
    insert into public.premium_api_quota_counters
      (user_id, resource, minute_start, hour_start, updated_at)
    values (p_user_id, p_resource,
      date_trunc('minute', v_now at time zone 'UTC') at time zone 'UTC',
      date_trunc('hour', v_now at time zone 'UTC') at time zone 'UTC', v_now)
    on conflict (user_id, resource) do nothing;
    select * into v_row from public.premium_api_quota_counters
      where user_id = p_user_id and resource = p_resource for update;
    if found then
      v_locked := true;
      exit;
    end if;
  end loop;
  if not v_locked then
    raise exception 'Premium quota accounting temporarily unavailable';
  end if;
  -- Read the clock AFTER acquiring the row lock, including a window boundary.
  v_now := clock_timestamp();
  v_minute := date_trunc('minute', v_now at time zone 'UTC') at time zone 'UTC';
  v_hour := date_trunc('hour', v_now at time zone 'UTC') at time zone 'UTC';
  if v_row.minute_start <> v_minute then v_row.minute_count := 0; end if;
  if v_row.hour_start <> v_hour then v_row.hour_count := 0; end if;
  if v_row.minute_count >= 60 then
    v_retry := greatest(v_retry, ceil(extract(epoch from v_minute + interval '1 minute' - v_now))::integer);
  end if;
  if v_row.hour_count >= v_hour_limit then
    v_retry := greatest(v_retry, ceil(extract(epoch from v_hour + interval '1 hour' - v_now))::integer);
  end if;
  if v_retry > 0 then
    -- Denied requests do not increment counters or extend a fixed window.
    return jsonb_build_object('allowed', false, 'retry_after_seconds', greatest(1, v_retry));
  end if;
  update public.premium_api_quota_counters set
    minute_start = v_minute, minute_count = v_row.minute_count + 1,
    hour_start = v_hour, hour_count = v_row.hour_count + 1, updated_at = v_now
    where user_id = p_user_id and resource = p_resource;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

create or replace function public.purge_premium_api_quota_counters(p_batch_size integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '3s'
as $$
declare
  v_deleted integer;
  v_cutoff timestamptz := clock_timestamp() - interval '7 days';
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 1000 then
    raise exception 'Cleanup batch must be between 1 and 1000' using errcode = '22023';
  end if;
  with expired as (
    select user_id, resource from public.premium_api_quota_counters
    where updated_at < v_cutoff
    order by updated_at limit p_batch_size for update skip locked
  )
  delete from public.premium_api_quota_counters c using expired e
    where c.user_id = e.user_id and c.resource = e.resource;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.read_premium_api_quota_control(text)
  from public, anon, authenticated;
revoke all on function public.consume_premium_api_quota(uuid, text)
  from public, anon, authenticated;
revoke all on function public.purge_premium_api_quota_counters(integer)
  from public, anon, authenticated;
grant execute on function public.read_premium_api_quota_control(text) to service_role;
grant execute on function public.consume_premium_api_quota(uuid, text) to service_role;
grant execute on function public.purge_premium_api_quota_counters(integer) to service_role;

comment on table public.premium_api_quota_counters is
  'Private aggregate counters only: at most two rows per auth user, no IPs/tokens/request history. FK deletes on account removal; hourly bounded cleanup expires inactive counters after seven days.';
comment on function public.consume_premium_api_quota(uuid, text) is
  'Service-role-only. Caller first verifies user JWT and current Pro subscription. Runtime control is rechecked with a shared lock until transaction end. Atomic fixed UTC windows: 60/minute; Pro 1200/hour, all premium Options tickers combined 600/hour.';
comment on table public.premium_api_quota_control is
  'Owner/admin-controlled runtime quota switch; default disabled, no ordinary client or service-role writes. Edge reads every attempt without a cache. Does not disable authentication/subscription authorization.';
commit;
