// Local-only manual browser fixture. No production requests or credentials.
// Run: node tests/helpers/premium_frontend_fixture.cjs [port]
// Open /docs/dow-russell-feature.html, /docs/premium-feature.html,
// /docs/spx-spy-overlap-chart.html, or /options/?ticker=QQQ in multiple tabs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const pages = {
  '/docs/dow-russell-feature.html': '/docs/dow_russell_script.js',
  '/docs/premium-feature.html': '/docs/pro_script.js',
  '/docs/spx-spy-overlap-chart.html': '/fixture-chart.js',
  '/options/': '/options/options.js',
};
const methods = {
  '/docs/dow_russell_script.js': 'updateDowRussellRatios',
  '/docs/pro_script.js': 'updateProRatios',
  '/options/options.js': 'loadData',
  '/fixture-chart.js': 'fetchLivePoint',
};
const auth = `export const supabase = {
  auth: { getSession: async () => ({data:{session:globalThis.fixtureSession()},error:null}),
    refreshSession: async () => ({data:{session:globalThis.fixtureSession()},error:null}),
    getUser: async () => ({data:{user:globalThis.fixtureSession().user},error:null}) },
  from: () => { const q={select:()=>q,eq:()=>q,single:async()=>({data:{is_subscribed:true}}),maybeSingle:async()=>({data:{is_subscribed:true}})}; return q; }
};`;
const bootstrap = `
const realNow=Date.now;
Date.now=()=>realNow()+Number(localStorage.getItem('fixture:clock-offset')||0);
globalThis.fixtureSession=()=>({access_token:'local-fixture-only',user:{id:sessionStorage.getItem('fixture:user')||'fixture-user-a'}});
let calls=0;
const panel=document.createElement('aside');panel.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#fff3cd;color:#111;padding:10px;z-index:999999;border-top:2px solid #111;font:14px sans-serif';
panel.innerHTML='<b>LOCAL FIXTURE — no production calls</b> <label>Response <select id="fixture-mode"><option>200</option><option>429</option><option>503</option></select></label> <label>Retry-After <input id="fixture-retry" value="120" size="8"></label> <label>Account <select id="fixture-user"><option value="fixture-user-a">A</option><option value="fixture-user-b">B</option></select></label> <button id="fixture-poll">Simulate normal poll</button> <button id="fixture-advance">Advance clock 60s (all tabs)</button> <button id="fixture-reset">Reset fixture storage + reload</button> <output id="fixture-calls"></output>';
document.body.append(panel);document.body.style.paddingBottom='120px';
const mode=document.getElementById('fixture-mode');mode.value=sessionStorage.getItem('fixture:mode')||'200';
mode.onchange=()=>sessionStorage.setItem('fixture:mode',mode.value);
const user=document.getElementById('fixture-user');user.value=fixtureSession().user.id;
user.onchange=()=>sessionStorage.setItem('fixture:user',user.value);
document.getElementById('fixture-poll').onclick=()=>globalThis.fixtureRefresh();
document.getElementById('fixture-advance').onclick=()=>localStorage.setItem('fixture:clock-offset',String(Number(localStorage.getItem('fixture:clock-offset')||0)+60000));
document.getElementById('fixture-reset').onclick=()=>{for(const k of Object.keys(localStorage))if(k.startsWith('fixture:')||k.startsWith('spyconverter:premium-cooldown:'))localStorage.removeItem(k);sessionStorage.clear();location.reload();};
globalThis.fetch=async(input)=>{
  const url=new URL(input,location.href);
  if(!url.pathname.includes('contact-for-licencing')&&!url.pathname.includes('fetch-spy-options'))throw Error('Fixture blocked unexpected network request');
  const ticker=url.searchParams.get('ticker')||'SPY';const isOptions=url.pathname.includes('fetch-spy-options');
  const status=isOptions&&ticker==='SPY'?200:Number(mode.value);
  document.getElementById('fixture-calls').textContent='API calls in this tab: '+(++calls)+'; last HTTP '+status;
  const es=url.searchParams.get('esContract')||'AUTO';
  const payload=isOptions?{symbol:ticker,currentPrice:500,maxPain:495,source:'LOCAL FIXTURE',updatedAt:new Date(Date.now()).toISOString()}:{Prices:{SPX:6000,SPY:600,ES:6050,NQ:24000,NDX:25000,QQQ:600,DJI:44000,DIA:440,YM:44100,RUT:2200,IWM:220,RTY:2210},'SPX/SPY Ratio':10,'NQ/QQQ Ratio':40,'NDX/QQQ Ratio':25000/600,Datetime:new Date(Date.now()).toISOString(),ESSelection:es,ESContract:es,ESSymbol:es+'.CME',ESContracts:[{contract:'ESZ26',label:'December 2026 (ESZ26)'}]};
  return new Response(JSON.stringify(status===200?payload:{code:status===429?'RATE_LIMITED':'QUOTA_UNAVAILABLE'}),{status,headers:{'Content-Type':'application/json','Retry-After':document.getElementById('fixture-retry').value}});
};
`;
function chartScript() {
  const html = fs.readFileSync(path.join(root, 'docs/spx-spy-overlap-chart.html'), 'utf8');
  return [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(text => text.includes('async function fetchLivePoint'))
    .replaceAll("from './", "from '/docs/");
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'");
  if (pathname === '/') {res.writeHead(200, {'Content-Type':'text/html'});res.end(Object.keys(pages).map(p=>`<p><a href="${p}${p==='/options/'?'?ticker=QQQ':''}">${p}</a></p>`).join(''));return;}
  if (pathname === '/docs/auth.js') {res.writeHead(200, {'Content-Type':'text/javascript'});res.end(auth);return;}
  if (pathname === '/fixture-bootstrap.js') {res.writeHead(200, {'Content-Type':'text/javascript'});res.end(bootstrap);return;}
  if (pages[pathname]) {
    const file = pathname === '/options/' ? 'options/index.html' : pathname.slice(1);
    let html = fs.readFileSync(path.join(root,file),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
    html = html.replace('</body>',`<script src="/fixture-bootstrap.js"></script><script type="module" src="${pages[pathname]}"></script></body>`);
    res.writeHead(200, {'Content-Type':'text/html'});res.end(html);return;
  }
  const filename = path.resolve(root, '.' + pathname);
  if (!filename.startsWith(root + path.sep) || (!/\.(css|js|png|ico|svg)$/.test(pathname))) {res.writeHead(404);res.end();return;}
  try {
    let body = pathname === '/fixture-chart.js' ? chartScript() : fs.readFileSync(filename);
    if (methods[pathname]) body = String(body) + `\nglobalThis.fixtureRefresh = ${methods[pathname]};\n`;
    res.setHeader('Content-Type', pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.svg')?'image/svg+xml':pathname.endsWith('.png')?'image/png':'image/x-icon');
    res.end(body);
  } catch {res.writeHead(404);res.end();}
});
if (require.main === module) server.listen(Number(process.argv[2]||4177),'127.0.0.1',()=>console.log('Local fixture: http://127.0.0.1:'+server.address().port));
module.exports = { server };
