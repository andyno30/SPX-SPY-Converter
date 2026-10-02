const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../news-app/node_modules/typescript');
const root = path.join(__dirname, '..');

function edge(name, options = {}) {
  const calls = [];
  let handler;
  const profile = options.profile ?? { stripe_customer_id: 'cus_owner', subscription_id: 'sub_owner' };
  const stripe = {
    subscriptions: { retrieve: async id => { calls.push(['subscription', id]); return { customer: 'cus_legacy' }; } },
    billingPortal: { sessions: { create: async data => { calls.push(['portal', data]); if (options.stripeError) throw Error('Stripe unavailable'); return { url: 'https://billing.stripe.com/p/session/example' }; } } },
    checkout: { sessions: { create: async data => { calls.push(['checkout', data]); return { url: 'https://checkout.stripe.com/example' }; } } },
  };
  const database = {
    auth: { getUser: async token => { calls.push(['auth', token]); return { data: { user: token === 'valid' ? { id: 'owner', email: 'owner@example.com' } : null }, error: null }; } },
    from: () => ({
      select: () => ({ eq: (field, id) => { calls.push(['profile', field, id]); return { single: async () => ({ data: profile, error: options.profileError ? Error('missing') : null }) }; } }),
      update: data => ({ eq: async (field, id) => { calls.push(['update', data, field, id]); return { error: null }; } }),
    }),
  };
  const source = fs.readFileSync(path.join(root, 'supabase/functions', name, 'index.ts'), 'utf8').replace(/^import .*;\n/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  vm.runInNewContext(js, {
    Response, Request, Headers, URL, console: { error() {} },
    Stripe: function () { return stripe; }, createClient: () => database,
    Deno: { env: { get: key => ({ STRIPE_PRICE_MONTHLY: 'price_monthly', STRIPE_PRICE_SIXMONTHS: 'price_six', SUCCESS_URL: 'https://spyconverter.com/missing.html' }[key] || 'test') }, serve: callback => { handler = callback; } },
  });
  return { calls, handler };
}

test('billing preflight is a bodyless 204 with usable CORS headers, without authentication or Stripe calls', async () => {
  const { handler, calls } = edge('customer-portal');
  const response = await handler(new Request('https://example.com', { method: 'OPTIONS' }));
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-allow-headers'), /authorization/);
  assert.match(response.headers.get('access-control-allow-headers'), /apikey/);
  assert.deepEqual(calls, []);
});

test('billing rejects absent and invalid authentication and disallowed methods', async () => {
  const { handler, calls } = edge('customer-portal');
  assert.equal((await handler(new Request('https://example.com'))).status, 405);
  for (const token of ['', 'invalid']) {
    const response = await handler(new Request('https://example.com', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }));
    assert.equal(response.status, 401);
  }
  assert.ok(!calls.some(([name]) => name === 'portal'));
});

test('billing uses authenticated profile, ignoring caller-supplied customer IDs', async () => {
  const { handler, calls } = edge('customer-portal');
  const response = await handler(new Request('https://example.com', { method: 'POST', headers: { Authorization: 'Bearer valid' }, body: JSON.stringify({ customer: 'cus_someone_else' }) }));
  assert.equal(response.status, 200);
  assert.equal(calls.find(([name]) => name === 'portal')[1].customer, 'cus_owner');
  assert.deepEqual(calls.find(([name]) => name === 'profile'), ['profile', 'id', 'owner']);
});

test('billing recovers legacy customer ID from the owned subscription', async () => {
  const { handler, calls } = edge('customer-portal', { profile: { subscription_id: 'sub_owner', stripe_customer_id: null } });
  assert.equal((await handler(new Request('https://example.com', { method: 'POST', headers: { Authorization: 'Bearer valid' } }))).status, 200);
  assert.deepEqual(calls.find(([name]) => name === 'subscription'), ['subscription', 'sub_owner']);
  assert.equal(calls.find(([name]) => name === 'portal')[1].customer, 'cus_legacy');
});

test('missing billing profile and Stripe outage return readable CORS errors', async () => {
  for (const [options, expected] of [[{ profileError: true }, 404], [{ profile: {} }, 404], [{ stripeError: true }, 500]]) {
    const { handler } = edge('customer-portal', options);
    const response = await handler(new Request('https://example.com', { method: 'POST', headers: { Authorization: 'Bearer valid' } }));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.ok((await response.json()).message);
  }
});

