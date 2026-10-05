const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

test('retired Pro endpoint never serves prices or redirects, even with authorization', async () => {
  let handler;
  // No database, credentials, Auth, or network APIs are provided to the old route.
  runInNewContext(readFileSync(new URL('../supabase/functions/get-live-price-pro/index.ts', `file://${__filename}`), 'utf8'), {
    Deno: { serve: callback => { handler = callback; } }, Response,
  });
  for (const method of ['GET', 'OPTIONS', 'POST']) {
    for (const headers of [{}, { Authorization: 'Bearer previously-valid-session' }]) {
      const response = await handler(new Request('https://example.com/get-live-price-pro', { method, headers }));
      assert.equal(response.status, 410);
      assert.equal(response.headers.get('Location'), null);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), {
        message: 'This endpoint has been retired. Please reload Spyconverter Pro.',
      });
    }
  }
});
