import {createApp} from './app.mjs';
import {remoteStore,resolveSupabaseUser} from './database.mjs';
import {createBilling} from './billing.mjs';
import {enabled,liveAllowed,deliveryAuthorization,requireValue} from './core.mjs';
import {synchronize} from './mirror.ts';

// Alternative all-in-Worker adapter for isolated evaluation. The actual deployed
// topology uses gateway-worker.mjs plus the Supabase B2B Edge adapter.
export default {
 async fetch(request:Request,env:any){
  try{
   const store=remoteStore(env);
   return await createApp({env,store,resolveUser:(r:Request)=>resolveSupabaseUser(r,env),billing:createBilling(env,store)})(request);
  }catch{return Response.json({error:{code:'configuration_required',message:'The B2B service is not configured.'}},{status:503,headers:{'Cache-Control':'no-store'}});}
 },
 async scheduled(_controller:any,env:any){
  // Default false; no timer is configured. Never called from fetch().
  if(!enabled(env.API_CACHE_COPY_ENABLED)||!liveAllowed(env))return;
  requireValue(env.B2B_SOURCE_READ_TOKEN&&env.B2B_CACHE_WRITER_TOKEN,503,'configuration_required','Restricted source/copy credentials are required.');
  const readSource=async()=>{
   // This one fixed RPC only SELECTs the existing database snapshot.
   requireValue(/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL||''),503,'configuration_required','Invalid source origin.');
   const res=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/b2b_api_source_snapshot`,{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${env.B2B_SOURCE_READ_TOKEN}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(8000)});
   requireValue(res.ok,503,'cache_copy_failed','Source cache read failed.');return res.json();
  };
  const writer=remoteStore({...env,B2B_BACKEND_TOKEN:env.B2B_CACHE_WRITER_TOKEN});
  const authorization=deliveryAuthorization(env)!;
  await synchronize(readSource,writer.publish,Date.now(),authorization.provenance,authorization.reference);
 },
};
