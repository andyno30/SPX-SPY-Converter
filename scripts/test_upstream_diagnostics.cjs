// Run with: node --test scripts/test_upstream_diagnostics.cjs
// All requests and authentication state below are synthetic; no network or secrets are read.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("../news-app/node_modules/typescript");

function load(file, fetch, logs = []) {
  const filename = path.resolve(__dirname, "..", file);
  const context = vm.createContext({
    exports: {}, URL, Date, Response, TextDecoder, Uint8Array, AbortSignal,
    setTimeout, clearTimeout, atob, fetch,
    console: { error: (...args) => logs.push(args), log: () => {} },
    Deno: {
      serve: () => {},
      env: { get: (name) => name === "SAVETICKER_AUTH_JSON_B64"
        ? Buffer.from(JSON.stringify({ cookies: [
          { name: "access_token", value: "synthetic-app-cookie", domain: ".saveticker.com" },
          { name: "cf_clearance", value: "synthetic-challenge-cookie", domain: ".saveticker.com" },
        ] })).toString("base64")
        : name === "PROJECT_URL" || name === "SERVICE_ROLE_KEY" ? "test-only" : undefined },
    },
    require: (name) => {
      if (name === "npm:@supabase/supabase-js@2") return { createClient: () => ({}) };
      if (name.endsWith("upstream-diagnostics.ts")) {
        return load("supabase/functions/_shared/upstream-diagnostics.ts", fetch, logs).exports;
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  vm.runInContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context;
}

test("classifies failure bodies while logging only allowlisted metadata", async () => {
  const logs = [];
  const { logUpstreamFailure } = load("supabase/functions/_shared/upstream-diagnostics.ts", null, logs).exports;
  for (const [body, contentType, expected] of [
    [null, "application/json", "empty"],
    ['{"access_token":"synthetic-body-secret"}', "application/json", "JSON"],
    ['<!doctype html><html>synthetic-body-secret</html>', "text/html", "HTML"],
    ["synthetic-body-secret", "text/plain", "other"],
    ['{"message":"' + "x".repeat(10000) + '"}', "application/json", "JSON"],
  ]) {
    await logUpstreamFailure("options", new Response(body, { status: 403, headers: {
      server: "cloudflare", "content-type": contentType, "cf-ray": "abc123-LAX",
      "set-cookie": "synthetic-response-cookie", authorization: "synthetic-auth-header",
    } }));
    const record = JSON.parse(logs.at(-1)[1]);
    assert.deepEqual(Object.keys(record).sort(), ["bodyType", "cf-ray", "content-type", "server", "source", "status"].sort());
    assert.equal(record.bodyType, expected);
    assert.equal(record.status, 403);
    assert.equal(record.server, "cloudflare");
    assert.equal(record["cf-ray"], "abc123-LAX");
  }
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-body-secret|synthetic-response-cookie|synthetic-auth-header/);
});

test("redacts suspicious response-header values", async () => {
  const logs = [];
  await load("supabase/functions/_shared/upstream-diagnostics.ts", null, logs).exports.logUpstreamFailure(
    "news", new Response(null, { status: 403, headers: { server: "session=synthetic-secret" } }),
  );
  assert.equal(JSON.parse(logs[0][1]).server, "[redacted]");
  assert.equal(JSON.parse(logs[0][1])["cf-ray"], null);
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-secret/);
});

test("stalled or unreadable bodies cannot prevent fallback", async () => {
  for (const fail of [false, true]) {
    const logs = [];
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) { if (fail) controller.error(new Error("synthetic-body-secret")); },
      cancel() { cancelled = true; },
    });
    const start = Date.now();
    await load("supabase/functions/_shared/upstream-diagnostics.ts", null, logs).exports.logUpstreamFailure(
      "news", new Response(body, { status: 503 }),
    );
    assert.equal(JSON.parse(logs[0][1]).bodyType, "other");
    assert.ok(Date.now() - start < 1500);
    if (!fail) assert.equal(cancelled, true);
    assert.doesNotMatch(JSON.stringify(logs), /synthetic-body-secret/);
  }
});

test("both anonymous News endpoints retain headers, one request, and null on HTTP failure", async () => {
  const logs = [], requests = [];
  const context = load("supabase/functions/fetch-news/index.ts", async (url, options) => {
    requests.push({ url, options });
    return new Response('<html>denied</html>', { status: 403, headers: { "content-type": "text/html" } });
  }, logs);
  const urls = vm.runInContext("SAVETICKER_NEWS_ENDPOINTS", context);
  const fetchJson = vm.runInContext("fetchJson", context);
  for (const url of urls) assert.equal(await fetchJson(url), null);
  assert.equal(requests.length, 2);
  for (const { options } of requests) {
    assert.deepEqual(JSON.parse(JSON.stringify(options.headers)), {
      "User-Agent": "SpyConverterNewsBot/1.0 (+https://spyconverter.com)", Accept: "application/json",
    });
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.deepEqual(logs.map((r) => JSON.parse(r[1]).source), ["news-label-group-1", "news-label-group-6"]);
});

test("Options preserves access_token-only request and original HTTP exception", async () => {
  const logs = [], requests = [];
  const { fetchSaveTickerJson } = load("supabase/functions/_shared/provider.ts", async (url, options) => {
    requests.push({ url, options });
    return new Response(null, { status: 403 });
  }, logs).exports;
  await assert.rejects(fetchSaveTickerJson("https://saveticker.com/api/stocks/api/v1/tickers/SPY/options", "https://saveticker.com/stocks/SPY"), { message: "SaveTicker returned HTTP 403." });
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].options.headers)), {
    Accept: "application/json", Cookie: "access_token=synthetic-app-cookie",
    Referer: "https://saveticker.com/stocks/SPY",
    "User-Agent": "SpyConverterSaveTickerEdge/1.0 (+https://spyconverter.com)",
  });
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(JSON.parse(logs[0][1]).source, "options");
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-app-cookie|synthetic-challenge-cookie/);
});

test("successful JSON responses remain unchanged and do not log failures", async () => {
  const logs = [];
  const context = load("supabase/functions/fetch-news/index.ts", async () => new Response('{"news_list":[]}'), logs);
  assert.deepEqual(await vm.runInContext("fetchJson", context)("https://example.test"), { news_list: [] });
  const provider = load("supabase/functions/_shared/provider.ts", async () => new Response('{"symbol":"SPY"}'), logs);
  assert.deepEqual(await provider.exports.fetchSaveTickerJson("https://example.test", "https://example.test"), { symbol: "SPY" });
  assert.equal(logs.length, 0);
});
