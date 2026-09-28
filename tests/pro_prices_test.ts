import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/get-live-price-pro/handler.ts';
import { createAuthorizer } from '../supabase/functions/get-live-price-pro/authorization.ts';
import { ES_CONTRACTS, parseContract, priceResponse, type Quote, SYMBOLS } from '../supabase/functions/get-live-price-pro/pricing.ts';
import { createSnapshotReader, MAX_FUTURE_SKEW_MS, MAX_SNAPSHOT_AGE_MS } from '../supabase/functions/get-live-price-pro/snapshot.ts';

export const NOW = Date.parse('2026-09-14T13:30:00Z');
export const fixtureQuotes: Quote[] = Object.values(SYMBOLS).map<Quote>(symbol => ({
  symbol, regularMarketPrice: symbol === 'SPY' ? 760 : symbol === '^GSPC' ? 7600 : 100,
})).concat([
  { symbol: 'ES=F', regularMarketPrice: 7600, shortName: 'E-Mini S&P 500 Sep 26', quoteType: 'FUTURE', regularMarketTime: '2026-09-14T13:18:00Z', expireDate: '2026-09-18', exchangeDataDelayedBy: 10 },
  ...ES_CONTRACTS.map((c, i) => ({ symbol: c.symbol, regularMarketPrice: 7600 + i * 70,
    quoteType: 'FUTURE', regularMarketTime: '2026-09-14T13:18:00Z',
    expireDate: ['2026-09-18','2026-12-18','2027-03-19','2027-06-17','2027-09-17'][i],
    exchangeDataDelayedBy: 10 })),
]);
const snapshot = { quotes: fixtureQuotes, fetchedAt: new Date(NOW).toISOString() };
const storedSnapshot = { quotes: fixtureQuotes, fetched_at: snapshot.fetchedAt };
const makeRequest = (query = '', token?: string, method = 'GET') => new Request(`http://localhost/prices${query}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });

Deno.test('Auto preserves generic fields and reports Yahoo underlying expiration', () => {
  const data = priceResponse(snapshot, 'AUTO', NOW)!;
  assert.equal(data.ESSymbol, 'ES=F'); assert.equal(data.ESContract, 'ESU26');
  assert.equal(data.Prices.ES, 7600); assert.equal(data['ES/SPY Ratio'], 10);
  assert.equal(data['ES/SPX Ratio'], 1); assert.equal(data.ESContracts.length, 5);
});
Deno.test('December and March use distinct quotes for both ES ratios; all unrelated values stay equal', () => {
  const auto = priceResponse(snapshot, 'AUTO', NOW)!;
  for (const [contract, value] of [['ESZ26',7670],['ESH27',7740]] as const) {
    const data = priceResponse(snapshot, contract, NOW)!;
    assert.equal(data.ESSymbol, `${contract}.CME`); assert.equal(data.Prices.ES, value);
    assert.equal(data['ES/SPY Ratio'], value / 760); assert.equal(data['ES/SPX Ratio'], value / 7600);
    for (const ticker of Object.keys(SYMBOLS) as (keyof typeof SYMBOLS)[]) {
      if (ticker !== 'ES') assert.equal(data.Prices[ticker], auto.Prices[ticker]);
    }
    for (const key of ['SPX/SPY Ratio','NQ/QQQ Ratio','NDX/QQQ Ratio'] as const) assert.equal(data[key], auto[key]);
  }
});
Deno.test('Allowlist rejects arbitrary, duplicate, empty, unlisted and malformed symbols', () => {
  for (const query of ['?esContract=AAPL','?esContract=ESZ27','?esContract=ESZ26.CME','?esContract=', '?esContract=ESZ26&esContract=ESH27','?esContract=__proto__','?esContract=esz26']) assert.equal(parseContract(`http://local/${query}`), null);
  assert.equal(parseContract('http://local'), 'AUTO');
  assert.equal(parseContract('http://local?esContract=AUTO'), 'AUTO');
});
Deno.test('Unavailable, expired, wrong-expiration and nonfinite quotes are omitted with no fallback', () => {
  for (const update of [{regularMarketPrice: NaN}, {regularMarketPrice: undefined, previousClose: 7700}, {regularMarketPrice: 0}, {expireDate:'2026-09-18'}, {regularMarketTime:undefined}, {quoteType:'EQUITY'}]) {
    const changed = fixtureQuotes.map(q => q.symbol === 'ESZ26.CME' ? {...q,...update} : q);
    assert.equal(priceResponse({...snapshot,quotes:changed},'ESZ26',NOW), null);
    assert.ok(!priceResponse({...snapshot,quotes:changed},'AUTO',NOW)!.ESContracts.some(c => c.contract === 'ESZ26'));
  }
  assert.equal(priceResponse(snapshot,'ESZ26',Date.parse('2026-12-19')), null);
  assert.equal(priceResponse({...snapshot, quotes:fixtureQuotes.filter(q => q.symbol !== 'ESZ26.CME')},'ESZ26',NOW), null);
});
Deno.test('Shared snapshot reader accepts data through two minutes and rejects anything older', async () => {
  let time = NOW;
  const read = createSnapshotReader(async () => storedSnapshot, () => time);
  assert.equal(MAX_SNAPSHOT_AGE_MS, 120_000);
  assert.deepEqual(await read(), snapshot);
  time = NOW + MAX_SNAPSHOT_AGE_MS - 1;
  assert.deepEqual(await read(), snapshot);
  time++;
  assert.deepEqual(await read(), snapshot);
  time++;
  await assert.rejects(read());
});
Deno.test('Shared snapshot reader rejects missing, malformed, and future database records', async () => {
  for (const record of [
    null,
    { quotes: fixtureQuotes, fetched_at: null },
    { quotes: fixtureQuotes, fetched_at: NOW },
    { quotes: fixtureQuotes, fetched_at: 'not-a-date' },
    { quotes: fixtureQuotes, fetched_at: new Date(NOW + MAX_FUTURE_SKEW_MS + 1).toISOString() },
    { quotes: null, fetched_at: snapshot.fetchedAt },
    { quotes: {}, fetched_at: snapshot.fetchedAt },
    { quotes: [], fetched_at: snapshot.fetchedAt },
    { quotes: [null], fetched_at: snapshot.fetchedAt },
    { quotes: [{ symbol: 123 }], fetched_at: snapshot.fetchedAt },
    { quotes: [{ symbol: '' }], fetched_at: snapshot.fetchedAt },
  ]) {
    await assert.rejects(createSnapshotReader(async () => record, () => NOW)());
  }
});
Deno.test('Shared snapshot reader tolerates five seconds of database clock skew and partial instruments', async () => {
  assert.equal(MAX_FUTURE_SKEW_MS, 5_000);
  const record = {
    quotes: [{ symbol: 'SPY' }],
    fetched_at: new Date(NOW + MAX_FUTURE_SKEW_MS).toISOString(),
  };
  assert.deepEqual(await createSnapshotReader(async () => record, () => NOW)(), {
    quotes: record.quotes,
    fetchedAt: record.fetched_at,
  });
});
Deno.test('Database serialization preserves all prices, ratios, contracts, and quote datetimes', async () => {
  const datedQuotes = fixtureQuotes.map(quote => ({
    ...quote,
    ...(quote.regularMarketTime ? { regularMarketTime: new Date(quote.regularMarketTime) } : {}),
    ...(quote.expireDate ? { expireDate: new Date(quote.expireDate) } : {}),
  }));
  const record = JSON.parse(JSON.stringify({ quotes: datedQuotes, fetched_at: snapshot.fetchedAt }));
  const restored = await createSnapshotReader(async () => record, () => NOW)();
  for (const selection of ['AUTO', ...ES_CONTRACTS.map(contract => contract.contract)]) {
    assert.deepEqual(
      priceResponse(restored, selection, NOW),
      priceResponse({ ...snapshot, quotes: datedQuotes }, selection, NOW),
    );
  }
});
Deno.test('Snapshot reads see database changes and fail closed on database outages without old-data fallback', async () => {
  let record = storedSnapshot;
  let unavailable = false;
  const read = createSnapshotReader(async () => {
    if (unavailable) throw new Error('database unavailable');
    return record;
  }, () => NOW);
  assert.deepEqual(await read(), snapshot);
  record = { ...record, quotes: fixtureQuotes.map(quote => quote.symbol === 'SPY'
    ? { ...quote, regularMarketPrice: 800 } : quote) };
  assert.equal(priceResponse(await read(), 'AUTO', NOW)!['SPX/SPY Ratio'], 9.5);
  unavailable = true;
  await assert.rejects(read());
});
Deno.test('Authorizer trusts verified user identity and exact server subscription boolean only', async () => {
  const ids: string[] = [];
  const auth = createAuthorizer({ userId: async token => token === 'valid' ? 'verified-user' : null,
    subscribed: async id => { ids.push(id); return true; } });
  assert.equal(await auth('invalid'),'unauthorized'); assert.equal(ids.length,0);
  assert.equal(await auth('valid'),'allowed'); assert.deepEqual(ids,['verified-user']);
  assert.equal(await createAuthorizer({userId: async () => 'free',subscribed: async () => false})('valid'),'forbidden');
});
Deno.test('Every endpoint GET requires valid Pro access before reading the shared snapshot', async () => {
  let reads = 0, checks = 0;
  const handle = createHandler({ authorize: async token => { checks++; return token === 'pro' ? 'allowed' : token === 'free' ? 'forbidden' : 'unauthorized'; },
    snapshot: createSnapshotReader(async () => { reads++; return storedSnapshot; }, () => NOW), now: () => NOW });
  assert.equal((await handle(makeRequest('?esContract=ESZ26'))).status,401); assert.equal(reads,0);
  assert.equal((await handle(makeRequest('?esContract=ESZ26','free'))).status,403); assert.equal(reads,0);
  const good = await handle(makeRequest('?esContract=ESZ26','pro')); assert.equal(good.status,200);
  assert.equal((await good.json()).ESContract,'ESZ26'); assert.equal(good.headers.get('Cache-Control'),'private, no-store');
  assert.equal((await handle(makeRequest('','bad'))).status,401);
  assert.equal((await handle(makeRequest('','free'))).status,403);
  assert.equal((await handle(makeRequest(''))).status,401);
  assert.equal((await handle(makeRequest('?esContract=ESH27','pro'))).status,200);
  assert.equal(reads,2); assert.equal(checks,5);
  assert.equal((await handle(makeRequest('?esContract=AAPL','pro'))).status,400); assert.equal(reads,2);
  assert.equal((await handle(makeRequest('',undefined,'OPTIONS'))).status,204);
  assert.equal((await handle(makeRequest('','pro','POST'))).status,405);
});
Deno.test('A burst across independent GET handlers only authorizes and reads the same stored quotes', async () => {
  let reads = 0, checks = 0;
  const selections = ['AUTO', 'ESZ26', 'ESH27'];
  const handlers = Array.from({ length: 4 }, () => createHandler({
    authorize: async () => { checks++; return 'allowed'; },
    snapshot: createSnapshotReader(async () => { reads++; return storedSnapshot; }, () => NOW),
    now: () => NOW,
  }));
  const responses = await Promise.all(Array.from({ length: 48 }, (_, index) =>
    handlers[index % handlers.length](makeRequest(`?esContract=${selections[index % selections.length]}`, 'pro'))
  ));
  assert.equal(checks, 48);
  assert.equal(reads, 48);
  for (const [index, response] of responses.entries()) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), priceResponse(snapshot, selections[index % selections.length], NOW));
  }
});
Deno.test('Pro GET returns unavailable for missing or expired shared snapshots', async () => {
  for (const record of [null, { ...storedSnapshot, fetched_at: new Date(NOW - MAX_SNAPSHOT_AGE_MS - 1).toISOString() }]) {
    let reads = 0;
    const handle = createHandler({
      authorize: async () => 'allowed',
      snapshot: createSnapshotReader(async () => { reads++; return record; }, () => NOW),
      now: () => NOW,
    });
    assert.equal((await handle(makeRequest('', 'pro'))).status, 503);
    assert.equal(reads, 1);
  }
});
Deno.test('Subscription lookup failures fail closed; missing explicit quote returns 503', async () => {
  const handle = createHandler({authorize: async () => {throw Error('db');},snapshot: async () => {throw Error('must not fetch');}});
  assert.equal((await handle(makeRequest('','pro'))).status,503);
  const missing = createHandler({authorize: async () => 'allowed',snapshot: async () => ({...snapshot,quotes:[]}),now: () => NOW});
  const response = await missing(makeRequest('?esContract=ESZ26','pro'));
  assert.equal(response.status,503); assert.equal((await response.json()).code,'es_contract_unavailable');
});
