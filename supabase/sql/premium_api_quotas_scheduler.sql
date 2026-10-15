-- PROPOSAL ONLY: run with the setup migration after approval.
-- Uses existing Supabase pg_cron. Does not install extensions or alter other jobs.
begin;
do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'premium_api_quota_cleanup' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('premium_api_quota_cleanup', '17 * * * *',
    'select public.purge_premium_api_quota_counters(1000)');
end;
$$;
commit;
