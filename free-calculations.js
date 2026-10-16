// Server-controlled Free allowance. No client counters, price fetching or local fallback.
(function(){
 const endpoint='https://api.spyconverter.com/v1/website/free-calculations';
 let verification,loader;
 async function request(body){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await r.json();return{r,data};}
 function load(){if(window.turnstile)return Promise.resolve(window.turnstile);if(!loader)loader=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.onload=()=>window.turnstile?resolve(window.turnstile):reject(Error('Verification could not load.'));s.onerror=()=>{loader=null;s.remove();reject(Error('Verification could not load. Please retry.'));};document.head.append(s);});return loader;}
 function verify(challenge){if(verification)return verification;verification=show(challenge).finally(()=>{verification=null;});return verification;}
 async function show(challenge){
  const dialog=document.createElement('dialog');dialog.style.cssText='max-width:380px;width:calc(100% - 40px);padding:24px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#222;font-family:Arial,sans-serif';
  const title=document.createElement('h2'),text=document.createElement('p'),widget=document.createElement('div'),status=document.createElement('p'),cancel=document.createElement('button');
  title.textContent='Verify you are human';title.id='free-verification-title';dialog.setAttribute('aria-labelledby',title.id);text.textContent='You have reached 10 calculations in a minute. Complete this check to continue with a controlled allowance. Shared networks share this limit.';status.setAttribute('role','status');cancel.textContent='Cancel';cancel.type='button';dialog.append(title,text,widget,status,cancel);document.body.append(dialog);dialog.showModal();let api,id;
  try{await new Promise((resolve,reject)=>{let settled=false,sending=false;const finish=e=>{if(settled)return;settled=true;e?reject(e):resolve();};cancel.onclick=()=>finish(Error('Verification was not completed. Please retry when ready.'));dialog.addEventListener('cancel',e=>{e.preventDefault();finish(Error('Verification was not completed.'));});load().then(v=>{if(settled)return;api=v;id=v.render(widget,{sitekey:challenge.sitekey,action:'free-calculations',cData:challenge.challenge,theme:'light',appearance:'always',callback:async response=>{if(settled||sending)return;sending=true;status.textContent='Checking verification…';try{const{r,data}=await request({action:'verify',challenge:challenge.challenge,response});if(!r.ok||data.verified!==true)throw Error(data.message||'Verification failed. Please retry later.');finish();}catch(e){finish(e);}},'error-callback':()=>{status.textContent='Verification could not load. Cancel and retry.';},'expired-callback':()=>{status.textContent='Verification expired. Please try again.';api.reset(id);}});}).catch(finish);});}finally{if(api&&id!==undefined)api.remove(id);dialog.close();dialog.remove();}
 }
 window.FreeCalculator={async calculate(amount,ratio,operation){
  const body={action:'calculate',amount,ratio,operation};let{r,data}=await request(body);
  if(r.status===429&&data.code==='HUMAN_VERIFICATION_REQUIRED'){await verify(data);({r,data}=await request(body));}
  if(!r.ok||typeof data.value!=='number')throw Error(data.message||'Calculation unavailable. Please wait and retry.');return data.value;
 }};
})();
