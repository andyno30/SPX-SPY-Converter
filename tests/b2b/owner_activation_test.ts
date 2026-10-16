import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../../supabase/b2b-api/app.mjs';
import {createStore} from '../../supabase/b2b-api/database.mjs';
import {createBilling} from '../../supabase/b2b-api/billing.mjs';
import {liveAllowed,deliveryAuthorization,authorizedLiveSnapshot} from '../../supabase/b2b-api/core.mjs';
import {TERMS_TEXT,TERMS_VERSION,TERMS_DIGEST} from '../../supabase/b2b-api/terms.mjs';
import {materialize} from '../../supabase/b2b-api/mirror.ts';
import {syntheticSnapshot} from '../../supabase/b2b-api/fixtures.ts';
import {createMockStripe} from '../../scripts/b2b-api/mock-stripe.mjs';
import {createRequestHandler} from '../../supabase/functions/get-live-price-pro/request.ts';
const require=createRequire(import.meta.url),{createLocalDatabase}=require('../../scripts/b2b-api/local-database.cjs');
const ownerConfig={API_ENVIRONMENT:'production',API_LIVE_MARKET_DATA_ENABLED:'true',API_DATA_LICENSE_APPROVED:'false',API_OWNER_DELIVERY_AUTHORIZED:'true',API_OWNER_AUTHORIZATION_REFERENCE:'synthetic-owner-directive'};

Deno.test('owner activation is explicit, reference-bound and never claims verified licensing',async()=>{
 assert.equal(liveAllowed({}),false);
 for(const change of [{API_LIVE_MARKET_DATA_ENABLED:'false'},{API_OWNER_DELIVERY_AUTHORIZED:'false'},{API_OWNER_AUTHORIZATION_REFERENCE:''},{API_ENVIRONMENT:'test'}])assert.equal(liveAllowed({...ownerConfig,...change}),false);
 assert.deepEqual(deliveryAuthorization(ownerConfig),{provenance:'owner_authorized',reference:'synthetic-owner-directive'});
 assert.equal(authorizedLiveSnapshot({provenance:'licensed',license_reference:'synthetic-owner-directive'},ownerConfig),false);
 assert.equal(authorizedLiveSnapshot({provenance:'owner_authorized',owner_authorization_reference:'forged'},ownerConfig),false);
 assert.equal(authorizedLiveSnapshot({provenance:'pending_review'},ownerConfig),false);
 await assert.rejects(materialize(syntheticSnapshot(Date.now()),Date.now(),'owner_authorized'));
});

