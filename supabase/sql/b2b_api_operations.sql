-- Additive private B2B operations. No original cache/updater/schedule is changed.
begin;
alter table b2b_private.snapshots drop constraint snapshots_check;
alter table b2b_private.snapshots add constraint snapshots_check check(
 (mode='test' and provenance='synthetic') or
 (mode='live' and provenance='pending_review' and license_reference is null) or
 (mode='live' and provenance='licensed' and length(license_reference)>0));
create table b2b_private.cache_health(
 id boolean primary key default true check(id),last_attempt_at timestamptz,last_success_at timestamptz,
 last_digest text,last_error text,successes bigint not null default 0,failures bigint not null default 0);
alter table b2b_private.cache_health enable row level security;
revoke all on b2b_private.cache_health from public,b2b_backend,b2b_cache_writer;
create function public.b2b_api_cache_copy_result(p_ok boolean,p_digest text,p_error text) returns void
language plpgsql security definer set search_path='' as $$ begin
 insert into b2b_private.cache_health(id,last_attempt_at,last_success_at,last_digest,last_error,successes,failures)
 values(true,clock_timestamp(),case when p_ok then clock_timestamp() end,case when p_ok then p_digest end,case when not p_ok then left(p_error,50) end,case when p_ok then 1 else 0 end,case when p_ok then 0 else 1 end)
 on conflict(id) do update set last_attempt_at=excluded.last_attempt_at,
 last_success_at=coalesce(excluded.last_success_at,cache_health.last_success_at),last_digest=coalesce(excluded.last_digest,cache_health.last_digest),
 last_error=excluded.last_error,successes=cache_health.successes+excluded.successes,failures=cache_health.failures+excluded.failures;
end $$;
revoke all on function public.b2b_api_cache_copy_result(boolean,text,text) from public;
grant execute on function public.b2b_api_cache_copy_result(boolean,text,text) to b2b_cache_writer;
create function public.b2b_api_operations() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('checked_at',now(),'database_bytes',pg_database_size(current_database()),
 'b2b_bytes',(select coalesce(sum(pg_total_relation_size(c.oid)),0) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='b2b_private' and c.relkind='r'),
 'cache_health',(select to_jsonb(h) from b2b_private.cache_health h),
 'source_age_seconds',(select extract(epoch from(now()-max(source_fetched_at))) from b2b_private.snapshots where mode='live'),
 'live_snapshots',(select count(*) from b2b_private.snapshots where mode='live'),
 'provenance',(select min(provenance) from b2b_private.snapshots where mode='live'),
 'recent_server_errors',(select count(*) from b2b_private.usage_records where created_at>now()-interval '1 hour' and status>=500),
 'active_paid_organizations',(select count(*) from b2b_private.subscriptions where livemode and status='active' and paid_through>now()))
$$;
revoke all on function public.b2b_api_operations() from public;
-- Operator-only, bounded maintenance. Never removes counters, payments, Terms,
-- signatures or audit records. Preserve 90 days of request detail by default.
create function public.b2b_api_prune_requests(p_days int default 90,p_limit int default 10000) returns bigint
language plpgsql security definer set search_path='' as $$ declare n bigint; begin
 if p_days<90 or p_limit<1 or p_limit>10000 then raise exception 'Unsafe retention bounds'; end if;
 delete from b2b_private.usage_records where request_id in(select request_id from b2b_private.usage_records where created_at<now()-make_interval(days=>p_days) order by created_at limit p_limit);
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.b2b_api_prune_requests(int,int) from public;
do $$ declare r text; begin for r in select rolname from pg_roles where rolname in('anon','authenticated','service_role') loop
 execute format('revoke all on b2b_private.cache_health from %I',r);
 execute format('revoke all on function public.b2b_api_cache_copy_result(boolean,text,text),public.b2b_api_operations(),public.b2b_api_prune_requests(int,int) from %I',r);
end loop; end $$;
commit;
