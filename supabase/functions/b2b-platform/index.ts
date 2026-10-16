import postgres from 'npm:postgres@3.4.5';
import {createApp} from '../../b2b-api/app.mjs';
import {createBilling} from '../../b2b-api/billing.mjs';
import {resolveSupabaseUser} from '../../b2b-api/database.mjs';
import {restrictedDatabaseUrl,sqlStore} from '../../b2b-api/sql-store.mjs';
import {constantEqual} from '../../b2b-api/core.mjs';

const raw=Deno.env.toObject();
// Existing Pro Stripe secrets/configuration are never read by the B2B adapter.
const env:any={SUPABASE_URL:raw.SUPABASE_URL,SUPABASE_DB_URL:raw.SUPABASE_DB_URL,...Object.fromEntries(Object.entries(raw).filter(([key])=>key.startsWith('B2B_')).map(([key,value])=>[key.slice(4),value])),B2B_DB_BACKEND_PASSWORD:raw.B2B_DB_BACKEND_PASSWORD,B2B_GATEWAY_SECRET:raw.B2B_GATEWAY_SECRET};
// Only the new restricted login is passed to the database driver.
let store:any;
Deno.serve(async request=>{
 try{
  const url=new URL(request.url);
  // Supabase terminates external TLS before forwarding to its internal runtime.
  // Reconstruct the public HTTPS URL from fixed deployment configuration, never
  // from a client-supplied forwarding header.
  url.protocol='https:';
  url.host=new URL(env.SUPABASE_URL).host;
  url.pathname=url.pathname.replace(/^\/b2b-platform(?=\/|$)/,'').replace(/^\/functions\/v1\/b2b-platform(?=\/|$)/,'');
  // Direct machine-origin calls cannot bypass the Cloudflare gateway. Account
  // operations still require genuine Supabase user verification in createApp.
  if(url.pathname.startsWith('/v1/')&&(!env.B2B_GATEWAY_SECRET||!constantEqual(request.headers.get('X-B2B-Gateway')||'',env.B2B_GATEWAY_SECRET)))return Response.json({error:{code:'origin_denied',message:'Use the authorized API hostname.'}},{status:403,headers:{'Cache-Control':'no-store'}});
  if(!store){const sql=postgres(restrictedDatabaseUrl(env),{ssl:{rejectUnauthorized:true},prepare:false,max:2,idle_timeout:20,connect_timeout:10});store=sqlStore(sql);}
  return await createApp({env,store,resolveUser:(r:Request)=>resolveSupabaseUser(r,env),billing:createBilling(env,store)})(new Request(url,request));
 }catch{return Response.json({error:{code:'temporarily_unavailable',message:'The API service is temporarily unavailable.'}},{status:503,headers:{'Cache-Control':'no-store'}});}
});
