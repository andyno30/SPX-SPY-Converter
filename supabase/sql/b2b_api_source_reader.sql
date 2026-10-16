-- PROPOSED licensed-source bridge. DO NOT apply or use before explicit approval.
-- New restricted role can read only the existing cached row through this function.
-- It receives no table write grants and no permission to call any refresh RPC.
begin;
do $$ begin if not exists(select from pg_roles where rolname='b2b_source_reader') then create role b2b_source_reader nologin; end if; end $$;
create function public.b2b_api_source_snapshot() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('quotes',quotes,'fetched_at',fetched_at) from public.pro_price_cache where id=1;
$$;
revoke all on function public.b2b_api_source_snapshot() from public;
grant execute on function public.b2b_api_source_snapshot() to b2b_source_reader;
do $$ declare r text; begin for r in select rolname from pg_roles where rolname in('anon','authenticated','service_role') loop execute format('revoke all on function public.b2b_api_source_snapshot() from %I',r); end loop; end $$;
commit;
