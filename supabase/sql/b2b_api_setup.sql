-- LOCAL REVIEW ONLY. Additive migration. No existing table/function/config changes.
-- Apply to an isolated database first. Production execution requires approval.
begin;
create schema b2b_private;
revoke all on schema b2b_private from public;
do $$ begin if not exists(select from pg_roles where rolname='b2b_backend') then create role b2b_backend nologin; end if; if not exists(select from pg_roles where rolname='b2b_cache_writer') then create role b2b_cache_writer nologin; end if; end $$;
create table b2b_private.organizations(
 id uuid primary key default gen_random_uuid(), name text not null, legal_name text not null,
 email text not null, intended_use text not null, created_by uuid not null references auth.users(id),
 business_approved boolean not null default false, suspended boolean not null default false,
 created_at timestamptz not null default now());
create table b2b_private.memberships(organization_id uuid references b2b_private.organizations on delete cascade,user_id uuid not null references auth.users(id),role text not null check(role in('owner','member')),primary key(organization_id,user_id));
create table b2b_private.subscriptions(organization_id uuid primary key references b2b_private.organizations,
 plan text not null check(plan in('developer','pro','business')),status text not null default 'pending',livemode boolean not null default false,
 stripe_customer_id text unique,stripe_subscription_id text unique,period_start timestamptz,period_end timestamptz,paid_through timestamptz,
 cancel_at_period_end boolean not null default false, last_event_created bigint not null default 0,
 sync_token uuid,sync_until timestamptz,checkout_token uuid,checkout_until timestamptz,checkout_expires_at timestamptz,checkout_plan text,checkout_session_id text);
create table b2b_private.keys(id uuid primary key default gen_random_uuid(),organization_id uuid not null references b2b_private.organizations,
 key_hash text not null unique check(length(key_hash)=64),prefix text not null,label text not null,mode text not null check(mode in('test','live')),
 created_at timestamptz not null default now(),revoked_at timestamptz);
create table b2b_private.agreements(id uuid primary key default gen_random_uuid(),organization_id uuid not null references b2b_private.organizations,
 version text not null,signer_id uuid not null,signer_email text not null,signed_at timestamptz not null,provider text not null,
 envelope_id text not null unique,document_sha256 text not null check(length(document_sha256)=64),document_reference text not null,
 unique(organization_id,version));
create table b2b_private.applications(id uuid primary key default gen_random_uuid(),organization_id uuid not null references b2b_private.organizations,
 plan text not null check(plan in('developer','pro','business')),intended_use text not null,status text not null default 'pending' check(status in('pending','approved','rejected')),
 created_at timestamptz not null default now(),reviewed_at timestamptz,reviewer text);
create table b2b_private.audit_logs(id bigint generated always as identity primary key,organization_id uuid references b2b_private.organizations,actor_id uuid,action text not null,details jsonb not null default '{}',created_at timestamptz not null default now());
create table b2b_private.usage_counters(organization_id uuid references b2b_private.organizations,period_start timestamptz,period_end timestamptz not null,used bigint not null default 0 check(used>=0),primary key(organization_id,period_start));
create table b2b_private.usage_records(request_id uuid primary key,organization_id uuid not null references b2b_private.organizations,key_id uuid not null references b2b_private.keys,
 fingerprint text not null,created_at timestamptz not null default clock_timestamp(),billable boolean not null,status integer not null,decision jsonb not null);
create index on b2b_private.usage_records(organization_id,created_at);
create table b2b_private.snapshots(mode text not null,selection text not null,body text not null,digest text not null,source_fetched_at timestamptz not null,copied_at timestamptz not null,evaluation_day text not null,provenance text not null,license_reference text,
 primary key(mode,selection),check((mode='test' and provenance='synthetic') or (mode='live' and provenance='licensed' and license_reference is not null)));
create table b2b_private.stripe_events(id text primary key,organization_id uuid not null references b2b_private.organizations,created bigint not null,processed_at timestamptz not null default now());
-- Defense in depth: no table is directly readable/writable by API identities.
do $$ declare t text; begin for t in select tablename from pg_tables where schemaname='b2b_private' loop execute format('alter table b2b_private.%I enable row level security',t); execute format('revoke all on b2b_private.%I from public',t); end loop; end $$;

