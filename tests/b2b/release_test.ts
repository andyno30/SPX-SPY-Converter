import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {priceResponse,ES_CONTRACTS} from '../../supabase/functions/get-live-price-pro/pricing.ts';
import {priceResponse as deployed} from './fixtures/deployed-serializer-20261016.mjs';
import {syntheticSnapshot} from '../../supabase/b2b-api/fixtures.ts';
const require=createRequire(import.meta.url);
const {createLocalDatabase}=require('../../scripts/b2b-api/local-database.cjs');
Deno.test('JSON parity with downloaded production v3 serializer, including nulls and expirations',()=>{
 for(const time of ['2026-10-16T15:00:00Z','2026-12-18T23:59:59Z','2026-12-19T00:00:00Z']){
  const now=Date.parse(time),base=syntheticSnapshot(now);
  for(const quotes of [base.quotes,base.quotes.filter(q=>q.symbol!=='SPY'),[],base.quotes.map(q=>({...q,exchangeDataDelayedBy:null,shortName:null,regularMarketTime:null}))]){
   const snapshot={quotes,fetchedAt:base.fetched_at};
   for(const selection of ['AUTO',...ES_CONTRACTS.map(c=>c.contract)])assert.equal(JSON.stringify(priceResponse(snapshot as any,selection,now)),JSON.stringify(deployed(snapshot,selection,now)));
  }
 }
});
Deno.test({name:'additive migration rollback removes only B2B objects and can be reapplied',sanitizeResources:false,sanitizeOps:false,fn:async()=>{
 const db=await createLocalDatabase('rollback');
 try{
  await db.pool.query("create table public.pro_price_cache(id int primary key,quotes jsonb,fetched_at timestamptz); insert into public.pro_price_cache values(1,'[]',now())");
  await db.pool.query(await Deno.readTextFile('supabase/sql/b2b_api_source_reader.sql'));
  await db.pool.query(await Deno.readTextFile('supabase/sql/b2b_api_rollback.sql'));
  assert.equal((await db.pool.query('select count(*)::int as count from public.pro_price_cache')).rows[0].count,1);
  assert.equal((await db.pool.query("select count(*)::int as count from pg_namespace where nspname='b2b_private'")).rows[0].count,0);
  assert.equal((await db.pool.query("select count(*)::int as count from pg_proc where proname like 'b2b_api_%'")).rows[0].count,0);
  await db.pool.query(await Deno.readTextFile('supabase/sql/b2b_api_setup.sql'));
  await db.pool.query(await Deno.readTextFile('supabase/sql/b2b_api_review.sql'));
  assert.ok((await db.pool.query("select to_regclass('b2b_private.organizations') as name")).rows[0].name);
 }finally{await db.close();}
}});
