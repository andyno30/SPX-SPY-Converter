-- Combine the existing per-request subscription and cache reads. Deploy this
-- before get-live-price-pro. No public access, writes, refreshes, or auth cache.
begin;

create or replace function public.read_pro_price_access_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'is_subscribed', coalesce(p.is_subscribed, false),
    'quotes', case when p.is_subscribed is true then c.quotes else null end,
    'fetched_at', case when p.is_subscribed is true then c.fetched_at else null end
  )
  from (values (p_user_id)) as requested(id)
  left join public.profiles p on p.id = requested.id
  left join public.pro_price_cache c on c.id = 1 and p.is_subscribed is true;
$$;

revoke all on function public.read_pro_price_access_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.read_pro_price_access_snapshot(uuid) to service_role;

comment on function public.read_pro_price_access_snapshot(uuid) is
  'Service-role-only subscription and Pro snapshot read. Caller must first verify the user with Supabase Auth. Never fetches Yahoo or changes the cache.';

commit;
