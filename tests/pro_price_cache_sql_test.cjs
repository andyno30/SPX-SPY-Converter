// Runs real PostgreSQL/PLpgSQL in an isolated, in-memory PGlite database.
// Install @electric-sql/pglite in a temporary directory, then run:
// PRO_PRICE_PGLITE_PATH=/path/to/node_modules/@electric-sql/pglite node --test tests/pro_price_cache_sql_test.cjs
// pg_cron/pg_net/Vault integrations are represented by recording SQL stubs;
// these tests never send HTTP requests or connect to a deployed database.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { PGlite } = require(process.env.PRO_PRICE_PGLITE_PATH || '@electric-sql/pglite');

const root = join(__dirname, '..');
const cacheSql = readFileSync(join(root, 'supabase/sql/pro_price_cache_setup.sql'), 'utf8');
const schedulerSql = readFileSync(join(root, 'supabase/sql/pro_price_refresh_scheduler.sql'), 'utf8');
const quote = [{ symbol: 'SPY', quoteType: 'ETF', regularMarketPrice: 650 }];
const rpcNames = [
  'public.claim_pro_price_refresh()',
  'public.finish_pro_price_refresh(uuid,jsonb)',
  'public.release_pro_price_refresh(uuid)',
];

test('Pro cache PostgreSQL migration and scheduler invariants', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.exec(cacheSql);

  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const scalar = async (sql, params = []) => Object.values((await rows(sql, params))[0])[0];
  const reset = () => db.exec(`
    update public.pro_price_cache set quotes = null, fetched_at = null,
      last_attempted_minute = null, refresh_started_at = null, claim_token = null;
  `);
  const asRole = (role, sql, params = []) => db.transaction(async (tx) => {
    assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
    await tx.exec(`set local role ${role}`);
    return tx.query(sql, params);
  });
  const claim = async () => (await asRole('service_role', 'select public.claim_pro_price_refresh() as token')).rows[0].token;
  const finish = async (token, payload = quote) => (await asRole('service_role',
    'select public.finish_pro_price_refresh($1::uuid, $2::jsonb) as accepted',
    [token, JSON.stringify(payload)])).rows[0].accepted;
  const release = async (token) => (await asRole('service_role',
    'select public.release_pro_price_refresh($1::uuid) as released', [token])).rows[0].released;

  await t.test('cache and refresh RPCs reject anon/authenticated; service role can read but cannot write directly', async () => {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(asRole(role, 'select * from public.pro_price_cache'), { code: '42501' });
      for (const rpc of rpcNames) {
        assert.equal(await scalar('select has_function_privilege($1, $2, $3)', [role, rpc, 'EXECUTE']), false);
      }
      await assert.rejects(asRole(role, 'select public.claim_pro_price_refresh()'), { code: '42501' });
    }
    assert.equal((await asRole('service_role', 'select id from public.pro_price_cache')).rows.length, 1);
    await assert.rejects(asRole('service_role', 'update public.pro_price_cache set last_attempted_minute = null'), { code: '42501' });
    const metadata = await rows(`
      select p.prosecdef, p.proconfig from pg_proc p
      where p.oid in ('public.claim_pro_price_refresh()'::regprocedure,
        'public.finish_pro_price_refresh(uuid,jsonb)'::regprocedure,
        'public.release_pro_price_refresh(uuid)'::regprocedure)
    `);
    assert.equal(metadata.length, 3);
    assert.ok(metadata.every((row) => row.prosecdef && row.proconfig.includes('search_path=""')));
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid = 'public.pro_price_cache'::regclass`), true);
  });

  await t.test('only one claim is admitted in a burst and its bucket is UTC despite the session timezone', async () => {
    await reset();
    await db.exec(`set time zone 'Pacific/Kiritimati'`);
    // PGlite serializes statements on its connection. This verifies admission
    // invariants; multi-connection lock contention still needs native Postgres.
    const claims = await Promise.all(Array.from({ length: 24 }, () =>
      scalar('select public.claim_pro_price_refresh()')));
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(await scalar(`
      select last_attempted_minute =
        (date_trunc('minute', refresh_started_at at time zone 'UTC') at time zone 'UTC')
      from public.pro_price_cache
    `), true);
    await db.exec(`set time zone 'UTC'`);
  });

  await t.test('failed refresh releases its lease without clearing the snapshot or minute cooldown', async () => {
    await reset();
    await db.query(`update public.pro_price_cache set quotes = $1::jsonb, fetched_at = clock_timestamp() - interval '30 seconds'`, [JSON.stringify(quote)]);
    const token = await claim();
    const before = (await rows('select quotes, fetched_at, last_attempted_minute from public.pro_price_cache'))[0];
    assert.equal(await release(token), true);
    assert.equal(await release(token), false);
    assert.deepEqual((await rows('select quotes, fetched_at, last_attempted_minute from public.pro_price_cache'))[0], before);
    // Pin the current attempt bucket immediately before this assertion to avoid
    // relying on whether earlier test work happened to cross a minute boundary.
    await db.exec(`update public.pro_price_cache set last_attempted_minute = date_trunc('minute', clock_timestamp())`);
    assert.equal(await claim(), null);
  });

  await t.test('active lease blocks a later minute; an expired lease is reclaimed with a new fence token', async () => {
    await reset();
    const oldToken = await claim();
    await db.exec(`update public.pro_price_cache set last_attempted_minute = date_trunc('minute', clock_timestamp()) - interval '1 minute'`);
    assert.equal(await claim(), null);
    await db.exec(`update public.pro_price_cache set refresh_started_at = clock_timestamp() - interval '91 seconds'`);
    const newToken = await claim();
    assert.ok(newToken);
    assert.notEqual(newToken, oldToken);
    assert.equal(await finish(oldToken), false);
    assert.equal(await release(oldToken), false);
    assert.equal(await finish(newToken), true);
    assert.equal(await finish(newToken), false);
    assert.deepEqual(await scalar('select quotes from public.pro_price_cache'), quote);
    assert.equal(await scalar(`select fetched_at between clock_timestamp() - interval '5 seconds' and clock_timestamp() from public.pro_price_cache`), true);
    assert.equal(await scalar('select claim_token is null and refresh_started_at is null from public.pro_price_cache'), true);
  });

  await t.test('expired finish is rejected even when its token has not been superseded', async () => {
    await reset();
    const token = await claim();
    await db.exec(`update public.pro_price_cache set refresh_started_at = clock_timestamp() - interval '91 seconds'`);
    assert.equal(await finish(token), false);
    assert.equal(await scalar('select quotes is null and fetched_at is null from public.pro_price_cache'), true);
  });

  await t.test('invalid quote transport cannot publish or consume the current valid claim', async () => {
    await reset();
    const token = await claim();
    for (const payload of [null, {}, [], [1], [null], [{}], [{ symbol: '' }], [{ symbol: '  ' }], [{ symbol: 1 }]]) {
      await assert.rejects(finish(token, payload), { code: '22023' });
      assert.equal(await scalar('select claim_token from public.pro_price_cache'), token);
    }
    assert.equal(await finish(token), true);
  });

  await t.test('reapplying the migration preserves the published snapshot and attempt history', async () => {
    const before = (await rows('select * from public.pro_price_cache'))[0];
    await db.exec(cacheSql);
    assert.deepEqual((await rows('select * from public.pro_price_cache'))[0], before);
    assert.equal(await scalar('select count(*)::int from public.pro_price_cache'), 1);
    await assert.rejects(db.exec('insert into public.pro_price_cache(id) values (2)'), { code: '23514' });
  });

  // Stub only integrations unavailable in PGlite. The helper's PLpgSQL and the
  // generated cron SQL execute unchanged against these recording interfaces.
  await db.exec(`
    create schema vault;
    create table vault.decrypted_secrets(name text primary key, decrypted_secret text);
    create schema cron;
    create table cron.job(jobid bigserial primary key, jobname text, schedule text, command text);
    create function cron.schedule(text, text, text) returns bigint language sql as $$
      insert into cron.job(jobname, schedule, command) values ($1, $2, $3) returning jobid;
    $$;
    create function cron.unschedule(bigint) returns boolean language sql as $$
      with removed as (delete from cron.job where jobid = $1 returning 1)
      select exists(select 1 from removed);
    $$;
    create schema net;
    create table net.calls(id bigserial primary key, url text, headers jsonb, body jsonb, timeout_milliseconds integer);
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
      returns bigint language sql as $$
      insert into net.calls(url, headers, body, timeout_milliseconds)
      values ($1, $2, $3, $4) returning id;
    $$;
  `);
  const extensionStatements = schedulerSql.match(/^create extension if not exists (pg_cron|pg_net);$/gm);
  assert.equal(extensionStatements.length, 2);
  const schedulerWithoutExtensions = schedulerSql.replace(/^create extension if not exists (pg_cron|pg_net);$/gm, '');
  await db.exec(schedulerWithoutExtensions);

  await t.test('scheduler configuration is owner-only and rejects invalid targets or absent Vault credentials', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await assert.rejects(asRole(role, `select public.configure_pro_price_refresh_schedule('https://testproject.supabase.co')`), { code: '42501' });
    }
    for (const url of [null, 'http://testproject.supabase.co', 'https://example.com', 'https://testproject.supabase.co/path', "https://testproject.supabase.co';select 1;"]) {
      await assert.rejects(db.query('select public.configure_pro_price_refresh_schedule($1)', [url]), { code: '22023' });
    }
    await assert.rejects(db.query('select public.configure_pro_price_refresh_schedule($1)', ['https://testproject.supabase.co']), { code: 'P0001' });
    assert.equal(await scalar('select count(*)::int from cron.job'), 0);
  });

  await t.test('configuration replaces only its own job and keeps the credential out of stored cron SQL', async () => {
    await db.exec(`
      insert into vault.decrypted_secrets values ('pro_prices_updater_service_role', 'test-only-initial-credential');
      insert into cron.job(jobname, schedule, command) values
        ('news_fetch_every_15m', '*/15 * * * *', 'select 1'),
        ('options_existing_job', '* * * * *', 'select 2');
    `);
    const others = await rows('select * from cron.job order by jobid');
    await db.query('select public.configure_pro_price_refresh_schedule($1)', ['https://testproject.supabase.co/']);
    await db.query('select public.configure_pro_price_refresh_schedule($1)', ['https://testproject.supabase.co']);
    assert.deepEqual(await rows(`select * from cron.job where jobname <> 'pro_price_refresh_every_minute' order by jobid`), others);
    const own = await rows(`select * from cron.job where jobname = 'pro_price_refresh_every_minute'`);
    assert.equal(own.length, 1);
    assert.equal(own[0].schedule, '* * * * *');
    assert.match(own[0].command, /vault\.decrypted_secrets/);
    assert.ok(!own[0].command.includes('test-only-initial-credential'));
    await db.exec(own[0].command);
    const first = (await rows('select * from net.calls order by id'))[0];
    assert.equal(first.url, 'https://testproject.supabase.co/functions/v1/refresh-pro-prices');
    assert.equal(first.headers.Authorization, 'Bearer test-only-initial-credential');
    assert.equal(first.timeout_milliseconds, 45000);
    await db.exec(`update vault.decrypted_secrets set decrypted_secret = 'test-only-rotated-credential'`);
    await db.exec(own[0].command);
    assert.equal(await scalar('select headers ->> \'Authorization\' from net.calls order by id desc limit 1'), 'Bearer test-only-rotated-credential');
    const before = await rows('select * from cron.job order by jobid');
    await db.exec(schedulerWithoutExtensions);
    assert.deepEqual(await rows('select * from cron.job order by jobid'), before);
  });
});
