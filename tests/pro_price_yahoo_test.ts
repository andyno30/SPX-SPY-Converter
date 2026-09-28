import assert from 'node:assert/strict';
import {
  createBoundedYahooFetch, createYahooFetcher, type SafeYahooRequestEvent,
} from '../supabase/functions/refresh-pro-prices/yahoo.ts';

Deno.test('Yahoo HTTP budget counts session setup and stops before another fetch', async () => {
  let calls = 0;
  const bounded = createBoundedYahooFetch(async () => {
    calls++;
    return new Response('cookie');
  }, new AbortController().signal, 8);
  for (let i = 0; i < 8; i++) await bounded('https://finance.yahoo.com/quote/AAPL');
  await assert.rejects(bounded('https://query2.finance.yahoo.com/v7/finance/quote'), /request_budget_exceeded/);
  assert.equal(calls, 8);
});

Deno.test('Yahoo wrapper rejects unapproved URLs before any network request', async () => {
  let calls = 0;
  const bounded = createBoundedYahooFetch(async () => {
    calls++;
    return new Response();
  }, new AbortController().signal);
  for (const url of [
    'http://finance.yahoo.com/', 'https://finance.yahoo.com.attacker.example/',
    'https://secret@finance.yahoo.com/', 'https://localhost/',
    'https://finance.yahoo.com:444/', 'file:///tmp/example',
  ]) await assert.rejects(bounded(url), /provider_host_rejected/);
  assert.equal(calls, 0);
});

Deno.test('Yahoo session redirects and cookie-bearing 404s are preserved with manual redirects', async () => {
  const seen: RequestInit[] = [];
  const bounded = createBoundedYahooFetch(async (_input, init) => {
    seen.push(init!);
    return new Response(null, { status: seen.length === 1 ? 302 : 404, headers: { 'set-cookie': 'A=secret' } });
  }, new AbortController().signal);
  assert.equal((await bounded('https://guce.yahoo.com/consent')).status, 302);
  assert.equal((await bounded('https://fc.yahoo.com/')).status, 404);
  assert.ok(seen.every(init => init.redirect === 'manual'));
});

Deno.test('Yahoo quote errors and request logs omit query secrets and response bodies', async () => {
  const events: SafeYahooRequestEvent[] = [];
  const bounded = createBoundedYahooFetch(async () =>
    new Response('private response body', { status: 429 }),
  new AbortController().signal, 8, event => events.push(event));
  await assert.rejects(
    bounded('https://query2.finance.yahoo.com/v7/finance/quote?crumb=private-crumb'),
    error => error instanceof Error && error.message === 'provider_quote_http_error',
  );
  assert.equal(events[0].status, 429);
  assert.equal(events[0].endpoint, 'quote');
  assert.doesNotMatch(JSON.stringify(events), /private|crumb|cookie|https/);
});

Deno.test('Yahoo expired deadline rejects without using the network', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const bounded = createBoundedYahooFetch(async () => {
    calls++;
    return new Response();
  }, controller.signal);
  await assert.rejects(bounded('https://finance.yahoo.com/quote/AAPL'), /deadline_exceeded/);
  assert.equal(calls, 0);
});

Deno.test('Yahoo refresh uses one quote call and preserves supported quote filtering', async () => {
  let calls = 0;
  let requestSignal: AbortSignal | null | undefined;
  const fetchQuotes = createYahooFetcher({
    async quote(symbols, _query, options) {
      calls++;
      assert.ok(symbols.includes('SPY') && symbols.includes('ES=F'));
      requestSignal = options.fetchOptions.signal;
      return [
        { symbol: 'SPY', quoteType: 'ETF', regularMarketPrice: 600 },
        { symbol: 'ES=F', quoteType: 'FUTURE', regularMarketPrice: 6500 },
        { symbol: 'ignored', quoteType: 'CURRENCY' }, null,
      ];
    },
  });
  assert.deepEqual((await fetchQuotes()).map(quote => quote.symbol), ['SPY', 'ES=F']);
  assert.equal(calls, 1);
  assert.equal(requestSignal!.aborted, true);
});

Deno.test('Yahoo library failures are sanitized and never retried within an attempt', async () => {
  let calls = 0;
  const fetchQuotes = createYahooFetcher({
    quote() {
      calls++;
      throw new Error('private crumb and cookie');
    },
  });
  await assert.rejects(fetchQuotes(), error =>
    error instanceof Error && error.message === 'provider_refresh_failed');
  assert.equal(calls, 1);
});

Deno.test('Yahoo overall deadline ends a hung quote and aborts its shared signal', async () => {
  let signal: AbortSignal | null | undefined;
  const fetchQuotes = createYahooFetcher({
    quote(_symbols, _query, options) {
      signal = options.fetchOptions.signal;
      return new Promise(() => {});
    },
  }, { timeoutMs: 5 });
  await assert.rejects(fetchQuotes(), /deadline_exceeded/);
  assert.equal(signal!.aborted, true);
});
