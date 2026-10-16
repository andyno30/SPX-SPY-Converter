const {test}=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),vm=require('node:vm');
const {Window}=require('happy-dom');
const source=readFileSync('docs/human-verification.js','utf8').replace(/^export /gm,'');
const flush=()=>new Promise(r=>setImmediate(r));
function setup(result={verified:true}){
 const win=new Window({url:'https://spyconverter.com/docs/premium-feature.html'});let options,removed=0,calls=[];
 win.turnstile={render:(el,o)=>{options=o;return 'fixture';},remove:()=>removed++,reset:()=>{}};
 const ctx={window:win,document:win.document,DOMException,Error,Promise,fetch:async(url,init)=>{calls.push({url,init});return{ok:result.verified===true,json:async()=>result};}};
 vm.runInNewContext(source+'\nthis.verify=verifyWebsiteHuman;',ctx);
 return{win,ctx,calls,options:()=>options,removed:()=>removed,challenge:{sitekey:'fixture-site',challenge:'fixture-nonce'}};
}
test('challenge shows only on demand, validates server-side, and closes after confirmed success',async()=>{
 const s=setup();try{
  assert.equal(s.win.document.querySelector('dialog'),null);
  const p=s.ctx.verify(s.challenge,async()=> 'fixture-jwt');await flush();
  assert.match(s.win.document.querySelector('dialog').textContent,/Verify you are human/);
  assert.equal(s.options().action,'pro-prices');assert.equal(s.options().cData,'fixture-nonce');
  await s.options().callback('fixture-token');await p;
  assert.equal(s.calls.length,1);assert.equal(s.calls[0].url,'https://isvzhpqrmjtqnqyyidxr.supabase.co/functions/v1/website-verification');
  assert.equal(s.calls[0].init.headers.Authorization,'Bearer fixture-jwt');assert.deepEqual(JSON.parse(s.calls[0].init.body),{challenge:'fixture-nonce',response:'fixture-token'});
  assert.equal(s.win.document.querySelector('dialog'),null);assert.equal(s.removed(),1);
 }finally{await s.win.happyDOM.close();}
});
test('cancel, changed identity and unsuccessful verification never grant a retry',async()=>{
 for(const mode of ['cancel','identity','invalid']){
  const s=setup({code:'VERIFICATION_FAILED'});try{
   const p=s.ctx.verify(s.challenge,async()=>mode==='identity'?null:'fixture');const rejected=assert.rejects(p);await flush();
   if(mode==='cancel')s.win.document.querySelector('button').click();else await s.options().callback('fixture-token');
   await rejected;assert.equal(s.calls.length,mode==='invalid'?1:0);assert.equal(s.win.document.querySelector('dialog'),null);
  }finally{await s.win.happyDOM.close();}
 }
});
test('price API retries once after verified challenge and never changes normal responses or polling',async()=>{
 let calls=0,verifications=0;const session={access_token:'fixture',user:{id:'same-user'}};
 const ctx={URL,Error,window:{location:{href:''}},supabase:{auth:{getSession:async()=>({data:{session}})}},premiumRequestCooldown:{begin:async()=>({}),completeProbe:async()=>{},responseError:async()=>null},verifyWebsiteHuman:async(body,getToken)=>{verifications++;assert.equal(body.challenge,'nonce');assert.equal(await getToken(),'fixture');},fetch:async()=>{calls++;return calls===1?{status:429,ok:false,json:async()=>({code:'HUMAN_VERIFICATION_REQUIRED',challenge:'nonce'})}:{status:200,ok:true,json:async()=>({Prices:{SPY:600},'SPX/SPY Ratio':10})};}};
 vm.runInNewContext(readFileSync('docs/pro_prices_api.js','utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,''),ctx);
 const body=await vm.runInNewContext('fetchProPrices()',ctx);assert.equal(body['SPX/SPY Ratio'],10);assert.equal(calls,2);assert.equal(verifications,1);
});
