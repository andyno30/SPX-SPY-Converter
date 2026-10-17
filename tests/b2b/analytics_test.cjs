const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {runInNewContext}=require('node:vm');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'B2B/api/assets/analytics.js'),'utf8');
const pages=['','pricing','docs','dashboard','terms'];
async function setup(page='dashboard',options={}) {
  const {Window}=await import(pathToFileURL(require.resolve('happy-dom')).href);
  const url=options.url||`https://spyconverter.com/B2B/api/${page? page+'/':''}?organization_id=private-org&email=private@example.test&code=private-code#access_token=private-token`;
  const w=new Window({url,settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableJavaScriptEvaluation:true}});
  const html=fs.readFileSync(path.join(root,'B2B/api',page,'index.html'),'utf8');
  w.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
  Object.defineProperty(w.document,'referrer',{value:options.referrer??'https://referrer.example/private-person?email=private@example.test#secret'});
  if(options.gpc)Object.defineProperty(w.navigator,'globalPrivacyControl',{value:true});
  if(options.dnt)Object.defineProperty(w.navigator,'doNotTrack',{value:'1'});
  if(options.optOut)w['ga-disable-G-2M5FE2EC3Q']=true;
  const context={window:w,document:w.document,location:w.location,navigator:w.navigator,URL};
  const run=()=>runInNewContext(source,context);
  const events=()=>JSON.parse(JSON.stringify(Array.from(w.dataLayer||[],x=>Array.from(x))));
  run();return{w,html,run,events};
}
test('all five B2B pages load the existing measurement ID once with sanitized page metadata',async()=>{
  for(const page of pages){const s=await setup(page);try{
    const canonical=`https://spyconverter.com/B2B/api/${page?page+'/':''}`;
    assert.equal((s.html.match(/assets\/analytics\.js\?v=/g)||[]).length,1);
    const config=s.events().find(e=>e[0]==='config');
    assert.equal(config[1],'G-2M5FE2EC3Q');assert.equal(config[2].page_location,canonical);
    assert.equal(config[2].page_referrer,'https://referrer.example/');assert.equal(config[2].content_group,'B2B API');
    assert.equal(config[2].allow_google_signals,false);assert.equal(config[2].allow_ad_personalization_signals,false);
    assert.equal(config[2].send_page_view,true);
    const payload=JSON.stringify(s.events());assert.doesNotMatch(payload,/private-org|private@example|private-code|private-token|private-person|secret/);
    assert.equal(s.events().some(e=>e[0]==='event'&&e[1]==='purchase'),false);
    s.run();assert.equal(s.events().filter(e=>e[0]==='config').length,1);
    assert.equal(s.w.document.querySelectorAll('script[src*="googletagmanager.com"]').length,1);
  }finally{await s.w.happyDOM.close();}}
});
test('tracking stays off for previews, unrelated paths and browser privacy opt-outs',async()=>{
  for(const options of [{url:'http://127.0.0.1:8799/B2B/api/dashboard/'},{url:'https://preview.example/B2B/api/dashboard/'},{url:'https://spyconverter.com/'},{gpc:true},{dnt:true},{optOut:true}]){
    const s=await setup('dashboard',options);try{assert.deepEqual(s.events(),[]);assert.equal(s.w.document.querySelectorAll('script').length,0);}finally{await s.w.happyDOM.close();}
  }
});
test('pricing selection records only an allowed plan and does not intercept navigation',async()=>{
  const s=await setup('pricing');try{
    const links=[...s.w.document.querySelectorAll('a[data-b2b-plan]')];assert.equal(links.length,3);
    for(const link of links){const e=new s.w.MouseEvent('click',{bubbles:true,cancelable:true});link.dispatchEvent(e);assert.equal(e.defaultPrevented,false);}
    const selected=s.events().filter(e=>e[0]==='event');assert.deepEqual(selected.map(e=>e[2].plan),['developer','pro','business']);
    assert.ok(selected.every(e=>e[1]==='b2b_plan_selected'&&e[2].send_to==='G-2M5FE2EC3Q'));
    links[0].dataset.b2bPlan='private@example.test';links[0].dispatchEvent(new s.w.MouseEvent('click'));assert.equal(s.events().filter(e=>e[0]==='event').length,3);
    assert.doesNotMatch(JSON.stringify(s.events()),/private@example|private-token/);
  }finally{await s.w.happyDOM.close();}
});
test('checkout return does not count as a purchase and private dashboard DOM is never included',async()=>{
  const s=await setup('dashboard',{url:'https://spyconverter.com/B2B/api/dashboard/?checkout=complete&organization_id=private-org#access_token=private-token',referrer:'https://checkout.stripe.com/c/pay/private-session'});try{
    s.w.document.getElementById('new-key-value').textContent='sc_live_private-key';
    s.w.document.getElementById('account-email').textContent='private@example.test';
    s.w.document.getElementById('auth-form').dispatchEvent(new s.w.Event('submit',{bubbles:true}));
    assert.equal(s.events().filter(e=>e[0]==='event').length,0);
    assert.equal(s.events().find(e=>e[0]==='config')[2].page_referrer,'https://checkout.stripe.com/');
    assert.doesNotMatch(JSON.stringify(s.events()),/private-|private@|sc_live_/);
  }finally{await s.w.happyDOM.close();}
});
