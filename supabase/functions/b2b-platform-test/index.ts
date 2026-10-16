// Temporary, explicitly enabled integration harness. Real Supabase identity and
// real Stripe TEST events; only designated disposable users and synthetic data.
import postgres from 'npm:postgres@3.4.5';
import {createApp} from '../../b2b-api/app.mjs';
import {createBilling,stripeClient} from '../../b2b-api/billing.mjs';
import {resolveSupabaseUser} from '../../b2b-api/database.mjs';
import {restrictedDatabaseUrl,sqlStore} from '../../b2b-api/sql-store.mjs';
import {ApiError,constantEqual,enabled} from '../../b2b-api/core.mjs';
import {materialize} from '../../b2b-api/mirror.ts';
import {TERMS_VERSION} from '../../b2b-api/terms.mjs';
import {syntheticSnapshot} from '../../b2b-api/fixtures.ts';
const raw=Deno.env.toObject();
const env:any={SUPABASE_URL:raw.SUPABASE_URL,SUPABASE_DB_URL:raw.SUPABASE_DB_URL,SUPABASE_PUBLISHABLE_KEY:raw.B2B_SUPABASE_PUBLISHABLE_KEY,B2B_DB_BACKEND_PASSWORD:raw.B2B_DB_BACKEND_PASSWORD,B2B_DB_WRITER_PASSWORD:raw.B2B_DB_WRITER_PASSWORD,API_KEY_PEPPER:raw.B2B_API_KEY_PEPPER,...Object.fromEntries(Object.entries(raw).filter(([k])=>k.startsWith('B2B_TEST_')).map(([k,v])=>[k.slice(9),v])),API_ENVIRONMENT:'test',API_SYNTHETIC_TEST_MODE:'true',API_LIVE_MARKET_DATA_ENABLED:'false',API_DATA_LICENSE_APPROVED:'false',API_SITE_ORIGIN:'https://spyconverter.com',API_AGREEMENT_VERSION:TERMS_VERSION,API_LEGAL_APPROVED:'true',API_STRIPE_TEST_ENABLED:'true'};
const options={ssl:{rejectUnauthorized:true},prepare:false,max:1,connect_timeout:10,idle_timeout:5};
let store:any;
const stripe=stripeClient(env);
// Test clocks let integration tests advance renewals without altering real time
// or any live subscription. This adapter cannot use a live Stripe credential.
async function testStripe(path:string,method='GET',data?:Record<string,string>,idem?:string){
 if(path==='customers'&&method==='POST'){
  const clock=await stripe('test_helpers/test_clocks','POST',{frozen_time:String(Math.floor(Date.now()/1000)),name:'B2B disposable integration'},`${idem}-clock`);
  return stripe(path,method,{...data,test_clock:clock.id},idem);
 }
 return stripe(path,method,data,idem);
}
Deno.serve(async request=>{
 const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!enabled(raw.B2B_TEST_ENABLED))return reply({error:{code:'test_disabled'}},503);
 try{
  const url=new URL(request.url);url.protocol='https:';url.host=new URL(env.SUPABASE_URL).host;
  url.pathname=url.pathname.replace(/^\/(?:functions\/v1\/)?b2b-platform-test(?=\/|$)/,'');
  if(url.pathname!=='/webhooks/stripe'&&(!raw.B2B_GATEWAY_SECRET||!constantEqual(request.headers.get('X-B2B-Gateway')||'',raw.B2B_GATEWAY_SECRET)))return reply({error:{code:'origin_denied'}},403);
  if(url.pathname==='/internal/synthetic-snapshot'&&request.method==='POST'){
   const writer=postgres(restrictedDatabaseUrl(env,'writer'),options);
   try{const now=Date.now();const rows=await materialize(syntheticSnapshot(now),now,'synthetic');await writer`select public.b2b_api_cache_publish('test',${writer.json(rows)}::jsonb)`;return reply({published:true,provenance:'synthetic',yahoo_requests:0});}
   finally{await writer.end({timeout:2});}
  }
  if(!store)store=sqlStore(postgres(restrictedDatabaseUrl(env),options));
  return await createApp({env,store,billing:createBilling(env,store,testStripe),resolveUser:async(r:Request)=>{const u=await resolveSupabaseUser(r,env);if(!(raw.B2B_TEST_USER_IDS||'').split(',').includes(u.id))throw new ApiError(403,'test_user_required','This integration environment is restricted.');return u;}})(new Request(url,request));
 }catch{return reply({error:{code:'integration_unavailable'}},503);}
});
