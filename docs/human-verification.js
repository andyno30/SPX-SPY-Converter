// Loaded only after the authenticated price endpoint requests verification.
// The server validates Cloudflare's single-use token; browser state grants no access.
let loader, pending;
function loadWidget(){
 if(window.turnstile)return Promise.resolve(window.turnstile);
 if(!loader)loader=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=()=>window.turnstile?resolve(window.turnstile):reject(Error('Verification could not load.'));script.onerror=()=>{loader=null;script.remove();reject(Error('Verification could not load. Please check your connection.'));};document.head.append(script);});
 return loader;
}
export function verifyWebsiteHuman(challenge,getToken,signal){
 if(pending)return pending;
 pending=showVerification(challenge,getToken,signal).finally(()=>{pending=null;});return pending;
}
async function showVerification(challenge,getToken,signal){
 if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
 if(!challenge.sitekey||!challenge.challenge)throw Error('Verification is unavailable.');
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-labelledby','website-verification-title');
 dialog.style.cssText='max-width:380px;width:calc(100% - 40px);padding:24px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#222;font-family:Arial,sans-serif';
 const title=document.createElement('h2');title.id='website-verification-title';title.textContent='Verify you are human';
 const explanation=document.createElement('p');explanation.textContent='There have been many price requests from this account. Complete this check to continue. Your subscription limits still apply.';
 const widget=document.createElement('div'),status=document.createElement('p'),cancel=document.createElement('button');status.setAttribute('role','status');cancel.textContent='Cancel';cancel.type='button';
 dialog.append(title,explanation,widget,status,cancel);document.body.append(dialog);dialog.showModal();
 let widgetId,turnstile;
 const cancelled=()=>Object.assign(new Error('Verification was not completed. Use Retry now when ready.'),{status:429,isCooldown:true,canRetry:true});
 try{
  await new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(error)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
   const abort=()=>finish(new DOMException('Request cancelled','AbortError'));
   signal?.addEventListener('abort',abort,{once:true});cancel.onclick=()=>finish(cancelled());dialog.addEventListener('cancel',event=>{event.preventDefault();finish(cancelled());});
   loadWidget().then(api=>{
    if(settled)return;turnstile=api;
    widgetId=api.render(widget,{sitekey:challenge.sitekey,action:'pro-prices',cData:challenge.challenge,theme:'light',appearance:'always',
     callback:async response=>{
      if(settled)return;status.textContent='Checking verification…';
      try{
       const token=await getToken();if(!token)throw Error('Your session changed. Sign in and retry.');
       const verified=await fetch('https://isvzhpqrmjtqnqyyidxr.supabase.co/functions/v1/website-verification',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({challenge:challenge.challenge,response}),signal});
       const body=await verified.json();if(!verified.ok||body.verified!==true)throw Error(body.message||'Verification failed. Please retry.');finish();
      }catch(e){finish(Object.assign(e,{status:429,isCooldown:true,canRetry:true}));}
     },'error-callback':()=>{status.textContent='Verification could not load. Cancel and retry when your connection is ready.';},'expired-callback':()=>{status.textContent='Verification expired. Please try again.';api.reset(widgetId);}});
   }).catch(finish);
  });
 }finally{if(turnstile&&widgetId!==undefined)turnstile.remove(widgetId);dialog.close();dialog.remove();}
}
