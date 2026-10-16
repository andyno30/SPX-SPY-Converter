const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {runInNewContext}=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const pages=['','pricing','docs','dashboard','terms'];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('B2B navigation never appears in an existing website page or script',()=>{
 const original=JSON.parse(fs.readFileSync(path.join(root,'scripts/b2b-api/evidence/original-files-sha256.json'),'utf8'));
 for(const name of Object.keys(original).filter(n=>/\.(html|js|css)$/.test(n))){
  const current=fs.readFileSync(path.join(root,name),'utf8');
  const before=execFileSync('git',['show',`1201ef5:${name}`],{cwd:root,encoding:'utf8'});
  assert.deepEqual(current.match(/B2B\/api/gi)||[],before.match(/B2B\/api/gi)||[],name);
 }
});
async function windowFor(page){
 const {Window}=await import(pathToFileURL(require.resolve('happy-dom')).href);
 const win=new Window({url:`http://127.0.0.1:8799/B2B/api/${page}/`,settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableJavaScriptEvaluation:true}});
 win.document.write(fs.readFileSync(path.join(root,'B2B/api',page,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
 return win;
}
test('all five isolated pages preserve native assets, internal routes and launch disclosures',async()=>{
 for(const page of pages){const w=await windowFor(page);try{
  const d=w.document;assert.equal(d.querySelectorAll('main').length,1);assert.equal(d.querySelectorAll('h1').length,1);
  assert.ok(d.querySelector('meta[name=viewport]'));assert.match(d.querySelector('meta[name=robots]').content,/noindex/);
  assert.ok(d.querySelector('link[href="/styles.css"]'));assert.ok(d.querySelector('img[src="/Images/spyconverter-logo.png"]'));
  assert.equal(d.querySelectorAll('.api-nav a').length,5);
  for(const a of d.querySelectorAll('a[href^="/B2B/"]')){const url=new URL(a.href);const p=path.join(root,url.pathname);assert.ok(fs.existsSync(p),url.pathname);}
  assert.match(d.body.textContent,page==='terms'?/Not an active agreement/:page==='pricing'?/unavailable access cannot be purchased/:/synthetic|Synthetic/);
 }finally{await w.happyDOM.close();}}
});
test('both pricing displays contain exactly the approved monthly tiers',async()=>{
 for(const page of ['','pricing']){const w=await windowFor(page);try{
  const cards=[...w.document.querySelectorAll('.price-card')];assert.equal(cards.length,3);
  for(const [i,price,quota,rpm] of [[0,25,'10,000',10],[1,50,'100,000',30],[2,150,'500,000',120]]){
   const text=cards[i].textContent;assert.ok(text.includes(`$${price}/month`));assert.ok(text.includes(`${quota} requests/month`));assert.ok(text.includes(`${rpm} requests/minute`));
  }
  assert.match(cards[2].textContent,/Custom review required/);
 }finally{await w.happyDOM.close();}}
});
async function dashboard(role='owner',options={}){
 const w=await windowFor('dashboard'),org='d603d247-cc2f-4254-9809-8f87c16ec21e';
 if(options.query)w.location.search=options.query;
 const state={role,organization:{name:'<img src=x onerror=alert(1)>',legal_name:'Synthetic',email:'test@example.test',business_approved:false},subscription:{plan:'developer',status:'active'},usage:{used:5,quota:10000,remaining:9995,per_minute:10},applications:[],agreements:[],keys:[],members:[],daily_usage:[],history:[]};
 Object.assign(state.subscription,options.subscription||{});
 if(options.signedOut!==true)w.sessionStorage.setItem('sc-b2b-demo-token','synthetic-session');w.sessionStorage.setItem('sc-b2b-demo-user',JSON.stringify({email:'test@example.test'}));
 const key='sc_test_'+'a'.repeat(64),calls=[];
 const fetch=async(url,opts={})=>{calls.push({url,opts});const p=new URL(url).pathname;return Response.json(p==='/platform/config'?{plans:{developer:{name:'Developer',cents:2500}}}:p==='/platform/organizations'?{organizations:[{id:org,name:'Synthetic'}]}:p==='/platform/dashboard'?state:p==='/platform/keys'?{key,record:{}}:{error:{message:'Unexpected synthetic request'}});};
 const source=fs.readFileSync(path.join(root,'B2B/api/assets/app.js'),'utf8').replace(/^import .*\n/,'');
 const context={API_ORIGIN:'',document:w.document,location:w.location,sessionStorage:w.sessionStorage,Node:w.Node,FormData:w.FormData,URL,fetch,Response,navigator:w.navigator,confirm:()=>true,setTimeout:()=>0,console};
 await runInNewContext(`(async()=>{${source}})()`,context);await flush();
 return{w,state,key,calls,el:id=>w.document.getElementById(id)};
}
test('dashboard renders account state safely and reveals generated keys only until dismissed',async()=>{
 const s=await dashboard();try{
  assert.equal(s.el('metric-used').textContent,'5');assert.equal(s.el('metric-remaining').textContent,'9,995');assert.equal(s.el('workspace').hidden,false);
  assert.equal(s.el('organization-details').querySelector('img'),null);assert.ok(s.el('organization-details').textContent.includes('<img'));
  const form=s.el('key-form');form.elements.label.value='Synthetic test';form.elements.mode.value='test';
  form.dispatchEvent(new s.w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('button')}));await flush();await flush();
  assert.equal(s.el('new-key-value').textContent,s.key);assert.equal(s.el('key-reveal').hidden,false);
  for(let i=0;i<s.w.sessionStorage.length;i++)assert.ok(!s.w.sessionStorage.getItem(s.w.sessionStorage.key(i)).includes(s.key));
  s.el('dismiss-key').click();assert.equal(s.el('new-key-value').textContent,'');assert.equal(s.el('key-reveal').hidden,true);
  s.w.document.querySelector('[data-panel="usage"]').click();assert.equal(s.w.document.querySelector('[data-section="usage"]').hidden,false);
 }finally{await s.w.happyDOM.close();}
});
test('member dashboard disables organization mutations and billing controls',async()=>{
 const s=await dashboard('member');try{for(const id of ['key-form','member-form','upgrade-form'])for(const el of s.el(id).elements)assert.equal(el.disabled,true);assert.equal(s.el('checkout').disabled,true);assert.equal(s.el('portal').disabled,true);}finally{await s.w.happyDOM.close();}
});

