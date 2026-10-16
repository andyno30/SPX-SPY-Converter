import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createFreeCalculator} from '../supabase/functions/_shared/free-calculations.ts';
import gateway from '../supabase/b2b-api/gateway-worker.mjs';
const require=createRequire(import.meta.url),{createLocalDatabase}=require('../scripts/b2b-api/local-database.cjs');
Deno.test({name:'Free calculations: exact atomic 10/minute, verification, 20/minute ceiling, failed block, no Yahoo',sanitizeResources:false,sanitizeOps:false,fn:async t=>{
 const db=await createLocalDatabase('free');let network=0;
 try{
  await db.pool.query(await Deno.readTextFile('supabase/sql/website_human_verification.sql'));
  await db.pool.query(await Deno.readTextFile('supabase/sql/website_free_calculations.sql'));
  await db.pool.query('update website_security.control set free_enabled=true');
  const id='a'.repeat(64),other='b'.repeat(64),control=async(id:string,action:string,challenge?:string,success=false)=>(await db.pool.query('select public.website_free_human_control($1,$2,$3,$4) r',[id,action,challenge||null,success])).rows[0].r;
  let valid=true,challenge='';
  const app=createFreeCalculator({gatewaySecret:'synthetic',turnstileSecret:'synthetic',sitekey:'synthetic',control,fetcher:async(input:any)=>{network++;assert.equal(String(input),'https://challenges.cloudflare.com/turnstile/v0/siteverify');return Response.json({success:valid,hostname:'spyconverter.com',action:'free-calculations',cdata:challenge,challenge_ts:new Date().toISOString()});}});
  const req=(body:any={action:'calculate',amount:7000,ratio:10.03214930,operation:'divide'},who=id,secret='synthetic')=>new Request('https://fixture',{method:'POST',headers:{origin:'https://spyconverter.com','x-b2b-gateway':secret,'x-free-visitor':who},body:JSON.stringify(body)});
  await t.step('direct-origin and forged RPC cannot bypass controls',async()=>{
   assert.equal((await app(req(undefined,id,''))).status,403);
   const c=await db.pool.connect();try{for(const role of ['anon','authenticated']){await c.query('set role '+role);await assert.rejects(c.query("select public.website_free_human_control($1,'finish',null,true)",[id]));await c.query('reset role');}}finally{await c.query('reset role');c.release();}
  });
  await t.step('concurrent load admits exactly ten; same network shares nonce, other network independent',async()=>{
   const rs=await Promise.all(Array.from({length:100},()=>app(req())));assert.equal(rs.filter(r=>r.status===200).length,10);
   const bodies=await Promise.all(rs.filter(r=>r.status===429).map(r=>r.json()));assert.equal(new Set(bodies.map(b=>b.challenge)).size,1);challenge=bodies[0].challenge;
   assert.equal((await app(req(undefined,other))).status,200);assert.equal(network,0);
   assert.equal((await rs.find(r=>r.status===200)!.json()).value,7000/10.03214930);
  });
  await t.step('forged cross-network challenge fails; verified result gives only ten more; duplicate completion reuses existing clearance',async()=>{
   const body={action:'verify',challenge,response:'synthetic'};
   assert.equal((await app(req(body,other))).status,429);assert.equal(network,0);
   assert.equal((await app(req(body))).status,200);assert.equal(network,1);
   assert.equal((await app(req(body))).status,200);assert.equal(network,1);
   const rs=await Promise.all(Array.from({length:30},()=>app(req())));assert.equal(rs.filter(r=>r.status===200).length,10);
   assert.equal((await rs.find(r=>r.status===429)!.json()).code,'RATE_LIMITED');
  });
  await t.step('rolling window resets, clearance expires, failed verification immediately blocks',async()=>{
   await db.pool.query("update website_security.free_visitors set admitted_at='{}',verified_until=now()-interval '1 second' where visitor_id=$1",[id]);
   for(let i=0;i<10;i++)assert.equal((await app(req())).status,200);
   challenge=(await(await app(req())).json()).challenge;valid=false;
   assert.equal((await app(req({action:'verify',challenge,response:'bad'}))).status,429);
   const blocked=await app(req());assert.equal(blocked.status,429);assert.equal((await blocked.json()).code,'RATE_LIMITED');assert.ok(Number(blocked.headers.get('retry-after'))>290);
   assert.equal(network,2);
  });
  await t.step('calculation values and manual ratio updates retained; zero price requests',async()=>{
   for(const operation of ['multiply','divide']){const r=await app(req({action:'calculate',amount:123.45,ratio:41.36962095,operation},other));assert.equal((await r.json()).value,operation==='multiply'?123.45*41.36962095:123.45/41.36962095);}
   assert.equal(network,2);assert.equal((await db.pool.query('select count(*)::int n from website_security.pro_visitors')).rows[0].n,0);
  });
 }finally{await db.close();}
}});
Deno.test('Free Cloudflare gateway binds trusted IP, ignores spoofed identities, groups IPv6 /64; B2B unchanged',async()=>{
 const before=globalThis.fetch;const ids:string[]=[];
 try{
  globalThis.fetch=async(input,options:any)=>{assert.equal(String(input),'https://isvzhpqrmjtqnqyyidxr.supabase.co/functions/v1/website-free-calculations');ids.push(options.headers.get('x-free-visitor'));assert.equal(options.headers.get('x-forwarded-for'),null);return Response.json({value:1});};
  for(const ip of ['2001:db8:1:2::1','2001:db8:1:2:ffff::2','2001:db8:1:3::1']){
   const r=await gateway.fetch(new Request('https://api.spyconverter.com/v1/website/free-calculations',{method:'POST',headers:{origin:'https://spyconverter.com','cf-connecting-ip':ip,'x-free-visitor':'forged','x-forwarded-for':'forged'},body:'{}'}),{B2B_GATEWAY_SECRET:'synthetic'});assert.equal(r.status,200);
  }
  assert.match(ids[0],/^[a-f0-9]{64}$/);assert.equal(ids[0],ids[1]);assert.notEqual(ids[0],ids[2]);
  assert.equal((await gateway.fetch(new Request('https://api.spyconverter.com/v1/conversions'),{B2B_GATEWAY_SECRET:'synthetic'})).status,401);
 }finally{globalThis.fetch=before;}
});