Deno.test({name:'owner-authorized production branch: all plan payments, one-time keys, exact JSON and gates (local fixtures only)',sanitizeResources:false,sanitizeOps:false,fn:async t=>{
 const db=await createLocalDatabase('activation');
 try{
  const actor=crypto.randomUUID();await db.pool.query('insert into auth.users(id) values($1)',[actor]);
  await db.pool.query('insert into b2b_private.terms_versions(version,document_text,document_sha256,approved_at,approved_by) values($1,$2,$3,now(),$4)',[TERMS_VERSION,TERMS_TEXT,TERMS_DIGEST,'synthetic reviewer']);
  const store=createStore((n:any,a:any)=>db.rpc(n,a));
  const env:any={...ownerConfig,API_LOCAL_ONLY:'true',API_SITE_ORIGIN:'http://127.0.0.1',API_LEGAL_APPROVED:'true',API_AGREEMENT_VERSION:TERMS_VERSION,API_KEY_PEPPER:'synthetic-only-private-pepper-of-sufficient-length',API_STRIPE_LIVE_ENABLED:'true',STRIPE_API_PRICE_DEVELOPER:'price_test_developer',STRIPE_API_PRICE_PRO:'price_test_pro',STRIPE_API_PRICE_BUSINESS:'price_test_business',STRIPE_API_WEBHOOK_SECRET:'whsec_synthetic',STRIPE_API_PORTAL_CONFIGURATION:'bpc_synthetic'};
  const mock=createMockStripe(env.API_SITE_ORIGIN);
  // Exercise live-mode branch checks without contacting Stripe or charging money.
  const asLive=(x:any):any=>Array.isArray(x)?x.map(asLive):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,k==='livemode'?true:asLive(v)])):x;
  const billing=createBilling(env,store,async(...args:any[])=>asLive(await mock.transport(...args)));
  const app=createApp({env,store,billing,resolveUser:async()=>({id:actor,email:'fixture@example.test',email_confirmed_at:new Date().toISOString()})});
  const post=(path:string,data:any)=>app(new Request(env.API_SITE_ORIGIN+'/platform/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}));
  const time=Date.now(),source=syntheticSnapshot(time),rows=await materialize(source,time,'owner_authorized',env.API_OWNER_AUTHORIZATION_REFERENCE);
  await store.publish(rows);
  assert.equal(rows[0].license_reference,null);assert.equal(rows[0].owner_authorization_reference,env.API_OWNER_AUTHORIZATION_REFERENCE);
  const original=createRequestHandler({userId:async()=>actor,readAccessSnapshot:async()=>({is_subscribed:true,...source}),now:()=>time});
  const expected=await(await original(new Request('https://fixture/',{headers:{Authorization:'Bearer fixture'}}))).text();
  assert.equal(rows[0].body,expected);
  const bad=rows.map(row=>({...row,owner_authorization_reference:null}));await assert.rejects(store.publish(bad));
  for(const [plan,quota,rpm] of [['developer',10000,10],['pro',100000,30],['business',500000,120]] as const){
   await t.step(plan,async()=>{
    const org=await store.account('create',actor,null,{name:'Synthetic '+plan,legal_name:'Local fixture',email:'fixture@example.test',intended_use:'Local no-network verification',plan,livemode:true});
    assert.equal((await post('agreement',{organization_id:org.id,accepted:true,version:TERMS_VERSION,document_sha256:TERMS_DIGEST})).status,200);
    assert.deepEqual(await(await post('keys/provision',{organization_id:org.id})).json(),{created:false});
    if(plan==='business'){await assert.rejects(billing.checkout(org.id,plan),(e:any)=>e.code==='business_review_required');await db.pool.query('update b2b_private.organizations set business_approved=true where id=$1',[org.id]);}
    await billing.checkout(org.id,plan);const session=[...mock.sessions.values()].find((s:any)=>s.metadata.organization_id===org.id)!;
    assert.equal((await store.billing('read',org.id)).subscription.status,'pending');
    mock.complete(session.id);const event=asLive(mock.event('checkout.session.completed',session));
    const req=()=>mock.webhook(event,env.STRIPE_API_WEBHOOK_SECRET);
    await billing.webhook(await req());assert.equal((await billing.webhook(await req())).duplicate,true);
    const provision=await post('keys/provision',{organization_id:org.id});assert.equal(provision.status,201);const key=(await provision.json()).key;assert.match(key,/^sc_live_/);
    assert.deepEqual(await(await post('keys/provision',{organization_id:org.id})).json(),{created:false});
    const request=()=>app(new Request(env.API_SITE_ORIGIN+'/v1/conversions',{headers:{Authorization:'Bearer '+key}}));
    const response=await request();assert.equal(response.status,200);assert.equal(response.headers.get('X-Data-Mode'),'owner_authorized');assert.equal(await response.text(),expected);
    const dash=await store.account('dashboard',actor,org.id);assert.equal(dash.usage.used,1);assert.equal(dash.usage.quota,quota);assert.equal(dash.usage.per_minute,rpm);
    assert.ok((await billing.portal(org.id)).url);
    env.API_OWNER_AUTHORIZATION_REFERENCE='different';assert.equal((await request()).status,503);env.API_OWNER_AUTHORIZATION_REFERENCE=ownerConfig.API_OWNER_AUTHORIZATION_REFERENCE;
    env.API_LIVE_MARKET_DATA_ENABLED='false';assert.equal((await request()).status,503);env.API_LIVE_MARKET_DATA_ENABLED='true';
   });
  }
  await db.pool.query("update b2b_private.snapshots set source_fetched_at=now()-interval '121 seconds'");
  assert.equal((await store.snapshot('live','AUTO')).provenance,'owner_authorized');
 }finally{await db.close();}
}});
