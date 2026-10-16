import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStore} from '../../supabase/b2b-api/database.mjs';
import {createBilling,stripeClient} from '../../supabase/b2b-api/billing.mjs';
import {sha256} from '../../supabase/b2b-api/core.mjs';
import {createMockStripe} from '../../scripts/b2b-api/mock-stripe.mjs';
const require=createRequire(import.meta.url),{createLocalDatabase}=require('../../scripts/b2b-api/local-database.cjs');
Deno.test({name:'Stripe test adapter: signatures, gates, exact prices and canonical event reconciliation',sanitizeResources:false,sanitizeOps:false,fn:async t=>{
 const db=await createLocalDatabase('billing'),store=createStore(db.rpc);
 const actor=crypto.randomUUID(),origin='https://synthetic.invalid';
 const env={API_ENVIRONMENT:'test',API_STRIPE_TEST_ENABLED:'true',API_LEGAL_APPROVED:'true',API_AGREEMENT_VERSION:'test-v1',API_SYNTHETIC_TEST_MODE:'true',API_LIVE_MARKET_DATA_ENABLED:'false',API_SITE_ORIGIN:origin,STRIPE_API_PRICE_DEVELOPER:'price_test_developer',STRIPE_API_PRICE_PRO:'price_test_pro',STRIPE_API_PRICE_BUSINESS:'price_test_business',STRIPE_API_WEBHOOK_SECRET:'whsec_synthetic_only',STRIPE_API_PORTAL_CONFIGURATION:'bpc_test_api_only'};
 const mock=createMockStripe(origin),billing=createBilling(env,store,mock.transport);
 await db.pool.query('insert into auth.users values($1)',[actor]);
 const org=await store.account('create',actor,null,{name:'Billing fixture',legal_name:'Synthetic',email:'test@example.test',intended_use:'Mock billing',plan:'developer'});
 const send=async(type:string,obj:any,id?:string,created?:number)=>{const event=mock.event(type,obj);if(id)event.id=id;if(created)event.created=created;return billing.webhook(await mock.webhook(event,env.STRIPE_API_WEBHOOK_SECRET));};
 try{
  await t.step('disabled flags, live secret keys and missing signatures prevent checkout',async()=>{
   await assert.rejects(createBilling({...env,API_STRIPE_TEST_ENABLED:'false'},store,mock.transport).checkout(org.id,'developer'),e=>e.code==='billing_disabled');
   assert.throws(()=>stripeClient({STRIPE_SECRET_KEY:'sk_live_NOT_A_REAL_KEY'}),e=>e.code==='test_configuration_required');
   await assert.rejects(billing.checkout(org.id,'developer'),e=>e.code==='terms_acceptance_required');
   await assert.rejects(billing.checkout(org.id,'business'),e=>e.code==='business_review_required');
  });
  await db.pool.query("insert into b2b_private.agreements(organization_id,version,signer_id,signer_email,signed_at,provider,envelope_id,document_sha256,document_reference) values($1,'test-v1',$2,'test@example.test',now(),'synthetic-test','synthetic-envelope',$3,'fixture:document')",[org.id,actor,await sha256('Synthetic signed document')]);
  await t.step('mispriced plan cannot create a checkout',async()=>{const p=mock.prices.price_test_developer;p.unit_amount=1900;await assert.rejects(billing.checkout(org.id,'developer'),e=>e.code==='price_mismatch');p.unit_amount=2500;});
  let session:any,sub:any;
  await t.step('checkout retries after a lost database acknowledgment retain identical Stripe parameters',async()=>{
   let failed=false;
   const interrupted={...store,billing:async(action:string,id:string,data:any)=>{if(action==='checkout.finish'&&!failed){failed=true;throw new Error('Synthetic lost acknowledgment');}return store.billing(action,id,data);}};
   await assert.rejects(createBilling(env,interrupted,mock.transport).checkout(org.id,'developer'),/lost acknowledgment/);
   const retry=await createBilling(env,store,mock.transport,()=>Date.now()+7000).checkout(org.id,'developer');
   assert.ok(retry.url);assert.equal(mock.sessions.size,1);assert.equal(mock.customers.size,1);
  });
  await t.step('concurrent checkouts create one API customer/session with no Pro metadata',async()=>{
   const results=await Promise.all(Array.from({length:10},()=>billing.checkout(org.id,'developer')));assert.equal(new Set(results.map(r=>r.url)).size,1);assert.equal(mock.customers.size,1);assert.equal(mock.sessions.size,1);
   session=[...mock.sessions.values()][0];assert.equal(session.metadata.namespace,'b2b_api');assert.ok(!JSON.stringify(session).includes('userId'));
   assert.equal((await store.billing('read',org.id)).subscription.status,'pending');
  });
  await t.step('raw-body HMAC rejects invalid, stale and modified signatures',async()=>{
   const event=mock.event('checkout.session.completed',session);const req=await mock.webhook(event,env.STRIPE_API_WEBHOOK_SECRET);const headers=new Headers(req.headers);headers.set('Stripe-Signature','t=1,v1=bad');await assert.rejects(billing.webhook(new Request(req.url,{method:'POST',headers,body:JSON.stringify(event)})),e=>e.code==='invalid_signature');
   const good=await mock.webhook(event,env.STRIPE_API_WEBHOOK_SECRET);await assert.rejects(billing.webhook(new Request(good.url,{method:'POST',headers:good.headers,body:JSON.stringify({...event,type:'invoice.paid'})})),e=>e.code==='invalid_signature');
  });
  await t.step('payment activates only through verified webhook and duplicate delivery is idempotent',async()=>{
   sub=mock.complete(session.id);const id='evt_test_duplicate';await send('checkout.session.completed',session,id);assert.equal((await store.billing('read',org.id)).subscription.status,'active');
   assert.equal((await send('checkout.session.completed',session,id)).duplicate,true);assert.equal((await db.pool.query('select count(*)::int n from b2b_private.stripe_events')).rows[0].n,1);
  });
  await t.step('test billing cannot mutate a live organization, including direct reconciliation',async()=>{
   await db.pool.query('update b2b_private.subscriptions set livemode=true where organization_id=$1',[org.id]);
   try{
    await assert.rejects(billing.checkout(org.id,'developer'),e=>e.code==='billing_mode_mismatch');
    await assert.rejects(billing.portal(org.id),e=>e.code==='billing_mode_mismatch');
    await assert.rejects(send('customer.subscription.updated',sub),e=>e.code==='billing_mode_mismatch');
    const lease=await store.billing('sync.claim',org.id,{event_id:'evt_wrong_mode'});
    await assert.rejects(store.billing('sync.apply',org.id,{token:lease.token,event_id:'evt_wrong_mode',event_created:1,snapshot:{livemode:false}}),e=>e.code==='42501');
    await store.billing('sync.release',org.id,{token:lease.token});
   }finally{await db.pool.query('update b2b_private.subscriptions set livemode=false where organization_id=$1',[org.id]);}
  });
  await t.step('scheduled cancellation preserves paid access until expiration',async()=>{sub.cancel_at_period_end=true;await send('customer.subscription.updated',sub);const s=(await store.billing('read',org.id)).subscription;assert.equal(s.status,'active');assert.equal(s.cancel_at_period_end,true);assert.ok(Date.parse(s.paid_through)>Date.now());});
  await t.step('failed invoice blocks; out-of-order failure cannot replace canonical paid state',async()=>{
   sub.status='past_due';sub.latest_invoice.paid=false;sub.latest_invoice.status='open';mock.invoices.set(sub.latest_invoice.id,sub.latest_invoice);
   await send('invoice.payment_failed',sub.latest_invoice);assert.equal((await store.billing('read',org.id)).subscription.status,'past_due');
   sub.status='active';sub.latest_invoice.paid=true;sub.latest_invoice.status='paid';await send('invoice.paid',sub.latest_invoice);
   await send('invoice.payment_failed',sub.latest_invoice,'evt_test_old',Math.floor(Date.now()/1000)-1000);assert.equal((await store.billing('read',org.id)).subscription.status,'active');
  });
  await t.step('refund suspends access; subsequent paid event cannot clear suspension',async()=>{
   mock.charges.set('ch_test',{id:'ch_test',invoice:sub.latest_invoice.id,livemode:false});
   await send('charge.refunded',{id:'ch_test',invoice:sub.latest_invoice.id});assert.equal((await store.billing('read',org.id)).organization.suspended,true);
   await send('invoice.paid',sub.latest_invoice);assert.equal((await store.billing('read',org.id)).organization.suspended,true);
  });
  await t.step('a dispute resolves its charge and invoice and requires manual reactivation even when closed',async()=>{
   await db.pool.query('update b2b_private.organizations set suspended=false where id=$1',[org.id]);
   const charge={id:'ch_disputed_test',invoice:sub.latest_invoice.id,livemode:false};mock.charges.set(charge.id,charge);
   await send('charge.dispute.created',{id:'dp_test',charge:charge.id});assert.equal((await store.billing('read',org.id)).organization.suspended,true);
   await send('charge.dispute.closed',{id:'dp_test',charge:charge.id,status:'won'});assert.equal((await store.billing('read',org.id)).organization.suspended,true);
  });
  await t.step('canonical termination blocks access',async()=>{sub.status='canceled';await send('customer.subscription.deleted',sub);assert.equal((await store.billing('read',org.id)).subscription.status,'canceled');});
  await t.step('webhook sync lease fences concurrent writes and expired tokens',async()=>{
   const a=await store.billing('sync.claim',org.id,{event_id:'evt_lease'});assert.equal(a.acquired,true);assert.equal((await store.billing('sync.claim',org.id,{event_id:'evt_lease_other'})).acquired,false);
   await assert.rejects(store.billing('sync.apply',org.id,{token:crypto.randomUUID(),event_id:'evt_bad',event_created:1,snapshot:{}}));await store.billing('sync.release',org.id,{token:a.token});
  });
  await t.step('portal is scoped to separate API customer/configuration and existing Pro events are ignored',async()=>{
   const portal=await billing.portal(org.id);assert.ok(portal.url.includes(encodeURIComponent(session.customer)));
   const foreign={...sub,id:'sub_pro_existing',metadata:{userId:actor}};mock.subscriptions.set(foreign.id,foreign);assert.equal((await send('customer.subscription.updated',foreign)).ignored,true);
  });
 }finally{await db.close();}
}});
