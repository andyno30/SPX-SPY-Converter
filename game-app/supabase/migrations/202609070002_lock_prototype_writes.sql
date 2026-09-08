-- Public hosting preview: preserve schema, but disable prototype reward writes.
-- A future migration must introduce server-validated commands before reopening writes.
begin;
revoke all on function public.commit_arpia_save(uuid,bigint,jsonb) from public, anon, authenticated;
comment on function public.commit_arpia_save(uuid,bigint,jsonb) is
  'Disabled in hosted projects. Future server-validated reward commands are required for public gameplay.';
commit;