test('checkout ignores stale redirect secrets and points both plans to existing static pages', async () => {
  for (const plan of ['monthly', 'six_months']) {
    const { handler, calls } = edge('subscribe');
    const response = await handler(new Request('https://example.com', { method: 'POST', headers: { Authorization: 'Bearer valid' }, body: JSON.stringify({ plan }) }));
    assert.equal(response.status, 200);
    const checkout = calls.find(([name]) => name === 'checkout')[1];
    assert.equal(checkout.success_url, 'https://spyconverter.com/docs/subscription-success.html');
    for (const field of ['success_url', 'cancel_url']) assert.ok(fs.existsSync(path.join(root, new URL(checkout[field]).pathname)));
    assert.equal(checkout.metadata.userId, 'owner');
  }
  assert.match(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), /url=\/docs\/subscription-success.html/);
});

async function confirmation(states, options = {}) {
  const elements = new Map();
  let polls = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: id === 'check-subscription', classList: { add() {} }, addEventListener() {} });
    return elements.get(id);
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: options.loggedOut ? null : { id: 'owner' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { const active = states[Math.min(polls++, states.length - 1)]; return { data: { is_subscribed: active }, error: options.failure ? Error('offline') : null }; } }) }) }),
  };
  const source = fs.readFileSync(path.join(root, 'docs/subscription-success.js'), 'utf8').replace(/^import .*;\n/, '').replace('void checkSubscription();', 'globalThis.done = checkSubscription();');
  const context = { document: { getElementById: element }, supabase, setTimeout: resolve => resolve() };
  vm.runInNewContext(source, context);
  await context.done;
  return { elements, polls };
}

test('confirmation verifies account access and handles webhook delay before showing Active', async () => {
  const { elements, polls } = await confirmation([false, false, true]);
  assert.equal(polls, 3);
  assert.equal(elements.get('confirmation-title').textContent, 'You are subscribed!');
  assert.equal(elements.get('confirmation-badge').textContent, 'Active');
});

test('confirmation leaves login available when signed out and never claims Active for pending or error states', async () => {
  assert.equal((await confirmation([], { loggedOut: true })).polls, 0);
  for (const options of [{}, { failure: true }]) {
    const { elements, polls } = await confirmation([false], options);
    assert.notEqual(elements.get('confirmation-badge').textContent, 'Active');
    assert.equal(elements.get('check-subscription').hidden, false);
    assert.ok(polls <= 5);
    assert.match(elements.get('confirmation-status').textContent, /pay again/);
  }
});

async function settings(options = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', hidden: false, disabled: false, listeners: {},
      classList: { add() {}, toggle() {} }, style: { setProperty() {} },
      addEventListener(event, callback) { this.listeners[event] = callback; },
      setAttribute() {}, removeAttribute() {},
    });
    return elements.get(id);
  };
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner', email: 'owner@example.com' } } }),
      getSession: async () => ({ data: { session: options.loggedOut ? null : { access_token: 'valid' } } }),
    },
    from: table => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === 'profiles' ? { is_subscribed: false, stripe_customer_id: 'cus_owner' } : {}, error: null }) }) }) }),
    functions: { invoke: async () => options.result ?? { data: { url: 'https://billing.stripe.com/p/session/example' }, error: null } },
  };
  const source = fs.readFileSync(path.join(root, 'docs/settings.js'), 'utf8').replace(/^import .*;\n/, '').replace('void initialize();', 'globalThis.done = initialize();');
  const context = { document: { getElementById: element }, supabase, signOut() {}, URL, window: { location: {} } };
  vm.runInNewContext(source, context);
  await context.done;
  await elements.get('manage-billing').listeners.click();
  return { elements, location: context.window.location };
}

test('inactive subscribers retain billing access and receive their Stripe portal redirect', async () => {
  const { elements, location } = await settings();
  assert.equal(elements.get('manage-billing').hidden, false);
  assert.equal(elements.get('billing-badge').textContent, 'Inactive');
  assert.equal(location.href, 'https://billing.stripe.com/p/session/example');
});

test('billing UI recovers from request failures and rejects untrusted redirect URLs', async () => {
  for (const result of [
    { error: { message: 'Failed to fetch' } },
    { data: { url: 'https://untrusted.example/' } },
    { error: { context: { status: 401 } } },
  ]) {
    const { elements, location } = await settings({ result });
    assert.equal(elements.get('manage-billing').disabled, false);
    assert.ok(elements.get('billing-status').textContent);
    assert.notEqual(elements.get('billing-status').textContent, 'Failed to fetch');
    assert.equal(location.href, undefined);
  }
  assert.match((await settings({ loggedOut: true })).location.href, /^login.html\?return_to=/);
});
