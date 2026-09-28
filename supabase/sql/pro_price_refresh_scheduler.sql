-- Install after pro_price_cache_setup.sql and the refresh-pro-prices function.
-- The database owner must first seed the named Vault secret through a secure
-- path; do not paste its value into this file or the stored cron command.
-- Then run: select public.configure_pro_price_refresh_schedule('https://YOUR_PROJECT_REF.supabase.co');
-- Only the dedicated Pro job is replaced. News/options jobs are untouched.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.configure_pro_price_refresh_schedule(p_project_url text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job record;
  v_job_id bigint;
  v_command text;
begin
  if p_project_url is null
     or p_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/?$' then
    raise exception 'Supply the HTTPS Supabase project URL without a path' using errcode = '22023';
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'pro_prices_updater_service_role'
      and decrypted_secret is not null
      and decrypted_secret <> ''
  ) then
    raise exception 'Seed Vault secret pro_prices_updater_service_role before enabling the Pro updater';
  end if;

  -- Vault is read when the job runs, so rotating the secret does not require
  -- putting a credential into cron.job or recreating this schedule.
  v_command := format($command$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'pro_prices_updater_service_role'
          limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 45000
    );
  $command$, rtrim(p_project_url, '/') || '/functions/v1/refresh-pro-prices');

  for v_job in
    select jobid from cron.job where jobname = 'pro_price_refresh_every_minute'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  select cron.schedule('pro_price_refresh_every_minute', '* * * * *', v_command)
  into v_job_id;
  return v_job_id;
end;
$$;

-- Scheduling is an administrative operation, never available to API clients.
revoke all on function public.configure_pro_price_refresh_schedule(text)
  from public, anon, authenticated, service_role;

commit;
