-- Anonymous Free calculator only. No source data or Pro/B2B quota changes.
begin;
create schema if not exists website_security;
revoke all on schema website_security from public,anon,authenticated,service_role;
alter table website_security.control add column free_enabled boolean not null default false;
create table website_security.free_visitors(
 visitor_id text primary key check(visitor_id ~ '^[a-f0-9]{64}$'),
 admitted_at timestamptz[] not null default '{}',
 verified_until timestamptz,
 challenge uuid,challenge_expires timestamptz,
 attempts int not null default 0,blocked_until timestamptz,
 updated_at timestamptz not null default now());
create index free_visitors_retention on website_security.free_visitors(updated_at);
alter table website_security.control enable row level security;
alter table website_security.free_visitors enable row level security;
revoke all on all tables in schema website_security from public,anon,authenticated,service_role;
create function public.website_free_human_control(p_visitor_id text,p_action text,p_challenge uuid default null,p_success boolean default false)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='4s' as $$
declare r website_security.free_visitors%rowtype; t timestamptz; active boolean; n int; retry int;
begin
 if p_visitor_id is null or p_visitor_id !~ '^[a-f0-9]{64}$' or p_action not in('consume','claim','finish') then raise exception 'Invalid action';end if;
 select free_enabled into active from website_security.control where id for share;
 if active is not true then return jsonb_build_object('allowed',true,'disabled',true);end if;
 -- Bounded opportunistic retention; active rows and blocks are retained.
 delete from website_security.free_visitors where visitor_id in (select visitor_id from website_security.free_visitors where updated_at<now()-interval '1 day' limit 20);
 insert into website_security.free_visitors(visitor_id) values(p_visitor_id) on conflict do nothing;
 select * into r from website_security.free_visitors where visitor_id=p_visitor_id for update;
 t:=clock_timestamp();
 r.admitted_at:=array(select x from unnest(r.admitted_at) x where x>t-interval '60 seconds');
 n:=cardinality(r.admitted_at);
 if r.blocked_until>t then return jsonb_build_object('allowed',false,'code','RATE_LIMITED','retry',greatest(1,ceil(extract(epoch from r.blocked_until-t))::int));end if;
 if p_action='consume' then
  if n>=20 then return jsonb_build_object('allowed',false,'code','RATE_LIMITED','retry',greatest(1,ceil(extract(epoch from r.admitted_at[1]+interval '60 seconds'-t))::int));end if;
  if n<10 or r.verified_until>t then
   update website_security.free_visitors set admitted_at=array_append(r.admitted_at,t),updated_at=t where visitor_id=p_visitor_id;
   return jsonb_build_object('allowed',true);
  end if;
  if r.challenge is null or r.challenge_expires<=t then
   r.challenge:=gen_random_uuid();r.challenge_expires:=t+interval '5 minutes';
   update website_security.free_visitors set challenge=r.challenge,challenge_expires=r.challenge_expires,attempts=0,updated_at=t where visitor_id=p_visitor_id;
  end if;
  return jsonb_build_object('allowed',false,'code','HUMAN_VERIFICATION_REQUIRED','challenge',r.challenge,'retry',60);
 end if;
 if r.challenge is null or p_challenge is distinct from r.challenge or r.challenge_expires<=t then
  return jsonb_build_object('allowed',false,'code','INVALID_CHALLENGE','retry',60);
 end if;
 if p_action='claim' then
  if r.attempts>=1 then
   update website_security.free_visitors set blocked_until=t+interval '5 minutes',challenge=null,challenge_expires=null,updated_at=t where visitor_id=p_visitor_id;
   return jsonb_build_object('allowed',false,'code','RATE_LIMITED','retry',300);
  end if;
  update website_security.free_visitors set attempts=attempts+1,updated_at=t where visitor_id=p_visitor_id;
  return jsonb_build_object('allowed',true);
 end if;
 if p_success and r.attempts>0 then
  update website_security.free_visitors set verified_until=t+interval '5 minutes',challenge=null,challenge_expires=null,attempts=0,updated_at=t where visitor_id=p_visitor_id;
  return jsonb_build_object('allowed',true);
 end if;
 update website_security.free_visitors set blocked_until=t+interval '5 minutes',challenge=null,challenge_expires=null,updated_at=t where visitor_id=p_visitor_id;
 return jsonb_build_object('allowed',false,'code','VERIFICATION_FAILED','retry',300);
end $$;
revoke all on function public.website_free_human_control(text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.website_free_human_control(text,text,uuid,boolean) to service_role;
comment on table website_security.free_visitors is 'Free calculator: HMAC network identity only, bounded rolling timestamps. No raw IP, tokens, quotes or account data. 10/minute, verified ceiling 20/minute, failed verification blocks 5 minutes.';
commit;
