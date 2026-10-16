// Cloudflare gateway. Exact organization limits and monthly accounting execute
// atomically at the private origin; all keys and edge regions share those rows.
const ORIGIN='https://isvzhpqrmjtqnqyyidxr.supabase.co/functions/v1/b2b-platform';
const FREE_PATH='/v1/website/free-calculations';
const PATHS=new Set([FREE_PATH,'/v1/conversions','/v1/convert','/v1/usage','/v1/status','/platform/config','/platform/organizations','/platform/dashboard','/platform/keys','/platform/keys/provision','/platform/keys/revoke','/platform/members','/platform/applications','/platform/agreement','/platform/checkout','/platform/portal','/webhooks/stripe']);
export default {
 async fetch(request,env){
  const url=new URL(request.url),origin=request.headers.get('origin');
  const cors=origin==='https://spyconverter.com'?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
  const error=(status,code,message)=>Response.json({error:{code,message}},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...cors}});
  if(!PATHS.has(url.pathname))return error(404,'not_found','Endpoint not found.');
  if(!['GET','POST','OPTIONS'].includes(request.method))return error(405,'method_not_allowed','Method not allowed.');
  if(request.method==='OPTIONS')return origin==='https://spyconverter.com'?new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}}):error(403,'origin_denied','Origin is not allowed.');
  const free=url.pathname===FREE_PATH;
  if(free&&origin!=='https://spyconverter.com')return error(403,'origin_denied','Origin is not allowed.');
  if(url.pathname.startsWith('/v1/')&&!free&&!/^Bearer sc_(test|live)_[a-f0-9]{64}$/.test(request.headers.get('authorization')||''))return error(401,'invalid_key','Provide a valid API key in the Authorization header.');
  if(!env.B2B_GATEWAY_SECRET)return error(503,'configuration_required','The API service is not yet available.');
  const headers=new Headers();
  for(const name of ['authorization','content-type','stripe-signature','origin']){const value=request.headers.get(name);if(value)headers.set(name,value);}
  headers.set('X-B2B-Gateway',env.B2B_GATEWAY_SECRET);
  if(free){
   if(request.method!=='POST')return error(405,'method_not_allowed','Method not allowed.');
   const ip=request.headers.get('CF-Connecting-IP');
   if(!ip)return error(503,'identity_unavailable','Network identity is unavailable.');
   // IPv6 privacy-address rotation stays within the same /64 allowance.
   let network=ip;
   if(ip.includes(':')){
    try{const canonical=new URL('http://['+ip+']/').hostname.slice(1,-1);const halves=canonical.split('::');const left=halves[0]?halves[0].split(':'):[],right=halves[1]?halves[1].split(':'):[];
     network=[...left,...Array(Math.max(0,8-left.length-right.length)).fill('0'),...right].slice(0,4).map(x=>parseInt(x,16).toString(16)).join(':')+'::/64';
    }catch{return error(503,'identity_unavailable','Network identity is unavailable.');}
   }else if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))return error(503,'identity_unavailable','Network identity is unavailable.');
   const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.B2B_GATEWAY_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const hash=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('free-calculator:'+network));
   headers.set('X-Free-Visitor',Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join(''));
  }
  try{
   let body;
   if(request.body){
    const chunks=[],reader=request.body.getReader();let length=0;
    for(;;){const{value,done}=await reader.read();if(done)break;length+=value.length;if(length>(free?4096:262144)){await reader.cancel();return error(413,'body_too_large','Request body is too large.');}chunks.push(value);}
    body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
   }
   const response=await fetch(free?'https://isvzhpqrmjtqnqyyidxr.supabase.co/functions/v1/website-free-calculations':ORIGIN+url.pathname+url.search,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(25000)});
   if(!response.headers.get('content-type')?.includes('application/json'))return error(503,'origin_unavailable','The API service is temporarily unavailable.');
   // No response reserialization, public CDN caching, browser challenges or redirects.
   const outgoing=new Headers(response.headers);outgoing.set('Cache-Control','private, no-store');outgoing.delete('set-cookie');
   return new Response(response.body,{status:response.status,headers:outgoing});
  }catch{return error(503,'temporarily_unavailable','The API service is temporarily unavailable.');}
 }
};
