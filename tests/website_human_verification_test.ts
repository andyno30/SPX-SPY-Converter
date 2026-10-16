import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createWebsiteHumanGuard,createWebsiteVerification} from '../supabase/functions/_shared/website-human-verification.ts';
import {createRequestHandler} from '../supabase/functions/get-live-price-pro/request.ts';
const require=createRequire(import.meta.url),{createLocalDatabase}=require('../scripts/b2b-api/local-database.cjs');
Deno.test({name:'Website human verification is atomic, identity-bound and independent of B2B/updaters',sanitizeResources:false,sanitizeOps:false,fn:async t=>{
 const db=await createLocalDatabase('human');
 try{
  await db.pool.query(await Deno.readTextFile('supabase/sql/website_human_verification.sql'));
  const user=crypto.randomUUID(),other=crypto.randomUUID();await db.pool.query('insert into auth.users(id) values($1),($2)',[user,other]);
  const control=async(id:string,action:string,challenge?:string,success=false)=>(await db.pool.query('select public.website_pro_human_control($1,$2,$3,$4) r',[id,action,challenge||null,success])).rows[0].r;
  await t.step('disabled is backward compatible; public callers cannot forge verification',async()=>{
   assert.equal((await control(user,'consume')).allowed,true);
   const c=await db.pool.connect();try{for(const role of ['anon','authenticated']){await c.query('set role '+role);await assert.rejects(c.query('select public.website_pro_human_control($1,\'finish\',null,true)',[user]));await c.query('reset role');}}finally{await c.query('reset role');c.release();}
  });
  await db.pool.query('update website_security.control set enabled=true');
  const guard=createWebsiteHumanGuard(control,'synthetic-sitekey');let challenge:string;
  await t.step('30 concurrent requests pass; excess gets JSON challenge, separate users remain independent',async()=>{
   const results=await Promise.all(Array.from({length:70},()=>guard(user)));
   assert.equal(results.filter(r=>r===null).length,30);const denied=results.filter(Boolean) as Response[];
   const bodies=await Promise.all(denied.map(r=>{assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'60');return r.json();}));
   assert.equal(new Set(bodies.map(b=>b.challenge)).size,1);challenge=bodies[0].challenge;assert.equal(bodies[0].code,'HUMAN_VERIFICATION_REQUIRED');assert.equal(await guard(other),null);
  });
  let network=0;const now=Date.now();let result:any={success:true,hostname:'spyconverter.com',action:'pro-prices',cdata:challenge!,challenge_ts:new Date(now).toISOString()};
  const verify=createWebsiteVerification({secret:'synthetic-secret',control,authorize:async token=>token==='valid'?user:token==='other'?other:null,now:()=>now,fetcher:async(input:any)=>{network++;assert.equal(String(input),'https://challenges.cloudflare.com/turnstile/v0/siteverify');return Response.json(result);}});
  const request=(extra:any={},token='valid',origin='https://spyconverter.com')=>new Request('https://fixture/verify',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({challenge,response:'synthetic-single-use-token',...extra})});
  await t.step('wrong origin, forged identity, cross-user challenge and malformed requests cannot reach Siteverify',async()=>{
   assert.equal((await verify(request({},'valid','https://evil.example'))).status,403);
   assert.equal((await verify(request({},'bad'))).status,401);
   assert.equal((await verify(request({},'other'))).status,429);
   assert.equal((await verify(request({response:'x'.repeat(2049)}))).status,400);
   assert.equal(network,0);
  });
  await t.step('wrong hostname and replay fail; successful verification permits only bounded retries',async()=>{
   result.hostname='evil.example';assert.equal((await verify(request({success:true}))).status,400);assert.equal((await guard(user))!.status,429);
   result.hostname='spyconverter.com';assert.equal((await verify(request())).status,200);
   assert.equal((await verify(request())).status,429);assert.equal(network,2);
   const retry=await Promise.all(Array.from({length:40},()=>guard(user)));assert.equal(retry.filter(r=>r===null).length,30);
   for(const r of retry.filter(Boolean) as Response[]){assert.equal((await r.json()).code,'RATE_LIMITED');assert.ok(Number(r.headers.get('Retry-After'))>0);}
   assert.equal((await db.pool.query('select cardinality(admitted_at) n from website_security.pro_visitors where user_id=$1',[user])).rows[0].n,60);
  });
  await t.step('expired clearance and malformed verification fail closed; no market-data fetch exists',async()=>{
   await db.pool.query("update website_security.pro_visitors set verified_until=now()-interval '1 second',admitted_at=admitted_at[1:30] where user_id=$1",[user]);
   const b=await(await guard(user))!.json();challenge=b.challenge;result.cdata=challenge;result.challenge_ts=new Date(now-300001).toISOString();assert.equal((await verify(request())).status,400);
   result.challenge_ts=new Date(now).toISOString();result.action='other';assert.equal((await verify(request())).status,400);
   result.action='pro-prices';result.cdata=crypto.randomUUID();assert.equal((await verify(request())).status,400);
   assert.equal((await verify(request())).status,429);assert.equal((await(await guard(user))!.json()).code,'RATE_LIMITED');
  });
 }finally{await db.close();}
}});
Deno.test('Pro guard runs only after existing authentication and never bypasses hard quotas or alters JSON',async()=>{
 let human=0,quota=0;let challenge=false;const now=Date.now();const snapshot={is_subscribed:true,quotes:[{symbol:'SPY',regularMarketPrice:600},{symbol:'^GSPC',regularMarketPrice:6000}],fetched_at:new Date(now).toISOString()};
 const original={userId:async(t:string)=>t==='valid'?'verified':null,readAccessSnapshot:async()=>snapshot,now:()=>now};
 const app=createRequestHandler({...original,humanCheck:async(id)=>{assert.equal(id,'verified');human++;return challenge?Response.json({code:'HUMAN_VERIFICATION_REQUIRED'},{status:429}):null;},consumeQuota:async()=>{quota++;return{allowed:true,retryAfterSeconds:0};}});
 const req=(token='valid')=>new Request('https://fixture/prices',{headers:{Authorization:'Bearer '+token}});
 assert.equal((await app(req('invalid'))).status,401);assert.equal(human,0);assert.equal(quota,0);
 assert.equal(await(await app(req())).text(),await(await createRequestHandler(original)(req())).text());assert.equal(quota,1);
 challenge=true;assert.equal((await app(req())).status,429);assert.equal(quota,1);
});
