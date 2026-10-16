import {ApiError,requireValue} from './core.mjs';
export function createStore(rpc){return{
 account:(action,actor,org=null,data={})=>rpc('b2b_api_account',{p_action:action,p_actor:actor,p_org:org,p_data:data}),
 key:hash=>rpc('b2b_api_key',{p_hash:hash}),
 meter:(hash,id,fingerprint,billable)=>rpc('b2b_api_meter',{p_hash:hash,p_request_id:id,p_fingerprint:fingerprint,p_billable:billable}),
 response:(hash,id,status)=>rpc('b2b_api_response',{p_hash:hash,p_request_id:id,p_status:status}),
 snapshot:(mode,selection)=>rpc('b2b_api_cache_read',{p_mode:mode,p_selection:selection}),
 publish:rows=>rpc('b2b_api_cache_publish',{p_mode:rows[0].mode,p_rows:rows}),
 billing:(action,org,data={})=>rpc('b2b_api_billing',{p_action:action,p_org:org,p_data:data}),
 signing:(action,actor,org,data={})=>rpc('b2b_api_signing',{p_action:action,p_actor:actor,p_org:org,p_data:data}),
};}
export function remoteStore(env,fetcher=fetch){
 requireValue(/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL||'')&&env.B2B_BACKEND_TOKEN,503,'configuration_required','B2B database is not configured.');
 // A custom restricted B2B database role, NEVER the existing service-role credential.
 return createStore(async(name,args)=>{
  requireValue(name.startsWith('b2b_api_'),500,'invalid_rpc','Invalid backend operation.');
  let response;try{response=await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${env.B2B_BACKEND_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});}catch{throw new ApiError(503,'backend_unavailable','B2B storage is temporarily unavailable.');}
  if(!response.ok){const e=await response.json().catch(()=>({}));throw new ApiError(e.code==='42501'?403:503,e.code==='42501'?'forbidden':'backend_unavailable',e.code==='42501'?'Access is not allowed.':'B2B storage is temporarily unavailable.');}
  const text=await response.text();return text?JSON.parse(text):null;
 });
}
export async function resolveSupabaseUser(request,env,fetcher=fetch){
 const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
 requireValue(token&&token.length<8192,401,'sign_in_required','Sign in to continue.');
 requireValue(/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL||'')&&env.SUPABASE_PUBLISHABLE_KEY,503,'configuration_required','Authentication is not configured.');
 let response;try{response=await fetcher(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000)});}catch{throw new ApiError(503,'auth_unavailable','Authentication is temporarily unavailable.');}
 requireValue(response.ok,401,'invalid_session','Your session is invalid or expired.');
 const user=await response.json();requireValue(user.id&&!user.is_anonymous,401,'invalid_session','A verified account is required.');return user;
}
