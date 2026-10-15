// Run with: node --test tests/news_ingestion_auth_test.cjs
// Execute the real handlers with isolated environments and no external I/O.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('../news-app/node_modules/typescript');

function execute(relativePath, globals) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const context = vm.createContext({ exports: {}, Request, Response, Headers, URL, ...globals });
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context;
}

function edge(secret) {
  const effects = [];
  let handler;
  const context = execute('supabase/functions/fetch-news/index.ts', {
    console: { log() {}, error() {} },
    fetch: async () => { effects.push('fetch'); throw new Error('Unexpected upstream request'); },
    Deno: {
      env: { get: key => ({ PROJECT_URL: 'https://example.invalid', SERVICE_ROLE_KEY: 'test-service-role', FETCH_NEWS_SECRET: secret })[key] },
      serve: callback => { handler = callback; },
    },
    require: name => {
      if (name === 'npm:@supabase/supabase-js@2') return {
        createClient: () => ({ from() { effects.push('database'); throw new Error('Unexpected database access'); } }),
      };
      if (name === '../_shared/upstream-diagnostics.ts') return { logUpstreamFailure() {} };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { handler, effects, isAuthorized: vm.runInContext('isAuthorized', context) };
}

function bridge(env, upstreamStatus = 200) {
  const calls = [];
  const context = execute('news-app/app/api/cron/fetch-news/route.ts', {
    process: { env },
    require: name => {
      assert.equal(name, 'next/server');
      return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    },
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, cache: init.cache, headers: new Headers(init.headers) });
      return Response.json({ inserted: 0 }, { status: upstreamStatus });
    },
  });
  return { ...context.exports, calls };
}

test('Edge ingestion rejects missing or empty configuration before upstream or database work', async () => {
  for (const secret of [undefined, '']) {
    const { handler, effects } = edge(secret);
    for (const method of ['GET', 'POST']) {
      for (const headers of [{}, { 'x-news-cron-secret': 'anything' }, { Authorization: 'Bearer anything' }]) {
        const response = await handler(new Request('https://example.invalid/fetch-news', { method, headers }));
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: 'Unauthorized' });
      }
    }
    assert.deepEqual(effects, []);
  }
});

test('Edge ingestion rejects absent and incorrect credentials when configured', async () => {
  const { handler, effects } = edge('news-secret');
  for (const headers of [{}, { 'x-news-cron-secret': 'wrong' }, { 'x-news-secret': 'wrong' }, { Authorization: 'Bearer wrong' }]) {
    const response = await handler(new Request('https://example.invalid/fetch-news', { method: 'POST', headers }));
    assert.equal(response.status, 401);
  }
  assert.deepEqual(effects, []);
});

test('Edge ingestion retains all existing authorized credential transports', () => {
  const { isAuthorized, effects } = edge('news-secret');
  for (const method of ['GET', 'POST']) {
    for (const headers of [
      { 'x-news-cron-secret': 'news-secret' },
      { 'x-news-secret': 'news-secret' },
      { Authorization: 'Bearer news-secret' },
    ]) assert.equal(isAuthorized(new Request('https://example.invalid/fetch-news', { method, headers })), true);
  }
  assert.deepEqual(effects, []);
});

test('Edge preflight and unsupported-method behavior are unchanged without a secret', async () => {
  const { handler, effects } = edge(undefined);
  const preflight = await handler(new Request('https://example.invalid/fetch-news', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.equal(await preflight.text(), '');
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'GET,POST,OPTIONS');
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /x-news-cron-secret/);
  assert.equal((await handler(new Request('https://example.invalid/fetch-news', { method: 'DELETE' }))).status, 405);
  assert.deepEqual(effects, []);
});

test('Vercel bridge fails closed for missing configuration and incorrect credentials', async () => {
  for (const secret of [undefined, '', 'cron-secret']) {
    const route = bridge({ CRON_SECRET: secret, SUPABASE_FETCH_NEWS_URL: 'https://example.invalid/fetch-news' });
    for (const method of ['GET', 'POST']) {
      for (const headers of [{}, { Authorization: 'Bearer wrong' }]) {
        const response = await route[method](new Request('https://example.invalid/api/cron/fetch-news', { method, headers }));
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: 'Unauthorized' });
      }
    }
    assert.equal(route.calls.length, 0);
  }
});

test('Vercel bridge retains authorized GET and POST forwarding with the separate ingestion secret', async () => {
  const url = 'https://example.invalid/fetch-news';
  for (const method of ['GET', 'POST']) {
    const route = bridge({ CRON_SECRET: 'cron-secret', FETCH_NEWS_SECRET: 'news-secret', SUPABASE_FETCH_NEWS_URL: url });
    const response = await route[method](new Request('https://example.invalid/api/cron/fetch-news', {
      method, headers: { Authorization: 'Bearer cron-secret' },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, status: 200, payload: { inserted: 0 } });
    assert.equal(route.calls.length, 1);
    assert.equal(route.calls[0].url, url);
    assert.equal(route.calls[0].method, 'POST');
    assert.equal(route.calls[0].cache, 'no-store');
    assert.equal(route.calls[0].headers.get('x-news-cron-secret'), 'news-secret');
  }
});

test('Vercel bridge preserves authorized configuration and upstream error responses', async () => {
  const request = () => new Request('https://example.invalid/api/cron/fetch-news', { headers: { Authorization: 'Bearer cron-secret' } });
  const missingTarget = bridge({ CRON_SECRET: 'cron-secret' });
  assert.equal((await missingTarget.GET(request())).status, 500);
  assert.equal(missingTarget.calls.length, 0);
  const deniedUpstream = bridge({ CRON_SECRET: 'cron-secret', SUPABASE_FETCH_NEWS_URL: 'https://example.invalid/fetch-news' }, 401);
  const response = await deniedUpstream.GET(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, status: 401, payload: { inserted: 0 } });
});
