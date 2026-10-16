import {ApiError,PLANS,enabled,liveAllowed,requireValue,hmac,constantEqual,readLimited,validId} from './core.mjs';
export const STRIPE_API_VERSION='2024-06-20';
export const stripeLiveMode=env=>env.API_ENVIRONMENT==='production';
export const billingEnabled=env=>enabled(stripeLiveMode(env)?env.API_STRIPE_LIVE_ENABLED:env.API_STRIPE_TEST_ENABLED);
const handled=new Set(['checkout.session.completed','invoice.paid','invoice.payment_failed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','charge.refunded','charge.dispute.created','charge.dispute.closed']);
export function stripeClient(env,fetcher=fetch){
 const live=stripeLiveMode(env);
 requireValue((live?/^(?:sk|rk)_live_/:/^(?:sk|rk)_test_/).test(env.STRIPE_SECRET_KEY||''),503,'test_configuration_required','Stripe credentials must match the configured environment.');
 return async(path,method='GET',data,idem)=>{
  const body=data?new URLSearchParams(data):undefined;
  const response=await fetcher(`https://api.stripe.com/v1/${path}`,{method,headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'Stripe-Version':STRIPE_API_VERSION,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idem?{'Idempotency-Key':idem}:{})},body,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new ApiError(502,'stripe_unavailable','Stripe could not complete the request. Please try again.');
  const result=await response.json();requireValue(result.livemode===undefined||result.livemode===live,503,'stripe_mode_mismatch','Stripe returned an object from the wrong environment.');return result;
 };
}
function priceId(env,plan){return env[`STRIPE_API_PRICE_${plan.toUpperCase()}`];}
function validPrice(price,plan,env){return price&&price.id&&price.livemode===stripeLiveMode(env)&&price.active===true&&price.currency==='usd'&&price.unit_amount===PLANS[plan]?.cents&&price.recurring?.interval==='month'&&price.recurring?.interval_count===1&&!price.recurring?.usage_type?.includes('metered');}
/** @param {any} env @param {any} store @param {Function|null} stripe @param {()=>number} now */
export function createBilling(env,store,stripe=null,now=Date.now){
 // Lazy transport: disabled billing does not even initialize Stripe or contact it.
 const call=stripe||((...args)=>stripeClient(env)(...args));
 function checkoutGates(){
  requireValue(billingEnabled(env),503,'billing_disabled','Checkout is not currently enabled.');
  requireValue(['test','production'].includes(env.API_ENVIRONMENT),503,'billing_disabled','Billing environment is not configured.');
  requireValue(enabled(env.API_LEGAL_APPROVED)&&env.API_AGREEMENT_VERSION,503,'agreement_pending','The API agreement requires legal approval.');
  // Test fixtures can exercise test checkout; production redistribution remains gated separately.
  requireValue((!stripeLiveMode(env)&&enabled(env.API_SYNTHETIC_TEST_MODE))||liveAllowed(env),503,'market_data_disabled','No authorized API capability is available.');
 }
 return{
  async checkout(org,plan){
   checkoutGates();requireValue(PLANS[plan],400,'invalid_plan','Choose a supported plan.');
   const state=await store.billing('read',org);
   requireValue(state.subscription.livemode===stripeLiveMode(env),403,'billing_mode_mismatch','This organization belongs to a different billing environment.');
   requireValue(!state.organization.suspended,403,'suspended','This organization is suspended.');
   requireValue(plan!=='business'||state.organization.business_approved,403,'business_review_required','Business requires manual approval.');
   requireValue(state.agreements.some(a=>a.version===env.API_AGREEMENT_VERSION&&a.document_sha256?.length===64&&a.envelope_id&&a.document_reference&&['docusign','adobe-sign','synthetic-test'].includes(a.provider)&&(!['synthetic-test'].includes(a.provider)||(!stripeLiveMode(env)&&enabled(env.API_SYNTHETIC_TEST_MODE)))),403,'signature_required','Complete the approved electronic signature workflow first.');
   const id=priceId(env,plan);requireValue(/^price_/.test(id||''),503,'price_configuration_required','The API test price is not configured.');
   const price=await call(`prices/${encodeURIComponent(id)}`);requireValue(validPrice(price,plan,env),503,'price_mismatch','The configured price does not match the monthly USD API plan.');
   const lease=await store.billing('checkout.reserve',org,{plan});requireValue(lease.allowed,409,'checkout_exists','A subscription or checkout already exists. Use billing management.');
   if(lease.session_id){const existing=await call(`checkout/sessions/${lease.session_id}`);if(existing.status==='open')return{url:existing.url};throw new ApiError(409,'checkout_pending','Checkout has completed or expired. Await webhook confirmation or support review.');}
   let customer=lease.customer_id;
   if(!customer){const c=await call('customers','POST',{email:state.organization.email,name:state.organization.legal_name,'metadata[namespace]':'b2b_api','metadata[organization_id]':org},`b2b-customer-${org}`);customer=c.id;}
   // Never use metadata.userId: the existing Pro webhook interprets it as a Pro purchase.
   const session=await call('checkout/sessions','POST',{mode:'subscription',customer,'line_items[0][price]':id,'line_items[0][quantity]':'1',success_url:`${env.API_SITE_ORIGIN}/B2B/api/dashboard/?checkout=complete&organization_id=${org}`,cancel_url:`${env.API_SITE_ORIGIN}/B2B/api/dashboard/?checkout=cancelled`,'metadata[namespace]':'b2b_api','metadata[organization_id]':org,'subscription_data[metadata][namespace]':'b2b_api','subscription_data[metadata][organization_id]':org,expires_at:String(lease.expires_at)},`b2b-checkout-${lease.token}`);
   await store.billing('checkout.finish',org,{token:lease.token,customer_id:customer,session_id:session.id});
   return{url:session.url};
  },
  async portal(org){
   requireValue(['test','production'].includes(env.API_ENVIRONMENT),503,'billing_disabled','Billing environment is not configured.');
   const state=await store.billing('read',org);
   requireValue(state.subscription.livemode===stripeLiveMode(env),403,'billing_mode_mismatch','This organization belongs to a different billing environment.');requireValue(state.subscription.stripe_customer_id&&env.STRIPE_API_PORTAL_CONFIGURATION,409,'billing_unavailable','Billing management is not configured for this organization.');
   const session=await call('billing_portal/sessions','POST',{customer:state.subscription.stripe_customer_id,configuration:env.STRIPE_API_PORTAL_CONFIGURATION,return_url:`${env.API_SITE_ORIGIN}/B2B/api/dashboard/`});return{url:session.url};
  },
  async webhook(request){
   requireValue(['test','production'].includes(env.API_ENVIRONMENT)&&env.STRIPE_API_WEBHOOK_SECRET,503,'webhook_disabled','Webhook is not configured.');
   const raw=await readLimited(request,262144),header=request.headers.get('stripe-signature')||'';
   const parts=header.split(',').map(p=>p.split('=')),timestamps=parts.filter(p=>p[0]==='t');
   requireValue(timestamps.length===1&&/^\d+$/.test(timestamps[0][1]),400,'invalid_signature','Invalid webhook signature.');
   const timestamp=Number(timestamps[0][1]);
   requireValue(Math.abs(now()/1000-timestamp)<=300,400,'invalid_signature','Invalid webhook signature.');
   const expected=await hmac(`${timestamp}.${raw}`,env.STRIPE_API_WEBHOOK_SECRET);
   requireValue(parts.some(p=>p[0]==='v1'&&constantEqual(p[1],expected)),400,'invalid_signature','Invalid webhook signature.');
   let event;try{event=JSON.parse(raw);}catch{throw new ApiError(400,'invalid_event','Invalid webhook event.');}
   requireValue(event.livemode===stripeLiveMode(env)&&typeof event.id==='string'&&Number.isInteger(event.created),400,'invalid_event','Webhook environment does not match this service.');
   if(!handled.has(event.type))return{received:true,ignored:true};
   let object=event.data?.object;requireValue(object?.id,400,'invalid_event','Missing webhook object.');
   // Re-fetch related objects. Never use client redirects or event snapshots as entitlement truth.
   if(event.type.startsWith('charge.dispute.'))object=await call(`charges/${typeof object.charge==='string'?object.charge:object.charge?.id}`);
   else if(event.type==='charge.refunded')object=await call(`charges/${object.id}`);
   let subId;
   if(event.type.startsWith('customer.subscription.'))subId=object.id;
   else if(event.type.startsWith('checkout.')){object=await call(`checkout/sessions/${object.id}`);subId=object.subscription;}
   else if(event.type.startsWith('invoice.')){object=await call(`invoices/${object.id}`);subId=object.subscription;}
   else {if(!object.invoice)return{received:true,ignored:true};const invoice=await call(`invoices/${typeof object.invoice==='string'?object.invoice:object.invoice.id}`);subId=invoice.subscription;}
   if(!subId)return{received:true,ignored:true};
   subId=typeof subId==='string'?subId:subId.id;
   // First read only identifies the organization; state used for apply is re-read inside the lease.
   const identified=await call(`subscriptions/${subId}`);const org=identified.metadata?.organization_id;
   if(identified.metadata?.namespace!=='b2b_api'||!validId(org))return{received:true,ignored:true};
   const state=await store.billing('read',org);
   requireValue(state.subscription.livemode===event.livemode,400,'billing_mode_mismatch','Webhook billing environment does not match the organization.');
   const lease=await store.billing('sync.claim',org,{event_id:event.id});
   if(lease.duplicate)return{received:true,duplicate:true};
   requireValue(lease.acquired,503,'sync_busy','Billing synchronization is in progress. Retry this webhook.');
   try{
    const sub=await call(`subscriptions/${subId}?expand[]=latest_invoice`);
    requireValue(sub.metadata?.namespace==='b2b_api'&&sub.metadata?.organization_id===org,400,'subscription_mismatch','Subscription ownership mismatch.');
    const items=sub.items?.data||[];requireValue(items.length===1&&items[0].quantity===1,400,'price_mismatch','Invalid API subscription items.');
    const price=items[0].price,plan=Object.keys(PLANS).find(p=>price.id===priceId(env,p));
    requireValue(plan&&validPrice(price,plan,env),400,'price_mismatch','Unknown API plan price.');
    let invoice=sub.latest_invoice;if(typeof invoice==='string')invoice=await call(`invoices/${invoice}`);
    const start=sub.current_period_start,end=sub.current_period_end;
    requireValue(Number.isFinite(start)&&Number.isFinite(end)&&end>start,400,'invalid_period','Invalid billing period.');
    const paid=invoice?.paid===true&&invoice.status==='paid'&&invoice.subscription===sub.id&&invoice.customer===sub.customer&&invoice.lines?.data?.some(l=>l.period?.start<=start&&l.period?.end>=end&&l.price?.id===price.id);
    const suspended=event.type==='charge.refunded'||event.type.startsWith('charge.dispute.');
    await store.billing('sync.apply',org,{token:lease.token,event_id:event.id,event_created:event.created,snapshot:{livemode:stripeLiveMode(env),stripe_customer_id:sub.customer,stripe_subscription_id:sub.id,plan,status:sub.status==='active'&&paid?'active':sub.status==='active'?'payment_pending':sub.status,period_start:new Date(start*1000).toISOString(),period_end:new Date(end*1000).toISOString(),paid_through:paid?new Date(end*1000).toISOString():null,cancel_at_period_end:sub.cancel_at_period_end===true,suspended}});
    return{received:true};
   }finally{await store.billing('sync.release',org,{token:lease.token});}
  },
 };
}
