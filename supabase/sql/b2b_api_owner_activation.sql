-- Additive provenance for explicitly owner-authorized delivery. It does not
-- record, infer or assert that a third-party market-data license was verified.
begin;
alter table b2b_private.snapshots add column owner_authorization_reference text;
alter table b2b_private.snapshots drop constraint snapshots_check;
alter table b2b_private.snapshots add constraint snapshots_check check(
 (mode='test' and provenance='synthetic' and license_reference is null and owner_authorization_reference is null) or
 (mode='live' and provenance='pending_review' and license_reference is null and owner_authorization_reference is null) or
 (mode='live' and provenance='licensed' and license_reference is not null and length(license_reference)>0 and owner_authorization_reference is null) or
 (mode='live' and provenance='owner_authorized' and license_reference is null and owner_authorization_reference is not null and length(owner_authorization_reference)>0));

create or replace function public.b2b_api_cache_publish(p_mode text,p_rows jsonb) returns jsonb
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
  insert into b2b_private.snapshots(mode,selection,body,digest,source_fetched_at,copied_at,evaluation_day,provenance,license_reference,owner_authorization_reference)
  values(r->>'mode',r->>'selection',r->>'body',r->>'digest',(r->>'source_fetched_at')::timestamptz,(r->>'copied_at')::timestamptz,r->>'evaluation_day',r->>'provenance',r->>'license_reference',r->>'owner_authorization_reference');
 end loop;
 return '{"published":true}';
end $$;
revoke all on function public.b2b_api_cache_publish(text,jsonb) from public,anon,authenticated,service_role,b2b_backend;
grant execute on function public.b2b_api_cache_publish(text,jsonb) to b2b_cache_writer;
comment on column b2b_private.snapshots.owner_authorization_reference is 'Explicit owner instruction authorizing delivery; not evidence of third-party licensing verification.';
commit;