test('checkout return requires authenticated verified payment, handles pending/cancelled, and labels sandbox payments',async()=>{
 for(const scenario of [
  {query:'?checkout=complete',signedOut:true,title:'Confirm your subscription',status:'pending'},
  {query:'?checkout=complete',subscription:{status:'pending'},title:'Confirming your subscription',status:'pending'},
  {query:'?checkout=complete',subscription:{status:'active',stripe_subscription_id:'sub_synthetic',paid_through:new Date(Date.now()+86400000).toISOString(),livemode:true},title:'Payment confirmed',status:'confirmed'},
  {query:'?checkout=complete',subscription:{status:'active',stripe_subscription_id:'sub_synthetic',paid_through:new Date(Date.now()+86400000).toISOString(),livemode:false},title:'Test payment confirmed',status:'confirmed'},
  {query:'?checkout=cancelled',title:'Checkout cancelled',status:'cancelled'},
 ]){const s=await dashboard('owner',scenario);try{
  assert.equal(s.el('checkout-confirmation').hidden,false);assert.equal(s.el('confirmation-title').textContent,scenario.title);assert.equal(s.el('checkout-confirmation').dataset.state,scenario.status);
  if(scenario.signedOut)assert.equal(s.calls.filter(c=>c.url.includes('/platform/dashboard')).length,0);
 }finally{await s.w.happyDOM.close();}}
});
