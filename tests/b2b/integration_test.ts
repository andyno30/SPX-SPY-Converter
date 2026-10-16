import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStore} from '../../supabase/b2b-api/database.mjs';
import {createApp} from '../../supabase/b2b-api/app.mjs';
import {ApiError,PLANS,generateKey} from '../../supabase/b2b-api/core.mjs';
import {materialize,synchronize} from '../../supabase/b2b-api/mirror.ts';
import {syntheticSnapshot} from '../../supabase/b2b-api/fixtures.ts';
import {createRequestHandler} from '../../supabase/functions/get-live-price-pro/request.ts';
import {createUpdater} from '../../supabase/functions/refresh-pro-prices/updater.ts';
import {createYahooFetcher} from '../../supabase/functions/refresh-pro-prices/yahoo.ts';
const require=createRequire(import.meta.url);
const {createLocalDatabase}=require('../../scripts/b2b-api/local-database.cjs');
const env={API_KEY_PEPPER:'synthetic-local-only-pepper-32-characters',API_LOCAL_ONLY:'true',API_SITE_ORIGIN:'http://127.0.0.1:8799',API_SYNTHETIC_TEST_MODE:'true',API_LIVE_MARKET_DATA_ENABLED:'false',API_ENVIRONMENT:'test'};

Deno.test({name:'B2B PostgreSQL and gateway integration (synthetic fixtures, network denied)',sanitizeResources:false,sanitizeOps:false,fn:async t=>{
 const db=await createLocalDatabase('integration');
 const store=createStore(async(n:string,a:any)=>{try{return await db.rpc(n,a);}catch(e){if(e.code==='42501')throw new ApiError(403,'forbidden','Access denied.');throw e;}});
 let clock=Date.now();let source=syntheticSnapshot(clock);let sourceReads=0;
 const owner=crypto.randomUUID(),other=crypto.randomUUID();
 await db.pool.query('insert into auth.users values($1),($2)',[owner,other]);
 const app=createApp({env,store,resolveUser:async(r:Request)=>({id:r.headers.get('authorization')==='Bearer owner'?owner:other}),billing:{checkout:()=>{throw new ApiError(503,'billing_disabled','Disabled');}},now:()=>clock});
 const api=(key:string,path='/v1/conversions')=>app(new Request(`http://127.0.0.1:8799${path}`,{headers:{Authorization:`Bearer ${key}`}}));
 const control=(path:string,body:any,token='owner')=>app(new Request(`http://127.0.0.1:8799/platform/${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 async function organization(plan='developer',user=owner){const o=await store.account('create',user,null,{name:`Synthetic ${plan}`,legal_name:'Synthetic LLC',email:'demo@example.test',intended_use:'Automated fixture test',plan});await db.pool.query("update b2b_private.subscriptions set status='active',period_start=clock_timestamp()-interval '1 day',period_end=clock_timestamp()+interval '29 days',paid_through=clock_timestamp()+interval '29 days' where organization_id=$1",[o.id]);return o;}
 async function key(o:any,mode='test'){const k=await generateKey(mode,env.API_KEY_PEPPER);const record=await store.account('key.create',o.created_by,o.id,{key_hash:k.hash,prefix:k.prefix,label:'Synthetic integration key',mode});return{...k,...record};}
 const copied=()=>synchronize(async()=>{sourceReads++;return source;},store.publish,clock,'synthetic');
 try{
  await copied();
  await t.step('exact $25/$50/$150 monthly prices and quotas',()=>{assert.deepEqual(Object.values(PLANS).map(p=>[p.cents,p.quota,p.perMinute]),[[2500,10000,10],[5000,100000,30],[15000,500000,120]]);});
  const dev=await organization(),pro=await organization('pro'),business=await organization('business');
  await t.step('Business requires manual approval before key activation',async()=>{await assert.rejects(key(business));const application=(await store.account('dashboard',owner,business.id)).applications[0];await db.rpc('b2b_api_review',{p_org:business.id,p_reviewer:'synthetic-operator',p_action:'business.approve',p_data:{application_id:application.id}});});
  const kd=await key(dev),kp=await key(pro),kb=await key(business);
  await t.step('organization listing and dashboard route return account-scoped state',async()=>{assert.equal((await store.account('list',owner)).length,3);const response=await app(new Request(`http://127.0.0.1:8799/platform/dashboard?organization_id=${dev.id}`,{headers:{Authorization:'Bearer owner'}}));assert.equal(response.status,200);assert.equal((await response.json()).organization.id,dev.id);});
  await t.step('stored response matches original handler bytes for every available contract',async()=>{
   const rows=await materialize(source,clock,'synthetic');
   const original=createRequestHandler({userId:async()=>owner,readAccessSnapshot:async()=>({...source,is_subscribed:true}),now:()=>clock});
   for(const row of rows){const old=await original(new Request(`https://original.invalid/contact-for-licencing?esContract=${row.selection}`,{headers:{Authorization:'Bearer synthetic'}}));const next=await api(kp.key,`/v1/conversions?esContract=${row.selection}`);assert.equal(next.status,200);assert.equal(await next.text(),await old.text());assert.equal(next.headers.get('X-Snapshot-Id'),row.digest);}
  });
  await t.step('nulls, nested metadata and unavailable contracts retain original semantics',async()=>{
   const changed=structuredClone(source);changed.quotes=changed.quotes.filter((q:any)=>q.symbol!=='SPY');await store.publish(await materialize(changed,clock,'synthetic'));
   const next=await api(kp.key);const body=await next.json();assert.equal(body.Prices.SPY,null);assert.equal(body['SPX/SPY Ratio'],null);assert.equal(typeof body.ESQuote.delayMinutes,'number');await copied();
   assert.equal((await api(kp.key,'/v1/conversions?esContract=invalid')).status,400);
  });
  await t.step('invalid and revoked credentials cannot read cached data',async()=>{
   assert.equal((await api('sc_test_invalid')).status,401);
   assert.equal((await api((await generateKey('test',env.API_KEY_PEPPER)).key)).status,401);
   const k=await key(dev);await store.account('key.revoke',owner,dev.id,{key_id:k.id});assert.equal((await api(k.key)).status,401);
  });
  await t.step('key rotation is atomic and full secrets are absent from dashboard',async()=>{
   const old=await key(dev),fresh=await generateKey('test',env.API_KEY_PEPPER);
   await store.account('key.create',owner,dev.id,{key_hash:fresh.hash,prefix:fresh.prefix,label:'Rotated',mode:'test',rotate_key_id:old.id});
   assert.equal((await api(old.key)).status,401);assert.equal((await api(fresh.key)).status,200);
   const dash=JSON.stringify(await store.account('dashboard',owner,dev.id));assert.ok(!dash.includes(fresh.key)&&!dash.includes(fresh.hash));
  });
  await t.step('organization isolation, owner permissions and last-owner protection',async()=>{
   await assert.rejects(store.account('dashboard',other,dev.id));
   assert.equal((await control('keys',{organization_id:dev.id,mode:'test',label:'bad'},'other')).status,403);
   await store.account('member.add',owner,dev.id,{user_id:other,role:'member'});
   await assert.rejects(store.account('key.revoke',other,dev.id,{key_id:kd.id}));
   await assert.rejects(store.account('member.remove',owner,dev.id,{user_id:owner}));
   await store.account('member.remove',owner,dev.id,{user_id:other});
   await assert.rejects(store.account('member.add',owner,dev.id,{user_id:crypto.randomUUID(),role:'member'}),{code:'23503'});
  });
  await t.step('operator records provider evidence; customers cannot self-approve or write agreements',async()=>{
   const data={provider:'docusign',version:'synthetic-provider-v1',signer_id:owner,signer_email:'signer@example.test',signed_at:new Date().toISOString(),envelope_id:crypto.randomUUID(),document_sha256:'a'.repeat(64),document_reference:'private:synthetic-completed.pdf'};
   await assert.rejects(db.rpc('b2b_api_review',{p_org:dev.id,p_reviewer:'fixture-operator',p_action:'agreement.record',p_data:{...data,document_reference:'https://public.invalid/document.pdf'}}));
   await db.rpc('b2b_api_review',{p_org:dev.id,p_reviewer:'fixture-operator',p_action:'agreement.record',p_data:data});
   const records=(await store.account('dashboard',owner,dev.id)).agreements;
   assert.equal(records[0].envelope_id,data.envelope_id);assert.equal(records[0].document_reference,undefined);
   const c=await db.pool.connect();try{await c.query('set role b2b_backend');await assert.rejects(c.query('select public.b2b_api_review($1,$2,$3,$4)',[dev.id,'bad','business.approve','{}']),{code:'42501'});}finally{await c.query('reset role');c.release();}
  });
  await t.step('minute limits are exact under concurrent requests and shared across organization keys',async()=>{
   for(const [o,k,limit] of [[dev,kd,10],[pro,kp,30],[business,kb,120]] as any){
    await db.pool.query('delete from b2b_private.usage_records where organization_id=$1',[o.id]);
    const second=await key(o);const responses=await Promise.all(Array.from({length:160},(_,i)=>api(i%2?k.key:second.key)));
    assert.equal(responses.filter(r=>r.status===200).length,limit);assert.equal(responses.filter(r=>r.status===429).length,160-limit);
    for(const r of responses.filter(r=>r.status===429))assert.ok(Number(r.headers.get('Retry-After'))>=1);
   }
  });
  await t.step('independent customers do not share rate counters',async()=>{
   const o=await organization('developer',other),k=await key(o);assert.equal((await api(k.key)).status,200);
  });
  await t.step('monthly quota admits precisely the last remaining request',async()=>{
   await db.pool.query('delete from b2b_private.usage_records where organization_id=$1',[dev.id]);
   await db.pool.query('update b2b_private.usage_counters set used=9999 where organization_id=$1',[dev.id]);
   const results=await Promise.all(Array.from({length:40},()=>api(kd.key)));
   assert.equal(results.filter(r=>r.status===200).length,1);
   const body=await results.find(r=>r.status===429)!.json();assert.equal(body.error.code,'monthly_quota');
   assert.equal((await store.account('dashboard',owner,dev.id)).usage.used,10000);
  });
  await t.step('billing period change resets quota without changing history; expiration and failed payment block',async()=>{
   await db.pool.query("update b2b_private.subscriptions set period_start=clock_timestamp()-interval '1 hour',period_end=clock_timestamp()+interval '30 days',paid_through=clock_timestamp()+interval '30 days',cancel_at_period_end=true where organization_id=$1",[dev.id]);
   await db.pool.query('delete from b2b_private.usage_records where organization_id=$1',[dev.id]);
   assert.equal((await api(kd.key)).status,200);const dash=await store.account('dashboard',owner,dev.id);assert.equal(dash.usage.used,1);assert.equal(dash.history.length,2);
   await db.pool.query("update b2b_private.subscriptions set paid_through=clock_timestamp()-interval '1 second' where organization_id=$1",[dev.id]);assert.equal((await api(kd.key)).status,403);
   await db.pool.query("update b2b_private.subscriptions set paid_through=period_end,status='past_due' where organization_id=$1",[dev.id]);assert.equal((await api(kd.key)).status,403);
   await db.pool.query("update b2b_private.subscriptions set status='active' where organization_id=$1",[dev.id]);
  });
  await t.step('internal metering retries are idempotent; caller request IDs cannot bypass accounting',async()=>{
   const id=crypto.randomUUID();const results=await Promise.all(Array.from({length:20},()=>store.meter(kd.hash,id,'retry-test',true)));assert.equal(results.filter((r:any)=>!r.replay).length,1);
   await assert.rejects(store.meter(kp.hash,id,'retry-test',true));
  });
  await t.step('120-second source TTL survives copies; stale and future source records fail closed',async()=>{
   await db.pool.query('delete from b2b_private.usage_records where organization_id=$1',[pro.id]);
   clock=Date.parse(source.fetched_at)+120000;assert.equal((await api(kp.key)).status,200);
   clock++;const response=await api(kp.key);assert.equal(response.status,503);assert.equal((await response.json()).error.code,'stale_cache');
   await assert.rejects(materialize(source,clock,'synthetic'));await assert.rejects(materialize({...source,fetched_at:new Date(clock+5001).toISOString()},clock,'synthetic'));
   clock=Date.now();source=syntheticSnapshot(clock,1);await copied();assert.equal((await api(kp.key)).status,200);
  });
  await t.step('live licensing flag blocks both market delivery and key creation',async()=>{
   await assert.rejects(key(pro,'live'),e=>e.status===403);
   await db.pool.query('update b2b_private.subscriptions set livemode=true where organization_id=$1',[pro.id]);
   try{await assert.rejects(key(pro,'live'),e=>e.status===403);
    // A pre-existing live credential fixture still cannot bypass launch gates.
    const live=await generateKey('live',env.API_KEY_PEPPER);
    await db.pool.query("insert into b2b_private.keys(organization_id,key_hash,prefix,label,mode) values($1,$2,$3,'synthetic legacy fixture','live')",[pro.id,live.hash,live.prefix]);
    assert.equal((await api(live.key)).status,503);assert.equal((await control('keys',{organization_id:pro.id,label:'live',mode:'live'})).status,503);
    await store.publish(await materialize(source,clock,'pending_review'));
    const gated=createApp({env:{...env,API_LIVE_MARKET_DATA_ENABLED:'true',API_DATA_LICENSE_APPROVED:'true',API_DATA_LICENSE_REFERENCE:'synthetic-test-reference'},store,resolveUser:async()=>null,billing:{},now:()=>clock});
    const denied=await gated(new Request('http://127.0.0.1/v1/conversions',{headers:{Authorization:'Bearer '+live.key}}));assert.equal(denied.status,503);assert.equal((await denied.json()).error.code,'unauthorized_source');
    const decision=await store.meter(kp.hash,crypto.randomUUID(),'cross-environment',true);assert.equal(decision.allowed,false);assert.equal(decision.status,403);
   }finally{await db.pool.query('update b2b_private.subscriptions set livemode=false where organization_id=$1',[pro.id]);}
  });
  await t.step('a snapshot expiring during accounting is never returned as fresh',async()=>{
   await db.pool.query('delete from b2b_private.usage_records where organization_id=$1',[pro.id]);
   const start=clock;
   const slow=createApp({env,store:{...store,meter:async(...args:any[])=>{const result=await store.meter(...args);clock=Date.parse(source.fetched_at)+120001;return result;}},resolveUser:async()=>null,billing:{},now:()=>clock});
   const response=await slow(new Request('http://127.0.0.1:8799/v1/conversions',{headers:{Authorization:`Bearer ${kp.key}`}}));
   assert.equal(response.status,503);assert.equal((await response.json()).error.code,'stale_cache');clock=start;
  });
  await t.step('cache advances atomically and old copies cannot overwrite new snapshots',async()=>{
   const before=await store.snapshot('test','AUTO');clock+=1000;source=syntheticSnapshot(clock,2);await copied();const after=await store.snapshot('test','AUTO');assert.notEqual(before.digest,after.digest);
   await store.publish([before]);assert.equal((await store.snapshot('test','AUTO')).digest,after.digest);
   assert.equal((await api(kd.key)).headers.get('X-Snapshot-Id'),after.digest);
   assert.equal((await api(kp.key)).headers.get('X-Snapshot-Id'),after.digest);
  });
  await t.step('restricted gateway cannot publish cache or read tables; source role cannot refresh',async()=>{
   const c=await db.pool.connect();try{
    for(const role of ['anon','authenticated','service_role']){
     await c.query(`set role ${role}`);await assert.rejects(c.query("select public.b2b_api_key('synthetic')"),{code:'42501'});await assert.rejects(c.query("select public.b2b_api_cache_read('test','AUTO')"),{code:'42501'});await c.query('reset role');
    }
    await c.query('set role b2b_backend');await assert.rejects(c.query('select * from b2b_private.keys'),{code:'42501'});
    await assert.rejects(c.query("select public.b2b_api_cache_publish('test','[]')"),{code:'42501'});await c.query('reset role');
    await c.query('create table public.pro_price_cache(id int,quotes jsonb,fetched_at timestamptz);create function public.claim_pro_price_refresh() returns uuid language sql as $$ select gen_random_uuid() $$;revoke all on function public.claim_pro_price_refresh() from public');
    await c.query(await Deno.readTextFile(new URL('../../supabase/sql/b2b_api_source_reader.sql',import.meta.url)));
    await c.query('set role b2b_source_reader');await assert.rejects(c.query('select public.claim_pro_price_refresh()'),{code:'42501'});await assert.rejects(c.query('update public.pro_price_cache set fetched_at=now()'),{code:'42501'});
   }finally{await c.query('reset role');c.release();}
  });
  await t.step('zero extra provider calls: same 3 synthetic updater ticks, 0 vs 600 B2B GETs',async()=>{
   async function scenario(traffic:number){
    let yahooHttp=0,quoteCalls=0,copies=0,reads=0,admitted=0;let stored=syntheticSnapshot(clock);let claimed=false;
    const fakeClient={quote:async(_s:any,_q:any,opts:any)=>{quoteCalls++;await opts.fetch('https://fc.yahoo.com');await opts.fetch('https://query2.finance.yahoo.com/v1/test/getcrumb');await opts.fetch('https://query2.finance.yahoo.com/v7/finance/quote');return stored.quotes;}};
    const fetchQuotes=createYahooFetcher(fakeClient,{fetch:async()=>{yahooHttp++;return new Response('{}');}});
    const updater=createUpdater({authorized:()=>true,claim:async()=>{if(claimed)return null;claimed=true;return'fixture-claim';},fetchQuotes,complete:async(_c,q)=>{stored={quotes:q,fetched_at:new Date(clock).toISOString()};},release:async()=>{}});
    for(let tick=0;tick<3;tick++){
     claimed=false;clock+=60000;await db.pool.query("update b2b_private.usage_records set created_at=created_at-interval '61 seconds' where organization_id=any($1::uuid[])",[[pro.id,business.id]]);await updater(new Request('https://synthetic.invalid/updater',{method:'POST'}));
     await synchronize(async()=>{reads++;return stored;},async rows=>{copies++;await store.publish(rows);},clock,'synthetic');
     const rs=await Promise.all(Array.from({length:traffic/3},(_,i)=>api(i%2?kp.key:kb.key)));admitted+=rs.filter(r=>r.status===200).length;
    }
    return{quoteCalls,yahooHttp,copies,sourceReads:reads,admitted};
   }
   const baseline=await scenario(0),loaded=await scenario(600);assert.deepEqual({...loaded,admitted:0},baseline);assert.deepEqual(loaded,{quoteCalls:3,yahooHttp:9,copies:3,sourceReads:3,admitted:390});
   console.log('ZERO-UPSTREAM EVIDENCE',JSON.stringify({baseline,loaded,additionalYahooHTTP:loaded.yahooHttp-baseline.yahooHttp,customerRequests:600,actualNetworkRequests:0}));
  });
 }finally{await db.close();}
}});
