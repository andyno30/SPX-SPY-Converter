// Operator-side completed-document verification. Not callable by customer routes.
// The operator sends a legally reviewed document through DocuSign separately.
// Only an authenticated provider response and archived PDF can authorize recording.
import {requireValue,hex,validId} from './core.mjs';
export async function verifyCompletedDocuSign({envelopeId,organizationId,signerId,signerEmail,version},provider,archive){
 requireValue(validId(envelopeId)&&validId(organizationId)&&validId(signerId)&&version,400,'invalid_signature_reference','A bound signing identity and agreement version are required.');
 const base=`envelopes/${envelopeId}`;
 const envelope=await provider.json(base);
 requireValue(envelope.envelopeId===envelopeId&&envelope.status==='completed',409,'signature_incomplete','The provider envelope is not completed.');
 const fields=await provider.json(`${base}/custom_fields`);
 const binding=Object.fromEntries((fields.textCustomFields||[]).map(f=>[f.name,f.value]));
 requireValue(binding.organization_id===organizationId&&binding.agreement_version===version,403,'agreement_mismatch','The envelope is not bound to this organization and agreement.');
 const recipients=await provider.json(`${base}/recipients`);
 const signer=(recipients.signers||[]).find(s=>s.clientUserId===signerId&&s.email?.toLowerCase()===signerEmail.toLowerCase());
 requireValue(signer?.status==='completed'&&Number.isFinite(Date.parse(signer.signedDateTime)),403,'signer_mismatch','A completed matching signing identity is required.');
 const bytes=await provider.document(`${base}/documents/combined`);
 requireValue(bytes instanceof Uint8Array&&bytes.length>5&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-',502,'document_missing','A completed PDF must be preserved.');
 const digest=hex(await crypto.subtle.digest('SHA-256',bytes));
 // Archive must be private, access-controlled and durable. No public document URL.
 const documentReference=await archive.put(`${organizationId}/${envelopeId}/${digest}.pdf`,bytes);
 requireValue(typeof documentReference==='string'&&documentReference.startsWith('private:'),503,'private_archive_required','The signed document requires private storage.');
 return{provider:'docusign',version,signer_id:signerId,signer_email:signerEmail,signed_at:signer.signedDateTime,envelope_id:envelopeId,document_sha256:digest,document_reference:documentReference};
}
export function docuSignTestProvider(env,fetcher=fetch){
 requireValue(env.DOCUSIGN_DEMO_ACCOUNT_ID&&env.DOCUSIGN_DEMO_ACCESS_TOKEN,503,'signature_configuration_required','Configure the DocuSign developer account securely.');
 // Test-only origin: no production provider account is used by this build.
 const base=`https://demo.docusign.net/restapi/v2.1/accounts/${encodeURIComponent(env.DOCUSIGN_DEMO_ACCOUNT_ID)}/`;
 async function read(path){requireValue(/^envelopes\/[0-9a-f-]+(?:\/(?:custom_fields|recipients|documents\/combined))?$/.test(path),400,'invalid_provider_path','Invalid provider resource.');const response=await fetcher(base+path,{headers:{Authorization:`Bearer ${env.DOCUSIGN_DEMO_ACCESS_TOKEN}`},signal:AbortSignal.timeout(15000)});requireValue(response.ok,502,'signature_provider_unavailable','The signature provider could not be verified.');return response;}
 return{json:async path=>(await read(path)).json(),document:async path=>new Uint8Array(await(await read(path)).arrayBuffer())};
}
