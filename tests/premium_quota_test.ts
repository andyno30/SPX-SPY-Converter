import assert from 'node:assert/strict';
import { createRequestHandler } from '../supabase/functions/get-live-price-pro/request.ts';
import { createOptionsAccessGuard } from '../supabase/functions/fetch-spy-options/access.ts';
import { createRuntimeQuotaConsumer, parseQuotaDecision } from '../supabase/functions/_shared/premium-quota.ts';

const now = Date.parse('2026-10-15T17:00:00Z');
const snapshot = {
  is_subscribed: true,
  quotes: [{ symbol: 'SPY', regularMarketPrice: 650 }, { symbol: '^GSPC', regularMarketPrice: 6500 }],
  fetched_at: new Date(now).toISOString(),
};
const request = (token?: string, query = '', method = 'GET') => new Request(`https://local/prices${query}`, {
  method, headers: token ? { Authorization: `Bearer ${token}`, 'X-User-Id': 'spoofed-user' } : {},
});
const allowed = { allowed: true, retryAfterSeconds: 0 };

Deno.test('Pro quota only charges verified subscribers and valid GET selections', async () => {
  const charged: string[] = [];
  const handler = createRequestHandler({
    userId: async token => token === 'invalid' ? null : `verified-${token}`,
    readAccessSnapshot: async id => ({ ...snapshot, is_subscribed: id !== 'verified-free' }),
    consumeQuota: async id => { charged.push(id); return allowed; },
    now: () => now,
  });
  for (const [req, status] of [
    [request(undefined, '', 'OPTIONS'), 204], [request('pro', '', 'POST'), 405],
    [request(), 401], [request('invalid'), 401], [request('free'), 403],
    [request('pro', '?esContract=INVALID'), 400],
  ] as const) assert.equal((await handler(req)).status, status);
  assert.deepEqual(charged, []);
  const good = await handler(request('pro'));
  assert.equal(good.status, 200);
  assert.equal((await good.json())['SPX/SPY Ratio'], 10);
  assert.deepEqual(charged, ['verified-pro']);
});

Deno.test('Pro uses verified identity across refreshed tokens and concurrent requests', async () => {
  const counts = new Map<string, number>();
  const handler = createRequestHandler({
    userId: async token => token.startsWith('alice-') ? 'alice' : 'bob',
    readAccessSnapshot: async () => snapshot,
    consumeQuota: async id => {
      const count = (counts.get(id) ?? 0) + 1;
      counts.set(id, count);
      return count <= 2 ? allowed : { allowed: false, retryAfterSeconds: 17 };
    },
    now: () => now,
  });
  const responses = await Promise.all(['alice-old', 'alice-new', 'alice-third', 'bob'].map(token => handler(request(token))));
  assert.deepEqual(responses.map(r => r.status), [200, 200, 429, 200]);
  const denied = responses[2];
  assert.equal(denied.headers.get('Retry-After'), '17');
  assert.equal(denied.headers.get('Access-Control-Expose-Headers'), 'Retry-After');
  assert.equal(denied.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await denied.json()).code, 'RATE_LIMITED');
  assert.deepEqual([...counts.entries()], [['alice', 3], ['bob', 1]]);
});

Deno.test('quota database failures and malformed decisions fail closed without exposing details', async () => {
  for (const bad of [null, {}, [], { allowed: true, retry_after_seconds: 12 },
    { allowed: false, retry_after_seconds: 0 }, { allowed: false, retry_after_seconds: 3601 },
    { allowed: false, retry_after_seconds: 1.5 }, { allowed: 'true', retry_after_seconds: 0 }]) {
    assert.throws(() => parseQuotaDecision(bad));
    const handler = createRequestHandler({
      userId: async () => 'verified', readAccessSnapshot: async () => snapshot,
      consumeQuota: async () => parseQuotaDecision(bad), now: () => now,
    });
    const response = await handler(request('valid'));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '5');
    assert.equal((await response.json()).code, 'QUOTA_UNAVAILABLE');
  }
  assert.deepEqual(parseQuotaDecision({ allowed: true, retry_after_seconds: 0 }), allowed);
  assert.deepEqual(parseQuotaDecision({ allowed: false, retry_after_seconds: 3600 }), { allowed: false, retryAfterSeconds: 3600 });
});

