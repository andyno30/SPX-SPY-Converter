const {test}=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),vm=require('node:vm');
const {Window}=require('happy-dom');
const flush=()=>new Promise(r=>setImmediate(r));
test('all 16 Free calculation handlers await a server result and preserve their output formatting',async()=>{
 let count=0;
 for(const file of ['index.html','converter.html','EStoSPX.html','RUSSELL2000andDOW.html']){
  const s=readFileSync(file,'utf8'),win=new Window();let calls=0;
  const ctx={document:win.document,parseFloat,isNaN,Number,FreeCalculator:{calculate:async(a,b,op)=>{calls++;return op==='divide'?a/b:a*b;}},ratio:10.03214930,formatConvertedValue:v=>Number.isFinite(v)?v.toFixed(2):'N/A'};
  for(const m of s.matchAll(/let (\w+) = \/\* [^*]+ \*\/ ([\d.]+)/g))ctx[m[1]]=Number(m[2]);
  for(const m of s.matchAll(/(?<indent> +)async function (?<name>convert\w+)\(\) \{(?<body>.*?)\n\k<indent>\}/gs)){
   const b=m.groups.body,ids=[...new Set([...b.matchAll(/getElementById\("([^"]+)"\)/g)].map(x=>x[1]))];
   for(const id of ids){if(!win.document.getElementById(id)){const e=win.document.createElement(id.endsWith('Input')||id.includes('Input')?'input':'div');e.id=id;e.value='123.45';win.document.body.append(e);}}
   vm.runInNewContext(m[0],ctx);const before=calls;await ctx[m.groups.name]();assert.equal(calls,before+1,file+' '+m.groups.name);
   const output=win.document.getElementById(ids[ids.length-1]);assert.match(output.innerText||output.innerHTML,/: -?[\d.]+$/);count++;
   const old=ctx.FreeCalculator;ctx.FreeCalculator={calculate:async()=>{throw Error('Please wait');}};await ctx[m.groups.name]();assert.equal(output.innerText,'Please wait');ctx.FreeCalculator=old;
  }
  assert.match(s,/free-calculations.js\?v=20261016/);await win.happyDOM.close();
 }
 assert.equal(count,16);
});
function setup(verifyOk=true){const win=new Window({url:'https://spyconverter.com'});let options,calls=[];
 win.turnstile={render:(_,o)=>{options=o;return 'widget';},remove:()=>{},reset:()=>{}};
 const ctx={window:win,document:win.document,Promise,Error,JSON,AbortSignal,fetch:async(url,init)=>{const b=JSON.parse(init.body);calls.push(b);assert.equal(url,'https://api.spyconverter.com/v1/website/free-calculations');return calls.length===1?{status:429,ok:false,json:async()=>({code:'HUMAN_VERIFICATION_REQUIRED',sitekey:'fixture',challenge:'nonce'})}:b.action==='verify'?{status:verifyOk?200:429,ok:verifyOk,json:async()=>({verified:verifyOk})}:{status:200,ok:true,json:async()=>({value:12.34})};}};
 vm.runInNewContext(readFileSync('free-calculations.js','utf8'),ctx);return{win,calls,options:()=>options};}
test('challenge only after server denial, retry only after server-verified success',async()=>{const s=setup();try{assert.equal(s.win.document.querySelector('dialog'),null);const p=s.win.FreeCalculator.calculate(123.4,10,'divide');await flush();assert.equal(s.options().action,'free-calculations');await Promise.all([s.options().callback('synthetic'),s.options().callback('synthetic')]);assert.equal(await p,12.34);assert.deepEqual(s.calls.map(x=>x.action),['calculate','verify','calculate']);assert.equal(s.win.document.querySelector('dialog'),null);}finally{await s.win.happyDOM.close();}});
test('failed verification or cancel never retries calculation or uses local math',async()=>{for(const cancel of [false,true]){const s=setup(false);try{const p=s.win.FreeCalculator.calculate(123.4,10,'divide');const rejection=assert.rejects(p);await flush();if(cancel)s.win.document.querySelector('button').click();else await s.options().callback('bad');await rejection;assert.equal(s.calls.filter(c=>c.action==='calculate').length,1);}finally{await s.win.happyDOM.close();}}});
test('manual ratios, source schedules and pre-existing numerical output remain identical on all Free pages',async()=>{
 const {execFileSync}=require('node:child_process');
 for(const file of ['index.html','converter.html','EStoSPX.html','RUSSELL2000andDOW.html']){
  const before=execFileSync('git',['show','05fbc33:'+file],{encoding:'utf8'}),after=readFileSync(file,'utf8');
  const ratios=s=>[...s.matchAll(/let (\w+) = \/\* [^*]+ \*\/ ([\d.]+)/g)].map(m=>[m[1],Number(m[2])]);assert.deepEqual(ratios(after),ratios(before));
  assert.deepEqual([...after.matchAll(/setInterval\([^;]+|fetch\([^\n]+/g)].map(m=>m[0]),[...before.matchAll(/setInterval\([^;]+|fetch\([^\n]+/g)].map(m=>m[0]));
  const win1=new Window(),win2=new Window(),base={parseFloat,isNaN,Number,ratio:10.03214930,formatConvertedValue:v=>Number.isFinite(v)?v.toFixed(2):'N/A',...Object.fromEntries(ratios(after))};
  const original={...base,document:win1.document},updated={...base,document:win2.document,FreeCalculator:{calculate:async(a,b,op)=>op==='multiply'?a*b:a/b}};
  const originals=[...before.matchAll(/(?<indent> +)function (?<name>convert\w+)\(\) \{(?<body>.*?)\n\k<indent>\}/gs)],updates=[...after.matchAll(/(?<indent> +)async function (?<name>convert\w+)\(\) \{(?<body>.*?)\n\k<indent>\}/gs)];assert.equal(originals.length,updates.length);
  for(let i=0;i<originals.length;i++){
   const m=originals[i],ids=[...new Set([...m.groups.body.matchAll(/getElementById\("([^"]+)"\)/g)].map(m=>m[1]))];
   for(const win of [win1,win2])for(const id of ids){if(!win.document.getElementById(id)){const e=win.document.createElement('div');e.id=id;win.document.body.append(e);}}
   vm.runInNewContext(m[0],original);vm.runInNewContext(updates[i][0],updated);
   for(const input of ['0','-123.45','7000','0.0001','']){
    for(const win of [win1,win2])win.document.getElementById(ids[0]).value=input;
    original[m.groups.name]();await updated[m.groups.name]();
    const output=w=>{const e=w.document.getElementById(ids[ids.length-1]);return e.innerText||e.innerHTML;};assert.equal(output(win1),output(win2),file+' '+m.groups.name+' '+input);
   }
  }
  await win1.happyDOM.close();await win2.happyDOM.close();
 }
});
