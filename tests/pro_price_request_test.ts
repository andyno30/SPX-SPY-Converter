import assert from 'node:assert/strict';
import { createRequestHandler } from '../supabase/functions/get-live-price-pro/request.ts';

const now = Date.parse('2026-10-02T15:00:00Z');
const saved = {
  is_subscribed: true,
  quotes: [{ symbol: 'SPY', regularMarketPrice: 650 }, { symbol: '^GSPC', regularMarketPrice: 6500 }],
  fetched_at: new Date(now).toISOString(),
};
const request = (token?: string, method = 'GET') => new Request('https://local/prices', {
  method, headers: token ? { Authorization: `Bearer ${token}` } : {},
});

Deno.test('one combined read per valid GET; preflight caching never caches subscription access', async () => {
  let identities = 0, reads = 0, subscribed = true;
  const handler = createRequestHandler({
    userId: async token => { identities++; return token === 'valid' ? 'user' : null; },
    readAccessSnapshot: async () => { reads++; return { ...saved, is_subscribed: subscribed }; },
    now: () => now,
  });
  const preflight = await handler(request(undefined, 'OPTIONS'));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Max-Age'), '3600');
  assert.equal(reads, 0);
  assert.equal(identities, 0);
  assert.equal((await handler(request())).status, 401);
  assert.equal((await handler(request('invalid'))).status, 401);
  assert.equal(reads, 0);
  const good = await handler(request('valid'));
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(good.headers.get('Access-Control-Max-Age'), null);
  assert.equal((await good.json())['SPX/SPY Ratio'], 10);
  subscribed = false;
  assert.equal((await handler(request('valid'))).status, 403);
  assert.equal(reads, 2);
  assert.equal(identities, 3);
});

Deno.test('concurrent requests cannot reuse another request\'s subscription or snapshot', async () => {
  let finishFirst!: (value: unknown) => void;
  const pendingFirst = new Promise(resolve => { finishFirst = resolve; });
  const handler = createRequestHandler({
    userId: async token => token,
    readAccessSnapshot: async id => id === 'first' ? pendingFirst : {
      ...saved, quotes: [{ symbol: 'SPY', regularMarketPrice: 500 }, { symbol: '^GSPC', regularMarketPrice: 6500 }],
    },
    now: () => now,
  });
  const first = handler(request('first'));
  const second = await handler(request('second'));
  assert.equal((await second.json())['SPX/SPY Ratio'], 13);
  finishFirst({ is_subscribed: false, quotes: null, fetched_at: null });
  assert.equal((await first).status, 403);
});

Deno.test('combined read rejects malformed access, missing/stale prices, and database failures', async () => {
  for (const value of [null, [], {}, { ...saved, is_subscribed: 'true' },
    { ...saved, quotes: null }, { ...saved, fetched_at: new Date(now - 120_001).toISOString() }]) {
    const handler = createRequestHandler({ userId: async () => 'user', readAccessSnapshot: async () => value, now: () => now });
    const response = await handler(request('valid'));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).message, 'Unable to refresh Pro prices. Please try again.');
  }
  const handler = createRequestHandler({ userId: async () => 'user', readAccessSnapshot: async () => { throw Error('unavailable'); } });
  assert.equal((await handler(request('valid'))).status, 503);
});
