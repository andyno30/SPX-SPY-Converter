// Run with: node --test scripts/test_news_dates.cjs
// Exercise the actual edge-function parser without network or database writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("../news-app/node_modules/typescript");

const now = Date.parse("2026-09-11T17:00:00Z");
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const context = vm.createContext({
  exports: {}, URL, Date: FixedDate, console,
  Deno: { env: { get: () => "test" }, serve: () => {} },
  require: (name) => {
    if (name === "npm:@supabase/supabase-js@2") return { createClient: () => ({}) };
    if (name === "../_shared/saveticker.ts") return {};
    throw new Error(`Unexpected dependency: ${name}`);
  },
});
const source = fs.readFileSync(path.join(__dirname, "../supabase/functions/fetch-news/index.ts"), "utf8");
vm.runInContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const parseRssEntries = vm.runInContext("parseRssEntries", context);

function parse(date, release = "2026-87-test", source = "SEC") {
  return parseRssEntries(`<rss><channel><item>
    <title>SEC announces securities market update</title>
    <description>New guidance for investors and securities markets.</description>
    <link>https://www.sec.gov/newsroom/press-releases/${release}</link>
    <pubDate>${date}</pubDate>
  </item></channel></rss>`, source, "regulator");
}

test("preserves a current SEC release's actual timestamp, including CDATA", () => {
  for (const date of ["Fri, 11 Sep 2026 11:00:00 -0400", "<![CDATA[Fri, 11 Sep 2026 11:00:00 -0400]]>"]) {
    const rows = parse(date);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].published_at, "2026-09-11T15:00:00.000Z");
  }
});

test("rejects all three archived releases even when their dates look current", () => {
  for (const [release, date] of [
    ["97-114-municipal-securities", "2026-12-16T12:00:00Z"],
    ["97-99-investors-meeting", "2026-11-05T12:00:00Z"],
    ["99-110-year-2000", "2026-09-07T12:00:00Z"],
    ["2019-123-archive", "2026-09-11T12:00:00Z"],
  ]) assert.equal(parse(date, release).length, 0);
});

test("rejects missing, malformed, pre-2020, and future SEC dates", () => {
  for (const date of ["", "not a date", "1997-12-16T12:00:00Z", "2026-12-16T12:00:00Z", "2026-09-11T17:16:00Z"]) {
    assert.equal(parse(date).length, 0, date);
  }
  assert.equal(parse("2026-09-11T17:05:00Z").length, 1);
});

test("retains older valid SEC releases and leaves other publishers unaffected", () => {
  assert.equal(parse("2025-12-16T12:00:00Z", "2025-114-test").length, 1);
  assert.equal(parse("2026-09-11T12:00:00Z", "99-110-test", "CNBC").length, 1);
});
