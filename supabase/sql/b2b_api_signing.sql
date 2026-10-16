-- Additive signing workflow: completed provider evidence and private PDF artifact.
begin;
create table b2b_private.signing_sessions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references b2b_private.organizations,
 version text not null,signer_id uuid not null references auth.users,signer_email text not null,signer_name text not null,
 envelope_id uuid unique,created_at timestamptz not null default now(),lease_until timestamptz not null default now()+interval '60 seconds',completed boolean not null default false,
 unique(organization_id,version));
create table b2b_private.agreement_documents(
 envelope_id uuid primary key references b2b_private.signing_sessions(envelope_id),
 document_sha256 text not null,document bytea not null,created_at timestamptz not null default now());
alter table b2b_private.signing_sessions enable row level security;
alter table b2b_private.agreement_documents enable row level security;
revoke all on b2b_private.signing_sessions,b2b_private.agreement_documents from public;
create function public.b2b_api_signing(p_action text,p_actor uuid,p_org uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s b2b_private.signing_sessions; v_bytes bytea;
begin
 perform 1 from b2b_private.organizations where id=p_org for update;
 if not exists(select from b2b_private.memberships where organization_id=p_org and user_id=p_actor and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 select * into s from b2b_private.signing_sessions where organization_id=p_org and version=p_data->>'version';
 if p_action='read' then return to_jsonb(s); end if;
 if p_action='reserve' then
  if s.id is not null then
   if s.signer_id=p_actor and s.envelope_id is null and s.lease_until<now() and s.created_at>now()-interval '6 days' then
    update b2b_private.signing_sessions set lease_until=now()+interval '60 seconds' where id=s.id;
    return to_jsonb(s)||jsonb_build_object('acquired',true,'recover',true);
   end if;
   return to_jsonb(s)||jsonb_build_object('acquired',false);
  end if;
  if length(coalesce(p_data->>'version','')) not between 1 and 100 or length(coalesce(p_data->>'signer_name','')) not between 1 and 200 or length(coalesce(p_data->>'signer_email','')) not between 3 and 254 then raise exception 'Invalid signer'; end if;
  insert into b2b_private.signing_sessions(organization_id,version,signer_id,signer_email,signer_name) values(p_org,p_data->>'version',p_actor,p_data->>'signer_email',p_data->>'signer_name') returning * into s;
  insert into b2b_private.audit_logs(organization_id,actor_id,action,details) values(p_org,p_actor,'agreement.started',jsonb_build_object('version',s.version,'session_id',s.id));
  return to_jsonb(s)||jsonb_build_object('acquired',true);
 end if;
 if s.id is null or s.signer_id<>p_actor then raise exception 'Signing identity mismatch' using errcode='42501'; end if;
 if p_action='bind' then
  if s.id<>(p_data->>'session_id')::uuid or (s.envelope_id is not null and s.envelope_id<>(p_data->>'envelope_id')::uuid) then raise exception 'Envelope mismatch'; end if;
  update b2b_private.signing_sessions set envelope_id=(p_data->>'envelope_id')::uuid where id=s.id;
 elsif p_action='complete' then
  if s.completed then return '{"completed":true}'; end if;
  if s.envelope_id is null or s.envelope_id<>(p_data->>'envelope_id')::uuid or p_data->>'provider'<>'docusign' or s.signer_email<>p_data->>'signer_email' or s.signer_id<>(p_data->>'signer_id')::uuid or (p_data->>'signed_at')::timestamptz>now()+interval '5 seconds' or coalesce(p_data->>'document_reference','') not like 'private:b2b-agreements/%' then raise exception 'Completed provider evidence required'; end if;
  v_bytes:=decode(p_data->>'document_hex','hex');
  if octet_length(v_bytes) not between 5 and 10000000 or substring(v_bytes from 1 for 5)<>convert_to('%PDF-','UTF8') or encode(sha256(v_bytes),'hex')<>p_data->>'document_sha256' then raise exception 'Document digest mismatch'; end if;
  insert into b2b_private.agreement_documents values(s.envelope_id,p_data->>'document_sha256',v_bytes,now());
  insert into b2b_private.agreements(organization_id,version,signer_id,signer_email,signed_at,provider,envelope_id,document_sha256,document_reference) values(p_org,s.version,p_actor,s.signer_email,(p_data->>'signed_at')::timestamptz,'docusign',s.envelope_id::text,p_data->>'document_sha256',p_data->>'document_reference');
  update b2b_private.signing_sessions set completed=true where id=s.id;
  insert into b2b_private.audit_logs(organization_id,actor_id,action,details) values(p_org,p_actor,'agreement.completed',p_data-'document_hex'-'document_reference');
 else raise exception 'Unknown signing operation'; end if;
 return '{"ok":true}';
end $$;
revoke all on function public.b2b_api_signing(text,uuid,uuid,jsonb) from public;
grant execute on function public.b2b_api_signing(text,uuid,uuid,jsonb) to b2b_backend;
do $$ declare r text; begin for r in select rolname from pg_roles where rolname in('anon','authenticated','service_role') loop execute format('revoke all on function public.b2b_api_signing(text,uuid,uuid,jsonb) from %I',r); end loop; end $$;
commit;
