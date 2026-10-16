import {enabled,requireValue,textField,validId,hex} from './core.mjs';
import {verifyCompletedDocuSign} from './agreements.mjs';

export function signingEnabled(env){return enabled(env.API_LEGAL_APPROVED)&&!!env.API_AGREEMENT_VERSION&&!!env.DOCUSIGN_TEMPLATE_ID&&!!env.DOCUSIGN_ACCOUNT_ID&&!!env.DOCUSIGN_INTEGRATION_KEY&&!!env.DOCUSIGN_USER_ID&&!!env.DOCUSIGN_PRIVATE_KEY;}
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const encode=value=>b64url(new TextEncoder().encode(JSON.stringify(value)));

// Server-side JWT grant; the account owner must grant DocuSign consent first.
// Neither OAuth credentials nor the private signing key reach the browser.
export function docuSignProvider(env,fetcher=fetch,now=Date.now){
 const production=env.API_ENVIRONMENT==='production';
 const auth=production?'account.docusign.com':'account-d.docusign.com';
 let cached=null;
 async function access(){
  requireValue(signingEnabled(env),503,'signature_configuration_required','Agreement signing is not yet available.');
  if(cached&&cached.expires>now()+60000)return cached;
  const raw=env.DOCUSIGN_PRIVATE_KEY.replaceAll('\\n','\n').replace(/-----[^-]+-----|\s/g,'');
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(raw),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const issued=Math.floor(now()/1000),data=`${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:env.DOCUSIGN_INTEGRATION_KEY,sub:env.DOCUSIGN_USER_ID,aud:auth,iat:issued,exp:issued+3600,scope:'signature impersonation'})}`;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(data));
  const response=await fetcher(`https://${auth}/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${data}.${b64url(new Uint8Array(signature))}`}),signal:AbortSignal.timeout(15000)});
  requireValue(response.ok,503,'signature_authentication_required','The signing provider account needs configuration.');
  const token=await response.json();
  const info=await fetcher(`https://${auth}/oauth/userinfo`,{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});
  requireValue(info.ok,503,'signature_account_unavailable','The signing provider account is unavailable.');
  const account=(await info.json()).accounts?.find(a=>a.account_id===env.DOCUSIGN_ACCOUNT_ID);
  const base=account?.base_uri;
  requireValue(typeof base==='string'&&/^https:\/\/[a-z0-9-]+\.docusign\.net$/.test(base)&&(!production||base!=='https://demo.docusign.net'),503,'signature_account_mismatch','The signing account does not match this environment.');
  cached={token:token.access_token,base:`${base}/restapi/v2.1/accounts/${encodeURIComponent(env.DOCUSIGN_ACCOUNT_ID)}/`,expires:now()+Math.min(Number(token.expires_in)||3600,3600)*1000};return cached;
 }
 async function request(path,method='GET',body){
  requireValue(/^envelopes(?:\/[0-9a-f-]+(?:\/(?:custom_fields|recipients|documents\/combined|views\/recipient))?|\?transaction_ids=[0-9a-f-]+)?$/.test(path),400,'invalid_provider_path','Invalid signing resource.');
  const session=await access();const response=await fetcher(session.base+path,{method,headers:{Authorization:`Bearer ${session.token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
  requireValue(response.ok,502,'signature_provider_unavailable','The signing provider could not complete the request.');return response;
 }
 return{json:async(path,method,body)=>(await request(path,method,body)).json(),document:async path=>{const r=await request(path);requireValue(Number(r.headers.get('content-length')||0)<=10000000,502,'document_too_large','Agreement document exceeds the archival limit.');const bytes=new Uint8Array(await r.arrayBuffer());requireValue(bytes.length<=10000000,502,'document_too_large','Agreement document exceeds the archival limit.');return bytes;}};
}

export function createSigning(env,store,provider=docuSignProvider(env)){
 return async(user,org,data)=>{
  requireValue(signingEnabled(env),503,'agreement_review_required','Agreement signing is not yet configured.');
  requireValue(user.email&&user.email_confirmed_at,403,'verified_email_required','Verify your account email before signing.');
  const version=env.API_AGREEMENT_VERSION;
  if(data.action==='status'){
   const session=await store.signing('read',user.id,org,{version});
   if(!session?.envelope_id)return{completed:false};
   if(session.completed)return{completed:true};
   const envelope=await provider.json(`envelopes/${session.envelope_id}`);
   if(envelope.status!=='completed')return{completed:false,status:envelope.status};
   let document;
   const evidence=await verifyCompletedDocuSign({envelopeId:session.envelope_id,organizationId:org,signerId:user.id,signerEmail:session.signer_email,version},provider,{put:async(path,bytes)=>{document=bytes;return`private:b2b-agreements/${path}`;}});
   // Store the completed artifact and evidence in one restricted DB transaction.
   await store.signing('complete',user.id,org,{...evidence,document_hex:hex(document)});
   return{completed:true};
  }
  const name=textField(data.signer_name,'signing name',200);
  const session=await store.signing('reserve',user.id,org,{version,signer_name:name,signer_email:user.email});
  if(session.completed)return{completed:true};
  requireValue(session.signer_id===user.id,409,'signer_conflict','This agreement is assigned to another organization owner.');
  let envelopeId=session.envelope_id;
  if(!envelopeId){
   requireValue(session.acquired,409,'signature_pending','Agreement preparation is in progress. Retry shortly.');
   // Recover a provider success whose acknowledgment was lost before DB bind.
   // The transaction ID is stable; recovery stops before its seven-day expiry.
   let envelope=session.recover?(await provider.json(`envelopes?transaction_ids=${session.id}`)).envelopes?.[0]:null;
   if(!envelope)envelope=await provider.json('envelopes','POST',{templateId:env.DOCUSIGN_TEMPLATE_ID,status:'sent',transactionId:session.id,templateRoles:[{roleName:env.DOCUSIGN_SIGNER_ROLE||'Customer',name:session.signer_name,email:session.signer_email,clientUserId:user.id}],customFields:{textCustomFields:[{name:'organization_id',value:org,show:'false'},{name:'agreement_version',value:version,show:'false'}]}});
   requireValue(validId(envelope.envelopeId),502,'invalid_envelope','The provider returned an invalid agreement reference.');
   envelopeId=envelope.envelopeId;await store.signing('bind',user.id,org,{version,envelope_id:envelopeId,session_id:session.id});
  }
  const view=await provider.json(`envelopes/${envelopeId}/views/recipient`,'POST',{returnUrl:`${env.API_SITE_ORIGIN}/B2B/api/dashboard/?agreement=returned`,authenticationMethod:'Password',email:session.signer_email,userName:session.signer_name,clientUserId:user.id});
  requireValue(/^https:\/\/[a-z0-9.-]+\.docusign\.(net|com)\//.test(view.url||''),502,'invalid_signing_url','The signing URL is invalid.');
  return{url:view.url};
 };
}
