import {ApiError,PLANS,enabled,liveAllowed,requireValue,textField,validId,keyHash,generateKey,readJson,assertFresh,FAMILIES} from './core.mjs';
import {parseContract} from '../functions/get-live-price-pro/pricing.ts';
import {billingEnabled} from './billing.mjs';
import {createSigning,signingEnabled} from './signing.mjs';

const security={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{...security,'Content-Type':'application/json',...headers}});
function publicConfig(env){return{environment:env.API_ENVIRONMENT||'unconfigured',synthetic:enabled(env.API_SYNTHETIC_TEST_MODE),live_market_data_enabled:liveAllowed(env),billing_enabled:billingEnabled(env),agreement_signing_enabled:signingEnabled(env),agreement_version:env.API_AGREEMENT_VERSION||null,auth_mode:env.API_AUTH_MODE||'supabase',supabase_url:env.SUPABASE_URL||'',supabase_publishable_key:env.SUPABASE_PUBLISHABLE_KEY||'',plans:PLANS};}

export function createApp({env,store,resolveUser,billing,signing=createSigning(env,store),now=Date.now}){
 return async(request)=>{
  const requestId=crypto.randomUUID();let hash=null;let metered=false;let result;
  const url=new URL(request.url),origin=request.headers.get('origin');
  const cors=origin===env.API_SITE_ORIGIN?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Expose-Headers':'Retry-After, X-Request-Id, X-Source-Fetched-At, X-Snapshot-Id, X-Data-Mode, X-Cache-Age-Seconds, X-RateLimit-Limit, X-Monthly-Remaining'}:{};
  try{
   requireValue(url.protocol==='https:'||(enabled(env.API_LOCAL_ONLY)&&['localhost','127.0.0.1'].includes(url.hostname)),400,'https_required','HTTPS is required.');
   if(request.method==='OPTIONS'){
    requireValue(origin===env.API_SITE_ORIGIN,403,'origin_denied','Origin is not allowed.');
    return new Response(null,{status:204,headers:{...security,...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
   }
   if(url.pathname==='/platform/config'&&request.method==='GET')return json(publicConfig(env),200,cors);
   if(url.pathname==='/webhooks/stripe'&&request.method==='POST')return json(await billing.webhook(request));
   if(url.pathname.startsWith('/platform/')){
    requireValue(['GET','POST'].includes(request.method),405,'method_not_allowed','Method not allowed.');
    if(request.method==='POST')requireValue(!origin||origin===env.API_SITE_ORIGIN,403,'origin_denied','Origin is not allowed.');
    const user=await resolveUser(request);requireValue(validId(user?.id),401,'invalid_session','Sign in to continue.');
    if(url.pathname==='/platform/organizations'&&request.method==='GET')return json({organizations:await store.account('list',user.id)},200,cors);
    if(url.pathname==='/platform/organizations'&&request.method==='POST'){
     const d=await readJson(request);const data={name:textField(d.name,'organization name',120),legal_name:textField(d.legal_name,'legal name',200),email:textField(d.email,'business email',254),intended_use:textField(d.intended_use,'intended use',2000),plan:d.plan,livemode:env.API_ENVIRONMENT==='production'};
     requireValue(PLANS[data.plan]&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email),400,'invalid_input','Choose a plan and provide a valid business email.');
     return json({organization:await store.account('create',user.id,null,data)},201,cors);
    }
    const d=request.method==='POST'?await readJson(request):Object.fromEntries(url.searchParams);
    requireValue(validId(d.organization_id),400,'organization_required','Select an organization.');
    const org=d.organization_id;
    if(url.pathname==='/platform/dashboard'&&request.method==='GET')return json({...await store.account('dashboard',user.id,org),organizations:await store.account('list',user.id)},200,cors);
    requireValue(request.method==='POST',405,'method_not_allowed','Use POST for this operation.');
    // Defense in depth: both this gateway and the DB enforce organization ownership.
    const state=await store.account('dashboard',user.id,org);
    requireValue(state.role==='owner',403,'owner_required','Only organization owners can make this change.');
    if(url.pathname==='/platform/keys/provision'){
     const mode=env.API_ENVIRONMENT==='test'?'test':'live';
     if(!enabled(env.API_LEGAL_APPROVED)||!env.API_AGREEMENT_VERSION||(mode==='live'?!liveAllowed(env):!enabled(env.API_SYNTHETIC_TEST_MODE)))return json({created:false},200,cors);
     const key=await generateKey(mode,env.API_KEY_PEPPER);
     const result=await store.account('key.provision',user.id,org,{key_hash:key.hash,prefix:key.prefix,mode,agreement_version:env.API_AGREEMENT_VERSION});
     return json(result.created?{...result,key:key.key}:result,result.created?201:200,cors);
    }
    if(url.pathname==='/platform/keys'){
     const label=textField(d.label,'key label',80);requireValue(['test','live'].includes(d.mode),400,'invalid_key_mode','Choose test or live.');
     if(d.mode==='live')requireValue(liveAllowed(env),503,'market_data_disabled','Live API keys are unavailable pending licensing approval.');
     if(d.rotate_key_id)requireValue(validId(d.rotate_key_id),400,'invalid_key','Choose a valid key to rotate.');
     const key=await generateKey(d.mode,env.API_KEY_PEPPER);
     const record=await store.account('key.create',user.id,org,{key_hash:key.hash,prefix:key.prefix,label,mode:d.mode,rotate_key_id:d.rotate_key_id||null});
     return json({key:key.key,record},201,cors);
    }
    if(url.pathname==='/platform/keys/revoke'){requireValue(validId(d.key_id),400,'invalid_key','Choose a valid key.');return json(await store.account('key.revoke',user.id,org,{key_id:d.key_id}),200,cors);}
    if(url.pathname==='/platform/members'){
     requireValue(validId(d.user_id)&&['add','remove'].includes(d.action)&&['owner','member'].includes(d.role||'member'),400,'invalid_member','Provide an existing user ID and role.');
     return json(await store.account(`member.${d.action}`,user.id,org,{user_id:d.user_id,role:d.role||'member'}),200,cors);
    }
    if(url.pathname==='/platform/applications'){requireValue(PLANS[d.plan],400,'invalid_plan','Choose a valid plan.');return json(await store.account('application',user.id,org,{plan:d.plan,intended_use:textField(d.intended_use,'intended use',2000)}),201,cors);}
    if(url.pathname==='/platform/checkout')return json(await billing.checkout(org,d.plan),200,cors);
    if(url.pathname==='/platform/portal')return json(await billing.portal(org),200,cors);
    if(url.pathname==='/platform/agreement')return json(await signing(user,org,d),200,cors);
    throw new ApiError(404,'not_found','Endpoint not found.');
   }
   requireValue(['/v1/conversions','/v1/convert','/v1/status','/v1/usage'].includes(url.pathname),404,'not_found','Endpoint not found.');
   requireValue(request.method==='GET',405,'method_not_allowed','Use GET for this endpoint.');
   const token=request.headers.get('authorization')?.match(/^Bearer (sc_(?:test|live)_[a-f0-9]{64})$/)?.[1];
   requireValue(token,401,'invalid_key','Provide a valid API key in the Authorization header.');
   hash=await keyHash(token,env.API_KEY_PEPPER);const key=await store.key(hash);
   requireValue(key&&!key.revoked_at&&token.startsWith(`sc_${key.mode}_`),401,'invalid_key','The API key is invalid or revoked.');
   let prepared,requestError=null,snapshot=null;
   try{
    if(key.mode==='live')requireValue(liveAllowed(env),503,'market_data_disabled','Market-derived access is disabled pending licensing approval.');
    if(key.mode==='test')requireValue(enabled(env.API_SYNTHETIC_TEST_MODE),503,'test_data_disabled','Synthetic API access is not enabled.');
    if(url.pathname==='/v1/conversions'||url.pathname==='/v1/convert'){
     const selection=parseContract(request.url);requireValue(selection,400,'invalid_contract','Invalid ES contract.');
     requireValue([...url.searchParams.keys()].every(k=>(url.pathname==='/v1/convert'?['from','to','amount','esContract']:['esContract']).includes(k)),400,'invalid_parameter','Unsupported query parameter.');
     snapshot=await store.snapshot(key.mode,selection);assertFresh(snapshot,now());
     requireValue(snapshot.mode===key.mode&&((key.mode==='test'&&snapshot.provenance==='synthetic')||(key.mode==='live'&&snapshot.provenance==='licensed'&&snapshot.license_reference===env.API_DATA_LICENSE_REFERENCE)),503,'unauthorized_source','The cached source is not authorized.');
     prepared=snapshot.body;
     if(url.pathname==='/v1/convert'){
      const from=url.searchParams.get('from'),to=url.searchParams.get('to'),raw=url.searchParams.get('amount');
      requireValue(['from','to','amount'].every(p=>url.searchParams.getAll(p).length===1)&&FAMILIES.some(g=>g.includes(from)&&g.includes(to)&&from!==to),400,'unsupported_pair','Choose a supported conversion pair.');
      requireValue(typeof raw==='string'&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)&&Number(raw)<=1e12,400,'invalid_amount','amount must be a decimal between 0 and 1000000000000.');
      const source=JSON.parse(snapshot.body);const a=source.Prices[from],b=source.Prices[to];
      requireValue(typeof a==='number'&&a>0&&typeof b==='number'&&b>0,503,'instrument_unavailable','A required instrument is unavailable.');
      prepared=JSON.stringify({from,to,amount:Number(raw),ratio:b/a,result:Number(raw)*b/a,Datetime:source.Datetime,mode:key.mode});
     }
    }else if(url.searchParams.size)throw new ApiError(400,'invalid_parameter','This endpoint takes no query parameters.');
   }catch(e){requestError=e;}
   const decision=await store.meter(hash,requestId,url.pathname+url.search,!requestError&&snapshot!==null);metered=true;
   if(!decision.allowed)throw new ApiError(decision.status,decision.code,decision.code==='rate_limit'?'Your organization has reached its per-minute limit.':decision.code==='monthly_quota'?'Your billing-period quota is exhausted.':'An active paid API subscription is required.',decision.retry_after);
   if(requestError)throw requestError;
   const headers={'X-Request-Id':requestId,'X-RateLimit-Limit':String(decision.per_minute),'X-Monthly-Remaining':String(decision.remaining),...cors};
   if(snapshot){
    // A slow accounting call must not turn a fresh admission into a stale reply.
    assertFresh(snapshot,now());
    // Return the stored serialized body verbatim. No reserialization or metadata injection.
    result=new Response(prepared,{headers:{...security,...headers,'Content-Type':'application/json','X-Snapshot-Id':snapshot.digest,'X-Source-Fetched-At':snapshot.source_fetched_at,'X-Cache-Age-Seconds':String(Math.max(0,Math.floor((now()-Date.parse(snapshot.source_fetched_at))/1000))),'X-Data-Mode':snapshot.provenance}});
   }else result=json(url.pathname==='/v1/usage'?{...decision,plan:(await store.billing('read',key.organization_id)).subscription.plan}:{status:'available',mode:key.mode,live_market_data_enabled:liveAllowed(env),cache_max_age_seconds:120,real_time_claim:false},200,headers);
  }catch(e){
   const known=e instanceof ApiError;const status=known?e.status:503;
   result=json({error:{code:known?e.code:'temporarily_unavailable',message:known?e.message:'The service is temporarily unavailable.',request_id:requestId}},status,{...cors,'X-Request-Id':requestId,...(known&&e.retryAfter?{'Retry-After':String(Math.max(1,Math.ceil(e.retryAfter)))}:{})});
  }
  if(hash&&metered){try{await store.response(hash,requestId,result.status);}catch{/* Response logging failure must not duplicate quota consumption. */}}
  return result;
 };
}