Deno.test('Pro revocation is checked before quotas and disabled quotas preserve the existing response', async () => {
  let subscribed = true, charges = 0;
  const deps = {
    userId: async () => 'verified',
    readAccessSnapshot: async () => ({ ...snapshot, is_subscribed: subscribed }),
    now: () => now,
  };
  const withoutQuota = createRequestHandler(deps);
  const withQuota = createRequestHandler({ ...deps, consumeQuota: async () => { charges++; return allowed; } });
  assert.deepEqual(await (await withoutQuota(request('valid'))).json(), await (await withQuota(request('valid'))).json());
  subscribed = false;
  assert.equal((await withQuota(request('valid'))).status, 403);
  assert.equal(charges, 1);
});

Deno.test('public SPY bypasses authentication and quotas, including during limiter failures', async () => {
  const unexpected = async () => { throw Error('Public SPY must not call this'); };
  const guard = createOptionsAccessGuard({ userId: unexpected, subscribed: unexpected, consumeQuota: unexpected });
  assert.equal(await guard(request(), 'SPY'), null);
  assert.equal(await guard(request('invalid'), 'SPY'), null);
});

Deno.test('all premium tickers share the verified user budget after authorization', async () => {
  const ids: string[] = [];
  let subscribed = true;
  const guard = createOptionsAccessGuard({
    userId: async token => token === 'invalid' ? null : 'verified-user',
    subscribed: async () => subscribed,
    consumeQuota: async id => {
      ids.push(id);
      return ids.length <= 2 ? allowed : { allowed: false, retryAfterSeconds: 58 };
    },
  });
  assert.equal((await guard(request(), 'QQQ'))?.status, 401);
  assert.equal((await guard(request('invalid'), 'NVDA'))?.status, 401);
  assert.equal(await guard(request('valid'), 'QQQ'), null);
  assert.equal(await guard(request('refreshed'), 'NVDA'), null);
  const limited = await guard(request('valid'), 'AAPL');
  assert.equal(limited?.status, 429);
  assert.equal(limited?.headers.get('Retry-After'), '58');
  assert.equal(limited?.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(ids, ['verified-user', 'verified-user', 'verified-user']);
  subscribed = false;
  assert.equal((await guard(request('valid'), 'QQQ'))?.status, 403);
  assert.equal(ids.length, 3);
});

Deno.test('premium Options limiter outage returns 503; omitted limiter preserves authorized access', async () => {
  const deps = { userId: async () => 'verified', subscribed: async () => true };
  assert.equal(await createOptionsAccessGuard(deps)(request('valid'), 'QQQ'), null);
  const guard = createOptionsAccessGuard({ ...deps, consumeQuota: async () => { throw Error('secret database detail'); } });
  const response = await guard(request('valid'), 'QQQ');
  assert.equal(response?.status, 503);
  assert.equal(response?.headers.get('Retry-After'), '5');
  assert.ok(!(await response!.text()).includes('secret database detail'));
});

Deno.test('disabled, missing, malformed or unavailable runtime control bypasses quota without consuming', async () => {
  for (const control of [{ enabled: false }, null, {}, [], true, { enabled: 'true' }, { enabled: 1 }]) {
    const consume = createRuntimeQuotaConsumer({
      readControl: async () => control,
      consume: async () => { throw Error('Counter RPC must not be called'); },
    });
    assert.deepEqual(await consume('verified-user'), allowed);
  }
  let reads = 0;
  const consumer = createRuntimeQuotaConsumer({
    readControl: async () => { reads++; throw Error('control service unavailable'); },
    consume: async () => { throw Error('Counter RPC must not be called'); },
  });
  assert.deepEqual(await consumer('verified-user'), allowed);
  assert.deepEqual(await consumer('verified-user'), allowed);
  assert.equal(reads, 2); // no instance cache, including unavailable results
});

Deno.test('same long-lived Pro and Options handlers honor runtime disable without reconstruction', async () => {
  let enabled = false, reads = 0, charges = 0;
  const consumer = createRuntimeQuotaConsumer({
    readControl: async () => { reads++; return { enabled }; },
    consume: async () => { charges++; return { allowed: false, retry_after_seconds: 19 }; },
  });
  const pro = createRequestHandler({
    userId: async () => 'verified', readAccessSnapshot: async () => snapshot,
    consumeQuota: consumer, now: () => now,
  });
  const options = createOptionsAccessGuard({
    userId: async () => 'verified', subscribed: async () => true, consumeQuota: consumer,
  });
  assert.equal((await pro(request('valid'))).status, 200);
  assert.equal(await options(request('valid'), 'QQQ'), null);
  assert.equal(charges, 0);
  enabled = true;
  assert.equal((await pro(request('valid'))).status, 429);
  assert.equal((await options(request('valid'), 'QQQ'))?.status, 429);
  assert.equal(charges, 2);
  enabled = false;
  assert.equal((await pro(request('valid'))).status, 200);
  assert.equal(await options(request('valid'), 'QQQ'), null);
  assert.equal(charges, 2);
  assert.equal(reads, 8); // fresh initial reads plus rechecks of both denials
});

Deno.test('concurrent long-lived requests recheck runtime control after an in-flight denial', async () => {
  let enabled = true;
  let reached = 0;
  let release!: () => void, bothReached!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const barrier = new Promise<void>(resolve => { bothReached = resolve; });
  const consumer = createRuntimeQuotaConsumer({
    readControl: async () => ({ enabled }),
    consume: async () => {
      if (++reached === 2) bothReached();
      await delayed;
      return { allowed: false, retry_after_seconds: 30 };
    },
  });
  const pro = createRequestHandler({
    userId: async token => token, readAccessSnapshot: async () => snapshot,
    consumeQuota: consumer, now: () => now,
  });
  const requests = [pro(request('alice')), pro(request('bob'))];
  await barrier;
  enabled = false;
  release();
  assert.deepEqual((await Promise.all(requests)).map(r => r.status), [200, 200]);
  assert.equal((await pro(request('alice'))).status, 200);
  assert.equal(reached, 2);
});

Deno.test('limiter failure rechecks control: disabled or unverified recovers, verified enabled remains 503', async () => {
  for (const afterFailure of ['disabled', 'missing', 'unavailable', 'enabled'] as const) {
    let failed = false, reads = 0;
    const consumer = createRuntimeQuotaConsumer({
      readControl: async () => {
        reads++;
        if (!failed) return { enabled: true };
        if (afterFailure === 'unavailable') throw Error('control timeout');
        if (afterFailure === 'missing') return null;
        return { enabled: afterFailure === 'enabled' };
      },
      consume: async () => { failed = true; throw Error('private limiter failure'); },
    });
    const pro = createRequestHandler({
      userId: async () => 'verified', readAccessSnapshot: async () => snapshot,
      consumeQuota: consumer, now: () => now,
    });
    const response = await pro(request('valid'));
    assert.equal(response.status, afterFailure === 'enabled' ? 503 : 200);
    assert.equal(reads, 2);
    if (response.status === 503) {
      assert.equal(response.headers.get('Retry-After'), '5');
      assert.equal((await response.json()).code, 'QUOTA_UNAVAILABLE');
    }
  }
});

Deno.test('malformed limiter response with confirmed enabled runtime control returns 503', async () => {
  let reads = 0;
  const consumer = createRuntimeQuotaConsumer({
    readControl: async () => { reads++; return { enabled: true }; },
    consume: async () => ({ allowed: 'true', retry_after_seconds: 0 }),
  });
  const options = createOptionsAccessGuard({
    userId: async () => 'verified', subscribed: async () => true, consumeQuota: consumer,
  });
  assert.equal((await options(request('valid'), 'QQQ'))?.status, 503);
  assert.equal(reads, 2);
});

Deno.test('unknown control never bypasses JWT, current membership, or public SPY isolation', async () => {
  let controlReads = 0, subscribed = true;
  const consumer = createRuntimeQuotaConsumer({
    readControl: async () => { controlReads++; throw Error('control down'); },
    consume: async () => { throw Error('must not consume'); },
  });
  const pro = createRequestHandler({
    userId: async token => token === 'valid' ? 'verified' : null,
    readAccessSnapshot: async () => ({ ...snapshot, is_subscribed: subscribed }),
    consumeQuota: consumer, now: () => now,
  });
  const options = createOptionsAccessGuard({
    userId: async token => token === 'valid' ? 'verified' : null,
    subscribed: async () => subscribed, consumeQuota: consumer,
  });
  assert.equal((await pro(request('valid'))).status, 200);
  assert.equal(await options(request('valid'), 'QQQ'), null);
  assert.equal(controlReads, 2);
  subscribed = false;
  assert.equal((await pro(request('valid'))).status, 403);
  assert.equal((await options(request('valid'), 'QQQ'))?.status, 403);
  assert.equal((await pro(request('invalid'))).status, 401);
  assert.equal((await options(request('invalid'), 'QQQ'))?.status, 401);
  assert.equal(await options(request('invalid'), 'SPY'), null);
  assert.equal(controlReads, 2);
});
