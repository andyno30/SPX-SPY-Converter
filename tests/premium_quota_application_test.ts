// Local integration only: real temporary PostgreSQL + the actual request/guard
// modules behind HTTP. JWT verification is a local adapter, not Supabase Auth.
// Start tests/helpers/premium-quota-postgres-runtime.cjs first. No remote URL is
// accepted, and no production credentials or subscriber records are used.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { createRequestHandler } from '../supabase/functions/get-live-price-pro/request.ts';
import { createOptionsAccessGuard } from '../supabase/functions/fetch-spy-options/access.ts';
import { createRuntimeQuotaConsumer, type PremiumQuotaResource } from '../supabase/functions/_shared/premium-quota.ts';

const require = createRequire(import.meta.url);
const runtime = require('./helpers/premium-quota-postgres-runtime.cjs');
const { Client, Pool } = require(runtime.pgModule);
const secret = randomBytes(32);
const issuer = 'spy-quota-local-test';
const ids = { a: randomUUID(), b: randomUUID(), expired: randomUUID(), anonymous: randomUUID() };

function jwt(id: string, overrides: Record<string, unknown> = {}): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: id, iss: issuer, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    jti: randomUUID(), ...overrides,
  })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

function verifyJwt(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const supplied = Buffer.from(parts[2], 'base64url');
    const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
    if (header.alg !== 'HS256' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (claims.iss !== issuer || claims.aud !== 'authenticated' || typeof claims.sub !== 'string' ||
        typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000 || claims.is_anonymous === true) return null;
    return claims.sub;
  } catch { return null; }
}

