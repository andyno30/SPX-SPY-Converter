import document from './terms-document.json' with {type:'json'};
import {enabled,requireValue,sha256} from './core.mjs';

export const TERMS_VERSION=document.version;
export const TERMS_TEXT=[document.title,`Version ${document.version}`,...document.sections.flatMap(s=>[s.heading,...s.paragraphs])].join('\n\n');
export const TERMS_DIGEST=await sha256(TERMS_TEXT);
export const termsEnabled=env=>enabled(env.API_LEGAL_APPROVED)&&env.API_AGREEMENT_VERSION===TERMS_VERSION;
export const acceptedTerms=(agreements,version)=>agreements.some(a=>a.version===version&&a.provider==='terms-acceptance'&&a.document_sha256===TERMS_DIGEST&&a.envelope_id?.startsWith('terms:')&&a.document_reference);

export function createTerms(env,store){
 return async(user,org,data,requestId,request)=>{
  requireValue(termsEnabled(env),503,'terms_pending_approval','The Terms are available for review. Acceptance opens after approval.');
  requireValue(user.email&&user.email_confirmed_at,403,'verified_identity_required','Use Google sign-in or an existing verified account.');
  requireValue(data.accepted===true,400,'terms_acceptance_required','You must explicitly accept the Terms before checkout.');
  requireValue(data.version===TERMS_VERSION&&data.document_sha256===TERMS_DIGEST,409,'terms_version_changed','The Terms have changed. Review the current version before accepting.');
  // Identity, time, version approval and receipt are verified again by the DB.
  // No customer-supplied signer, approval, timestamp or document body is trusted.
  return store.terms('accept',user.id,org,{version:TERMS_VERSION,document_sha256:TERMS_DIGEST,request_id:requestId,origin:request.headers.get('origin')||null,user_agent:(request.headers.get('user-agent')||'').slice(0,300)});
 };
}
