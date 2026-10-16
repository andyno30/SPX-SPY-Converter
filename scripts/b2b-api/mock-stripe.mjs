// In-memory Stripe simulator. Never makes network requests. Not imported by the Worker.
import {PLANS,ApiError,hmac} from '../../supabase/b2b-api/core.mjs';
export function createMockStripe(origin,now=Date.now){
 const customers=new Map(),sessions=new Map(),subscriptions=new Map(),invoices=new Map(),charges=new Map(),idempotency=new Map();
 const prices=Object.fromEntries(Object.entries(PLANS).map(([p,v])=>[`price_test_${p}`,{id:`price_test_${p}`,livemode:false,active:true,currency:'usd',unit_amount:v.cents,recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}]));
 const transport=async(path,method='GET',data={},idem)=>{
  const key=idem?`${path}:${idem}`:null;if(key&&idempotency.has(key)){const prior=idempotency.get(key);if(prior.parameters!==JSON.stringify(data))throw new ApiError(409,'idempotency_mismatch','Repeated Stripe requests must have identical parameters.');return structuredClone(prior.response);}
  let out;const route=path.split('?')[0];
  if(route.startsWith('prices/'))out=prices[route.slice(7)];
  else if(route==='customers'&&method==='POST'){out={id:`cus_test_${crypto.randomUUID()}`,livemode:false,...data};customers.set(out.id,out);}
  else if(route==='checkout/sessions'&&method==='POST'){out={id:`cs_test_${crypto.randomUUID()}`,livemode:false,status:'open',customer:data.customer,subscription:null,metadata:{namespace:data['metadata[namespace]'],organization_id:data['metadata[organization_id]']},price:prices[data['line_items[0][price]']]};out.url=`${origin}/local/checkout?session_id=${out.id}`;sessions.set(out.id,out);}
  else if(route.startsWith('checkout/sessions/'))out=sessions.get(route.slice(18));
  else if(route.startsWith('subscriptions/'))out=subscriptions.get(route.slice(14));
  else if(route.startsWith('invoices/'))out=invoices.get(route.slice(9));
  else if(route.startsWith('charges/'))out=charges.get(route.slice(8));
  else if(route==='billing_portal/sessions'){out={livemode:false,url:`${origin}/local/portal?customer=${encodeURIComponent(data.customer)}`};}
  if(!out)throw new ApiError(502,'synthetic_object_missing','Synthetic Stripe object is unavailable.');
  if(key)idempotency.set(key,{parameters:JSON.stringify(data),response:structuredClone(out)});return structuredClone(out);
 };
 const complete=sessionId=>{
  const session=sessions.get(sessionId);if(!session)throw new Error('Session missing');
  if(session.status==='complete')return subscriptions.get(session.subscription);
  const start=Math.floor(now()/1000),end=start+30*86400;
  const sub={id:`sub_test_${crypto.randomUUID()}`,livemode:false,customer:session.customer,status:'active',metadata:session.metadata,items:{data:[{price:session.price,quantity:1}]},current_period_start:start,current_period_end:end,cancel_at_period_end:false};
  const invoice={id:`in_test_${crypto.randomUUID()}`,livemode:false,subscription:sub.id,customer:sub.customer,paid:true,status:'paid',lines:{data:[{price:session.price,period:{start,end}}]}};
  invoices.set(invoice.id,invoice);sub.latest_invoice=invoice;subscriptions.set(sub.id,sub);session.status='complete';session.subscription=sub.id;return sub;
 };
 async function webhook(event,secret){const body=JSON.stringify(event),timestamp=Math.floor(now()/1000);return new Request(`${origin}/webhooks/stripe`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${timestamp},v1=${await hmac(`${timestamp}.${body}`,secret)}`},body});}
 const event=(type,object)=>({id:`evt_test_${crypto.randomUUID()}`,created:Math.floor(now()/1000),livemode:false,type,data:{object}});
 return{transport,complete,webhook,event,customers,sessions,subscriptions,invoices,charges,prices};
}
