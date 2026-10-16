-- Website-only abuse control. Never changes subscriptions, hard quotas or prices.
begin;
create schema if not exists website_security;
revoke all on schema website_security from public,anon,authenticated,service_role;
create table website_security.control(id boolean primary key default true check(id),enabled boolean not null default false);
insert into website_security.control(id) values(true);
create table website_security.pro_visitors(
 user_id uuid primary key references auth.users(id) on delete cascade,
 admitted_at timestamptz[] not null default '{}',
 verified_until timestamptz,
 challenge uuid,challenge_expires timestamptz,
 attempts int not null default 0,blocked_until timestamptz,
 updated_at timestamptz not null default now());
alter table website_security.control enable row level security;
alter table website_security.pro_visitors enable row level security;
revoke all on all tables in schema website_security from public,anon,authenticated,service_role;
create function public.website_pro_human_control(p_user_id uuid,p_action text,p_challenge uuid default null,p_success boolean default false)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='4s' as $$
declare r website_security.pro_visitors%rowtype; t timestamptz; active boolean; n int; retry int;
begin
 if p_user_id is null or p_action not in('consume','claim','finish') then raise exception 'Invalid action';end if;
 select enabled into active from website_security.control where id for share;
 if active is not true then return jsonb_build_object('allowed',true,'disabled',true);end if;
 insert into website_security.pro_visitors(user_id) values(p_user_id) on conflict do nothing;
 select * into r from website_security.pro_visitors where user_id=p_user_id for update;
 t:=clock_timestamp();
 r.admitted_at:=array(select x from unnest(r.admitted_at) x where x>t-interval '60 seconds');
 n:=cardinality(r.admitted_at);
 if r.blocked_until>t then return jsonb_build_object('allowed',false,'code','RATE_LIMITED','retry',greatest(1,ceil(extract(epoch from r.blocked_until-t))::int));end if;
 if p_action='consume' then
  if n>=60 then return jsonb_build_object('allowed',false,'code','RATE_LIMITED','retry',greatest(1,ceil(extract(epoch from r.admitted_at[1]+interval '60 seconds'-t))::int));end if;
  if n<30 or r.verified_until>t then
   update website_security.pro_visitors set admitted_at=array_append(r.admitted_at,t),updated_at=t where user_id=p_user_id;
   return jsonb_build_object('allowed',true);
  end if;
  if r.challenge is null or r.challenge_expires<=t then
   r.challenge:=gen_random_uuid();r.challenge_expires:=t+interval '5 minutes';
   update website_security.pro_visitors set challenge=r.challenge,challenge_expires=r.challenge_expires,attempts=0,updated_at=t where user_id=p_user_id;
  end if;
  return jsonb_build_object('allowed',false,'code','HUMAN_VERIFICATION_REQUIRED','challenge',r.challenge,'retry',60);
 end if;
 if r.challenge is null or p_challenge is distinct from r.challenge or r.challenge_expires<=t then
  return jsonb_build_object('allowed',false,'code','INVALID_CHALLENGE','retry',60);
 end if;
 if p_action='claim' then
  if r.attempts>=3 then
   update website_security.pro_visitors set blocked_until=t+interval '5 minutes',challenge=null,challenge_expires=null,updated_at=t where user_id=p_user_id;
   return jsonb_build_object('allowed',false,'code','RATE_LIMITED','retry',300);
  end if;
  update website_security.pro_visitors set attempts=attempts+1,updated_at=t where user_id=p_user_id;
  return jsonb_build_object('allowed',true);
 end if;
 if p_success and r.attempts>0 then
  update website_security.pro_visitors set verified_until=t+interval '5 minutes',challenge=null,challenge_expires=null,attempts=0,updated_at=t where user_id=p_user_id;
  return jsonb_build_object('allowed',true);
 end if;
 return jsonb_build_object('allowed',false,'code','VERIFICATION_FAILED','retry',60);
end $$;
revoke all on function public.website_pro_human_control(uuid,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.website_pro_human_control(uuid,text,uuid,boolean) to service_role;
comment on table website_security.pro_visitors is 'Website verification only: bounded timestamps and nonce per authenticated Pro user; no IP, token, quote or payment data. Existing hard quotas execute separately.';
commit;
