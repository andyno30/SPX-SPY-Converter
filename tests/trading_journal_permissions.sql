-- Run through an administrative SQL connection. Every test write is rolled back.
begin;
select set_config('journal.test_owner', (select user_id::text from public.trading_journal_owner), true);
select set_config('journal.test_entry', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('journal.test_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if not public.is_trading_journal_owner() then raise exception 'Owner rejected'; end if;
  insert into public.trading_journal_entries (id, market, entry_date, description)
    values (current_setting('journal.test_entry')::uuid, 'options', '2026-10-05', 'Permission test');
  update public.trading_journal_entries set description = 'Owner edit succeeds'
    where id = current_setting('journal.test_entry')::uuid;
  if not found then raise exception 'Owner edit rejected'; end if;
  begin
    update public.trading_journal_entries set created_at = now()
      where id = current_setting('journal.test_entry')::uuid;
    raise exception 'Owner can rewrite creation order';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.trading_journal_owner;
    raise exception 'Owner membership table exposed';
  exception when insufficient_privilege then null;
  end;
  insert into storage.objects (bucket_id, name)
    values ('trading-journal', current_setting('journal.test_owner') || '/' || current_setting('journal.test_entry') || '/test.png');
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if public.is_trading_journal_owner() then raise exception 'Other user is owner'; end if;
  if not exists (select 1 from public.trading_journal_entries where id = current_setting('journal.test_entry')::uuid) then
    raise exception 'Other user cannot read';
  end if;
  begin
    insert into public.trading_journal_entries (market, entry_date, description)
      values ('futures', '2026-10-05', 'Unauthorized entry');
    raise exception 'Other user can insert';
  exception when insufficient_privilege then null;
  end;
  update public.trading_journal_entries set description = 'Unauthorized edit'
    where id = current_setting('journal.test_entry')::uuid;
  if found then raise exception 'Other user can edit'; end if;
  begin
    insert into storage.objects (bucket_id, name)
      values ('trading-journal', '00000000-0000-4000-8000-000000000001/test.png');
    raise exception 'Other user can upload';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  if public.is_trading_journal_owner() then raise exception 'Anonymous visitor is owner'; end if;
  if not exists (select 1 from public.trading_journal_entries where id = current_setting('journal.test_entry')::uuid) then
    raise exception 'Anonymous visitor cannot read';
  end if;
  begin
    insert into public.trading_journal_entries (market, entry_date, description)
      values ('options', '2026-10-05', 'Unauthorized entry');
    raise exception 'Anonymous visitor can insert';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.trading_journal_entries set description = 'Unauthorized edit'
      where id = current_setting('journal.test_entry')::uuid;
    raise exception 'Anonymous visitor can edit';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('trading-journal', 'anonymous/test.png');
    raise exception 'Anonymous visitor can upload';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select 'Owner writes, public reads, unauthorized writes denied' as permissions_test;
rollback;