create function public.b2b_api_account(p_action text,p_actor uuid,p_org uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare o b2b_private.organizations; s b2b_private.subscriptions; k b2b_private.keys; role_name text; result jsonb; new_id uuid; v_plan text; v_quota bigint; v_rate int; v_used bigint;
begin
 if p_actor is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 if p_action='create' then
  if length(coalesce(p_data->>'name','')) not between 1 and 120 or length(coalesce(p_data->>'legal_name','')) not between 1 and 200 or length(coalesce(p_data->>'email','')) not between 3 and 254 or length(coalesce(p_data->>'intended_use','')) not between 1 and 2000 or coalesce(p_data->>'plan','') not in('developer','pro','business') then raise exception 'Invalid organization'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,1));
  if (select count(*) from b2b_private.memberships where user_id=p_actor)>=5 then raise exception 'Organization limit reached'; end if;
  insert into b2b_private.organizations(name,legal_name,email,intended_use,created_by) values(p_data->>'name',p_data->>'legal_name',p_data->>'email',p_data->>'intended_use',p_actor) returning * into o;
  insert into b2b_private.memberships values(o.id,p_actor,'owner');
  insert into b2b_private.subscriptions(organization_id,plan,livemode) values(o.id,p_data->>'plan',coalesce((p_data->>'livemode')::boolean,false));
  insert into b2b_private.applications(organization_id,plan,intended_use) values(o.id,p_data->>'plan',o.intended_use);
  insert into b2b_private.audit_logs(organization_id,actor_id,action) values(o.id,p_actor,'organization.created');
  return to_jsonb(o);
 end if;
 if p_action='list' then return coalesce((select jsonb_agg(to_jsonb(x)) from(select orgs.id,orgs.name,m.role from b2b_private.organizations orgs join b2b_private.memberships m on m.organization_id=orgs.id where m.user_id=p_actor order by orgs.created_at)x),'[]'); end if;
 -- All mutations and owner checks serialize on one organization, preventing lost last owner/key races.
 select * into o from b2b_private.organizations where id=p_org for update;
 select role into role_name from b2b_private.memberships where organization_id=p_org and user_id=p_actor;
 if o.id is null or role_name is null then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into s from b2b_private.subscriptions where organization_id=p_org;
 if p_action='dashboard' then
  v_quota:=case s.plan when 'developer' then 10000 when 'pro' then 100000 else 500000 end;
  v_rate:=case s.plan when 'developer' then 10 when 'pro' then 30 else 120 end;
  select used into v_used from b2b_private.usage_counters where organization_id=p_org and period_start=s.period_start;
  return jsonb_build_object('organization',to_jsonb(o),'role',role_name,
   'subscription',to_jsonb(s)-array['sync_token','sync_until','checkout_token','checkout_until','checkout_session_id'],
   'usage',jsonb_build_object('used',coalesce(v_used,0),'quota',v_quota,'remaining',greatest(v_quota-coalesce(v_used,0),0),'per_minute',v_rate,'period_start',s.period_start,'period_end',s.period_end),
   'keys',coalesce((select jsonb_agg(to_jsonb(t)-'key_hash') from b2b_private.keys t where organization_id=p_org),'[]'),
   'members',coalesce((select jsonb_agg(to_jsonb(t)) from b2b_private.memberships t where organization_id=p_org),'[]'),
   'agreements',coalesce((select jsonb_agg(to_jsonb(t)-'document_reference') from b2b_private.agreements t where organization_id=p_org),'[]'),
   'applications',coalesce((select jsonb_agg(to_jsonb(t)) from b2b_private.applications t where organization_id=p_org),'[]'),
   'history',coalesce((select jsonb_agg(to_jsonb(t)) from(select * from b2b_private.usage_counters where organization_id=p_org order by period_start desc limit 12)t),'[]'),
   'daily_usage',coalesce((select jsonb_agg(to_jsonb(t)) from(select (created_at at time zone 'UTC')::date as day,count(*) as requests,count(*) filter(where status>=400) as errors,count(*) filter(where status=429) as rate_limits from b2b_private.usage_records where organization_id=p_org and created_at>=now()-interval '31 days' group by 1 order by 1)t),'[]'));
 end if;
 if role_name<>'owner' then raise exception 'Owner access required' using errcode='42501'; end if;
 if p_action='key.provision' then
  -- The organization lock makes first retrieval atomic across tabs/devices. Never
  -- auto-replace a revoked key, and never persist a retrievable plaintext secret.
  if exists(select from b2b_private.keys where organization_id=p_org and mode=p_data->>'mode') then return '{"created":false}'; end if;
  if s.livemode is distinct from (p_data->>'mode'='live') or o.suspended or s.status<>'active' or s.paid_through is null or s.paid_through<=now() or s.period_start is null or s.period_start>now() or s.period_end is null or s.period_end<=now() or (s.plan='business' and not o.business_approved) then return '{"created":false}'; end if;
  if not exists(select from b2b_private.agreements where organization_id=p_org and version=p_data->>'agreement_version' and (provider in('docusign','adobe-sign') or (provider='synthetic-test' and p_data->>'mode'='test'))) then return '{"created":false}'; end if;
  if coalesce(p_data->>'mode','') not in('test','live') then raise exception 'Invalid key'; end if;
  if (select count(*) from b2b_private.keys where organization_id=p_org and revoked_at is null)>=10 then return '{"created":false}'; end if;
  insert into b2b_private.keys(organization_id,key_hash,prefix,label,mode) values(p_org,p_data->>'key_hash',p_data->>'prefix','Initial application key',p_data->>'mode') returning * into k;
  insert into b2b_private.audit_logs(organization_id,actor_id,action,details) values(p_org,p_actor,p_action,jsonb_build_object('record_id',k.id));
  return jsonb_build_object('created',true,'record',to_jsonb(k)-'key_hash');
 elsif p_action='key.create' then
  if p_data->>'mode' not in('test','live') or length(coalesce(p_data->>'label','')) not between 1 and 80 then raise exception 'Invalid key'; end if;
  if s.livemode is distinct from (p_data->>'mode'='live') or o.suspended or s.status<>'active' or s.paid_through<=now() or s.period_end<=now() or s.period_start>now() or s.paid_through is null or s.period_end is null or s.period_start is null or (s.plan='business' and not o.business_approved) then raise exception 'Paid access required' using errcode='42501'; end if;
  if p_data->>'rotate_key_id' is not null then
   update b2b_private.keys set revoked_at=now() where id=(p_data->>'rotate_key_id')::uuid and organization_id=p_org and revoked_at is null;
   if not found then raise exception 'Key not found'; end if;
  end if;
  if (select count(*) from b2b_private.keys where organization_id=p_org and revoked_at is null)>=10 then raise exception 'Key limit reached'; end if;
  insert into b2b_private.keys(organization_id,key_hash,prefix,label,mode) values(p_org,p_data->>'key_hash',p_data->>'prefix',p_data->>'label',p_data->>'mode') returning * into k;
  result:=to_jsonb(k)-'key_hash';
 elsif p_action='key.revoke' then
  update b2b_private.keys set revoked_at=coalesce(revoked_at,now()) where id=(p_data->>'key_id')::uuid and organization_id=p_org returning * into k;
  if not found then raise exception 'Key not found'; end if;
  result:=to_jsonb(k)-'key_hash';
 elsif p_action='member.add' then
  if p_data->>'role' not in('owner','member') then raise exception 'Invalid role'; end if;
  insert into b2b_private.memberships values(p_org,(p_data->>'user_id')::uuid,p_data->>'role') on conflict(organization_id,user_id) do update set role=excluded.role;
  if not exists(select from b2b_private.memberships where organization_id=p_org and role='owner') then raise exception 'Last owner cannot be removed'; end if;
  result:='{"ok":true}';
 elsif p_action='member.remove' then
  delete from b2b_private.memberships where organization_id=p_org and user_id=(p_data->>'user_id')::uuid;
  if not exists(select from b2b_private.memberships where organization_id=p_org and role='owner') then raise exception 'Last owner cannot be removed'; end if;
  result:='{"ok":true}';
 elsif p_action='application' then
  insert into b2b_private.applications(organization_id,plan,intended_use) values(p_org,p_data->>'plan',p_data->>'intended_use') returning to_jsonb(applications.*) into result;
 else raise exception 'Unknown account action'; end if;
 insert into b2b_private.audit_logs(organization_id,actor_id,action,details) values(p_org,p_actor,p_action,jsonb_build_object('record_id',result->>'id'));
 return result;
