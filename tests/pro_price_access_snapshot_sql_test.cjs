const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { PGlite } = require(process.env.PRO_PRICE_PGLITE_PATH || '@electric-sql/pglite');

test('combined snapshot read preserves subscription decisions and private permissions', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, is_subscribed boolean);
    alter table public.profiles enable row level security;
    grant select on public.profiles to service_role;
    create policy service_read on public.profiles for select to service_role using (true);
    insert into public.profiles values
      ('00000000-0000-0000-0000-000000000001', true),
      ('00000000-0000-0000-0000-000000000002', false),
      ('00000000-0000-0000-0000-000000000003', null);
  `);
  await db.exec(readFileSync(join(__dirname, '../supabase/sql/pro_price_cache_setup.sql'), 'utf8'));
  const migration = readFileSync(join(__dirname, '../supabase/sql/pro_price_access_snapshot.sql'), 'utf8');
  await db.exec(migration);
  const quotes = [{ symbol: 'SPY', regularMarketPrice: 650 }];
  await db.query('update public.pro_price_cache set quotes=$1, fetched_at=now() where id=1', [JSON.stringify(quotes)]);
  const rpc = (role, id) => db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    return (await tx.query('select public.read_pro_price_access_snapshot($1::uuid) as result', [id])).rows[0].result;
  });
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(rpc(role, id(1)), { code: '42501' });
  }
  const good = await rpc('service_role', id(1));
  assert.equal(good.is_subscribed, true);
  assert.deepEqual(good.quotes, quotes);
  assert.ok(Number.isFinite(Date.parse(good.fetched_at)));
  for (const user of [id(2), id(3), id(4), null]) {
    assert.deepEqual(await rpc('service_role', user), { is_subscribed: false, quotes: null, fetched_at: null });
  }
  await db.query('update public.profiles set is_subscribed=false where id=$1', [id(1)]);
  assert.equal((await rpc('service_role', id(1))).is_subscribed, false);
  await db.query('update public.profiles set is_subscribed=true where id=$1', [id(1)]);
  await db.exec('update public.pro_price_cache set quotes=null, fetched_at=null where id=1');
  assert.deepEqual(await rpc('service_role', id(1)), { is_subscribed: true, quotes: null, fetched_at: null });
  await db.exec(migration);
  assert.equal((await rpc('service_role', id(1))).is_subscribed, true);
  const flags = (await db.query("select prosecdef, provolatile from pg_proc where oid='public.read_pro_price_access_snapshot(uuid)'::regprocedure")).rows[0];
  assert.deepEqual(flags, { prosecdef: false, provolatile: 's' });
  await db.exec('revoke select on public.profiles from service_role');
  await assert.rejects(rpc('service_role', id(1)), { code: '42501' });
});
