-- REVIEW ONLY. Disable the new Worker/API flags FIRST; retain/export agreement,
-- billing, audit and usage records before destructive removal. Requires approval.
-- This file touches no existing Pro functions, source cache, auth users or schedules.
begin;
drop function if exists public.b2b_api_signing(text,uuid,uuid,jsonb);
drop function if exists public.b2b_api_source_snapshot();
drop function if exists public.b2b_api_review(uuid,text,text,jsonb);
drop function if exists public.b2b_api_response(text,uuid,int);
drop function if exists public.b2b_api_billing(text,uuid,jsonb);
drop function if exists public.b2b_api_cache_read(text,text);
drop function if exists public.b2b_api_cache_publish(text,jsonb);
drop function if exists public.b2b_api_meter(text,uuid,text,boolean);
drop function if exists public.b2b_api_key(text);
drop function if exists public.b2b_api_account(text,uuid,uuid,jsonb);
drop schema if exists b2b_private cascade;
-- Role cleanup deliberately separate: verify no other grants/dependencies first.
commit;
