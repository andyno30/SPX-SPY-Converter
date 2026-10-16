import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../../supabase/b2b-api/app.mjs';
import {createStore} from '../../supabase/b2b-api/database.mjs';
import {ApiError,keyHash} from '../../supabase/b2b-api/core.mjs';
const require=createRequire(import.meta.url);
const {createLocalDatabase}=require('../../scripts/b2b-api/local-database.cjs');

Deno.test({name:'automatic first-key provisioning is authorized, atomic and shown once',sanitizeResources:false,sanitizeOps:false,fn:async()=>{
 const db=await createLocalDatabase('provisioning');
 try{
  const owner=crypto.randomUUID(),stranger=crypto.randomUUID();
  await db.pool.query('insert into auth.users values($1),($2)',[owner,stranger]);
  const store=createStore(async(n,a)=>{try{return await db.rpc(n,a);}catch(e){if(e.code==='42501')throw new ApiError(403,'forbidden','Denied');throw e;}});
  const org=await store.account('create',owner,null,{name:'Synthetic',legal_name:'Synthetic LLC',email:'test@example.test',intended_use:'Tests',plan:'business'});
  const env={API_ENVIRONMENT:'test',API_LOCAL_ONLY:'true',API_SYNTHETIC_TEST_MODE:'true',API_LEGAL_APPROVED:'true',API_AGREEMENT_VERSION:'test-v1',API_KEY_PEPPER:'synthetic-test-only-pepper-over-32-chars'};
  const app=createApp({env,store,billing:{},resolveUser:async r=>({id:r.headers.get('authorization')==='Bearer owner'?owner:stranger})});
  const provision=()=>app(new Request('http://127.0.0.1/platform/keys/provision',{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({organization_id:org.id})}));
  assert.deepEqual(await(await provision()).json(),{created:false});
  await db.pool.query("update b2b_private.subscriptions set status='active',period_start=now()-interval '1 day',period_end=now()+interval '29 days',paid_through=now()+interval '29 days' where organization_id=$1",[org.id]);
  assert.deepEqual(await(await provision()).json(),{created:false});
  await db.pool.query("update b2b_private.organizations set business_approved=true where id=$1",[org.id]);
  assert.deepEqual(await(await provision()).json(),{created:false});
  await db.pool.query("insert into b2b_private.agreements(organization_id,version,signer_id,signer_email,signed_at,provider,envelope_id,document_sha256,document_reference) values($1,'test-v1',$2,'test@example.test',now(),'synthetic-test',$3,$4,'private:synthetic.pdf')",[org.id,owner,crypto.randomUUID(),'a'.repeat(64)]);
  env.API_LEGAL_APPROVED='false';assert.deepEqual(await(await provision()).json(),{created:false});env.API_LEGAL_APPROVED='true';
  const responses=await Promise.all(Array.from({length:32},provision));
  assert.equal(responses.filter(r=>r.status===201).length,1);
  const bodies=await Promise.all(responses.map(r=>r.json()));
  const result=bodies.find(b=>b.created);assert.match(result.key,/^sc_test_[a-f0-9]{64}$/);
  assert.equal(bodies.filter(b=>b.key).length,1);
  const records=(await db.pool.query('select * from b2b_private.keys where organization_id=$1',[org.id])).rows;
  assert.equal(records.length,1);assert.equal(records[0].key_hash,await keyHash(result.key,env.API_KEY_PEPPER));
  assert.ok(!JSON.stringify(await store.account('dashboard',owner,org.id)).includes(result.key));
  await store.account('key.revoke',owner,org.id,{key_id:result.record.id});
  assert.deepEqual(await(await provision()).json(),{created:false});
  const denied=await app(new Request('http://127.0.0.1/platform/keys/provision',{method:'POST',headers:{Authorization:'Bearer stranger','Content-Type':'application/json'},body:JSON.stringify({organization_id:org.id})}));assert.equal(denied.status,403);
  env.API_ENVIRONMENT='production';assert.deepEqual(await(await provision()).json(),{created:false});
 }finally{await db.close();}
}});