Deno.test('local HTTP subscribers, runtime disable, and real PostgreSQL accounting', async t => {
  console.log(`Local database: ${await runtime.verifyCluster()}`);
  const database = `spy_quota_application_${Date.now()}`;
  const admin = new Client(runtime.getConfig());
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const pool = new Pool({ ...runtime.getConfig(database), max: 24 });
  const servers: Deno.HttpServer[] = [];
  const urls: string[] = [];
  let authReads = 0, controlReads = 0, consumes = 0;
  let identityOutage = false;
  try {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      END $$;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, is_anonymous boolean NOT NULL DEFAULT false);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id), is_subscribed boolean NOT NULL);
    `);
    for (const [name, id] of Object.entries(ids)) {
      await pool.query('INSERT INTO auth.users VALUES ($1,$2)', [id, name === 'anonymous']);
      await pool.query('INSERT INTO profiles VALUES ($1,$2)', [id, name !== 'expired']);
    }
    await pool.query(await Deno.readTextFile(new URL('../supabase/sql/premium_api_quotas_setup.sql', import.meta.url)));
    async function rpc(sql: string, params: unknown[]) {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query('SET LOCAL ROLE service_role');
        const result = await connection.query(sql, params);
        await connection.query('COMMIT');
        return result.rows[0].result;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally { connection.release(); }
    }
    const userId = async (token: string) => {
      authReads++;
      if (identityOutage) throw Error('Local auth dependency unavailable');
      const id = verifyJwt(token);
      if (!id) return null;
      const result = await pool.query('SELECT id FROM auth.users WHERE id=$1 AND NOT is_anonymous', [id]);
      return result.rows[0]?.id ?? null;
    };
    const subscribed = async (id: string) => {
      const result = await pool.query('SELECT is_subscribed FROM profiles WHERE id=$1', [id]);
      return result.rows[0]?.is_subscribed === true;
    };
    function quota(resource: PremiumQuotaResource) {
      return createRuntimeQuotaConsumer({
        readControl: () => {
          controlReads++;
          return rpc('SELECT public.read_premium_api_quota_control($1) AS result', [resource]);
        },
        consume: id => {
          consumes++;
          return rpc('SELECT public.consume_premium_api_quota($1,$2) AS result', [id, resource]);
        },
      });
    }
    // Construct once. Every test below uses these same four running handlers.
    for (let i = 0; i < 4; i++) {
      const pro = createRequestHandler({
        userId,
        readAccessSnapshot: async id => ({
          is_subscribed: await subscribed(id),
          quotes: [{ symbol: 'SPY', regularMarketPrice: 650 }, { symbol: '^GSPC', regularMarketPrice: 6500 }],
          fetched_at: new Date().toISOString(),
        }),
        consumeQuota: quota('pro-prices'),
      });
      const options = createOptionsAccessGuard({ userId, subscribed, consumeQuota: quota('premium-options') });
      const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async req => {
        const url = new URL(req.url);
        if (url.pathname === '/pro') return await pro(req);
        if (url.pathname !== '/options') return new Response(null, { status: 404 });
        // Local payload adapter: actual premium guard, no Yahoo/cache calls.
        const ticker = url.searchParams.get('ticker') ?? 'SPY';
        const denied = await options(req, ticker);
        return denied ?? Response.json({ ticker, localFixture: true });
      });
      servers.push(server);
      urls.push(`http://127.0.0.1:${server.addr.port}`);
    }
    async function get(path: string, token?: string, instance = 0, headers: Record<string, string> = {}) {
      const response = await fetch(urls[instance % urls.length] + path, {
        headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      return { status: response.status, headers: response.headers, body };
    }
    async function reset() {
      // Do not let an intentional fixed-window boundary split a short race.
      const clock = await pool.query("SELECT extract(epoch FROM date_trunc('minute',clock_timestamp()) + interval '1 minute' - clock_timestamp()) AS remaining");
      const remaining = Number(clock.rows[0].remaining);
      if (remaining < 5) await new Promise(resolve => setTimeout(resolve, remaining * 1000 + 50));
      await pool.query('TRUNCATE public.premium_api_quota_counters');
      await pool.query('UPDATE public.premium_api_quota_control SET enabled=true');
    }
    const a = jwt(ids.a), b = jwt(ids.b);

    await t.step('default disabled admits subscribers across running instances without counters', async () => {
      const responses = await Promise.all(urls.map((_, i) => get('/pro', a, i)));
      assert.ok(responses.every(r => r.status === 200 && r.body['SPX/SPY Ratio'] === 10));
      assert.equal(consumes, 0);
      assert.equal(controlReads, 4);
      assert.equal((await pool.query('SELECT count(*) FROM premium_api_quota_counters')).rows[0].count, '0');
    });

    await t.step('signed identities, expiry, current membership, anonymous and public SPY', async () => {
      await reset();
      const before = consumes;
      const invalid = [undefined, 'invalid', jwt(ids.a, { exp: 1 }), jwt(ids.a, { aud: 'other' }),
        jwt(ids.anonymous), jwt(ids.a, { is_anonymous: true }), jwt(randomUUID()), `${a.slice(0, -8)}tampered`];
      for (const token of invalid) {
        assert.equal((await get('/pro', token)).status, 401);
        assert.equal((await get('/options?ticker=QQQ', token)).status, 401);
      }
      assert.equal((await get('/pro', jwt(ids.expired))).status, 403);
      assert.equal((await get('/options?ticker=QQQ', jwt(ids.expired))).status, 403);
      assert.equal(consumes, before);
      assert.equal((await get('/pro', a)).status, 200);
      await pool.query('UPDATE profiles SET is_subscribed=false WHERE id=$1', [ids.a]);
      assert.equal((await get('/pro', a, 1)).status, 403);
      assert.equal((await get('/options?ticker=QQQ', a, 2)).status, 403);
      await pool.query('UPDATE profiles SET is_subscribed=true WHERE id=$1', [ids.a]);
      assert.equal((await get('/pro', a, 3)).status, 200);
      const beforePublic = { authReads, controlReads, consumes };
      for (const token of [undefined, 'invalid', a]) assert.equal((await get('/options?ticker=SPY', token)).status, 200);
      assert.deepEqual({ authReads, controlReads, consumes }, beforePublic);
    });

    await t.step('simultaneous requests share authenticated budget across tokens and four handlers', async () => {
      await reset();
      const rotated = jwt(ids.a);
      const results = await Promise.all(Array.from({ length: 80 }, (_, i) =>
        get('/pro', i % 2 ? a : rotated, i, { 'x-user-id': ids.b })));
      assert.equal(results.filter(r => r.status === 200).length, 60);
      assert.equal(results.filter(r => r.status === 429).length, 20);
      const denied = results.find(r => r.status === 429)!;
      assert.equal(denied.body.code, 'RATE_LIMITED');
      assert.ok(Number(denied.headers.get('Retry-After')) >= 1);
      assert.equal(denied.headers.get('Cache-Control'), 'private, no-store');
      assert.equal(denied.headers.get('Access-Control-Expose-Headers'), 'Retry-After');
      const counters = await pool.query('SELECT user_id,resource,minute_count,hour_count FROM premium_api_quota_counters');
      assert.deepEqual(counters.rows, [{ user_id: ids.a, resource: 'pro-prices', minute_count: 60, hour_count: 60 }]);
      assert.equal((await get('/pro', b)).status, 200);
      assert.equal((await get('/options?ticker=QQQ', a)).status, 200);
    });

    await t.step('hourly budgets are separate and all premium Options tickers share one budget', async () => {
      await reset();
      await get('/pro', a);
      await get('/options?ticker=QQQ', a);
      await pool.query(`UPDATE premium_api_quota_counters SET minute_count=0,
        hour_count=CASE WHEN resource='pro-prices' THEN 1199 ELSE 599 END`);
      assert.equal((await get('/pro', a, 1)).status, 200);
      assert.equal((await get('/options?ticker=IWM', a, 2)).status, 200);
      assert.equal((await get('/pro', a, 3)).status, 429);
      assert.equal((await get('/options?ticker=DIA', a, 0)).status, 429);
      assert.equal((await get('/pro', b)).status, 200);
      assert.equal((await get('/options?ticker=QQQ', b)).status, 200);
      assert.equal((await get('/options?ticker=SPY')).status, 200);
    });

    await t.step('emergency disable recovers exhausted users on already-running handlers', async () => {
      const before = consumes;
      await pool.query(await Deno.readTextFile(new URL('../supabase/sql/premium_api_quotas_emergency_disable.sql', import.meta.url)));
      for (let i = 0; i < urls.length; i++) {
        assert.equal((await get('/pro', a, i)).status, 200);
        assert.equal((await get('/options?ticker=QQQ', a, i)).status, 200);
      }
      assert.equal(consumes, before);
      assert.equal((await get('/pro')).status, 401);
      assert.equal((await get('/options?ticker=QQQ', jwt(ids.expired))).status, 403);
      // The Options switch can remain off while the Pro switch is enabled.
      await pool.query("UPDATE premium_api_quota_control SET enabled=true WHERE resource='pro-prices'");
      assert.equal((await get('/pro', a)).status, 429);
      assert.equal((await get('/options?ticker=QQQ', a)).status, 200);
    });

    await t.step('actual missing counter RPC is 503 while verified enabled, then disable recovers', async () => {
      await pool.query('ALTER FUNCTION consume_premium_api_quota(uuid,text) RENAME TO unavailable_quota_test');
      try {
        const failure = await get('/pro', b);
        assert.equal(failure.status, 503);
        assert.equal(failure.body.code, 'QUOTA_UNAVAILABLE');
        assert.equal(failure.headers.get('Retry-After'), '5');
        await pool.query('UPDATE premium_api_quota_control SET enabled=false');
        for (let i = 0; i < urls.length; i++) assert.equal((await get('/pro', b, i)).status, 200);
      } finally { await pool.query('ALTER FUNCTION unavailable_quota_test(uuid,text) RENAME TO consume_premium_api_quota'); }
    });

    await t.step('unverifiable control bypasses only quota, preserving auth and membership', async () => {
      await reset();
      await pool.query('ALTER TABLE premium_api_quota_control RENAME TO unavailable_control_test');
      try {
        for (let i = 0; i < urls.length; i++) {
          assert.equal((await get('/pro', a, i)).status, 200);
          assert.equal((await get('/options?ticker=QQQ', a, i)).status, 200);
        }
        assert.equal((await get('/pro')).status, 401);
        assert.equal((await get('/pro', jwt(ids.expired))).status, 403);
        assert.equal((await get('/options?ticker=QQQ', jwt(ids.expired))).status, 403);
        identityOutage = true;
        assert.equal((await get('/pro', a)).status, 503);
        // The guard rejects; the local Deno server supplies its default 500.
        // Hosted Supabase's transport error mapping still needs staging checks.
        assert.equal((await get('/options?ticker=QQQ', a)).status, 500);
        assert.equal((await get('/options?ticker=SPY')).status, 200);
      } finally {
        identityOutage = false;
        await pool.query('ALTER TABLE unavailable_control_test RENAME TO premium_api_quota_control');
      }
      assert.equal((await get('/pro', a)).status, 200);
      assert.equal((await pool.query('SELECT count(*) FROM premium_api_quota_counters')).rows[0].count, '1');
    });
  } finally {
    await Promise.all(servers.map(server => server.shutdown()));
    await pool.end();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
});
