// Local-only review server. Binds loopback; Deno is run with internet access denied
// except its loopback listener. No environment credentials or .env files are loaded.
import {createRequire} from 'node:module';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStore} from '../../supabase/b2b-api/database.mjs';
import {createApp} from '../../supabase/b2b-api/app.mjs';
import {createBilling} from '../../supabase/b2b-api/billing.mjs';
import {ApiError,readJson,sha256,hex,constantEqual,requireValue} from '../../supabase/b2b-api/core.mjs';
import {materialize} from '../../supabase/b2b-api/mirror.ts';
import {syntheticSnapshot} from '../../supabase/b2b-api/fixtures.ts';
import {createMockStripe} from './mock-stripe.mjs';
const require=createRequire(import.meta.url),{createLocalDatabase}=require('./local-database.cjs');
const root=fileURLToPath(new URL('../..',import.meta.url)),origin='http://127.0.0.1:8799';
const db=await createLocalDatabase('preview');
const store=createStore(async(n:string,a:any)=>{try{return await db.rpc(n,a);}catch(e){if(e.code==='42501')throw new ApiError(403,'forbidden','Access is not allowed for this account.');throw new ApiError(400,'operation_rejected','The operation could not be completed. Check your account state and input.');}});
const env={API_LOCAL_ONLY:'true',API_ENVIRONMENT:'test',API_SITE_ORIGIN:origin,API_AUTH_MODE:'local',API_SYNTHETIC_TEST_MODE:'true',API_LIVE_MARKET_DATA_ENABLED:'false',API_DATA_LICENSE_APPROVED:'false',API_KEY_PEPPER:hex(crypto.getRandomValues(new Uint8Array(32))),API_STRIPE_TEST_ENABLED:'true',API_LEGAL_APPROVED:'true',API_AGREEMENT_VERSION:'synthetic-review-only',STRIPE_API_WEBHOOK_SECRET:hex(crypto.getRandomValues(new Uint8Array(32))),STRIPE_API_PRICE_DEVELOPER:'price_test_developer',STRIPE_API_PRICE_PRO:'price_test_pro',STRIPE_API_PRICE_BUSINESS:'price_test_business',STRIPE_API_PORTAL_CONFIGURATION:'bpc_synthetic'};
const mock=createMockStripe(origin),billing=createBilling(env,store,mock.transport),users=new Map(),sessions=new Map();
async function passwordHash(password:string,salt:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:210000},key,256));}
async function addUser(email:string,password:string){const salt=hex(crypto.getRandomValues(new Uint8Array(16)));const user={id:crypto.randomUUID(),email,salt,hash:await passwordHash(password,salt)};users.set(email,user);await db.pool.query('insert into auth.users(id) values($1)',[user.id]);return user;}
const demo=await addUser('developer@example.test','local-demo-only');
const demoOrg=await store.account('create',demo.id,null,{name:'Example Trading',legal_name:'Example Trading — synthetic account',email:demo.email,intended_use:'Internal research application using synthetic data only',plan:'developer'});
await db.pool.query("update b2b_private.subscriptions set status='active',period_start=now()-interval '8 days',period_end=now()+interval '22 days',paid_through=now()+interval '22 days' where organization_id=$1",[demoOrg.id]);
// Demonstration usage history is explicitly labeled synthetic on every screen.
await db.pool.query("insert into b2b_private.usage_counters select organization_id,period_start,period_end,1248 from b2b_private.subscriptions where organization_id=$1",[demoOrg.id]);
let revision=0;await store.publish(await materialize(syntheticSnapshot(Date.now(),revision++),Date.now(),'synthetic'));
const timer=setInterval(async()=>{try{const now=Date.now();await store.publish(await materialize(syntheticSnapshot(now,revision++),now,'synthetic'));}catch{/* serving rejects expired source */}},60000);
function userFor(request:Request){const token=request.headers.get('authorization')?.replace(/^Bearer /,'');const session=sessions.get(token);requireValue(session&&session.expires>Date.now(),401,'sign_in_required','Sign in to the local demonstration.');return session.user;}
const app=createApp({env,store,resolveUser:async r=>userFor(r),billing});
const json=(v:any,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const shell=(title:string,text:string,action:string,fields:string)=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/B2B/api/assets/api.css"><body class="b2b"><main><p class="eyebrow">SPYCONVERTER • LOCAL SIMULATOR</p><h1>${title}</h1><div class="notice">Synthetic fixture only. No Stripe request, payment, invoice or legal signature will be created.</div><p>${text}</p><form method="post" action="${action}">${fields}<button class="button" type="submit">Confirm synthetic event</button></form><p><a href="/B2B/api/dashboard/">Return to dashboard</a></p></main></body></html>`,{headers:{'Content-Type':'text/html','Cache-Control':'no-store'}});
const server=Deno.serve({hostname:'127.0.0.1',port:8799,onListen:()=>console.log(`Local B2B review: ${origin}/B2B/api/ (synthetic data; no external requests)` )},async req=>{
 const url=new URL(req.url);
 try{
  requireValue(url.origin===origin,403,'host_denied','Loopback host required.');
  if(req.method==='POST')requireValue(!req.headers.get('origin')||req.headers.get('origin')===origin,403,'origin_denied','Local origin required.');
  if(url.pathname==='/local/auth'&&req.method==='POST'){
   const d=await readJson(req);requireValue(typeof d.email==='string'&&d.email.endsWith('@example.test')&&typeof d.password==='string'&&d.password.length>=10&&d.password.length<=128,400,'invalid_credentials','Use an @example.test address and at least 10 characters.');
   let user=users.get(d.email);if(d.action==='register'){requireValue(!user,409,'account_exists','This synthetic account already exists.');user=await addUser(d.email,d.password);}
   requireValue(user&&constantEqual(user.hash,await passwordHash(d.password,user.salt)),401,'invalid_credentials','Incorrect synthetic account credentials.');
   const token=hex(crypto.getRandomValues(new Uint8Array(32)));sessions.set(token,{user:{id:user.id,email:user.email},expires:Date.now()+3600000});return json({token,user:{id:user.id,email:user.email}});
  }
  if(url.pathname==='/local/logout'&&req.method==='POST'){sessions.delete(req.headers.get('authorization')?.replace(/^Bearer /,''));return json({ok:true});}
  if(['/local/agreement','/local/business-approval'].includes(url.pathname)&&req.method==='POST'){
   const user=userFor(req),d=await readJson(req);const state=await store.account('dashboard',user.id,d.organization_id);requireValue(state.role==='owner',403,'owner_required','Owner required.');
   if(url.pathname==='/local/agreement')await db.pool.query("insert into b2b_private.agreements(organization_id,version,signer_id,signer_email,signed_at,provider,envelope_id,document_sha256,document_reference) values($1,$2,$3,$4,now(),'synthetic-test',$5,$6,'local-fixture:synthetic-only') on conflict(organization_id,version) do nothing",[d.organization_id,env.API_AGREEMENT_VERSION,user.id,user.email,`synthetic-${crypto.randomUUID()}`,await sha256('SYNTHETIC DOCUMENT — NO LEGAL EFFECT')]);
   else{await db.pool.query('update b2b_private.organizations set business_approved=true where id=$1',[d.organization_id]);await db.pool.query("update b2b_private.applications set status='approved',reviewed_at=now(),reviewer='local-simulator' where organization_id=$1 and plan='business'",[d.organization_id]);}
   return json({ok:true,synthetic:true});
  }
  if(url.pathname==='/local/checkout'){
   const id=url.searchParams.get('session_id');requireValue(mock.sessions.has(id),404,'session_missing','Synthetic checkout is unavailable.');
   if(req.method==='GET')return shell('Test checkout','Complete a simulated subscription to exercise the signature-verified webhook and activate synthetic API access. No card details are needed.',`/local/checkout?session_id=${id}`,'');
   const sub=mock.complete(id);const event=mock.event('checkout.session.completed',mock.sessions.get(id));const response=await app(await mock.webhook(event,env.STRIPE_API_WEBHOOK_SECRET));requireValue(response.ok,503,'webhook_failed','Synthetic billing synchronization failed.');return Response.redirect(`${origin}/B2B/api/dashboard/?checkout=complete`,303);
  }
  if(url.pathname==='/local/portal'){
   const customer=url.searchParams.get('customer'),sub=[...mock.subscriptions.values()].find(s=>s.customer===customer);requireValue(sub,404,'subscription_missing','Create a synthetic checkout first to preview billing management.');
   if(req.method==='GET')return shell('Test billing portal','Simulate cancellation at the end of the current paid period. This screen is a local fixture, not the Stripe Customer Portal.',`/local/portal?customer=${customer}`,'');
   sub.cancel_at_period_end=true;const event=mock.event('customer.subscription.updated',sub);await app(await mock.webhook(event,env.STRIPE_API_WEBHOOK_SECRET));return Response.redirect(`${origin}/B2B/api/dashboard/`,303);
  }
  if(url.pathname.startsWith('/platform/')||url.pathname.startsWith('/v1/')||url.pathname==='/webhooks/stripe')return await app(req);
  if(url.pathname==='/')return Response.redirect(`${origin}/B2B/api/`,302);
  requireValue(req.method==='GET',405,'method_not_allowed','Use GET.');
  let pathname=decodeURIComponent(url.pathname);
  requireValue(!pathname.includes('..')&&!pathname.includes('\\')&&(pathname.startsWith('/B2B/api/')||pathname==='/B2B/api'||['/styles.css','/Images/spyconverter-logo.png','/Images/favicon.ico'].includes(pathname)),404,'not_found','This local preview serves only the new B2B pages.');
  if(!extname(pathname)){if(!pathname.endsWith('/'))return Response.redirect(origin+pathname+'/',301);pathname+='index.html';}
  const file=await Deno.readFile(root+pathname);const type=({'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.ico':'image/x-icon'} as any)[extname(pathname)]||'application/octet-stream';
  return new Response(file,{headers:{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
 }catch(e){return json({error:{code:e.code||'local_error',message:e instanceof ApiError?e.message:'The local preview could not complete this request.'}},e.status||500);}
});
async function stop(){clearInterval(timer);await server.shutdown();await db.close();Deno.exit(0);}
Deno.addSignalListener('SIGINT',stop);Deno.addSignalListener('SIGTERM',stop);
await server.finished;
