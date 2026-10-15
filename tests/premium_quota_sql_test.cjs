const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { PGlite } = require(process.env.PRO_PRICE_PGLITE_PATH || '@electric-sql/pglite');

const sql = name => readFileSync(join(__dirname, '../supabase/sql/', name), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('durable premium quotas: permissions, limits, reset, retention and rollback', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create table auth.users(id uuid primary key);
  `);
  for (let n = 1; n <= 5; n++) await db.query('insert into auth.users values ($1)', [id(n)]);
  await db.exec(sql('premium_api_quotas_setup.sql'));
  const asRole = (role, query, params = []) => db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    return tx.query(query, params);
  });
  const consume = async (user = id(1), resource = 'pro-prices', role = 'service_role') =>
    (await asRole(role, 'select public.consume_premium_api_quota($1,$2) as result', [user, resource])).rows[0].result;
  const scalar = async (query, params = []) => Object.values((await db.query(query, params)).rows[0])[0];
  const readControl = async (resource, role = 'service_role') =>
    (await asRole(role, 'select public.read_premium_api_quota_control($1) as result', [resource])).rows[0].result;

  await t.test('runtime control is default-disabled, rechecked inside consume, and owner-only mutable', async () => {
    for (const resource of ['pro-prices', 'premium-options']) {
      assert.deepEqual(await readControl(resource), { enabled: false });
      assert.deepEqual(await consume(id(1), resource), { allowed: true, retry_after_seconds: 0 });
    }
    assert.equal(await scalar('select count(*)::int from public.premium_api_quota_counters'), 0);
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(readControl('pro-prices', role), { code: '42501' });
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await assert.rejects(asRole(role, 'select * from public.premium_api_quota_control'), { code: '42501' });
      await assert.rejects(asRole(role, 'update public.premium_api_quota_control set enabled=true'), { code: '42501' });
      await assert.rejects(asRole(role, 'delete from public.premium_api_quota_control'), { code: '42501' });
    }
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.premium_api_quota_control'::regclass"), true);
    const properties = (await db.query(`select prosecdef,proconfig from pg_proc
      where oid='public.read_premium_api_quota_control(text)'::regprocedure`)).rows[0];
    assert.equal(properties.prosecdef, true);
    assert.ok(properties.proconfig.includes('search_path=""'));
    await db.exec("delete from public.premium_api_quota_control where resource='pro-prices'");
    assert.equal(await readControl('pro-prices'), null);
    assert.deepEqual(await consume(), { allowed: true, retry_after_seconds: 0 });
    assert.equal(await scalar('select count(*)::int from public.premium_api_quota_counters'), 0);
    await db.exec(sql('premium_api_quotas_setup.sql'));
    await db.exec('update public.premium_api_quota_control set enabled=true');
    // Rerunning setup must not silently overwrite an operator's runtime choice.
    await db.exec(sql('premium_api_quotas_setup.sql'));
    assert.deepEqual(await readControl('pro-prices'), { enabled: true });
  });

  await t.test('public/authenticated cannot invoke RPC or access counters, service cannot change raw counters', async () => {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(consume(id(1), 'pro-prices', role), { code: '42501' });
      await assert.rejects(asRole(role, 'select public.purge_premium_api_quota_counters(1)'), { code: '42501' });
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await assert.rejects(asRole(role, 'select * from public.premium_api_quota_counters'), { code: '42501' });
      await assert.rejects(asRole(role, 'delete from public.premium_api_quota_counters'), { code: '42501' });
    }
    const properties = (await db.query(`select prosecdef,proconfig from pg_proc
      where oid='public.consume_premium_api_quota(uuid,text)'::regprocedure`)).rows[0];
    assert.equal(properties.prosecdef, true);
    assert.ok(properties.proconfig.includes('search_path=""'));
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.premium_api_quota_counters'::regclass"), true);
    await assert.rejects(consume(null), { code: '22023' });
    await assert.rejects(consume(id(1), 'SPY'), { code: '22023' });
    await assert.rejects(consume(id(99)), { code: '23503' });
  });

  await t.test('parallel callers share a capped counter; resources and users stay separate', async () => {
    // PGlite serializes its single connection. This tests concurrent caller
    // semantics; deployment review must also exercise real PostgreSQL sessions.
    const results = await Promise.all(Array.from({ length: 80 }, () => consume()));
    assert.equal(results.filter(r => r.allowed).length, 60);
    assert.equal(results.filter(r => !r.allowed).length, 20);
    for (const r of results.filter(r => !r.allowed)) assert.ok(r.retry_after_seconds >= 1 && r.retry_after_seconds <= 60);
    assert.equal(await scalar('select minute_count from public.premium_api_quota_counters where user_id=$1 and resource=$2', [id(1), 'pro-prices']), 60);
    assert.equal((await consume(id(2))).allowed, true);
    assert.equal((await consume(id(1), 'premium-options')).allowed, true);
    assert.equal(await scalar('select count(*)::int from public.premium_api_quota_counters'), 3);
  });

  await t.test('minute reset preserves hourly quota; hourly reset admits requests again', async () => {
    for (const [resource, limit] of [['pro-prices', 1200], ['premium-options', 600]]) {
      await db.query(`update public.premium_api_quota_counters set
        minute_start=date_trunc('minute',clock_timestamp())-interval '1 minute', minute_count=60,
        hour_start=date_trunc('hour',clock_timestamp()), hour_count=$1
        where user_id=$2 and resource=$3`, [limit, id(1), resource]);
      const denied = await consume(id(1), resource);
      assert.equal(denied.allowed, false);
      assert.ok(denied.retry_after_seconds >= 1 && denied.retry_after_seconds <= 3600);
      assert.equal(await scalar('select hour_count from public.premium_api_quota_counters where user_id=$1 and resource=$2', [id(1), resource]), limit);
      await db.query(`update public.premium_api_quota_counters set
        hour_start=date_trunc('hour',clock_timestamp())-interval '1 hour'
        where user_id=$1 and resource=$2`, [id(1), resource]);
      assert.equal((await consume(id(1), resource)).allowed, true);
      assert.deepEqual((await db.query('select minute_count,hour_count from public.premium_api_quota_counters where user_id=$1 and resource=$2', [id(1), resource])).rows[0], { minute_count: 1, hour_count: 1 });
    }
  });

  await t.test('committed emergency disable bypasses existing quotas without erasing counters or entitlements', async () => {
    const before = await db.query('select * from public.premium_api_quota_counters order by user_id,resource');
    const priorEnabledRead = await readControl('pro-prices');
    assert.deepEqual(priorEnabledRead, { enabled: true });
    await db.exec(sql('premium_api_quotas_emergency_disable.sql'));
    for (const resource of ['pro-prices', 'premium-options']) {
      assert.deepEqual(await readControl(resource), { enabled: false });
      // Simulates a stale enabled read at the Edge: consume rechecks in SQL.
      assert.deepEqual(await consume(id(1), resource), { allowed: true, retry_after_seconds: 0 });
    }
    assert.deepEqual(await db.query('select * from public.premium_api_quota_counters order by user_id,resource'), before);
    assert.equal(await scalar('select count(*)::int from auth.users'), 5);
    await db.exec('update public.premium_api_quota_control set enabled=true');
  });

  await t.test('reapplying migration preserves counts, cleanup bounds work, account deletion cascades', async () => {
    const before = await scalar('select sum(hour_count)::int from public.premium_api_quota_counters');
    await db.exec(sql('premium_api_quotas_setup.sql'));
    assert.equal(await scalar('select sum(hour_count)::int from public.premium_api_quota_counters'), before);
    await consume(id(3)); await consume(id(4)); await consume(id(5));
    await db.query("update public.premium_api_quota_counters set updated_at=clock_timestamp()-interval '8 days' where user_id in ($1,$2)", [id(3), id(4)]);
    const purge = async n => (await asRole('service_role', 'select public.purge_premium_api_quota_counters($1) as n', [n])).rows[0].n;
    await assert.rejects(purge(1001), { code: '22023' });
    assert.equal(await purge(1), 1);
    assert.equal(await purge(1000), 1);
    assert.equal(await purge(1000), 0);
    assert.equal(await scalar('select count(*)::int from public.premium_api_quota_counters where user_id=$1', [id(5)]), 1);
    await db.query('delete from auth.users where id=$1', [id(1)]);
    assert.equal(await scalar('select count(*)::int from public.premium_api_quota_counters where user_id=$1', [id(1)]), 0);
  });

  await t.test('scheduler and rollback touch only their own job and accounting objects', async () => {
    await db.exec(`create schema cron;
      create table cron.job(jobid bigint generated always as identity primary key, jobname text, schedule text, command text);
      create function cron.schedule(text,text,text) returns bigint language sql as $$
        insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid $$;
      create function cron.unschedule(bigint) returns boolean language sql as $$
        delete from cron.job where jobid=$1 returning true $$;
      insert into cron.job(jobname,schedule,command) values('keep_news','* * * * *','original'),('keep_prices','* * * * *','original');
    `);
    await db.exec(sql('premium_api_quotas_scheduler.sql'));
    await db.exec(sql('premium_api_quotas_scheduler.sql'));
    assert.equal(await scalar("select count(*)::int from cron.job where jobname='premium_api_quota_cleanup'"), 1);
    assert.equal(await scalar("select count(*)::int from cron.job where jobname like 'keep_%' and command='original'"), 2);
    await db.exec(sql('premium_api_quotas_rollback.sql'));
    assert.equal(await scalar("select to_regclass('public.premium_api_quota_counters')"), null);
    assert.equal(await scalar("select to_regclass('public.premium_api_quota_control')"), null);
    assert.equal(await scalar("select to_regprocedure('public.read_premium_api_quota_control(text)')"), null);
    assert.equal(await scalar('select count(*)::int from auth.users'), 4);
    assert.equal(await scalar('select count(*)::int from cron.job'), 2);
  });
});
