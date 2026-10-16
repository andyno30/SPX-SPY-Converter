import assert from 'node:assert/strict';
import worker from '../../supabase/b2b-api/gateway-worker.mjs';
Deno.test('Cloudflare gateway fails closed with JSON and never exposes a CAPTCHA or origin secret',async()=>{
 const absent=await worker.fetch(new Request('https://api.spyconverter.com/v1/conversions'),{});assert.equal(absent.status,401);
 const validShape=new Request('https://api.spyconverter.com/v1/conversions',{headers:{Authorization:'Bearer sc_live_'+'a'.repeat(64)}});
 const unavailable=await worker.fetch(validShape,{});assert.equal(unavailable.status,503);assert.match(unavailable.headers.get('content-type')!,/application\/json/);
 const oldFetch=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'https://isvzhpqrmjtqnqyyidxr.supabase.co/functions/v1/b2b-platform/v1/conversions');assert.equal(init.headers.get('X-B2B-Gateway'),'synthetic-secret');return new Response('{"Prices":{"SPX":7.000001,"SPY":null}}',{headers:{'Content-Type':'application/json','X-Snapshot-Id':'fixture'}});};
  const response=await worker.fetch(validShape,{B2B_GATEWAY_SECRET:'synthetic-secret'});assert.equal(await response.text(),'{"Prices":{"SPX":7.000001,"SPY":null}}');assert.equal(response.headers.get('X-B2B-Gateway'),null);assert.equal(calls,1);
  globalThis.fetch=async()=>new Response('<html>Challenge</html>',{headers:{'Content-Type':'text/html'}});
  const blocked=await worker.fetch(validShape,{B2B_GATEWAY_SECRET:'synthetic-secret'});assert.equal(blocked.status,503);assert.equal((await blocked.json()).error.code,'origin_unavailable');
 }finally{globalThis.fetch=oldFetch;}
});
