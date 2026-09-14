const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const flush = () => new Promise(resolve => setImmediate(resolve));
const contracts = [
  {contract:'ESZ26',symbol:'ESZ26.CME',label:'December 2026 (ESZ26)'},
  {contract:'ESH27',symbol:'ESH27.CME',label:'March 2027 (ESH27)'},
];
const payload = (contract='AUTO', es=contract==='AUTO'?7600:contract==='ESZ26'?7670:7740) => ({
  Prices:{SPX:7600,SPY:760,ES:es,NQ:28000,NDX:29000,QQQ:700},
  'SPX/SPY Ratio':10,'ES/SPY Ratio':es/760,'ES/SPX Ratio':es/7600,
  'NQ/QQQ Ratio':40,'NDX/QQQ Ratio':29000/700,
  Datetime:'2026-09-14T13:30:00Z',ESSelection:contract,ESContract:contract==='AUTO'?'ESU26':contract,
  ESSymbol:contract==='AUTO'?'ES=F':`${contract}.CME`,ESContracts:contracts,
  ESQuote:{timestamp:'2026-09-14T13:18:00Z',delayMinutes:10},
});
async function setup() {
  const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
  const win = new Window();
  win.document.body.innerHTML = readFileSync(path.join(__dirname,'../docs/premium-feature.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
  let fetcher = async contract => payload(contract);
  const context = {document:win.document,window:{},Option:function(text,value){const o=win.document.createElement('option');o.textContent=text;o.value=value;return o;},AbortController,console,
    fetchProPrices:(...args)=>fetcher(...args),setInterval:()=>0};
  const script=readFileSync(path.join(__dirname,'../docs/pro_script.js'),'utf8').replace(/^import .*\n/,'');
  runInNewContext(script,context); await flush();
  const el=id=>win.document.getElementById(id);
  const select=async (id,value)=>{el(id).value=value;el(id).dispatchEvent(new win.Event('change'));await flush();};
  return {win,context,el,select,setFetch:fn=>fetcher=fn,update:()=>runInNewContext('updateProRatios()',context)};
}
test('Auto and explicit selection immediately recalculate both ES conversions without changing unrelated ratios or To',async()=>{
  const s=await setup();
  try {
    assert.equal(s.el('es-contract-status').textContent,''); assert.equal(s.el('es-contract-status').hidden,true);
    await s.select('from-ticker','ES');await s.select('to-ticker','SPY');s.el('convert-input').value='7600';s.context.window.convertPremium();
    assert.match(s.el('convert-output').textContent,/SPY: 760\.00000000/);
    const nq=s.el('ratio-nq-qqq').textContent;
    await s.select('es-contract','ESZ26');
    assert.equal(s.el('to-ticker').value,'SPY'); assert.equal(s.el('ratio-es-spy').textContent,(7670/760).toFixed(8));
    assert.match(s.el('convert-output').textContent,new RegExp((7600/(7670/760)).toFixed(8)));
    assert.equal(s.el('es-contract-status').textContent,''); assert.equal(s.el('es-contract-status').hidden,true);
    await s.select('to-ticker','SPX');await s.select('es-contract','ESH27');
    assert.equal(s.el('ratio-es-spx').textContent,(7740/7600).toFixed(8));
    assert.match(s.el('convert-output').textContent,new RegExp((7600/(7740/7600)).toFixed(8)));
    assert.equal(s.el('ratio-nq-qqq').textContent,nq);
    await s.select('es-contract','AUTO');assert.equal(s.el('ratio-es-spy').textContent,'10.00000000');
  } finally { await s.win.happyDOM.close(); }
});
test('Contract-only responses preserve base prices even across a new backend snapshot',async()=>{
  const s=await setup();try {
    s.setFetch(async c=>({...payload(c),Prices:{...payload(c).Prices,SPY:800,SPX:8000,NQ:30000},'SPX/SPY Ratio':11,'NQ/QQQ Ratio':50}));
    await s.select('es-contract','ESZ26');
    assert.equal(s.el('ratio-es-spy').textContent,(7670/760).toFixed(8));assert.equal(s.el('ratio-spx-spy').textContent,'10.00000000');
    assert.equal(s.el('ratio-nq-qqq').textContent,'40.00000000');
  } finally {await s.win.happyDOM.close();}
});
test('Rapid switches ignore late responses and unavailable contracts cannot reuse Auto or previous ES',async()=>{
  const s=await setup();try {
    const pending={};s.setFetch(c=>new Promise(resolve=>pending[c]=resolve));
    await s.select('from-ticker','ES');await s.select('to-ticker','SPY');s.el('convert-input').value='7600';
    await s.select('es-contract','ESZ26');assert.equal(s.el('ratio-es-spy').textContent,'N/A');
    assert.match(s.el('convert-output').textContent,/Loading December/);
    await s.select('es-contract','ESH27');pending.ESH27(payload('ESH27'));await flush();pending.ESZ26(payload('ESZ26'));await flush();
    assert.equal(s.el('es-contract').value,'ESH27'); assert.equal(s.el('es-contract-status').hidden,true);assert.equal(s.el('ratio-es-spy').textContent,(7740/760).toFixed(8));
    s.setFetch(async()=>{throw Error('Unavailable');});await s.select('es-contract','ESZ26');
    assert.equal(s.el('ratio-es-spy').textContent,'N/A');assert.match(s.el('convert-output').textContent,/ES quote unavailable/);
    s.setFetch(async()=>payload('AUTO'));await s.select('es-contract','ESH27');
    assert.equal(s.el('ratio-es-spy').textContent,'N/A');assert.match(s.el('es-contract-status').textContent,/requested ES contract was not returned/);
  } finally {await s.win.happyDOM.close();}
});
test('Periodic refresh keeps selected conversion and contract; old Auto payload remains compatible',async()=>{
  const s=await setup();try {
    await s.select('from-ticker','ES');await s.select('to-ticker','SPY');await s.select('es-contract','ESZ26');s.el('convert-input').value='7600';
    s.setFetch(async c=>payload(c,7800));await s.update();
    assert.equal(s.el('to-ticker').value,'SPY');assert.equal(s.el('es-contract').value,'ESZ26');assert.match(s.el('convert-output').textContent,/ESZ26/);
    s.setFetch(async()=>{const p=payload();for(const key of Object.keys(p))if(key.startsWith('ES'))delete p[key];return p;});
    await s.select('es-contract','AUTO');assert.equal(s.el('ratio-es-spy').textContent,'10.00000000');assert.equal(s.el('es-contract').options.length,1);
  } finally {await s.win.happyDOM.close();}
});
function apiContext(session, statuses=[200]) {
  const calls=[];let refreshed=0;
  const context={URL,Error,window:{location:{href:''}},supabase:{auth:{
    getSession:async()=>({data:{session},error:null}),refreshSession:async()=>{refreshed++;return {data:{session:{access_token:'renewed'}},error:null};}
  }},fetch:async(url,opts)=>{calls.push({url:String(url),...opts});const status=statuses.shift()||200;return {status,ok:status===200,json:async()=>status===200?payload('ESZ26'):{message:'Denied'}};}};
  const script=readFileSync(path.join(__dirname,'../docs/pro_prices_api.js'),'utf8').replace(/^import .*\n/,'').replace('export async function','async function');
  runInNewContext(script,context);
  return {context,calls,refreshed:()=>refreshed,request:()=>runInNewContext("fetchProPrices('ESZ26')",context)};
}
test('Pricing API sends session, refreshes expired tokens once, redirects missing/non-Pro sessions',async()=>{
  let s=apiContext({access_token:'existing'},[401,200]);await s.request();
  assert.equal(s.calls[0].headers.Authorization,'Bearer existing');assert.equal(s.calls[1].headers.Authorization,'Bearer renewed');assert.equal(s.refreshed(),1);
  assert.match(s.calls[0].url,/esContract=ESZ26/);assert.equal(s.calls[0].cache,'no-store');
  s=apiContext(null);await assert.rejects(s.request());assert.equal(s.calls.length,0);assert.equal(s.context.window.location.href,'login.html');
  s=apiContext({access_token:'free'},[403]);await assert.rejects(s.request());assert.equal(s.context.window.location.href,'dashboard.html');
  s=apiContext({access_token:'bad'},[401,401]);await assert.rejects(s.request());assert.equal(s.refreshed(),1);assert.equal(s.context.window.location.href,'login.html');
});
