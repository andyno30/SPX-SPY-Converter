import assert from 'node:assert/strict';
import { createUpdater } from '../supabase/functions/refresh-pro-prices/updater.ts';
import type { Quote } from '../supabase/functions/get-live-price-pro/pricing.ts';

type UpdaterDeps = Parameters<typeof createUpdater>[0];
const quotes: Quote[] = [
  { symbol: 'SPY', regularMarketPrice: 760 },
  { symbol: '^GSPC', regularMarketPrice: 7600 },
  { symbol: 'ES=F', regularMarketPrice: 7600, quoteType: 'FUTURE',
    regularMarketTime: new Date('2026-09-14T13:18:00Z'), expireDate: new Date('2026-09-18') },
];
const request = (method = 'POST') => new Request('https://local/refresh-pro-prices', { method });

function dependencies(overrides: Partial<UpdaterDeps> = {}): UpdaterDeps {
  return {
    authorized: () => true,
    claim: async () => 'test-claim',
    fetchQuotes: async () => quotes,
    complete: async () => {},
    release: async () => {},
    ...overrides,
  };
}

Deno.test('Updater rejects unauthorized callers before claiming, fetching, or writing', async () => {
  const operations: string[] = [];
  const updater = createUpdater(dependencies({
    authorized: () => false,
    claim: async () => { operations.push('claim'); return 'test-claim'; },
    fetchQuotes: async () => { operations.push('fetch'); return quotes; },
    complete: async () => { operations.push('complete'); },
    release: async () => { operations.push('release'); },
  }));
  assert.equal((await updater(request())).status, 401);
  assert.deepEqual(operations, []);
});

Deno.test('Private updater only accepts POST, including rejecting browser preflight', async () => {
  const operations: string[] = [];
  const updater = createUpdater(dependencies({
    authorized: () => { operations.push('authorize'); return true; },
    claim: async () => { operations.push('claim'); return 'test-claim'; },
    fetchQuotes: async () => { operations.push('fetch'); return quotes; },
    complete: async () => { operations.push('complete'); },
    release: async () => { operations.push('release'); },
  }));
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal((await updater(request(method))).status, 405);
  }
  assert.deepEqual(operations, []);
});

Deno.test('A denied refresh claim skips provider access and storage writes', async () => {
  const operations: string[] = [];
  const updater = createUpdater(dependencies({
    claim: async () => { operations.push('claim'); return null; },
    fetchQuotes: async () => { operations.push('fetch'); return quotes; },
    complete: async () => { operations.push('complete'); },
    release: async () => { operations.push('release'); },
  }));
  const response = await updater(request());
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.deepEqual(operations, ['claim']);
});

Deno.test('One winning shared claim permits one provider batch across independent concurrent updaters', async () => {
  let claimed = false;
  let claims = 0, fetches = 0, completions = 0, releases = 0;
  const shared = dependencies({
    claim: async () => {
      claims++;
      if (claimed) return null;
      claimed = true;
      return 'shared-claim';
    },
    fetchQuotes: async () => { fetches++; await Promise.resolve(); return quotes; },
    complete: async (claim, received) => {
      assert.equal(claim, 'shared-claim');
      assert.deepEqual(received, quotes);
      completions++;
    },
    release: async () => { releases++; },
  });
  const responses = await Promise.all(Array.from({ length: 16 }, () =>
    createUpdater(shared)(request())
  ));
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal(responses.filter(response => response.status === 204).length, 15);
  assert.equal(claims, 16);
  assert.equal(fetches, 1);
  assert.equal(completions, 1);
  assert.equal(releases, 0);
});

Deno.test('Provider failure releases its claim once without automatic retry or replacing stored prices', async () => {
  let cooldownActive = false;
  let claims = 0, fetches = 0, completions = 0;
  const released: string[] = [];
  const secretMarker = 'FAKE_PRIVATE_PROVIDER_ERROR';
  const updater = createUpdater(dependencies({
    claim: async () => {
      claims++;
      if (cooldownActive) return null;
      cooldownActive = true;
      return 'failed-claim';
    },
    fetchQuotes: async () => { fetches++; throw new Error(secretMarker); },
    complete: async () => { completions++; },
    release: async claim => { released.push(claim); },
  }));
  const response = await updater(request());
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes(secretMarker));
  assert.equal(fetches, 1);
  assert.equal(completions, 0);
  assert.deepEqual(released, ['failed-claim']);
  // Releasing a failed lease does not erase the shared database cooldown.
  assert.equal((await updater(request())).status, 204);
  assert.equal(claims, 2);
  assert.equal(fetches, 1);
  assert.equal(completions, 0);
  assert.deepEqual(released, ['failed-claim']);
});

Deno.test('Snapshot persistence failure releases the winning claim without a second provider fetch', async () => {
  let fetches = 0, completions = 0;
  const released: string[] = [];
  const updater = createUpdater(dependencies({
    fetchQuotes: async () => { fetches++; return quotes; },
    complete: async () => { completions++; throw new Error('FAKE_PRIVATE_DATABASE_ERROR'); },
    release: async claim => { released.push(claim); },
  }));
  const response = await updater(request());
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('FAKE_PRIVATE_DATABASE_ERROR'));
  assert.equal(fetches, 1);
  assert.equal(completions, 1);
  assert.deepEqual(released, ['test-claim']);
});

Deno.test('Claim failure never contacts the provider or attempts to release an unowned claim', async () => {
  const operations: string[] = [];
  const updater = createUpdater(dependencies({
    claim: async () => { throw new Error('FAKE_PRIVATE_DATABASE_ERROR'); },
    fetchQuotes: async () => { operations.push('fetch'); return quotes; },
    complete: async () => { operations.push('complete'); },
    release: async () => { operations.push('release'); },
  }));
  const response = await updater(request());
  assert.equal(response.status, 503);
  assert.deepEqual(operations, []);
});

Deno.test('Cleanup failure still returns a generic unavailable response without retrying', async () => {
  let fetches = 0, releases = 0;
  const logs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const updater = createUpdater(dependencies({
      fetchQuotes: async () => { fetches++; throw new Error('FAKE_PRIVATE_PROVIDER_ERROR'); },
      release: async () => { releases++; throw new Error('FAKE_PRIVATE_CLEANUP_ERROR'); },
    }));
    const response = await updater(request());
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('FAKE_PRIVATE_'));
    assert.ok(!logs.flat().map(String).join(' ').includes('FAKE_PRIVATE_'));
    assert.equal(fetches, 1);
    assert.equal(releases, 1);
  } finally {
    console.error = originalError;
  }
});
