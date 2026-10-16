type Decision={allowed:boolean;disabled?:boolean;code?:string;retry?:number;challenge?:string};
type Control=(id:string,action:string,challenge?:string,success?:boolean)=>Promise<Decision>;
const CORS={'Access-Control-Allow-Origin':'https://spyconverter.com','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'private, no-store','Vary':'Origin'};
const reply=(body:unknown,status:number,headers:Record<string,string>={})=>Response.json(body,{status,headers:{...CORS,...headers}});
export function createWebsiteHumanGuard(control:Control,sitekey:string){
 return async(id:string):Promise<Response|null>=>{
  try{
   const d=await control(id,'consume');if(d.allowed===true)return null;
   if(!['HUMAN_VERIFICATION_REQUIRED','RATE_LIMITED'].includes(d.code||''))throw Error('Invalid decision');
   return reply({code:d.code,message:d.code==='HUMAN_VERIFICATION_REQUIRED'?'Verify you are human to continue refreshing prices.':'Too many requests. Please wait before trying again.',retryAfterSeconds:d.retry||60,...(d.challenge?{challenge:d.challenge,sitekey}: {})},429,{'Retry-After':String(d.retry||60),'Access-Control-Expose-Headers':'Retry-After'});
  }catch{return reply({code:'QUOTA_UNAVAILABLE',message:'Verification is temporarily unavailable. Please try again.',retryAfterSeconds:5},503,{'Retry-After':'5','Access-Control-Expose-Headers':'Retry-After'});}
 };
}
export function createWebsiteVerification(deps:{secret:string;control:Control;authorize:(token:string)=>Promise<string|null>;fetcher?:typeof fetch;now?:()=>number}){
 return async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
  if(req.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED'},405);
  if(req.headers.get('origin')!=='https://spyconverter.com')return reply({code:'ORIGIN_DENIED'},403);
  const token=req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if(!token)return reply({code:'UNAUTHORIZED'},401);
  try{
   const id=await deps.authorize(token);if(!id)return reply({code:'UNAUTHORIZED'},401);
   if(!deps.secret)return reply({code:'VERIFICATION_UNAVAILABLE'},503);
   const reader=req.body?.getReader();let raw='';const decoder=new TextDecoder();let bytes=0;
   if(reader)for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4096){await reader.cancel();return reply({code:'INVALID_REQUEST'},413);}raw+=decoder.decode(value,{stream:true});}
   let body;try{body=JSON.parse(raw);}catch{return reply({code:'INVALID_REQUEST'},400);}
   if(typeof body.challenge!=='string'||!/^[-a-f0-9]{36}$/.test(body.challenge)||typeof body.response!=='string'||body.response.length<1||body.response.length>2048)return reply({code:'INVALID_REQUEST'},400);
   const claim=await deps.control(id,'claim',body.challenge);
   if(!claim.allowed||claim.disabled)return reply({code:claim.code||'VERIFICATION_UNAVAILABLE'},claim.disabled?503:429,{'Retry-After':String(claim.retry||60)});
   const response=await(deps.fetcher||fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:deps.secret,response:body.response}),signal:AbortSignal.timeout(8000)});
   const result=await response.json();const age=(deps.now?.()??Date.now())-Date.parse(result.challenge_ts);
   const valid=response.ok&&result.success===true&&result.hostname==='spyconverter.com'&&result.action==='pro-prices'&&result.cdata===body.challenge&&Number.isFinite(age)&&age>=-10000&&age<=300000;
   const finish=await deps.control(id,'finish',body.challenge,valid);
   return valid&&finish.allowed&&!finish.disabled?reply({verified:true},200):reply({code:'VERIFICATION_FAILED',message:'Verification failed or expired. Please try again.'},400);
  }catch{return reply({code:'VERIFICATION_UNAVAILABLE',message:'Verification is temporarily unavailable. Please try again.'},503);}
 };
}
