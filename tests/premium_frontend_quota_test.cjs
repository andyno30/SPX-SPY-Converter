// NODE_PATH=/path/to/happy-dom/node_modules node --test tests/premium_frontend_quota_test.cjs
// Executes the actual frontend consumers with a DOM, fake clock, mock auth,
// shared tab storage, and intercepted network. No production requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createContext, runInContext } = require('node:vm');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => readFileSync(path.join(root, name), 'utf8');
const source = name => read(name).replace(/^\s*import .*;\s*$/gm, '').replace(/^export /gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
const storage = () => {
  const values = new Map();
  const queues = new Map();
  const locks = { request: (key, options, callback) => {
    const task = (queues.get(key) || Promise.resolve()).then(callback);
    queues.set(key, task.catch(() => {})); return task;
  } };
  return { values, locks, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};
const response = (status, retry = '120', code = status === 429 ? 'RATE_LIMITED' : 'QUOTA_UNAVAILABLE') => ({
  status, headers: { get: () => retry }, body: { code },
});
function helper(clock = { now: Date.UTC(2026, 9, 15, 17) }, shared = storage()) {
  const ctx = createContext({ console, clock, shared });
  runInContext(source('docs/premium-request-cooldown.js'), ctx);
  const instance = runInContext('createPremiumRequestCooldown({now:()=>clock.now,storage:()=>shared,locks:()=>shared.locks})', ctx);
  return { clock, shared, instance, parse: (value, fallback) => runInContext('retryAfterSeconds', ctx)(value, clock.now, fallback) };
}
function prices(clock, es = 'AUTO') {
  return { Prices: { SPX: 6000, SPY: 600, ES: 6050, NQ: 24000, NDX: 25000, QQQ: 600,
    DJI: 44000, DIA: 440, YM: 44100, RUT: 2200, IWM: 220, RTY: 2210 },
    'SPX/SPY Ratio': 10, 'NQ/QQQ Ratio': 40, 'NDX/QQQ Ratio': 25000 / 600,
    Datetime: new Date(clock.now).toISOString(), ESSelection: es, ESContract: es, ESSymbol: `${es}.CME`,
    ESContracts: [{ contract: 'ESZ26', label: 'December 2026 (ESZ26)' }] };
}
async function consumer(page, { shared = storage(), clock = { now: Date.UTC(2026, 9, 15, 17) }, user = 'user-a', mode = 200, ticker = 'QQQ' } = {}) {
  const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
  const file = { pro: 'docs/premium-feature.html', dow: 'docs/dow-russell-feature.html', chart: 'docs/spx-spy-overlap-chart.html', options: 'options/index.html' }[page];
  const win = new Window({ url: `http://fixture.local/${file}?ticker=${ticker}` });
  win.document.body.innerHTML = read(file).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const state = { user, mode, retry: '120', calls: [], token: 'test-session', deferred: null, statuses: [], refreshes: 0 };
  const timers = [];
  const interval = (callback, ms) => { timers.push({ callback, ms, nextAt: clock.now + ms }); return timers.length; };
  win.setInterval = interval; win.clearInterval = () => {};
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const session = () => state.user ? { user: { id: state.user }, access_token: state.token } : null;
  const query = { select: () => query, eq: () => query, single: async () => ({ data: { is_subscribed: true } }), maybeSingle: async () => ({ data: { is_subscribed: true } }) };
  const ctx = createContext({ document: win.document, window: win, Option: function(text, value) { const option = win.document.createElement('option'); option.textContent = text; option.value = value; return option; },
    AbortController, URL, URLSearchParams, Intl, Date: FakeDate, localStorage: shared, navigator: { locks: shared.locks },
    console: { log() {}, error() {} }, setInterval: interval, clearInterval() {},
    supabase: { auth: { getSession: async () => ({ data: { session: session() } }),
      getUser: async () => ({ data: { user: session()?.user } }),
      refreshSession: async () => { state.refreshes++; state.token = 'renewed-test-session'; return { data: { session: session() } }; } }, from: () => query },
    fetch: async (input, init) => {
      const url = new URL(input, win.location.href); state.calls.push({ url, init, at: clock.now, user: state.user });
      const isOptions = url.pathname.includes('fetch-spy-options');
      const requestedTicker = url.searchParams.get('ticker') || 'SPY';
      const status = isOptions && requestedTicker === 'SPY' ? 200 : state.statuses.shift() || state.mode;
      const body = status === 200 ? isOptions ? { symbol: requestedTicker, currentPrice: 500, source: 'test' } : prices(clock, url.searchParams.get('esContract') || 'AUTO')
        : { code: status === 429 ? 'RATE_LIMITED' : 'QUOTA_UNAVAILABLE' };
      const result = { status, ok: status === 200, headers: { get: () => state.retry }, json: async () => body };
      if (state.deferred) return new Promise(resolve => { state.deferred.resolve = () => resolve(result); });
      return result;
    },
  });
  runInContext(source('docs/premium-request-cooldown.js'), ctx);
  if (page !== 'options') runInContext(source('docs/pro_prices_api.js'), ctx);
  if (page === 'chart') {
    const chart = [...read(file).matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('async function fetchLivePoint'));
    runInContext(chart.replace(/^\s*import .*;\s*$/gm, ''), ctx);
  } else runInContext(source({ pro: 'docs/pro_script.js', dow: 'docs/dow_russell_script.js', options: 'options/options.js' }[page]), ctx);
  await flush();
  const invoke = expression => runInContext(expression, ctx);
  return { win, ctx, clock, shared, state, timers, invoke, el: id => win.document.getElementById(id),
    poll: () => invoke({ pro: 'updateProRatios()', dow: 'updateDowRussellRatios()', chart: 'fetchLivePoint()', options: 'loadData()' }[page]),
    close: () => win.happyDOM.close() };
}

test('Retry-After seconds/date parsing is bounded and invalid headers fall back safely', () => {
  const h = helper();
  assert.equal(h.parse('120'), 120);
  assert.equal(h.parse(new Date(h.clock.now + 90000).toUTCString()), 90);
  assert.equal(h.parse('999999999'), 3600);
  assert.equal(h.parse('0'), 1);
  assert.equal(h.parse('bad'), 60);
  assert.equal(h.parse('-20'), 60);
  assert.equal(h.parse('1.5'), 60);
  assert.equal(h.parse(null, 5), 5);
  assert.equal(h.parse(new Date(h.clock.now - 1000).toUTCString()), 1);
});

test('Shared cooldowns survive tabs/reloads, isolate user/resource and never store credentials', async () => {
  const a = helper(); const r = response(429);
  await a.instance.responseError('user-a', 'pro_prices', r, r.body);
  const tab = helper(a.clock, a.shared), reload = helper(a.clock, a.shared);
  for (const h of [a, tab, reload]) assert.throws(() => h.instance.check('user-a', 'pro_prices'), e => e.code === 'RATE_LIMITED');
  tab.instance.check('user-b', 'pro_prices'); tab.instance.check('user-a', 'options'); tab.instance.check(undefined, 'pro_prices');
  assert.deepEqual(Object.keys(JSON.parse([...a.shared.values.values()][0])).sort(), ['code', 'generation', 'status', 'until']);
  a.clock.now += 120000;
  reload.instance.check('user-a', 'pro_prices');
});

test('Disabled/corrupt storage uses in-memory suppression and a later response cannot shorten cooldown', async () => {
  const h = helper(undefined, { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
  let r = response(429); await h.instance.responseError('a', 'options', r, r.body);
  r = response(503, '5'); await h.instance.responseError('a', 'options', r, r.body);
  assert.throws(() => h.instance.check('a', 'options'), e => e.retryAfterSeconds === 120);
  const shared = storage(); shared.setItem('spyconverter:premium-cooldown:v1:options:a', '{invalid');
  helper(undefined, shared).instance.check('a', 'options');
});

test('Pro consumer keeps prices/calculations on 429/503 and resumes only after cooldown', async () => {
  const s = await consumer('pro');
  try {
    const ratio = s.el('ratio-es-spy').textContent, date = s.el('conversionDate').textContent;
    s.state.mode = 429; await s.poll();
    assert.match(s.el('es-contract-status').textContent, /request limit reached/);
    assert.equal(s.el('ratio-es-spy').textContent, ratio); assert.equal(s.el('conversionDate').textContent, date);
    await s.poll(); assert.equal(s.state.calls.length, 2);
    s.clock.now += 120000; s.state.mode = 503; s.state.retry = '5'; await s.poll();
    assert.match(s.el('es-contract-status').textContent, /temporarily unavailable/);
    assert.equal(s.el('ratio-es-spy').textContent, ratio);
    await s.poll(); assert.equal(s.state.calls.length, 3);
    s.clock.now += 5000; s.state.mode = 200; await s.poll();
    assert.equal(s.state.calls.length, 4); assert.equal(s.el('es-contract-status').hidden, true);
    assert.deepEqual(s.timers.map(t => t.ms), [60000]);
  } finally { await s.close(); }
});

test('Pro contract changes during cooldown never reuse another ES contract or issue requests', async () => {
  const s = await consumer('pro');
  try {
    s.state.mode = 429; await s.poll();
    s.el('es-contract').value = 'ESZ26'; s.el('es-contract').dispatchEvent(new s.win.Event('change')); await flush();
    assert.equal(s.state.calls.length, 2); assert.equal(s.el('ratio-es-spy').textContent, 'N/A');
    assert.equal(s.el('ratio-spx-spy').textContent, '10.00000000');
  } finally { await s.close(); }
});

test('Dow/Russell shows visible quota/outage feedback and retains last data through recovery', async () => {
  const s = await consumer('dow');
  try {
    const date = s.el('conversionDate').textContent, ratio = s.el('ratio-dji-dia').textContent;
    s.state.mode = 429; await s.poll();
    assert.equal(s.el('price-refresh-status').hidden, false); assert.match(s.el('price-refresh-status').textContent, /request limit reached/);
    await s.poll(); assert.equal(s.state.calls.length, 2);
    assert.equal(s.el('conversionDate').textContent, date); assert.equal(s.el('ratio-dji-dia').textContent, ratio);
    s.clock.now += 120000; s.state.mode = 503; s.state.retry = '5'; await s.poll();
    assert.match(s.el('price-refresh-status').textContent, /temporarily unavailable/);
    s.clock.now += 5000; s.state.mode = 200; await s.poll();
    assert.equal(s.el('price-refresh-status').hidden, true); assert.equal(s.state.calls.length, 4);
  } finally { await s.close(); }
});

test('Actual Pro API shares a cooldown with warm Dow tab and reload, but not another account', async () => {
  const a = await consumer('pro'); const b = await consumer('dow', { shared: a.shared, clock: a.clock });
  let reload;
  try {
    a.state.mode = 429; a.state.retry = new Date(a.clock.now + 120000).toUTCString(); await a.poll();
    await b.poll(); assert.equal(b.state.calls.length, 1); assert.match(b.el('price-refresh-status').textContent, /request limit/);
    reload = await consumer('dow', { shared: a.shared, clock: a.clock });
    assert.equal(reload.state.calls.length, 0); assert.equal(reload.el('price-refresh-status').hidden, false);
    b.state.token = 'rotated-test-session'; await b.poll(); assert.equal(b.state.calls.length, 1);
    b.state.user = 'user-b'; await b.poll(); assert.equal(b.state.calls.length, 2);
    b.state.user = 'user-a'; await b.poll(); assert.equal(b.state.calls.length, 2);
    a.clock.now += 120000; await reload.poll(); assert.equal(reload.state.calls.length, 1);
  } finally { await a.close(); await b.close(); if (reload) await reload.close(); }
});

test('Chart polling and manual reset preserve history on 429/503 and recover without rapid retries', async () => {
  const s = await consumer('chart');
  try {
    const points = s.shared.getItem('spxSpyOverlapChartPoints');
    s.state.mode = 429; s.el('reset-chart-data').click(); await flush();
    assert.match(s.el('chart-status').textContent, /request limit reached/);
    assert.equal(s.shared.getItem('spxSpyOverlapChartPoints'), points);
    s.el('reset-chart-data').click(); await flush(); await s.poll(); assert.equal(s.state.calls.length, 2);
    s.clock.now += 120000; s.state.mode = 503; s.state.retry = '5'; await s.poll();
    assert.match(s.el('chart-status').textContent, /temporarily unavailable/);
    assert.equal(s.shared.getItem('spxSpyOverlapChartPoints'), points);
    s.clock.now += 5000; s.state.mode = 200; s.el('reset-chart-data').click(); await flush();
    assert.equal(s.el('point-count').textContent, '1 chart point'); assert.equal(s.state.calls.length, 4);
  } finally { await s.close(); }
});

test('Options manual/normal refreshes retain data on 429/503, share all premium tickers, leave SPY public', async () => {
  const s = await consumer('options');
  try {
    const price = s.el('current-price').textContent;
    s.state.mode = 429; s.el('refresh-data').click(); await flush();
    assert.match(s.el('load-error').textContent, /request limit reached/); assert.equal(s.el('current-price').textContent, price);
    await s.poll(); s.el('refresh-data').click(); await flush(); assert.equal(s.state.calls.length, 3); // One explicit probe.
    s.el('refresh-data').click(); await flush(); assert.equal(s.state.calls.length, 3);
    await s.invoke("selectTicker('IWM')"); assert.equal(s.state.calls.length, 3);
    assert.notEqual(s.el('current-price').textContent, price); // Never mislabel QQQ as IWM.
    await s.invoke("selectTicker('SPY')"); assert.equal(s.state.calls.length, 4); assert.equal(s.el('load-error').hidden, true);
    await s.invoke("selectTicker('QQQ')"); assert.equal(s.state.calls.length, 4);
    s.clock.now += 120000; s.state.mode = 503; s.state.retry = '5'; await s.poll();
    assert.match(s.el('load-error').textContent, /temporarily unavailable/);
    await s.poll(); assert.equal(s.state.calls.length, 5);
    s.clock.now += 5000; s.state.mode = 200; await s.poll();
    assert.equal(s.state.calls.length, 6); assert.equal(s.el('load-error').hidden, true);
    assert.deepEqual(s.timers.map(t => t.ms), [900000]);
  } finally { await s.close(); }
});

test('Options shares cooldown across reloads/accounts correctly and Pro quota stays independent', async () => {
  const a = await consumer('options'); let b, pro;
  try {
    a.state.mode = 429; await a.poll();
    b = await consumer('options', { shared: a.shared, clock: a.clock });
    assert.equal(b.state.calls.length, 0);
    b.state.user = 'user-b'; await b.poll(); assert.equal(b.state.calls.length, 1);
    pro = await consumer('pro', { shared: a.shared, clock: a.clock }); assert.equal(pro.state.calls.length, 1);
  } finally { await a.close(); if (b) await b.close(); if (pro) await pro.close(); }
});

test('In-flight response records only the captured request user after an account switch', async () => {
  const s = await consumer('options');
  try {
    s.state.mode = 429; s.state.deferred = {}; const pending = s.poll(); await flush();
    const resolve = s.state.deferred.resolve; s.state.user = 'user-b'; s.state.deferred = null; resolve(); await pending;
    s.state.mode = 200; await s.poll(); assert.equal(s.state.calls.length, 3);
    s.state.user = 'user-a'; await s.poll(); assert.equal(s.state.calls.length, 3);
  } finally { await s.close(); }
});

test('One hour of real polling functions across six tabs plus reloads/manual requests retains quota headroom', async t => {
  const shared = storage(), clock = { now: Date.UTC(2026, 9, 15, 17) }, allTabs = [];
  const start = clock.now;
  async function open(page, ticker) {
    const tab = await consumer(page, { shared, clock, ticker }); allTabs.push(tab); return tab;
  }
  const pro = [await open('pro'), await open('dow'), await open('chart')];
  const options = [await open('options', 'QQQ'), await open('options', 'IWM'), await open('options', 'AAPL')];
  try {
    for (let minute = 1; minute < 60; minute++) {
      clock.now = start + minute * 60000;
      for (const tab of [...pro, ...options]) {
        for (const timer of tab.timers.filter(timer => timer.ms >= 60000)) {
          if (timer.nextAt <= clock.now) {
            timer.nextAt += timer.ms;
            await timer.callback();
          }
        }
      }
      await flush();
      if (minute === 5) {
        pro[0].el('es-contract').value = 'ESZ26';
        pro[0].el('es-contract').dispatchEvent(new pro[0].win.Event('change'));
      }
      if (minute === 10) pro[2].el('reset-chart-data').click();
      if (minute === 7 || minute === 40) options[2].el('refresh-data').click();
      if (minute === 22) await options[1].invoke("selectTicker('NVDA')");
      if (minute === 20) { await pro[0].close(); pro[0] = await open('pro'); }
      if (minute === 35) { await options[0].close(); options[0] = await open('options', 'QQQ'); }
      await flush();
    }
    const calls = allTabs.flatMap(tab => tab.state.calls);
    const counts = { pro_prices: 0, options: 0 };
    const minutes = { pro_prices: new Map(), options: new Map() };
    for (const call of calls) {
      assert.equal(call.user, 'user-a');
      const resource = call.url.pathname.includes('fetch-spy-options') ? 'options' : 'pro_prices';
      counts[resource]++;
      const bucket = Math.floor(call.at / 60000);
      minutes[resource].set(bucket, (minutes[resource].get(bucket) || 0) + 1);
    }
    assert.deepEqual(counts, { pro_prices: 183, options: 16 });
    const peak = Object.fromEntries(Object.entries(minutes).map(([resource, buckets]) => [resource, Math.max(...buckets.values())]));
    assert.deepEqual(peak, { pro_prices: 4, options: 3 });
    assert.ok(counts.pro_prices < 1200 && counts.options < 600);
    assert.ok(peak.pro_prices < 60 && peak.options < 60);
    assert.equal(allTabs.some(tab => [...tab.shared.values.keys()].some(key => key.startsWith('spyconverter:premium-cooldown:'))), false);
    t.diagnostic('60 minutes, same user: Pro + Dow + chart = 183/1200 requests, peak 4/60 per minute; three premium Options tabs = 16/600 requests, peak 3/60 per minute. Includes two reloads, one ES switch, one chart reset, two Options refreshes, and one ticker switch.');
  } finally { for (const tab of allTabs) await tab.close(); }
});

test('Concurrent manual probes claim one shared 15-second lease; failed probes retain backoff', async () => {
  const a = helper(), b = helper(a.clock, a.shared), r = response(429, '3600');
  await a.instance.responseError('a', 'pro_prices', r, r.body);
  const results = await Promise.allSettled([
    a.instance.begin('a', 'pro_prices', { manualProbe: true }),
    b.instance.begin('a', 'pro_prices', { manualProbe: true }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  await a.instance.responseError('a', 'pro_prices', r, r.body); // Probe was denied.
  await assert.rejects(b.instance.begin('a', 'pro_prices', { manualProbe: true }), e => e.isCooldown && /15 seconds/.test(e.message));
  const reload = helper(a.clock, a.shared);
  await assert.rejects(reload.instance.begin('a', 'pro_prices', { manualProbe: true }));
  a.clock.now += 15000;
  assert.ok(await reload.instance.begin('a', 'pro_prices', { manualProbe: true }));
  await assert.rejects(a.instance.begin('a', 'pro_prices')); // Normal polls still suppressed.
});

test('Successful explicit probe clears warm-tab memory, but cannot erase a newer denial', async () => {
  const a = helper(), b = helper(a.clock, a.shared), r = response(429, '3600');
  await a.instance.responseError('a', 'options', r, r.body);
  assert.throws(() => b.instance.check('a', 'options')); // Warm the other tab.
  let probe = await a.instance.begin('a', 'options', { manualProbe: true });
  await a.instance.completeProbe(probe);
  b.instance.check('a', 'options'); // Storage deletion is authoritative.
  await a.instance.responseError('a', 'options', r, r.body);
  a.clock.now += 15000;
  probe = await a.instance.begin('a', 'options', { manualProbe: true });
  await b.instance.responseError('a', 'options', r, r.body); // Newer concurrent 429.
  await a.instance.completeProbe(probe);
  assert.throws(() => b.instance.check('a', 'options'), e => e.code === 'RATE_LIMITED');
  b.instance.check('b', 'options'); b.instance.check('a', 'pro_prices');
});

test('Unsupported lock coordination or unwritable storage never permits an unbounded manual probe', async () => {
  const shared = storage(); shared.locks = null;
  const h = helper(undefined, shared), r = response(429);
  await h.instance.responseError('a', 'options', r, r.body);
  await assert.rejects(h.instance.begin('a', 'options', { manualProbe: true }), e => !e.canRetry);
  const broken = storage(); broken.setItem = () => { throw Error('read-only storage'); };
  const b = helper(undefined, broken);
  await b.instance.responseError('a', 'options', r, r.body);
  await assert.rejects(b.instance.begin('a', 'options', { manualProbe: true }), e => !e.canRetry);
});

test('Visible Dow Retry now probes restore warm Pro and chart tabs before a one-hour deadline', async () => {
  const dow = await consumer('dow'), pro = await consumer('pro', { shared: dow.shared, clock: dow.clock });
  const chart = await consumer('chart', { shared: dow.shared, clock: dow.clock });
  try {
    dow.state.mode = 429; dow.state.retry = '3600'; await dow.poll(); await pro.poll(); await chart.poll();
    const button = dow.el('price-refresh-status').nextElementSibling;
    assert.equal(button.textContent, 'Retry now'); assert.equal(button.hidden, false);
    button.click(); await flush(); // Denied explicit probe.
    assert.equal(dow.state.calls.length, 3);
    pro.el('es-contract-status').nextElementSibling.click(); await flush();
    chart.el('chart-status').nextElementSibling.click(); await flush();
    assert.equal(pro.state.calls.length, 1); assert.equal(chart.state.calls.length, 1);
    dow.clock.now += 15000; dow.state.mode = 200;
    button.click(); await flush(); assert.equal(dow.state.calls.length, 4); assert.equal(button.hidden, true);
    await pro.poll(); await chart.poll();
    assert.equal(pro.state.calls.length, 2); assert.equal(chart.state.calls.length, 2);
    assert.equal(pro.el('es-contract-status').hidden, true);
  } finally { await dow.close(); await pro.close(); await chart.close(); }
});

test('Options explicit Retry now restores another premium tab after emergency recovery', async () => {
  const a = await consumer('options'), b = await consumer('options', { shared: a.shared, clock: a.clock, ticker: 'IWM' });
  try {
    a.state.mode = 429; a.state.retry = '3600'; await a.poll(); await b.poll();
    assert.equal(a.el('refresh-data').textContent, 'Retry now');
    a.state.mode = 200; a.el('refresh-data').click(); await flush();
    assert.equal(a.state.calls.length, 3); assert.equal(a.el('load-error').hidden, true);
    await b.poll(); assert.equal(b.state.calls.length, 2);
    assert.equal(a.clock.now, Date.UTC(2026, 9, 15, 17)); // No hour wait or automatic retry loop.
  } finally { await a.close(); await b.close(); }
});

test('Pro manual probe reuses its lease across the existing single 401 token refresh', async () => {
  const s = await consumer('pro');
  try {
    s.state.mode = 429; s.state.retry = '3600'; await s.poll();
    s.state.mode = 200; s.state.statuses = [401, 200];
    await s.invoke("fetchProPrices('AUTO', undefined, {manualProbe:true})");
    assert.equal(s.state.calls.length, 4); assert.equal(s.state.refreshes, 1);
    assert.equal(s.state.calls[3].init.headers.Authorization, 'Bearer renewed-test-session');
    await s.poll(); assert.equal(s.state.calls.length, 5);
  } finally { await s.close(); }
});
