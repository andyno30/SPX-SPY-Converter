const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('Billing safeguard blocks self-upgrade and billing-ID edits, preserves profile edits and Stripe writes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create schema auth;
      create function auth.role() returns text language sql as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
      grant usage on schema auth, public to authenticated, anon, service_role;
      create table public.profiles (id text primary key, is_subscribed boolean default false, subscription_id text, stripe_customer_id text, nickname text);
      insert into public.profiles (id) values ('test');
      grant select, update on public.profiles to authenticated, anon, service_role;
    `);
    const sql = readFileSync(new URL('../supabase/sql/pro_price_authorization.sql', `file://${__filename}`), 'utf8');
    await db.exec(sql); await db.exec(sql); // safely re-applicable
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);`);
    for (const edit of ["is_subscribed=true", "subscription_id='forged'", "stripe_customer_id='forged'", "id='different'"]) {
      await assert.rejects(db.exec(`update public.profiles set ${edit} where id='test'`), /Billing fields can only/);
    }
    await db.exec(`update public.profiles set nickname='Trader' where id='test'`);
    assert.equal((await db.query('select is_subscribed from public.profiles')).rows[0].is_subscribed,false);
    await db.exec(`reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false);`);
    await db.exec(`update public.profiles set is_subscribed=true, subscription_id='sub_test', stripe_customer_id='cus_test' where id='test'`);
    assert.equal((await db.query('select is_subscribed from public.profiles')).rows[0].is_subscribed,true);
    await db.exec(`update public.profiles set is_subscribed=false where id='test'`);
    assert.equal((await db.query('select nickname from public.profiles')).rows[0].nickname,'Trader');
  } finally { await db.close(); }
});
