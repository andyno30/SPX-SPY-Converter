-- Additive operator-only workflows. Never grant b2b_reviewer to browser identities
-- or the customer-facing Worker. Apply only to the isolated test DB until approved.
begin;
do $$ begin if not exists(select from pg_roles where rolname='b2b_reviewer') then create role b2b_reviewer nologin; end if; end $$;
create function public.b2b_api_review(p_org uuid,p_reviewer text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_app b2b_private.applications;
begin
 if length(coalesce(p_reviewer,''))<3 then raise exception 'Named reviewer required'; end if;
 perform 1 from b2b_private.organizations where id=p_org for update;
 if not found then raise exception 'Organization missing'; end if;
 if p_action='business.approve' or p_action='business.reject' then
  select * into v_app from b2b_private.applications where id=(p_data->>'application_id')::uuid and organization_id=p_org and plan='business';
  if not found then raise exception 'Business application missing'; end if;
  update b2b_private.applications set status=case when p_action='business.approve' then 'approved' else 'rejected' end,reviewed_at=now(),reviewer=p_reviewer where id=v_app.id;
  update b2b_private.organizations set business_approved=p_action='business.approve' where id=p_org;
 elsif p_action='agreement.record' then
  if coalesce(p_data->>'provider','') not in('docusign','adobe-sign') or coalesce(p_data->>'document_sha256','') !~ '^[0-9a-f]{64}$' or coalesce(p_data->>'envelope_id','')='' or coalesce(p_data->>'document_reference','') not like 'private:%' or coalesce(p_data->>'version','')='' or coalesce(p_data->>'signer_email','')='' or coalesce(p_data->>'signed_at','')='' then raise exception 'Completed provider evidence required'; end if;
  if (p_data->>'signed_at')::timestamptz>now()+interval '5 seconds' then raise exception 'Invalid signing timestamp'; end if;
  if not exists(select from b2b_private.memberships where organization_id=p_org and user_id=(p_data->>'signer_id')::uuid and role='owner') then raise exception 'Signer must be organization owner'; end if;
  insert into b2b_private.agreements(organization_id,version,signer_id,signer_email,signed_at,provider,envelope_id,document_sha256,document_reference)
   values(p_org,p_data->>'version',(p_data->>'signer_id')::uuid,p_data->>'signer_email',(p_data->>'signed_at')::timestamptz,p_data->>'provider',p_data->>'envelope_id',p_data->>'document_sha256',p_data->>'document_reference');
 else raise exception 'Unknown review action'; end if;
 insert into b2b_private.audit_logs(organization_id,action,details) values(p_org,p_action,jsonb_build_object('reviewer',p_reviewer,'evidence',p_data-'document_reference'));
 return '{"ok":true}';
end $$;
revoke all on function public.b2b_api_review(uuid,text,text,jsonb) from public;
grant execute on function public.b2b_api_review(uuid,text,text,jsonb) to b2b_reviewer;
do $$ declare r text; begin for r in select rolname from pg_roles where rolname in('anon','authenticated','service_role') loop execute format('revoke all on function public.b2b_api_review(uuid,text,text,jsonb) from %I',r); end loop; end $$;
commit;
