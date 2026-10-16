import {ApiError,requireValue} from './core.mjs';
import {createStore} from './database.mjs';

// A dedicated login with only b2b_backend membership. No service-role key or
// privileged postgres connection is used to execute application queries.
export function restrictedDatabaseUrl(env,role='backend'){
 const names={backend:'b2b_backend_login',source:'b2b_source_login',writer:'b2b_writer_login'};
 requireValue(names[role]&&env[`B2B_DB_${role.toUpperCase()}_PASSWORD`],503,'configuration_required','Restricted B2B storage credentials are missing.');
 const base=new URL(env.DB_POOLER_URL||env.SUPABASE_DB_URL);
 requireValue(base.protocol==='postgresql:'||base.protocol==='postgres:',503,'configuration_required','Database transport is not configured.');
 const suffix=env.DB_POOLER_URL?new URL(env.SUPABASE_URL).hostname.split('.')[0]:null;
 requireValue(!suffix||(base.hostname.endsWith('.pooler.supabase.com')&&base.port==='6543'),503,'configuration_required','B2B requires the verified transaction pooler.');
 base.username=names[role]+(suffix?`.${suffix}`:'');base.password=env[`B2B_DB_${role.toUpperCase()}_PASSWORD`];
 return base.href;
}
const operations={
 b2b_api_account:['p_action','p_actor','p_org','p_data'],
 b2b_api_key:['p_hash'],b2b_api_meter:['p_hash','p_request_id','p_fingerprint','p_billable'],
 b2b_api_response:['p_hash','p_request_id','p_status'],b2b_api_cache_read:['p_mode','p_selection'],
 b2b_api_billing:['p_action','p_org','p_data'],
 b2b_api_terms:['p_action','p_actor','p_org','p_data'],
 b2b_api_signing:['p_action','p_actor','p_org','p_data'],
};
export function sqlStore(sql){
 return createStore(async(name,args)=>{
  const fields=operations[name];requireValue(fields&&Object.keys(args).every(k=>fields.includes(k)),400,'invalid_rpc','Invalid storage operation.');
  let connection;
  try{
   // One outstanding query per physical connection: postgres.js pipelining is
   // not safe with the shared transaction pooler. Each RPC remains one atomic
   // server-side transaction, and reserve() queues callers within this isolate.
   connection=await sql.reserve();
   // postgres.js applies its JSONB serializer after PostgreSQL describes the
   // argument types. Pre-stringifying objects would encode them twice.
   const params=fields.map(k=>args[k]);
   const rows=await connection.unsafe(`select public.${name}(${fields.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as result`,params);
   return rows[0].result;
  }catch(e){throw new ApiError(e.code==='42501'?403:503,e.code==='42501'?'forbidden':'backend_unavailable',e.code==='42501'?'Access is not allowed.':'B2B storage is temporarily unavailable.');}
  finally{connection?.release();}
 });
}
