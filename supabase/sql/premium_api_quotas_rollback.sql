-- PROPOSAL ONLY: FIRST commit premium_api_quotas_emergency_disable.sql and
-- verify normal paid reads. Keep both rollout flags off for later deployments.
-- Removes ONLY quota accounting; never touches users, billing, prices or options.
-- Keep the setup/scheduler migration to re-enable later; old counts are not restored.
begin;
do $$
declare v_job record;
begin
  if to_regclass('cron.job') is not null then
    for v_job in select jobid from cron.job where jobname = 'premium_api_quota_cleanup' loop
      perform cron.unschedule(v_job.jobid);
    end loop;
  end if;
end;
$$;
drop function if exists public.consume_premium_api_quota(uuid, text);
drop function if exists public.read_premium_api_quota_control(text);
drop function if exists public.purge_premium_api_quota_counters(integer);
drop table if exists public.premium_api_quota_counters;
drop table if exists public.premium_api_quota_control;
commit;
