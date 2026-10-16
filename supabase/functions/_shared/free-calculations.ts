type Decision={allowed:boolean;already_verified?:boolean;disabled?:boolean;code?:string;retry?:number;challenge?:string};
type Control=(id:string,action:string,challenge?:string,success?:boolean)=>Promise<Decision>;
const CORS={'Access-Control-Allow-Origin':'https://spyconverter.com','Vary':'Origin','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Expose-Headers':'Retry-After','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const reply=(body:unknown,status=200,retry?:number)=>Response.json(body,{status,headers:{...CORS,...(retry?{'Retry-After':String(retry)}:{})}});
export function createFreeCalculator(deps:{gatewaySecret:string;turnstileSecret:string;sitekey:string;control:Control;fetcher?:typeof fetch;now?:()=>number}){
 return async(req:Request)=>{
  // The gateway overwrites visitor identity from Cloudflare's trusted client address.
  if(!deps.gatewaySecret||req.headers.get('x-b2b-gateway')!==deps.gatewaySecret)return reply({code:'ORIGIN_DENIED'},403);
  if(req.headers.get('origin')!=='https://spyconverter.com')return reply({code:'ORIGIN_DENIED'},403);
  if(req.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED'},405);
  const id=req.headers.get('x-free-visitor')||'';if(!/^[a-f0-9]{64}$/.test(id))return reply({code:'IDENTITY_UNAVAILABLE'},503);
  try{
   let raw='',bytes=0;const reader=req.body?.getReader(),decoder=new TextDecoder();
   if(reader)for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4096){await reader.cancel();return reply({code:'INVALID_REQUEST'},413);}raw+=decoder.decode(value,{stream:true});}
   let body;try{body=JSON.parse(raw);}catch{return reply({code:'INVALID_REQUEST'},400);}
   if(!body||typeof body!=='object'||Array.isArray(body))return reply({code:'INVALID_REQUEST'},400);
   if(body.action==='verify'){
    if(!deps.turnstileSecret)return reply({code:'VERIFICATION_UNAVAILABLE'},503);
    if(typeof body.challenge!=='string'||!/^[-a-f0-9]{36}$/.test(body.challenge)||typeof body.response!=='string'||body.response.length<1||body.response.length>2048)return reply({code:'INVALID_REQUEST'},400);
    const claim=await deps.control(id,'claim',body.challenge);
    if(!claim.allowed||claim.disabled)return reply({code:claim.code||'VERIFICATION_UNAVAILABLE'},claim.disabled?503:429,claim.retry||60);
    if(claim.already_verified)return reply({verified:true});
    let valid=false;
    try{
     const r=await(deps.fetcher||fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:deps.turnstileSecret,response:body.response}),signal:AbortSignal.timeout(8000)});
     const v=await r.json(),age=(deps.now?.()??Date.now())-Date.parse(v.challenge_ts);
     valid=r.ok&&v.success===true&&v.hostname==='spyconverter.com'&&v.action==='free-calculations'&&v.cdata===body.challenge&&Number.isFinite(age)&&age>=-10000&&age<=300000;
    }catch{/* Failed verification never grants clearance. */}
    const finish=await deps.control(id,'finish',body.challenge,valid);
    return valid&&finish.allowed&&!finish.disabled?reply({verified:true}):reply({code:'VERIFICATION_FAILED',message:'Verification failed. Please wait five minutes before retrying.'},429,300);
   }
   if(body.action!=='calculate'||!['multiply','divide'].includes(body.operation)||typeof body.amount!=='number'||!Number.isFinite(body.amount)||typeof body.ratio!=='number'||!Number.isFinite(body.ratio)||body.ratio<=0)return reply({code:'INVALID_REQUEST'},400);
   const d=await deps.control(id,'consume');
   if(!d.allowed)return reply({code:d.code||'RATE_LIMITED',message:d.challenge?'Verify you are human to continue calculating.':'Too many calculations. Please wait before retrying.',...(d.challenge?{challenge:d.challenge,sitekey:deps.sitekey}:{})},429,d.retry||60);
   // Use the page's currently displayed ratio, including manual updates. Never fetch prices.
   const value=body.operation==='multiply'?body.amount*body.ratio:body.amount/body.ratio;
   return Number.isFinite(value)?reply({value}):reply({code:'INVALID_REQUEST'},400);
  }catch{return reply({code:'SERVICE_UNAVAILABLE',message:'Calculations are temporarily unavailable. Please retry.'},503,5);}
 };
}
