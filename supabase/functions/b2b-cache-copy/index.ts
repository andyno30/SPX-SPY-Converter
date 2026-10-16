import postgres from 'npm:postgres@3.4.5';
import {restrictedDatabaseUrl} from '../../b2b-api/sql-store.mjs';
import {constantEqual,enabled,liveAllowed} from '../../b2b-api/core.mjs';
import {synchronize} from '../../b2b-api/mirror.ts';

// Only existing cached database records are read. This function has no market
// provider, refresh endpoint, or HTTP fetch capability in its application path.
const raw=Deno.env.toObject();
const env:any={SUPABASE_URL:raw.SUPABASE_URL,SUPABASE_DB_URL:raw.SUPABASE_DB_URL,...Object.fromEntries(Object.entries(raw).filter(([k])=>k.startsWith('B2B_')).map(([k,v])=>[k.slice(4),v])),B2B_DB_SOURCE_PASSWORD:raw.B2B_DB_SOURCE_PASSWORD,B2B_DB_WRITER_PASSWORD:raw.B2B_DB_WRITER_PASSWORD};
Deno.serve(async request=>{
 const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return reply({error:{code:'method_not_allowed'}},405);
 if(!env.CACHE_COPY_SECRET||!constantEqual(request.headers.get('Authorization')||'',`Bearer ${env.CACHE_COPY_SECRET}`))return reply({error:{code:'unauthorized'}},401);
 if(!enabled(env.API_CACHE_COPY_ENABLED))return reply({copied:false,reason:'copy_disabled'});
 // Start after the unchanged minute-boundary updater. Delay only this private
 // copy; hold no DB connection and never request/trigger a source refresh.
 await new Promise(resolve=>setTimeout(resolve,10000));
 const options={ssl:{rejectUnauthorized:true},prepare:false,max:1,connect_timeout:10,idle_timeout:5};
 const source=postgres(restrictedDatabaseUrl(env,'source'),options),writer=postgres(restrictedDatabaseUrl(env,'writer'),options);
 try{
  const authorized=liveAllowed(env);
  const digest=await synchronize(async()=>{const rows=await source`select public.b2b_api_source_snapshot() as snapshot`;return rows[0].snapshot;},async rows=>{await writer`select public.b2b_api_cache_publish('live',${writer.json(rows)}::jsonb)`;},Date.now(),authorized?'licensed':'pending_review',authorized?env.API_DATA_LICENSE_REFERENCE:null);
  await writer`select public.b2b_api_cache_copy_result(true,${digest},null)`;
  return reply({copied:true,digest,customer_delivery:authorized});
 }catch(e){const code=e&&typeof e==='object'&&'code' in e?String(e.code):'copy_failed';try{await writer`select public.b2b_api_cache_copy_result(false,null,${['stale_cache','cache_unavailable'].includes(code)?code:'copy_failed'})`;}catch{/* Monitoring never triggers a source refresh. */}return reply({error:{code:'cache_copy_unavailable'}},503);}
 finally{await Promise.all([source.end({timeout:2}),writer.end({timeout:2})]);}
});
