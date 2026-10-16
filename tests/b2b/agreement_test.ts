import assert from 'node:assert/strict';
import {verifyCompletedDocuSign} from '../../supabase/b2b-api/agreements.mjs';
Deno.test('completed signature evidence requires provider completion, identity, version and private PDF',async()=>{
 const input={envelopeId:crypto.randomUUID(),organizationId:crypto.randomUUID(),signerId:crypto.randomUUID(),signerEmail:'signer@example.test',version:'synthetic-reviewed-v1'};
 let status='completed',version=input.version,email=input.signerEmail;
 const provider={json:async(path:string)=>path.endsWith('custom_fields')?{textCustomFields:[{name:'organization_id',value:input.organizationId},{name:'agreement_version',value:version}]}:path.endsWith('recipients')?{signers:[{clientUserId:input.signerId,email,status:'completed',signedDateTime:'2026-10-15T18:00:00Z'}]}:{envelopeId:input.envelopeId,status},document:async()=>new TextEncoder().encode('%PDF-1.7 synthetic fixture only')};
 const writes:any[]=[];const archive={put:async(key:string,bytes:Uint8Array)=>{writes.push({key,bytes});return`private:${key}`;}};
 const result=await verifyCompletedDocuSign(input,provider,archive);assert.equal(result.document_sha256.length,64);assert.equal(writes.length,1);assert.equal(result.signer_id,input.signerId);
 status='sent';await assert.rejects(verifyCompletedDocuSign(input,provider,archive),e=>e.code==='signature_incomplete');status='completed';version='wrong';await assert.rejects(verifyCompletedDocuSign(input,provider,archive),e=>e.code==='agreement_mismatch');version=input.version;email='wrong@example.test';await assert.rejects(verifyCompletedDocuSign(input,provider,archive),e=>e.code==='signer_mismatch');assert.equal(writes.length,1);
});
