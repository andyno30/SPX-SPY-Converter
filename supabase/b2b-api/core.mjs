export const PLANS = Object.freeze({
  developer: Object.freeze({name:'Developer',cents:2500,quota:10000,perMinute:10,applications:1}),
  pro: Object.freeze({name:'Pro',cents:5000,quota:100000,perMinute:30,applications:1}),
  business: Object.freeze({name:'Business',cents:15000,quota:500000,perMinute:120,applications:null}),
});
export const enabled = value => value === 'true';
export class ApiError extends Error {
  constructor(status,code,message,retryAfter){super(message);Object.assign(this,{status,code,retryAfter});}
}
export function requireValue(value,status,code,message){if(!value)throw new ApiError(status,code,message);}
export function textField(value,name,max=200){requireValue(typeof value==='string'&&value.trim().length>0&&value.length<=max,400,'invalid_input',`Provide a valid ${name}.`);return value.trim();}
export function validId(value){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
export async function sha256(value){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
export const hex = bytes => [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function hmac(value,secret){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)));}
export function constantEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export async function keyHash(key,pepper){requireValue(typeof pepper==='string'&&pepper.length>=32,503,'configuration_required','Key security is not configured.');return hmac(key,pepper);}
export async function generateKey(mode,pepper){requireValue(['test','live'].includes(mode),400,'invalid_key_mode','Choose test or live.');const key=`sc_${mode}_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;return{key,hash:await keyHash(key,pepper),prefix:key.slice(0,16)};}
export async function readLimited(request,limit=16384){requireValue(Number(request.headers.get('content-length')||0)<=limit,413,'body_too_large','Request body is too large.');if(!request.body)return '';const reader=request.body.getReader(),parts=[];let size=0;while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new ApiError(413,'body_too_large','Request body is too large.');}parts.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder().decode(bytes);}
export async function readJson(request){requireValue((request.headers.get('content-type')||'').split(';')[0]==='application/json',415,'json_required','Use application/json.');try{const value=JSON.parse(await readLimited(request));requireValue(value&&typeof value==='object'&&!Array.isArray(value),400,'invalid_json','A JSON object is required.');return value;}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(400,'invalid_json','A JSON object is required.');}}
export function liveAllowed(env){return enabled(env.API_LIVE_MARKET_DATA_ENABLED)&&enabled(env.API_DATA_LICENSE_APPROVED)&&!!env.API_DATA_LICENSE_REFERENCE;}
export function assertFresh(snapshot,now){requireValue(snapshot,503,'cache_unavailable','No cached snapshot is available.');const age=now-Date.parse(snapshot.source_fetched_at);requireValue(Number.isFinite(age)&&age>=-5000&&age<=120000&&snapshot.evaluation_day===new Date(now).toISOString().slice(0,10),503,'stale_cache','The source snapshot is unavailable or older than 120 seconds.');}
export const safeKey = ({id,prefix,label,mode,created_at,revoked_at})=>({id,prefix,label,mode,created_at,revoked_at});
export const FAMILIES=[['SPX','SPY','ES'],['QQQ','NQ','NDX'],['DJI','DIA','YM'],['RUT','IWM','RTY']];
