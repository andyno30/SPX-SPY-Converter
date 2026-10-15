// Real PostgreSQL, separate server processes/connections; never a production URL.
// Start tests/helpers/premium-quota-postgres-runtime.cjs first. See the companion
// runbook for the temporary dependency install and cleanup commands.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const runtime = require('./helpers/premium-quota-postgres-runtime.cjs');
const { Client } = require(runtime.pgModule);

const sql = name => readFileSync(join(__dirname, '../supabase/sql', name), 'utf8');
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('isolated PostgreSQL quota transactions and access controls', { timeout: 150000 }, async t => {
  const database = `spy_quota_concurrency_${process.pid}_${Date.now()}`;
  const control = new Client(runtime.getConfig());
  const connections = new Set();
  let created = false;
  await control.connect();
  t.after(async () => {
    for (const c of connections) {
      await c.query('rollback; select pg_advisory_unlock_all()').catch(() => {});
      await c.end().catch(() => {});
    }
    if (created) await control.query(`drop database ${database} with (force)`);
    await control.end();
  });
  t.diagnostic(await runtime.verifyCluster());
  await control.query(`create database ${database}`);
  created = true;
  async function connect(role = null, label = 'quota-test') {
    const c = new Client({ ...runtime.getConfig(database), application_name: label });
    await c.connect();
    connections.add(c);
    c.pid = (await c.query('select pg_backend_pid() as pid')).rows[0].pid;
    if (role) {
      assert.ok(['anon', 'authenticated', 'service_role', 'quota_untrusted'].includes(role));
      await c.query(`set role ${role}`);
    }
    return c;
  }
  async function close(c) { connections.delete(c); await c.end(); }
  const admin = await connect();
  await admin.query(`
    do $$ begin
      if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
      if not exists(select from pg_roles where rolname='quota_untrusted') then create role quota_untrusted; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role, quota_untrusted;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key references auth.users, is_pro boolean not null);
    create table public.subscriptions(user_id uuid primary key references auth.users, status text not null, valid_until timestamptz not null);
    insert into auth.users select ('10000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid from generate_series(1,40) n;
    insert into public.profiles select id,true from auth.users;
    insert into public.subscriptions select id,'active','2030-01-01Z'::timestamptz from auth.users;
  `);
  const subscriberSnapshot = async () => (await admin.query(`select jsonb_build_object(
    'users',(select jsonb_agg(u order by id) from auth.users u),
    'profiles',(select jsonb_agg(p order by id) from public.profiles p),
    'subscriptions',(select jsonb_agg(s order by user_id) from public.subscriptions s)) as snapshot`)).rows[0].snapshot;
  const baselineSubscribers = await subscriberSnapshot();
  await admin.query(sql('premium_api_quotas_setup.sql'));
  const service = await connect('service_role');
  const consume = async (c, user, resource = 'pro-prices') =>
    (await c.query('select public.consume_premium_api_quota($1,$2) as result', [id(user), resource])).rows[0].result;
  const readControl = async (c, resource = 'pro-prices') =>
    (await c.query('select public.read_premium_api_quota_control($1) as result', [resource])).rows[0].result;
  const count = async (user, resource = 'pro-prices') =>
    (await admin.query('select minute_count,hour_count from public.premium_api_quota_counters where user_id=$1 and resource=$2', [id(user), resource])).rows[0];
  const enable = async value => admin.query('update public.premium_api_quota_control set enabled=$1', [value]);
  const purge = async (c, batch = 1000) =>
    (await c.query('select public.purge_premium_api_quota_counters($1) as n', [batch])).rows[0].n;
  async function seed(user, resource = 'pro-prices', minuteCount = 0, hourCount = 0, minuteAge = '0 minute', hourAge = '0 hour') {
    await admin.query(`insert into public.premium_api_quota_counters
      (user_id,resource,minute_start,minute_count,hour_start,hour_count,updated_at)
      values ($1,$2,date_trunc('minute',clock_timestamp())-$5::interval,$3,
        date_trunc('hour',clock_timestamp())-$6::interval,$4,clock_timestamp())
      on conflict (user_id,resource) do update set minute_start=excluded.minute_start,
        minute_count=excluded.minute_count,hour_start=excluded.hour_start,hour_count=excluded.hour_count,updated_at=excluded.updated_at`,
    [id(user), resource, minuteCount, hourCount, minuteAge, hourAge]);
  }
  async function until(predicate, description, timeout = 5000) {
    const deadline = Date.now() + timeout;
    do { if (await predicate()) return; await sleep(10); } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${description}`);
  }
  async function waitLocked(pids, event = null) {
    await until(async () => (await admin.query(`select count(*)::int as n from pg_stat_activity
      where pid=any($1::int[]) and wait_event_type='Lock' and ($2::text is null or wait_event=$2)`, [pids, event])).rows[0].n === pids.length,
    `${pids.length} independent blocked backends`);
  }
  async function avoidMinuteRollover() {
    const remaining = Number((await admin.query("select extract(epoch from date_trunc('minute',clock_timestamp())+interval '1 minute'-clock_timestamp())*1000 as ms")).rows[0].ms);
    if (remaining < 10000) await sleep(remaining + 50);
  }

  await t.test('migration defaults disabled; disabled/missing control bypasses accounting', async () => {
    assert.deepEqual(await readControl(service), { enabled: false });
    assert.deepEqual(await readControl(service, 'premium-options'), { enabled: false });
    assert.deepEqual(await consume(service, 1), { allowed: true, retry_after_seconds: 0 });
    assert.equal(await count(1), undefined);
    await admin.query("delete from public.premium_api_quota_control where resource='premium-options'");
    assert.equal(await readControl(service, 'premium-options'), null);
    assert.equal((await consume(service, 1, 'premium-options')).allowed, true);
    assert.equal(await count(1, 'premium-options'), undefined);
    await admin.query(sql('premium_api_quotas_setup.sql'));
  });

  await t.test('RPCs and raw tables are private, including a BYPASSRLS service role', async () => {
    for (const role of ['anon', 'authenticated', 'quota_untrusted', 'service_role']) {
      const c = await connect(role);
      for (const table of ['premium_api_quota_control', 'premium_api_quota_counters']) {
        await assert.rejects(c.query(`select * from public.${table}`), { code: '42501' });
        await assert.rejects(c.query(`delete from public.${table}`), { code: '42501' });
      }
      await assert.rejects(c.query('update public.premium_api_quota_control set enabled=true'), { code: '42501' });
      if (role !== 'service_role') {
        await assert.rejects(consume(c, 1), { code: '42501' });
        await assert.rejects(readControl(c), { code: '42501' });
        await assert.rejects(purge(c), { code: '42501' });
      }
      await close(c);
    }
    const properties = (await admin.query(`select proname,prosecdef,proconfig from pg_proc where proname in
      ('consume_premium_api_quota','read_premium_api_quota_control','purge_premium_api_quota_counters')`)).rows;
    assert.equal(properties.length, 3);
    for (const p of properties) { assert.equal(p.prosecdef, true); assert.ok(p.proconfig.includes('search_path=""')); }
    const tables = (await admin.query("select relrowsecurity from pg_class where relname in ('premium_api_quota_control','premium_api_quota_counters')")).rows;
    assert.ok(tables.every(r => r.relrowsecurity));
    await enable(true);
    await assert.rejects(service.query('select public.consume_premium_api_quota(null,$1)', ['pro-prices']), { code: '22023' });
    await assert.rejects(consume(service, 1, 'SPY'), { code: '22023' });
    await assert.rejects(consume(service, 999), { code: '23503' });
    await assert.rejects(purge(service, 1001), { code: '22023' });
  });

  const callers = await Promise.all(Array.from({ length: 80 }, (_, i) => connect('service_role', `quota-parallel-${i}`)));
  assert.equal(new Set(callers.map(c => c.pid)).size, 80);
  t.diagnostic('80 unique pg_backend_pid() values; every cap race gates all 80 live sessions on one advisory lock before release.');
  async function race(subject) {
    await avoidMinuteRollover();
    const gate = 482001;
    await admin.query('select pg_advisory_lock($1)', [gate]);
    const pending = Promise.all(callers.map(async (c, i) => {
      await c.query('begin');
      try {
        await c.query('select pg_advisory_xact_lock_shared($1)', [gate]);
        const [user, resource] = subject(i);
        const result = await consume(c, user, resource);
        await c.query('commit');
        return result;
      } catch (e) { await c.query('rollback'); throw e; }
    }));
    pending.catch(() => {});
    try { await waitLocked(callers.map(c => c.pid), 'advisory'); }
    finally { await admin.query('select pg_advisory_unlock($1)', [gate]); }
    return pending;
  }
  await t.test('80 simultaneous sessions admit exactly 60 requests for one account', async () => {
    const results = await race(() => [1, 'pro-prices']);
    assert.equal(results.filter(r => r.allowed).length, 60);
    assert.equal(results.filter(r => !r.allowed).length, 20);
    assert.ok(results.filter(r => !r.allowed).every(r => r.retry_after_seconds >= 1 && r.retry_after_seconds <= 60));
    assert.deepEqual(await count(1), { minute_count: 60, hour_count: 60 });
  });

  await t.test('same account Options and different account Pro counters remain separate', async () => {
    const results = await race(i => i % 2 ? [2, 'pro-prices'] : [1, 'premium-options']);
    assert.ok(results.every(r => r.allowed));
    assert.deepEqual(await count(1, 'premium-options'), { minute_count: 40, hour_count: 40 });
    assert.deepEqual(await count(2), { minute_count: 40, hour_count: 40 });
    assert.deepEqual(await count(1), { minute_count: 60, hour_count: 60 });
  });

  await t.test('hour caps survive minute reset; expired hour resets atomically', async () => {
    for (const [resource, limit] of [['pro-prices', 1200], ['premium-options', 600]]) {
      await seed(3, resource, 60, limit, '1 minute');
      const denied = await consume(service, 3, resource);
      assert.equal(denied.allowed, false);
      assert.ok(denied.retry_after_seconds >= 1 && denied.retry_after_seconds <= 3600);
      assert.equal((await count(3, resource)).hour_count, limit);
      await seed(3, resource, 60, limit, '1 minute', '1 hour');
      const results = await race(() => [3, resource]);
      assert.equal(results.filter(r => r.allowed).length, 60);
      assert.deepEqual(await count(3, resource), { minute_count: 60, hour_count: 60 });
    }
  });

  await t.test('locking one account does not block a different account', async () => {
    const locker = await connect();
    await seed(4); await seed(5);
    await locker.query('begin');
    await locker.query('select * from public.premium_api_quota_counters where user_id=$1 for update', [id(4)]);
    const blocked = consume(callers[0], 4);
    blocked.catch(() => {});
    await waitLocked([callers[0].pid]);
    try { assert.equal((await consume(callers[1], 5)).allowed, true); }
    finally { await locker.query('commit'); }
    assert.equal((await blocked).allowed, true);
    await close(locker);
  });

  await t.test('a request waiting across an actual UTC minute boundary uses the new window', async () => {
    // Only this check waits for wall-clock time (at most one minute). Hour resets
    // above use deliberately old stored windows, not a claim of waiting an hour.
    const ms = Number((await admin.query("select extract(epoch from date_trunc('minute',clock_timestamp())+interval '1 minute'-clock_timestamp())*1000 as ms")).rows[0].ms);
    if (ms < 1500) await sleep(ms + 50);
    const untilBoundary = Number((await admin.query("select extract(epoch from date_trunc('minute',clock_timestamp())+interval '1 minute'-clock_timestamp())*1000 as ms")).rows[0].ms);
    await sleep(Math.max(0, untilBoundary - 800));
    await seed(6, 'pro-prices', 60, 60);
    const oldWindow = (await admin.query('select minute_start from public.premium_api_quota_counters where user_id=$1', [id(6)])).rows[0].minute_start;
    await admin.query('begin');
    await admin.query('select * from public.premium_api_quota_counters where user_id=$1 for update', [id(6)]);
    const pending = consume(service, 6);
    pending.catch(() => {});
    await waitLocked([service.pid]);
    const wait = Number((await admin.query("select extract(epoch from date_trunc('minute',clock_timestamp())+interval '1 minute'-clock_timestamp())*1000 as ms")).rows[0].ms);
    await sleep(wait + 80);
    await admin.query('commit');
    assert.equal((await pending).allowed, true);
    const row = (await admin.query('select * from public.premium_api_quota_counters where user_id=$1', [id(6)])).rows[0];
    assert.ok(row.minute_start > oldWindow);
    assert.equal(row.minute_count, 1);
    assert.equal(row.hour_count, row.hour_start.getTime() > oldWindow.getTime() ? 1 : 61);
  });

  await t.test('cleanup skips locked expired rows, deletes only a bounded batch', async () => {
    await seed(7); await seed(8); await seed(9);
    await admin.query("update public.premium_api_quota_counters set updated_at=clock_timestamp()-interval '8 days' where user_id=any($1::uuid[])", [[id(7), id(8), id(9)]]);
    await admin.query('begin');
    await admin.query('select * from public.premium_api_quota_counters where user_id=$1 for update', [id(7)]);
    assert.equal(await purge(service, 1), 1);
    assert.equal(await purge(service, 1000), 1);
    assert.notEqual(await count(7), undefined);
    await admin.query('commit');
    assert.equal((await consume(service, 7)).allowed, true);
    assert.equal(await purge(service, 1000), 0);
  });

  await t.test('cleanup between conflict detection and row lock safely retries initialization', async () => {
    await seed(10);
    await admin.query("update public.premium_api_quota_counters set updated_at=clock_timestamp()-interval '8 days' where user_id=$1", [id(10)]);
    // A test-only AFTER STATEMENT trigger exposes the exact gap between the
    // INSERT ON CONFLICT and SELECT FOR UPDATE in the unmodified production RPC.
    await admin.query(`create function public.test_quota_conflict_gap() returns trigger language plpgsql as $$
      begin if current_setting('application_name')='quota-cleanup-gap' then perform pg_advisory_xact_lock(482002); end if; return null; end $$;
      create trigger test_quota_conflict_gap after insert on public.premium_api_quota_counters
        for each statement execute function public.test_quota_conflict_gap();`);
    const gapCaller = await connect('service_role', 'quota-cleanup-gap');
    await admin.query('select pg_advisory_lock(482002)');
    const pending = consume(gapCaller, 10);
    pending.catch(() => {});
    await waitLocked([gapCaller.pid], 'advisory');
    assert.equal(await purge(service), 1);
    assert.equal(await count(10), undefined);
    await admin.query('select pg_advisory_unlock(482002)');
    assert.equal((await pending).allowed, true);
    assert.deepEqual(await count(10), { minute_count: 1, hour_count: 1 });
    await admin.query('drop trigger test_quota_conflict_gap on public.premium_api_quota_counters; drop function public.test_quota_conflict_gap()');
    await close(gapCaller);
  });

  await t.test('disable commit serializes with in-flight decisions; stale enabled read cannot count', async () => {
    const owner = await connect();
    await callers[0].query('begin');
    assert.equal((await consume(callers[0], 11)).allowed, true);
    assert.deepEqual(await readControl(service), { enabled: true });
    const disabling = owner.query(sql('premium_api_quotas_emergency_disable.sql'));
    disabling.catch(() => {});
    await waitLocked([owner.pid]);
    await callers[0].query('commit');
    await disabling;
    assert.deepEqual(await readControl(service), { enabled: false });
    assert.deepEqual(await consume(service, 11), { allowed: true, retry_after_seconds: 0 });
    assert.deepEqual(await count(11), { minute_count: 1, hour_count: 1 });
    assert.equal((await consume(service, 12)).allowed, true);
    assert.equal(await count(12), undefined);
    assert.deepEqual(await readControl(service, 'premium-options'), { enabled: false });
    await close(owner);
  });

  await t.test('migration reapply preserves settings and counts; rollback preserves mock subscribers', async () => {
    const before = (await admin.query('select jsonb_agg(c order by user_id,resource) as rows from public.premium_api_quota_counters c')).rows[0].rows;
    await admin.query(sql('premium_api_quotas_setup.sql'));
    assert.deepEqual(await readControl(service), { enabled: false });
    const after = (await admin.query('select jsonb_agg(c order by user_id,resource) as rows from public.premium_api_quota_counters c')).rows[0].rows;
    assert.deepEqual(after, before);
    assert.deepEqual(await subscriberSnapshot(), baselineSubscribers);
    // Local runtime has no pg_cron extension. These stubs test migration job
    // selection/rollback isolation, not hosted scheduler execution.
    await admin.query(`create schema cron;
      create table cron.job(jobid bigint generated always as identity primary key,jobname text,schedule text,command text);
      create function cron.schedule(text,text,text) returns bigint language sql as $$
        insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid $$;
      create function cron.unschedule(bigint) returns boolean language sql as $$ delete from cron.job where jobid=$1 returning true $$;
      insert into cron.job(jobname,schedule,command) values('keep_news','* * * * *','original'),('keep_prices','* * * * *','original');`);
    await admin.query(sql('premium_api_quotas_scheduler.sql'));
    await admin.query(sql('premium_api_quotas_scheduler.sql'));
    assert.equal((await admin.query("select count(*)::int as n from cron.job where jobname='premium_api_quota_cleanup'")).rows[0].n, 1);
    await admin.query(sql('premium_api_quotas_rollback.sql'));
    for (const table of ['premium_api_quota_control', 'premium_api_quota_counters']) {
      assert.equal((await admin.query('select to_regclass($1) as name', [`public.${table}`])).rows[0].name, null);
    }
    assert.equal((await admin.query("select count(*)::int as n from pg_proc where proname in ('consume_premium_api_quota','read_premium_api_quota_control','purge_premium_api_quota_counters')")).rows[0].n, 0);
    assert.equal((await admin.query("select count(*)::int as n from cron.job where jobname in ('keep_news','keep_prices') and command='original'")).rows[0].n, 2);
    assert.deepEqual(await subscriberSnapshot(), baselineSubscribers);
  });
});