end $$;

create function public.b2b_api_key(p_hash text) returns jsonb language sql security definer set search_path='' as $$ select to_jsonb(k) from b2b_private.keys k where key_hash=p_hash and revoked_at is null $$;
create function public.b2b_api_meter(p_hash text,p_request_id uuid,p_fingerprint text,p_billable boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k b2b_private.keys; o b2b_private.organizations; s b2b_private.subscriptions; prev b2b_private.usage_records; v_now timestamptz; v_used bigint:=0; v_count int; v_quota bigint; v_rate int; v_status int:=200; v_code text:='ok'; v_retry int; result jsonb;
begin
 select * into k from b2b_private.keys where key_hash=p_hash;
 if k.id is null then return '{"allowed":false,"status":401,"code":"invalid_key"}'; end if;
 select * into o from b2b_private.organizations where id=k.organization_id for update;
 -- Re-read revocation after acquiring the org lock used by key rotation.
 select * into k from b2b_private.keys where id=k.id;
 if k.revoked_at is not null then return '{"allowed":false,"status":401,"code":"invalid_key"}'; end if;
 v_now:=clock_timestamp();
 select * into prev from b2b_private.usage_records where request_id=p_request_id;
 if found then
  if prev.organization_id<>o.id or prev.key_id<>k.id or prev.fingerprint<>p_fingerprint or prev.billable<>p_billable then raise exception 'Request identity collision'; end if;
  return prev.decision || '{"replay":true}'::jsonb;
 end if;
 select * into s from b2b_private.subscriptions where organization_id=o.id;
 v_quota:=case s.plan when 'developer' then 10000 when 'pro' then 100000 when 'business' then 500000 end;
 v_rate:=case s.plan when 'developer' then 10 when 'pro' then 30 when 'business' then 120 end;
 if s.livemode is distinct from (k.mode='live') or o.suspended or s.status is distinct from 'active' or s.paid_through is null or s.paid_through<=v_now or s.period_end is null or s.period_end<=v_now or s.period_start is null or s.period_start>v_now or (s.plan='business' and not o.business_approved) then
  v_status:=403;v_code:='subscription_required';
 else
  insert into b2b_private.usage_counters values(o.id,s.period_start,s.period_end,0) on conflict do nothing;
  select used into v_used from b2b_private.usage_counters where organization_id=o.id and period_start=s.period_start;
  select count(*) into v_count from b2b_private.usage_records where organization_id=o.id and created_at>v_now-interval '60 seconds' and (decision->>'allowed')::boolean;
  if v_count>=v_rate then
   v_status:=429;v_code:='rate_limit';
   select greatest(1,ceil(extract(epoch from min(created_at)+interval '60 seconds'-v_now))::int) into v_retry from b2b_private.usage_records where organization_id=o.id and created_at>v_now-interval '60 seconds' and (decision->>'allowed')::boolean;
  elsif p_billable and v_used>=v_quota then v_status:=429;v_code:='monthly_quota';v_retry:=greatest(1,ceil(extract(epoch from s.period_end-v_now))::int);
  elsif p_billable then update b2b_private.usage_counters set used=used+1 where organization_id=o.id and period_start=s.period_start returning used into v_used;
  end if;
 end if;
 result:=jsonb_build_object('allowed',v_status=200,'status',v_status,'code',v_code,'used',v_used,'quota',v_quota,'remaining',greatest(v_quota-v_used,0),'per_minute',v_rate,'period_start',s.period_start,'period_end',s.period_end,'retry_after',v_retry,'replay',false,'organization_id',o.id);
 insert into b2b_private.usage_records values(p_request_id,o.id,k.id,p_fingerprint,v_now,p_billable,v_status,result);
 return result;
end $$;

create function public.b2b_api_cache_publish(p_mode text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; latest timestamptz; incoming timestamptz;
begin
 if jsonb_array_length(p_rows)=0 then raise exception 'Invalid cache action'; end if;
 perform pg_advisory_xact_lock(hashtextextended('b2b-cache-'||p_mode,2));
 incoming:=(p_rows->0->>'source_fetched_at')::timestamptz;
 select max(source_fetched_at) into latest from b2b_private.snapshots where mode=p_mode;
 if latest>incoming or (latest=incoming and exists(select from b2b_private.snapshots where mode=p_mode and copied_at>(p_rows->0->>'copied_at')::timestamptz)) then return '{"published":false}'; end if;
 if exists(select from jsonb_array_elements(p_rows) as item(value) where item.value->>'mode'<>p_mode or (item.value->>'source_fetched_at')::timestamptz<>incoming) then raise exception 'Mixed cache batch'; end if;
 delete from b2b_private.snapshots where mode=p_mode;
 for r in select * from jsonb_array_elements(p_rows) loop
  insert into b2b_private.snapshots values(r->>'mode',r->>'selection',r->>'body',r->>'digest',(r->>'source_fetched_at')::timestamptz,(r->>'copied_at')::timestamptz,r->>'evaluation_day',r->>'provenance',r->>'license_reference');
 end loop;
 return '{"published":true}';
end $$;

create function public.b2b_api_cache_read(p_mode text,p_selection text) returns jsonb language sql security definer set search_path='' as $$ select to_jsonb(s) from b2b_private.snapshots s where mode=p_mode and selection=p_selection $$;
revoke all on function public.b2b_api_cache_publish(text,jsonb) from public;
grant execute on function public.b2b_api_cache_publish(text,jsonb) to b2b_cache_writer;

create function public.b2b_api_billing(p_action text,p_org uuid,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare o b2b_private.organizations; s b2b_private.subscriptions; token uuid; snap jsonb; event_time bigint;
begin
 select * into o from b2b_private.organizations where id=p_org for update;
 if o.id is null then raise exception 'Organization missing'; end if;
 select * into s from b2b_private.subscriptions where organization_id=p_org for update;
 if p_action='read' then return jsonb_build_object('organization',to_jsonb(o),'subscription',to_jsonb(s),'agreements',coalesce((select jsonb_agg(to_jsonb(a)) from b2b_private.agreements a where organization_id=p_org),'[]')); end if;
 if p_action='checkout.reserve' then
  if s.status in('active','past_due','unpaid','incomplete') or s.stripe_subscription_id is not null then return '{"allowed":false}'; end if;
  if s.checkout_until>now() then
   if s.checkout_plan<>p_data->>'plan' then return '{"allowed":false}'; end if;
   return jsonb_build_object('allowed',true,'token',s.checkout_token,'expires_at',floor(extract(epoch from s.checkout_expires_at)),'customer_id',s.stripe_customer_id,'session_id',s.checkout_session_id);
  end if;
  token:=gen_random_uuid();
  update b2b_private.subscriptions set checkout_token=token,checkout_until=now()+interval '24 hours',checkout_expires_at=now()+interval '1 hour',checkout_plan=p_data->>'plan',checkout_session_id=null where organization_id=p_org returning * into s;
  return jsonb_build_object('allowed',true,'token',token,'expires_at',floor(extract(epoch from s.checkout_expires_at)),'customer_id',s.stripe_customer_id);
 elsif p_action='checkout.finish' then
  if s.checkout_token is distinct from (p_data->>'token')::uuid or s.checkout_until<=now() then raise exception 'Checkout lease expired'; end if;
  update b2b_private.subscriptions set stripe_customer_id=p_data->>'customer_id',checkout_session_id=p_data->>'session_id' where organization_id=p_org;
 elsif p_action='sync.claim' then
  if exists(select from b2b_private.stripe_events where id=p_data->>'event_id') then return '{"duplicate":true}'; end if;
  if s.sync_until>now() then return '{"acquired":false}'; end if;
  token:=gen_random_uuid();update b2b_private.subscriptions set sync_token=token,sync_until=now()+interval '120 seconds' where organization_id=p_org;
  return jsonb_build_object('acquired',true,'token',token);
 elsif p_action='sync.release' then
  update b2b_private.subscriptions set sync_token=null,sync_until=null where organization_id=p_org and sync_token=(p_data->>'token')::uuid;
 elsif p_action='sync.apply' then
  if s.sync_token is distinct from (p_data->>'token')::uuid or s.sync_until<=now() then raise exception 'Sync lease expired'; end if;
  if exists(select from b2b_private.stripe_events where id=p_data->>'event_id') then return '{"duplicate":true}'; end if;
  snap:=p_data->'snapshot';event_time:=(p_data->>'event_created')::bigint;
  if s.livemode is distinct from (snap->>'livemode')::boolean then raise exception 'Billing environment mismatch' using errcode='42501'; end if;
  if s.stripe_customer_id is distinct from snap->>'stripe_customer_id' then raise exception 'Customer mismatch'; end if;
  if s.stripe_subscription_id is not null and s.stripe_subscription_id<>snap->>'stripe_subscription_id' then raise exception 'Subscription mismatch'; end if;
  -- Snapshots are canonical Stripe reads under a fenced lease, not event payload state.
  update b2b_private.subscriptions set plan=snap->>'plan',status=snap->>'status',stripe_subscription_id=snap->>'stripe_subscription_id',
   period_start=(snap->>'period_start')::timestamptz,period_end=(snap->>'period_end')::timestamptz,paid_through=(snap->>'paid_through')::timestamptz,
   cancel_at_period_end=coalesce((snap->>'cancel_at_period_end')::boolean,false),last_event_created=greatest(last_event_created,event_time),sync_token=null,sync_until=null where organization_id=p_org;
  if coalesce((snap->>'suspended')::boolean,false) then update b2b_private.organizations set suspended=true where id=p_org; end if;
  insert into b2b_private.stripe_events(id,organization_id,created) values(p_data->>'event_id',p_org,event_time);
  insert into b2b_private.audit_logs(organization_id,action,details) values(p_org,'billing.sync',jsonb_build_object('event_id',p_data->>'event_id'));
 else raise exception 'Unknown billing action'; end if;
 return '{"ok":true}';
end $$;
create function public.b2b_api_response(p_hash text,p_request_id uuid,p_status int) returns void language sql security definer set search_path='' as $$
 update b2b_private.usage_records r set status=p_status from b2b_private.keys k where r.request_id=p_request_id and r.key_id=k.id and k.key_hash=p_hash and p_status between 100 and 599;
$$;
revoke all on function public.b2b_api_response(text,uuid,int) from public;
grant execute on function public.b2b_api_response(text,uuid,int) to b2b_backend;
-- Explicitly revoke default PUBLIC function execution before granting the narrow role.
revoke all on function public.b2b_api_account(text,uuid,uuid,jsonb),public.b2b_api_key(text),public.b2b_api_meter(text,uuid,text,boolean),public.b2b_api_cache_read(text,text),public.b2b_api_billing(text,uuid,jsonb) from public;
grant execute on function public.b2b_api_account(text,uuid,uuid,jsonb),public.b2b_api_key(text),public.b2b_api_meter(text,uuid,text,boolean),public.b2b_api_cache_read(text,text),public.b2b_api_billing(text,uuid,jsonb) to b2b_backend;
-- Supabase projects may automatically grant new public functions to these roles.
-- Revoking PUBLIC alone does not remove their direct default-privilege grants.
do $$ declare r text; f text; begin
 for r in select rolname from pg_roles where rolname in('anon','authenticated','service_role') loop
  execute format('revoke all on schema b2b_private from %I',r);
  execute format('revoke all on all tables in schema b2b_private from %I',r);
  execute format('revoke all on all sequences in schema b2b_private from %I',r);
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'b2b_api_%' loop
   execute format('revoke all on function %s from %I',f,r);
  end loop;
 end loop;
end $$;
commit;
