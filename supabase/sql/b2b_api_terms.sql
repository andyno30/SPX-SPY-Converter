-- Additive B2B clickwrap records. Historical signature tables remain unchanged.
begin;
create table b2b_private.terms_versions(
 version text primary key,document_text text not null,document_sha256 text not null,
 created_at timestamptz not null default now(),approved_at timestamptz,approved_by text,test_enabled boolean not null default false,
 check(document_sha256=encode(sha256(convert_to(document_text,'UTF8')),'hex')),
 check((approved_at is null and approved_by is null) or (approved_at is not null and length(approved_by)>0)));
create table b2b_private.terms_acceptances(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references b2b_private.organizations,
 user_id uuid not null references auth.users,email text not null,version text not null references b2b_private.terms_versions,
 document_sha256 text not null,accepted_at timestamptz not null default clock_timestamp(),request_id uuid not null,
 evidence jsonb not null,unique(organization_id,version));
alter table b2b_private.terms_versions enable row level security;
alter table b2b_private.terms_acceptances enable row level security;
revoke all on b2b_private.terms_versions,b2b_private.terms_acceptances from public,b2b_backend;

create function b2b_private.preserve_terms_version() returns trigger language plpgsql set search_path='' as $$
begin
 if new.version<>old.version or new.document_text<>old.document_text or new.document_sha256<>old.document_sha256 then raise exception 'Terms are immutable; publish a new version'; end if;
 return new;
end $$;
create trigger preserve_terms_version before update on b2b_private.terms_versions for each row execute function b2b_private.preserve_terms_version();

create function public.b2b_api_terms(p_action text,p_actor uuid,p_org uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v b2b_private.terms_versions; a b2b_private.terms_acceptances; identity_email text; verified_at timestamptz; is_live boolean;
begin
 if p_action<>'accept' then raise exception 'Unknown Terms action'; end if;
 perform 1 from b2b_private.organizations where id=p_org for update;
 if not exists(select from b2b_private.memberships where organization_id=p_org and user_id=p_actor and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 select email,email_confirmed_at into identity_email,verified_at from auth.users where id=p_actor;
 if identity_email is null or verified_at is null then raise exception 'Verified identity required' using errcode='42501'; end if;
 select * into v from b2b_private.terms_versions where version=p_data->>'version' for share;
 select livemode into is_live from b2b_private.subscriptions where organization_id=p_org;
 if v.version is null or is_live is null or (is_live and v.approved_at is null) or (not is_live and not v.test_enabled) or v.document_sha256 is distinct from p_data->>'document_sha256' then raise exception 'Approved Terms version required' using errcode='42501'; end if;
 select * into a from b2b_private.terms_acceptances where organization_id=p_org and version=v.version;
 if a.id is not null then return jsonb_build_object('accepted',true,'receipt_id',a.id,'version',a.version,'accepted_at',a.accepted_at,'duplicate',true); end if;
 insert into b2b_private.terms_acceptances(organization_id,user_id,email,version,document_sha256,request_id,evidence)
 values(p_org,p_actor,identity_email,v.version,v.document_sha256,(p_data->>'request_id')::uuid,
 jsonb_build_object('method','explicit-unchecked-checkbox','authenticated_provider','supabase','livemode',is_live,'origin',p_data->>'origin','observed_user_agent',left(p_data->>'user_agent',300),'statement','I accept the SpyConverter B2B API Terms on behalf of this organization.')) returning * into a;
 insert into b2b_private.agreements(organization_id,version,signer_id,signer_email,signed_at,provider,envelope_id,document_sha256,document_reference)
 values(p_org,v.version,p_actor,identity_email,a.accepted_at,'terms-acceptance','terms:'||a.id,v.document_sha256,'private:terms-versions/'||v.version);
 insert into b2b_private.audit_logs(organization_id,actor_id,action,details) values(p_org,p_actor,'terms.accepted',jsonb_build_object('receipt_id',a.id,'version',v.version,'document_sha256',v.document_sha256,'request_id',a.request_id));
 return jsonb_build_object('accepted',true,'receipt_id',a.id,'version',a.version,'accepted_at',a.accepted_at,'duplicate',false);
end $$;
revoke all on function public.b2b_api_terms(text,uuid,uuid,jsonb) from public;
grant execute on function public.b2b_api_terms(text,uuid,uuid,jsonb) to b2b_backend;
do $$ declare r text; begin for r in select rolname from pg_roles where rolname in('anon','authenticated','service_role') loop
 execute format('revoke all on b2b_private.terms_versions,b2b_private.terms_acceptances from %I',r);
 execute format('revoke all on function public.b2b_api_terms(text,uuid,uuid,jsonb) from %I',r);
end loop; end $$;
-- The database independently binds live checkout/keys to an approved version
-- and authenticated acceptance. Test approval can never authorize live access.
create function b2b_private.has_terms(p_org uuid,p_version text) returns boolean language sql security definer set search_path='' as $$
 select exists(select from b2b_private.terms_acceptances a join b2b_private.terms_versions v on v.version=a.version join b2b_private.subscriptions s on s.organization_id=a.organization_id
 where a.organization_id=p_org and a.version=p_version and a.document_sha256=v.document_sha256 and ((s.livemode and v.approved_at is not null) or (not s.livemode and v.test_enabled)))
$$;
revoke all on function b2b_private.has_terms(uuid,text),b2b_private.preserve_terms_version() from public;
-- Extend only the new B2B functions, preserving legacy signature records.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.b2b_api_account(text,uuid,uuid,jsonb)'::regprocedure);
 if position('provider in(''docusign'',''adobe-sign'')' in definition)=0 then raise exception 'Unexpected B2B account function; migration not applied'; end if;
 definition:=replace(definition,'provider in(''docusign'',''adobe-sign'')','provider in(''docusign'',''adobe-sign'',''terms-acceptance'')');
 definition:=replace(definition,'if p_action=''key.provision'' then','if p_action=''key.provision'' then
  if (s.livemode or exists(select from b2b_private.terms_versions where version=p_data->>''agreement_version'')) and not b2b_private.has_terms(p_org,p_data->>''agreement_version'') then return ''{"created":false}''; end if;');
 definition:=replace(definition,'elsif p_action=''key.create'' then','elsif p_action=''key.create'' then
  if (s.livemode or exists(select from b2b_private.terms_versions where version=p_data->>''agreement_version'')) and not b2b_private.has_terms(p_org,p_data->>''agreement_version'') then raise exception ''Terms acceptance required'' using errcode=''42501''; end if;');
 execute definition;
 definition:=pg_get_functiondef('public.b2b_api_billing(text,uuid,jsonb)'::regprocedure);
 if position('if p_action=''checkout.reserve'' then' in definition)=0 then raise exception 'Unexpected B2B billing function'; end if;
 definition:=replace(definition,'if p_action=''checkout.reserve'' then','if p_action=''checkout.reserve'' then
  if (s.livemode or exists(select from b2b_private.terms_versions where version=p_data->>''agreement_version'')) and not b2b_private.has_terms(p_org,p_data->>''agreement_version'') then raise exception ''Terms acceptance required'' using errcode=''42501''; end if;');
 execute definition;
end $$;
commit;
