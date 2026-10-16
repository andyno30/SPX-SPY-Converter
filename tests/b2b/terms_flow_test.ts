import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../../supabase/b2b-api/app.mjs';
import {createStore} from '../../supabase/b2b-api/database.mjs';
import {createBilling} from '../../supabase/b2b-api/billing.mjs';
import {TERMS_TEXT,TERMS_VERSION,TERMS_DIGEST} from '../../supabase/b2b-api/terms.mjs';
import {ApiError} from '../../supabase/b2b-api/core.mjs';
import {createMockStripe} from '../../scripts/b2b-api/mock-stripe.mjs';
import {materialize} from '../../supabase/b2b-api/mirror.ts';
import {syntheticSnapshot} from '../../supabase/b2b-api/fixtures.ts';
const require=createRequire(import.meta.url),{createLocalDatabase}=require('../../scripts/b2b-api/local-database.cjs');
Deno.test({name:'Terms → verified Stripe payment → automatic key → shared API, all three tiers',sanitizeResources:false,sanitizeOps:false,fn:async t=>{
 const db=await createLocalDatabase('terms');
 try{
  const owner=crypto.randomUUID(),other=crypto.randomUUID(),unverified=crypto.randomUUID();
  await db.pool.query('insert into auth.users(id) values($1),($2),($3)',[owner,other,unverified]);
  await db.pool.query('update auth.users set email_confirmed_at=null where id=$1',[unverified]);
  await db.pool.query('insert into b2b_private.terms_versions(version,document_text,document_sha256,test_enabled) values($1,$2,$3,true)',[TERMS_VERSION,TERMS_TEXT,TERMS_DIGEST]);
  const store=createStore(async(n:any,a:any)=>{try{return await db.rpc(n,a);}catch(e:any){if(e.code==='42501')throw new ApiError(403,'forbidden','Denied');throw e;}});
  const env:any={API_ENVIRONMENT:'test',API_LOCAL_ONLY:'true',API_SITE_ORIGIN:'http://127.0.0.1',API_SYNTHETIC_TEST_MODE:'true',API_LEGAL_APPROVED:'true',API_AGREEMENT_VERSION:TERMS_VERSION,API_KEY_PEPPER:'synthetic-only-private-pepper-of-sufficient-length',API_STRIPE_TEST_ENABLED:'true',STRIPE_API_PRICE_DEVELOPER:'price_test_developer',STRIPE_API_PRICE_PRO:'price_test_pro',STRIPE_API_PRICE_BUSINESS:'price_test_business',STRIPE_API_WEBHOOK_SECRET:'whsec_synthetic',STRIPE_API_PORTAL_CONFIGURATION:'bpc_synthetic'};
  const mock=createMockStripe(env.API_SITE_ORIGIN),billing=createBilling(env,store,mock.transport);
  const app=createApp({env,store,billing,resolveUser:async(r:any)=>({id:r.headers.get('authorization')||owner,email:'fixture@example.test',email_confirmed_at:new Date().toISOString()})});
  const call=(path:string,data:any,actor=owner)=>app(new Request('http://127.0.0.1/platform/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:actor},body:JSON.stringify(data)}));
  const accept=(id:string,extra:any={})=>call('agreement',{organization_id:id,accepted:true,version:TERMS_VERSION,document_sha256:TERMS_DIGEST,...extra});
  await store.publish(await materialize(syntheticSnapshot(Date.now()),Date.now(),'synthetic'));
  const org=await store.account('create',owner,null,{name:'Terms fixture',legal_name:'Synthetic',email:'fixture@example.test',intended_use:'Synthetic integration',plan:'developer'});
  await t.step('unchecked, forged, stale, unapproved and cross-organization submissions fail closed',async()=>{
   for(const accepted of [false,null,undefined,'true'])assert.equal((await accept(org.id,{accepted})).status,400);
   assert.equal((await accept(org.id,{version:'stale'})).status,409);
   assert.equal((await accept(org.id,{document_sha256:'0'.repeat(64)})).status,409);
   assert.equal((await call('agreement',{organization_id:org.id,accepted:true,version:TERMS_VERSION,document_sha256:TERMS_DIGEST},other)).status,403);
   env.API_LEGAL_APPROVED='false';assert.equal((await accept(org.id,{approved:true})).status,503);env.API_LEGAL_APPROVED='true';
   await db.pool.query('update b2b_private.terms_versions set test_enabled=false');assert.equal((await accept(org.id)).status,403);await db.pool.query('update b2b_private.terms_versions set test_enabled=true');
   await db.pool.query('update b2b_private.subscriptions set livemode=true where organization_id=$1',[org.id]);assert.equal((await accept(org.id,{approved:true,approved_at:new Date().toISOString()})).status,403);await db.pool.query('update b2b_private.subscriptions set livemode=false where organization_id=$1',[org.id]);
   const u=await store.account('create',unverified,null,{name:'Unverified',legal_name:'Synthetic',email:'unverified@example.test',intended_use:'Tests',plan:'developer'});
   assert.equal((await call('agreement',{organization_id:u.id,accepted:true,version:TERMS_VERSION,document_sha256:TERMS_DIGEST},unverified)).status,403);
   await assert.rejects(billing.checkout(org.id,'developer'),(e:any)=>e.code==='terms_acceptance_required');
  });
  await t.step('concurrent acceptance is idempotent and cannot forge signer, date or approval',async()=>{
   const responses=await Promise.all(Array.from({length:16},()=>accept(org.id,{signer_id:other,signed_at:'2000-01-01',approved:true,document_text:'forged'})));
   for(const r of responses)assert.equal(r.status,200);
   const receipts=await db.pool.query('select * from b2b_private.terms_acceptances where organization_id=$1',[org.id]);assert.equal(receipts.rowCount,1);
   const receipt=receipts.rows[0];assert.equal(receipt.user_id,owner);assert.equal(receipt.email,'fixture@example.test');assert.ok(new Date(receipt.accepted_at).getFullYear()>2025);
   assert.equal(receipt.document_sha256,TERMS_DIGEST);assert.equal(receipt.evidence.livemode,false);
   assert.equal((await db.pool.query("select count(*)::int n from b2b_private.audit_logs where organization_id=$1 and action='terms.accepted'",[org.id])).rows[0].n,1);
  });
  await t.step('catalog is immutable; backend and public identities cannot approve or read private receipts',async()=>{
   await assert.rejects(db.pool.query("update b2b_private.terms_versions set document_text='replacement'"));
   const c=await db.pool.connect();try{for(const role of ['b2b_backend','anon','authenticated','service_role']){await c.query('set role '+role);await assert.rejects(c.query('select * from b2b_private.terms_acceptances'));await assert.rejects(c.query('update b2b_private.terms_versions set approved_at=now(),approved_by=\'forged\''));await c.query('reset role');}}finally{await c.query('reset role');c.release();}
  });
  for(const [plan,cents,quota,rpm] of [['developer',2500,10000,10],['pro',5000,100000,30],['business',15000,500000,120]] as const){
   await t.step(`${plan}: acceptance, exact Stripe price, verified payment, one key, API and quota`,async()=>{
    const o=plan==='developer'?org:await store.account('create',owner,null,{name:plan,legal_name:'Synthetic',email:'fixture@example.test',intended_use:'Tests',plan});
    assert.equal((await accept(o.id)).status,200);
    assert.deepEqual(await(await call('keys/provision',{organization_id:o.id})).json(),{created:false});
    if(plan==='business'){await assert.rejects(billing.checkout(o.id,plan),(e:any)=>e.code==='business_review_required');await db.pool.query('update b2b_private.organizations set business_approved=true where id=$1',[o.id]);}
    const checkout=await billing.checkout(o.id,plan);assert.ok(checkout.url);assert.equal(mock.prices['price_test_'+plan].unit_amount,cents);
    const session=[...mock.sessions.values()].find((s:any)=>s.metadata.organization_id===o.id)!;
    assert.equal((await store.billing('read',o.id)).subscription.status,'pending');
    mock.complete(session.id);await billing.webhook(await mock.webhook(mock.event('checkout.session.completed',session),env.STRIPE_API_WEBHOOK_SECRET));
    const response=await call('keys/provision',{organization_id:o.id});assert.equal(response.status,201);const key=await response.json();assert.match(key.key,/^sc_test_/);
    assert.deepEqual(await(await call('keys/provision',{organization_id:o.id})).json(),{created:false});
    const api=await app(new Request('http://127.0.0.1/v1/conversions',{headers:{Authorization:'Bearer '+key.key}}));assert.equal(api.status,200);
    const dash=await store.account('dashboard',owner,o.id);assert.equal(dash.usage.used,1);assert.equal(dash.usage.quota,quota);assert.equal(dash.usage.per_minute,rpm);
    assert.ok(!JSON.stringify(dash).includes(key.key));
    assert.ok((await billing.portal(o.id)).url);
   });
  }
 }finally{await db.close();}
}});
