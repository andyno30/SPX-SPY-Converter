import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStore} from '../../supabase/b2b-api/database.mjs';
import {createSigning,signingEnabled} from '../../supabase/b2b-api/signing.mjs';
const require=createRequire(import.meta.url),{createLocalDatabase}=require('../../scripts/b2b-api/local-database.cjs');
Deno.test({name:'Provider signing: authenticated identity, concurrency, private artifact and idempotent completion',sanitizeResources:false,sanitizeOps:false,fn:async t=>{
 const db=await createLocalDatabase('signingflow'),store=createStore(db.rpc),actor=crypto.randomUUID(),stranger=crypto.randomUUID();
 const env={API_ENVIRONMENT:'production',API_LEGAL_APPROVED:'true',API_AGREEMENT_VERSION:'test-reviewed-v1',DOCUSIGN_TEMPLATE_ID:'test-template',DOCUSIGN_ACCOUNT_ID:'test-account',DOCUSIGN_INTEGRATION_KEY:'test-integration',DOCUSIGN_USER_ID:'test-user',DOCUSIGN_PRIVATE_KEY:'test-private-key-never-used',API_SITE_ORIGIN:'https://synthetic.invalid'};
 await db.pool.query('insert into auth.users values($1),($2)',[actor,stranger]);
 const org=await store.account('create',actor,null,{name:'Synthetic signing',legal_name:'Test company',email:'test@example.test',intended_use:'Automated signing test',plan:'developer'});
 const user={id:actor,email:'test@example.test',email_confirmed_at:new Date().toISOString()};
 let completed=false,creates=0;const envelopeId=crypto.randomUUID();
 const provider={json:async(path:string,method='GET',body?:any)=>{
  if(path==='envelopes'){creates++;assert.equal(body.templateRoles[0].email,user.email);assert.equal(body.templateRoles[0].clientUserId,actor);return{envelopeId};}
  if(path.endsWith('/views/recipient'))return{url:'https://demo.docusign.net/signing/test'};
  if(path.endsWith('/custom_fields'))return{textCustomFields:[{name:'organization_id',value:org.id},{name:'agreement_version',value:env.API_AGREEMENT_VERSION}]};
  if(path.endsWith('/recipients'))return{signers:[{clientUserId:actor,email:user.email,status:'completed',signedDateTime:new Date().toISOString()}]};
  return{envelopeId,status:completed?'completed':'sent'};
 },document:async()=>new TextEncoder().encode('%PDF-1.7\nSynthetic test artifact, no legal effect.')};
 const sign=createSigning(env,store,provider);
 try{
  await t.step('configuration, verified identity, and organization ownership are required',async()=>{
   assert.equal(signingEnabled({...env,API_LEGAL_APPROVED:'false'}),false);
   await assert.rejects(createSigning({...env,API_LEGAL_APPROVED:'false'},store,provider)(user,org.id,{signer_name:'Test'}),e=>e.code==='agreement_review_required');
   await assert.rejects(sign({...user,email_confirmed_at:null},org.id,{signer_name:'Test'}),e=>e.code==='verified_email_required');
   await assert.rejects(sign({...user,id:stranger},org.id,{signer_name:'Other'}),/Owner required/);
  });
  await t.step('simultaneous starts create one provider envelope, with reusable signing view',async()=>{
   const outcomes=await Promise.allSettled(Array.from({length:20},()=>sign(user,org.id,{signer_name:'Synthetic Person'})));
   assert.ok(outcomes.some(r=>r.status==='fulfilled'));assert.equal(creates,1);
   assert.ok((await sign(user,org.id,{signer_name:'Synthetic Person'})).url);
   assert.equal(creates,1);
  });
  await t.step('a return URL cannot mark an unfinished agreement as signed',async()=>{
   assert.equal((await sign(user,org.id,{action:'status'})).completed,false);
   assert.equal((await db.pool.query('select count(*)::int n from b2b_private.agreements')).rows[0].n,0);
  });
  await t.step('provider completion archives the PDF and signature atomically, duplicate callbacks are safe',async()=>{
   completed=true;const responses=await Promise.all(Array.from({length:5},()=>sign(user,org.id,{action:'status'})));
   assert.ok(responses.every(x=>x.completed));
   assert.equal((await db.pool.query('select count(*)::int n from b2b_private.agreements')).rows[0].n,1);
   assert.equal((await db.pool.query('select count(*)::int n from b2b_private.agreement_documents')).rows[0].n,1);
   const state=await store.account('dashboard',actor,org.id);assert.equal(state.agreements[0].provider,'docusign');assert.equal(state.agreements[0].document_reference,undefined);
   const access=await db.pool.query("select has_table_privilege('authenticated','b2b_private.agreement_documents','SELECT') allowed");assert.equal(access.rows[0].allowed,false);
  });
  await t.step('a lost provider acknowledgment is recovered without another envelope',async()=>{
   const retryOrg=await store.account('create',actor,null,{name:'Signing retry',legal_name:'Synthetic',email:user.email,intended_use:'Recovery test',plan:'developer'});
   let posts=0;const recovered=crypto.randomUUID();
   const retryProvider={...provider,json:async(path:string,method='GET')=>{
    if(path==='envelopes'&&method==='POST'){posts++;throw new Error('Lost provider acknowledgment');}
    if(path.startsWith('envelopes?transaction_ids='))return{envelopes:[{envelopeId:recovered}]};
    return{url:'https://demo.docusign.net/signing/recovered'};
   }};
   const retry=createSigning(env,store,retryProvider);
   await assert.rejects(retry(user,retryOrg.id,{signer_name:'Synthetic Person'}),/Lost provider acknowledgment/);
   await db.pool.query("update b2b_private.signing_sessions set lease_until=now()-interval '1 second' where organization_id=$1",[retryOrg.id]);
   assert.ok((await retry(user,retryOrg.id,{signer_name:'Synthetic Person'})).url);assert.equal(posts,1);
  });
 }finally{await db.close();}
}});
