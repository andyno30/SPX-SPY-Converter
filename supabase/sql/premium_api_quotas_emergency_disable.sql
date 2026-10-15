-- PREPARED ONLY. No production activation/migration is authorized by this file.
-- Run as the database owner/admin to disable quota enforcement without deploying
-- functions. This does not bypass JWT verification or current Pro membership.
-- COMMIT is the effective boundary: earlier accounting transactions can finish
-- first, and already in-flight HTTP responses may still arrive afterwards.
-- New accounting decisions after commit bypass quota and leave counters intact.
begin;
update public.premium_api_quota_control
set enabled = false, updated_at = clock_timestamp()
where resource in ('pro-prices', 'premium-options')
returning resource, enabled, updated_at;
commit;
