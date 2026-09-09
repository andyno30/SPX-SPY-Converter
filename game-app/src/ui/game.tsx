'use client';
import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {AssetResolver} from '../game/engine/assets';
import {meets,type Element} from '../game/engine/model';
import {validateCampaign} from '../game/adventure/registry';
import {AdventureSession,BrowserAdventureStore,mapFor,visibleTargets,distance,type Command} from '../game/adventure/session';
import {currentQuest,currentStep,playerStats,type AdventureState} from '../game/adventure/state';
import {isReady,type BattleAction} from '../game/adventure/combat';
import type {Campaign} from '../game/adventure/schema';
import type {WorldView} from './world';

type Panel='Mission'|'Inventory'|'Magic'|'Pets'|'Character'|'Settings'|'Nearby'|null;
function Meter({label,value,max,color}:{label:string;value:number;max:number;color:string}){return <span className="meter" aria-label={`${label} ${value} of ${max}`}><i style={{width:`${max?Math.min(100,value/max*100):0}%`,background:color}}/><span>{label} {value} / {max}</span></span>;}
function downloadBackup(store:BrowserAdventureStore,state:AdventureState){
  const blob=new Blob([store.export(state)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='arpia-adventure.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function RestoreBackup({store,c,current,onRestore}:{store:BrowserAdventureStore;c:Campaign;current:AdventureState|null;onRestore:(state:AdventureState)=>void}){
  const [candidate,setCandidate]=useState<(ReturnType<BrowserAdventureStore['prepareImport']>&{raw:string;filename:string})|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const pick=async(file:File)=>{
    setCandidate(null);setError('');setBusy(true);
    try{if(file.size>2_000_000)throw new Error('Choose a save backup smaller than 2 MB');const raw=await file.text();setCandidate({...store.prepareImport(raw),raw,filename:file.name});}
    catch(e){setError('Unable to read this backup: '+(e as Error).message);}finally{setBusy(false);}
  };
  const restore=async()=>{
    if(!candidate)return;setBusy(true);setError('');
    try{const state=await store.import(candidate.raw,candidate.expectedRaw);setCandidate(null);onRestore(state);}
    catch(e){setError((e as Error).message+' Select the backup again to review the latest saved progress.');}
    finally{setBusy(false);}
  };
  return <details className="backup-restore"><summary>Restore a save backup</summary>
    <label>Save backup file<input type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void pick(file);e.target.value='';}}/></label>
    {candidate&&<section aria-label="Review save backup"><h3>{candidate.state.save.character.name} · Level {candidate.state.save.character.level}</h3>
      <p>{c.maps.find(m=>m.id===candidate.state.save.world.mapId)?.name}</p><p className="small">{candidate.filename} · {Object.values(candidate.state.save.quests).filter(q=>q.completed).length} missions complete</p>
      <p>This replaces the adventure saved in this browser.</p><div className="settings-actions">
        {current&&<button disabled={busy} onClick={()=>downloadBackup(store,current)}>Back up current adventure</button>}
        <button disabled={busy} onClick={()=>void restore()}>Restore as {candidate.state.save.character.name}</button><button disabled={busy} onClick={()=>setCandidate(null)}>Cancel</button>
      </div></section>}
    {error&&<p role="alert" className="error">{error}</p>}
  </details>;
}
function nextPortal(s:AdventureState,c:Campaign,mapId:string):string|undefined{
  if(s.save.world.mapId===mapId)return;
  const seen=new Set<string>(),queue=[{id:s.save.world.mapId,first:''}];
  while(queue.length){const node=queue.shift()!;if(seen.has(node.id))continue;seen.add(node.id);
    if(node.id===mapId)return node.first;
    const m=c.maps.find(m=>m.id===node.id)!;
    for(const p of m.portals)if(p.conditions.every(x=>meets(s.save,x))&&(!p.element||p.element===s.save.character.element))queue.push({id:p.toMapId,first:node.first||p.id});
  }
}
export default function Game({data,manifest}:{data:unknown;manifest:unknown}){
  const assets=useMemo(()=>new AssetResolver(manifest),[manifest]);
  const c=useMemo(()=>validateCampaign(data,assets.manifest),[data,assets]);
  const store=useMemo(()=>new BrowserAdventureStore(c),[c]);
  const [session,setSession]=useState<AdventureSession|null>(null),[saved,setSaved]=useState<AdventureState|null>(null),[loaded,setLoaded]=useState(false);
  const [error,setError]=useState(''),[name,setName]=useState(''),[element,setElement]=useState<Exclude<Element,'NONE'>>('FLAME'),[sex,setSex]=useState<'male'|'female'>('female');
  const [creating,setCreating]=useState(false),[startBusy,setStartBusy]=useState(false);
  useEffect(()=>{void store.load().then(s=>{setSaved(s);setLoaded(true);}).catch(e=>{setError('Unable to read the saved adventure: '+e.message);setLoaded(true);});},[store]);
  const origin=c.origins.find(o=>o.element===element)!;
  const begin=async()=>{setStartBusy(true);try{const state=await store.create(c,name,element,sex);setSession(new AdventureSession(c,state,store));setError('');}catch(e){setError((e as Error).message);}finally{setStartBusy(false);}};
  const leave=async()=>{if(!session)return;try{await session.dispatch({type:'SAVE'});setSaved(session.state);setSession(null);}catch(e){setError((e as Error).message);}};
  return <div className="arpia-page">
    <div className="page-top"><span>Arpia · English reconstruction</span><span>Local playtest · Episodes 0–{Math.max(...c.quests.map(q=>q.episodeNumber??0))}</span></div>
    {!session?<main className="title-screen">
      <div className="title-castle" aria-hidden="true">✦</div><p className="title-kicker">The school of magic awaits</p><h1>Magic School <strong>Arpia</strong></h1>
      {!creating?<div className="title-actions">
        <p>Choose a homeland, meet your teachers, and begin your first adventure.</p>
        {saved?<button className="primary" disabled={!loaded} onClick={()=>{try{setSession(new AdventureSession(c,saved,store));setError('');}catch(e){setError((e as Error).message);}}}>Continue as {saved.save.character.name}</button>:<button className="primary" disabled={!loaded||!!error} onClick={()=>setCreating(true)}>Enter the school</button>}
        {saved&&<p className="small">Level {saved.save.character.level} · {c.maps.find(m=>m.id===saved.save.world.mapId)?.name}</p>}
        <RestoreBackup store={store} c={c} current={saved} onRestore={state=>{setSaved(state);setError('');}}/>
      </div>:<form className="creation" onSubmit={e=>{e.preventDefault();void begin();}}>
        <fieldset><legend>Your homeland</legend><div className="origin-choices">{c.origins.map(o=><button type="button" className={element===o.element?'chosen':''} aria-pressed={element===o.element} key={o.element} onClick={()=>setElement(o.element as typeof element)}><img alt="" src={assets.resolve(sex==='male'?o.maleAssetId:o.femaleAssetId)}/><strong>{o.name}</strong><span>{o.element==='FLAME'?'Strong and spirited':o.element==='ICE'?'Gifted in magic':'A balanced beginning'}</span></button>)}</div></fieldset>
        <div className="creation-options"><label>Student name<input value={name} maxLength={24} minLength={1} required autoComplete="off" onChange={e=>setName(e.target.value)}/></label><fieldset><legend>Appearance</legend><label><input type="radio" checked={sex==='female'} onChange={()=>setSex('female')}/> Girl</label><label><input type="radio" checked={sex==='male'} onChange={()=>setSex('male')}/> Boy</label></fieldset></div>
        <div className="form-actions"><button type="button" onClick={()=>setCreating(false)}>Back</button><button className="primary" disabled={startBusy||!name.trim()}>Begin as a {origin.name} student</button></div>
      </form>}
      {error&&<p role="alert" className="error">{error}</p>}
      <p className="title-note">A playable restoration study. English dialogue, artwork, map layouts, and battle values are newly authored where the original is undocumented. Progress saves in this browser.</p>
    </main>:<Play session={session} assets={assets} leave={()=>void leave()} store={store}/>}
    <p className="page-foot">Independent reconstruction · Original study artwork · No connection to an official game service</p>
  </div>;
}
function Play({session,assets,leave,store}:{session:AdventureSession;assets:AssetResolver;leave:()=>void;store:BrowserAdventureStore}){
  const [,redraw]=useState(0),[panel,setPanel]=useState<Panel>(null),[uiError,setUIError]=useState(''),[context,setContext]=useState<string|null>(null),[scale,setScale]=useState(1);
  const [phrase,setPhrase]=useState('');
  const host=useRef<HTMLDivElement>(null),shell=useRef<HTMLDivElement>(null),world=useRef<WorldView|null>(null);
  const c=session.campaign,s=session.state,quest=currentQuest(s,c),step=currentStep(s,c),map=mapFor(s,c),stats=playerStats(s,c);
  useEffect(()=>session.subscribe(()=>redraw(n=>n+1)),[session]);
  useEffect(()=>{const timer=setInterval(()=>session.tick(),100);return()=>clearInterval(timer);},[session]);
  useEffect(()=>{let cancelled=false;void import('./world').then(({createWorld})=>{if(!cancelled&&host.current)world.current=createWorld(host.current,session,assets,setUIError,setContext);}).catch(e=>setUIError('Unable to open the game world: '+e.message));return()=>{cancelled=true;world.current?.destroy();world.current=null;};},[session,assets]);
  useEffect(()=>{const element=shell.current;if(!element)return;const resize=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width??960;setScale(Math.min(1,width/960));});resize.observe(element);return()=>resize.disconnect();},[]);
  const send=async(command:Command)=>{try{setUIError('');await session.dispatch(command);}catch(e){setUIError((e as Error).message);}};
  const approach=(id:string)=>{setPanel(null);setContext(id);world.current?.approach(id);};
  const targets=visibleTargets(s,c),hint=step&&(step.mapId===map.id?targets.find(t=>t.id===step.targetId):targets.find(t=>t.id===nextPortal(s,c,step.mapId)));
  const dialogue=s.dialogue&&c.dialogue.find(d=>d.id===s.dialogue!.id),line=dialogue?.lines[s.dialogue!.line],speaker=line&&c.actors.find(a=>a.id===line.speakerId);
  const services=context&&!s.dialogue&&!s.battle?c.services.filter(x=>x.actorId===context&&x.mapId===map.id&&x.conditions.every(p=>meets(s.save,p))&&distance(s.save.world,map.npcs.find(n=>n.actorId===x.actorId)!.position)<=1):[];
  const backup=()=>downloadBackup(store,session.state);
  return <main className="play-layout">
    <div className="game-wrap" ref={shell} style={{height:640*scale}}>
      <div className="game-frame" style={{transform:`scale(${scale})`} as CSSProperties}>
        <div ref={host} className="canvas-host" role="img" aria-label={`${map.name}. Use Nearby to choose a person or destination, or click in the scene to walk.`}/>
        {!s.battle&&<>
          <div className="quest-note"><span>Current mission</span><strong>{quest?.name??'A little time at school'}</strong><p>{step?.label??'Available missions complete. Visit teachers, train your pets, or explore the school.'}</p>{hint&&<button disabled={session.busy||!!s.dialogue} onClick={()=>approach(hint.id)}>{step?.mapId===map.id?'Find ':'Go via '}{hint.name} →</button>}</div>
          <button className="location-plaque" onClick={()=>setPanel('Nearby')}><svg className="minimap" viewBox="0 0 170 86" aria-label="Minimap with your position and nearby destinations"><path d="M12 34 76 6 158 45 95 77Z" fill="#75959a" stroke="#d4d4ae"/>{targets.map(t=><circle key={t.id} cx={76+(t.position.x-t.position.y)*4.4} cy={5+(t.position.x+t.position.y)*2.2} r={t.kind==='PORTAL'?3:2} fill={t.kind==='PORTAL'?'#b4dcf4':'#f8d683'}/>)}<circle cx={76+(s.save.world.x-s.save.world.y)*4.4} cy={5+(s.save.world.x+s.save.world.y)*2.2} r="3.5" fill="white" stroke="#3a6573"/></svg>{map.name}<small>Map & nearby</small></button>
          <div className="world-tip">Click to walk · Click a character to talk · Arrow keys to move</div>
        </>}
        {s.battle&&<BattleUI session={session} assets={assets} send={send}/>}
        <div className="bottom-hud">
          <div className="student-portrait"><img src={assets.resolve(s.save.character.appearanceId)} alt=""/></div>
          <div className="student-stats"><strong>{s.save.character.name} <small>Lv. {s.save.character.level}</small></strong><span className="rank">{s.save.character.element.toLowerCase()} · {s.save.character.rank.toLowerCase()}</span><Meter label="HP" value={s.battle?.units.find(u=>u.role==='PLAYER')?.hp??s.hp} max={stats.hp} color="#ba5651"/><Meter label="MP" value={s.battle?.units.find(u=>u.role==='PLAYER')?.mp??s.mp} max={stats.mp} color="#558fc2"/></div>
          <div className="toolbar">{(['Character','Inventory','Magic','Pets','Mission','Nearby','Settings'] as const).map((p,i)=><button key={p} disabled={!!s.dialogue||!!s.battle} className={panel===p?'active':''} onClick={()=>{setContext(null);setPanel(panel===p?null:p);}}><span aria-hidden="true">{['♙','▣','✧','♧','▤','⌖','⚙'][i]}</span>{p}</button>)}</div>
          <div className="purse"><span>◈ {s.save.currencies.pin} Pin</span><span>✦ {s.save.currencies.virtuePoints} Virtue</span><small>{session.busy?'Saving…':'Saved · revision '+s.save.revision}</small></div>
        </div>
        {line&&<section className="dialogue-box" aria-label="Conversation" aria-live="polite">
          {speaker?<img className="dialogue-portrait" alt={speaker.name} src={assets.resolve(speaker.portraitAssetId)}/>:line.speakerId==='player'?<img className="dialogue-portrait" alt="Your student" src={assets.resolve(s.save.character.appearanceId)}/>:<div className="dialogue-star">✧</div>}
          <div className="dialogue-copy"><h2>{speaker?.name??(line.speakerId==='player'?s.save.character.name:'Arpia')}</h2><p>{line.text}</p><button autoFocus disabled={session.busy} className="next-dialogue" onClick={()=>void send({type:'NEXT_DIALOGUE'})}>{s.dialogue!.line+1===dialogue!.lines.length?'Continue':'Next'} ▷</button><small>{s.dialogue!.line+1} / {dialogue!.lines.length}</small></div>
        </section>}
        {panel&&!s.battle&&!s.dialogue&&<section role="dialog" aria-modal="false" aria-labelledby="panel-title" className="game-window"><div className="window-title"><h2 id="panel-title">{panel}</h2><button aria-label="Close window" onClick={()=>setPanel(null)}>×</button></div><div className="window-body">
          {panel==='Nearby'&&<><p>{map.name} · Select a destination to walk there.</p><div className="nearby-list">{targets.map(t=><button key={t.id} onClick={()=>approach(t.id)}><span>{t.kind==='PORTAL'?'↗':t.kind==='NPC'?'♙':t.kind==='BATTLE'?'⚔':'◇'}</span>{t.name}<small>{t.kind.toLowerCase()}</small></button>)}</div></>}
          {panel==='Mission'&&<><h3>{quest?.name??'Available missions complete'}</h3><p>{quest?.summary??'You have finished the currently playable missions. Later episodes remain under reconstruction.'}</p><ol className="mission-steps">{quest?.steps.map((st,i)=><li key={st.id} className={i<(s.save.quests[quest.id]?.stepIndex??0)?'done':st.id===step?.id?'current':''}>{st.label}{st.id===step?.id&&<small>{c.maps.find(m=>m.id===st.mapId)?.name}</small>}</li>)}</ol><h3>Completed</h3>{c.quests.filter(q=>s.save.quests[q.id]?.completed).map(q=><p key={q.id}>✓ {q.name}</p>)}<p className="small">Mission sequence is reconstructed from surviving accounts. Dialogue, geometry, rewards, and combat balance are restoration choices.</p></>}
          {panel==='Inventory'&&<div className="item-list">{Object.entries(s.save.inventory).filter(([,n])=>n>0).map(([id,n])=>{const item=c.items.find(i=>i.id===id)!;return <article key={id}><img src={assets.resolve(item.assetId)} alt=""/><div><h3>{item.name} × {n}</h3><p>{item.description}</p></div>{item.slot?<button disabled={session.busy} onClick={()=>void send({type:'EQUIP',itemId:id})}>{Object.values(s.save.equipment).includes(id)?'Equipped':'Equip'}</button>:['HP','MP'].includes(item.kind)?<button disabled={session.busy} onClick={()=>void send({type:'USE_ITEM',itemId:id})}>Use</button>:<span>Mission item</span>}</article>;})}</div>}
          {panel==='Magic'&&<><p>Teachers offer lessons at school. Three lessons raise proficiency by one.</p><div className="item-list">{Object.entries(s.save.spells).filter(([,n])=>n>0).map(([id,n])=>{const sp=c.spells.find(x=>x.id===id)!;return <article key={id}><img src={assets.resolve(sp.assetId)} alt=""/><div><h3>{sp.name}</h3><p>{sp.mpCost} MP · Proficiency {n} · {sp.element.toLowerCase()}</p></div></article>;})}</div></>}
          {panel==='Pets'&&<><p>Up to two pets travel and fight with you. Visit Pelita for training.</p>{!s.save.pets.length&&<p>You will meet your first pet during Episode 1.</p>}<div className="item-list">{s.save.pets.map(p=>{const d=c.pets.find(x=>x.id===p.definitionId)!;return <article key={p.id}><img src={assets.resolve(p.level>=d.evolutionLevel?d.evolvedAssetId:d.spriteAssetId)} alt=""/><div><h3>{d.name}{p.level>=d.evolutionLevel?' · Evolved':''}</h3><p>Level {p.level} / {d.maxLevel} · Affinity {p.affinity}</p></div><button disabled={session.busy} onClick={()=>void send({type:'TOGGLE_PET',petId:p.id})}>{s.save.activePetIds.includes(p.id)?'Rest':'Join party'}</button></article>;})}</div></>}
          {panel==='Character'&&<><h3>{s.save.character.name}</h3><p>Level {s.save.character.level} · {s.save.character.rank.toLowerCase()} · {s.save.character.exp} / {s.save.character.level*50} EXP</p><dl className="stats-grid">{Object.entries(stats).map(([k,v])=><div key={k}><dt>{k.replace(/([A-Z])/g,' $1')}</dt><dd>{v}</dd></div>)}</dl><h3>Equipment</h3>{Object.entries(s.save.equipment).map(([slot,id])=><p key={slot}>{slot}: {c.items.find(i=>i.id===id)?.name} <button onClick={()=>void send({type:'UNEQUIP',slot:slot as Extract<Command,{type:'UNEQUIP'}>['slot']})}>Remove</button></p>)}<p className="small">Numerical values are temporary restoration balance, not recovered original statistics.</p></>}
          {panel==='Settings'&&<><h3>Your adventure</h3><p>Progress is stored on this browser and device. Story actions save automatically. Use Save & exit to keep your latest walking position. The title screen lets you restore a downloaded backup.</p><div className="settings-actions"><button disabled={session.busy} onClick={()=>void send({type:'SAVE'})}>Save now</button><button onClick={backup}>Download save backup</button><button disabled={session.busy} onClick={leave}>Save & exit</button><button disabled={session.busy} onClick={()=>void session.reload().catch(e=>setUIError(e.message))}>Reload saved progress</button></div><p className="small">Audio is not yet restored. This local build includes Episodes 0–{Math.max(...c.quests.map(q=>q.episodeNumber??0))}, original study artwork, and newly written English dialogue. Cloud saves and accounts are not enabled.</p></>}
        </div></section>}
        {context&&step?.type==='TYPE_PHRASE'&&step.targetId===context&&!s.dialogue&&!s.battle&&targets.some(t=>t.id===context&&distance(s.save.world,t.position)<=1)&&<section className="phrase-window" role="dialog" aria-label="Nearby chat"><div className="window-title"><h2>Nearby chat · {targets.find(t=>t.id===context)?.name}</h2><button aria-label="Close chat" onClick={()=>setContext(null)}>×</button></div><form className="window-body" onSubmit={e=>{e.preventDefault();void send({type:'PHRASE',targetId:context,phrase});setPhrase('');}}><p>Type the words you learned. Only nearby objects can hear them.</p><label>Message<input value={phrase} onChange={e=>setPhrase(e.target.value)} autoFocus maxLength={120} autoComplete="off"/></label><button disabled={session.busy||!phrase}>Say</button></form></section>}
        {services.length>0&&<section className="service-window" role="dialog" aria-label="School services"><div className="window-title"><h2>{c.actors.find(a=>a.id===context)?.name}</h2><button aria-label="Close services" onClick={()=>setContext(null)}>×</button></div><div className="window-body">{services.map(service=><div key={service.id}><h3>{service.name}</h3>{service.kind==='SHOP'?<div className="shop-list">{service.itemIds.map(id=>{const item=c.items.find(i=>i.id===id)!;return <div key={id}><span>{item.name}</span><button disabled={session.busy} onClick={()=>void send({type:'BUY',serviceId:service.id,itemId:id,quantity:1})}>Buy · {item.price} Pin</button>{(s.save.inventory[id]??0)>0&&<button disabled={session.busy} onClick={()=>void send({type:'SELL',serviceId:service.id,itemId:id,quantity:1})}>Sell · {item.sellPrice} Pin</button>}</div>;})}</div>:service.kind==='PET_TRAIN'?<>{s.save.pets.length===0&&<p>Return when a pet has joined you.</p>}{s.save.pets.map(p=><button key={p.id} disabled={session.busy} onClick={()=>void send({type:'SERVICE',serviceId:service.id,petId:p.id})}>Train {c.pets.find(d=>d.id===p.definitionId)?.name} · {service.pinCost} Pin</button>)}</>:<><p>{service.kind==='LESSON'?`${s.lessons[service.spellId!]??0} lessons completed. `:''}{service.pinCost} Pin · {service.virtueCost} Virtue</p><button disabled={session.busy} onClick={()=>void send({type:'SERVICE',serviceId:service.id})}>{service.kind==='LESSON'?'Attend lesson':'Receive care'}</button></>}</div>)}</div></section>}
        {(uiError||session.error)&&<div role="alert" className="game-error">{uiError||session.error}<button onClick={()=>{setUIError('');session.error=null;redraw(n=>n+1);}}>Dismiss</button></div>}
      </div>
    </div>
    <p className="notice-log" role="status">{s.notices.at(-1)}</p>
  </main>;
}
function BattleUI({session,assets,send}:{session:AdventureSession;assets:AssetResolver;send:(c:Command)=>Promise<void>}){
  const b=session.state.battle!,c=session.campaign,ready=b.units.filter(u=>u.side==='ALLY'&&isReady(u));
  const [selected,setSelected]=useState(''),[action,setAction]=useState<{kind:BattleAction['kind'];spellId?:string;itemId?:string}|null>(null),[menu,setMenu]=useState<'Magic'|'Items'|null>(null);
  const actor=ready.find(u=>u.id===selected)??ready[0];
  const execute=(targetId?:string)=>{if(!actor||!action)return;void send({type:'BATTLE_ACTION',action:{actorId:actor.id,kind:action.kind,spellId:action.spellId,targetId},itemId:action.itemId}).then(()=>{setAction(null);setMenu(null);});};
  const spell=action?.spellId?c.spells.find(s=>s.id===action.spellId):undefined;
  const support=action?.kind==='ITEM'||spell&&['HEAL','CURE','REVIVE'].includes(spell.kind),revive=spell?.kind==='REVIVE'||c.items.find(i=>i.id===action?.itemId)?.kind==='REVIVE';
  const targets=b.units.filter(u=>(support?u.side==='ALLY':u.side==='ENEMY')&&(revive?u.hp===0:u.hp>0));
  return <>
    <div className="battle-heading"><strong>{c.battles.find(x=>x.id===b.id)!.name}</strong><p aria-live="polite">{b.log.at(-1)}</p></div>
    <div className="enemy-bars">{b.units.filter(u=>u.side==='ENEMY').map(u=><div key={u.id}><strong>{u.name}</strong><Meter label="HP" value={u.hp} max={u.maxHP} color="#b75249"/><Meter label="Ready" value={u.gauge} max={100} color="#bc9d41"/></div>)}</div>
    <div className="party-bars">{b.units.filter(u=>u.side==='ALLY').map(u=><button key={u.id} disabled={!isReady(u)||session.busy} className={actor?.id===u.id?'selected':''} onClick={()=>{setSelected(u.id);setAction(null);setMenu(null);}}><img src={assets.resolve(u.assetId)} alt=""/><strong>{u.name}</strong><Meter label="HP" value={u.hp} max={u.maxHP} color="#9e5550"/><Meter label="MP" value={u.mp} max={u.maxMP} color="#4e89bb"/><Meter label="Ready" value={u.gauge} max={100} color="#bf9e39"/>{u.statuses.length>0&&<small>{u.statuses.map(s=>s.kind.toLowerCase()).join(', ')}</small>}</button>)}</div>
    {b.phase==='ACTIVE'?<div className="battle-controls">
      <strong>{actor?actor.name+' is ready':'Preparing…'}</strong>
      {actor&&!action&&!menu&&<div>{(['ATTACK','SPELL','ITEM','WAIT','ESCAPE'] as const).map(kind=><button key={kind} disabled={session.busy||kind==='ITEM'&&actor.role!=='PLAYER'||kind==='ESCAPE'&&(!b.canEscape||actor.role!=='PLAYER')} onClick={()=>{if(kind==='SPELL')setMenu('Magic');else if(kind==='ITEM')setMenu('Items');else if(kind==='WAIT'||kind==='ESCAPE')void send({type:'BATTLE_ACTION',action:{actorId:actor.id,kind}});else setAction({kind});}}>{({ATTACK:'Attack',SPELL:'Magic',ITEM:'Items',WAIT:'Wait',ESCAPE:'Escape'})[kind]}</button>)}</div>}
      {actor&&menu&&!action&&<div className="battle-menu">{menu==='Magic'?actor.skillIds.map(id=>{const s=c.spells.find(s=>s.id===id)!;return <button key={id} disabled={actor.mp<s.mpCost||actor.statuses.some(x=>x.kind==='SILENCE')} onClick={()=>setAction({kind:'SPELL',spellId:id})}>{s.name} · {s.mpCost} MP</button>;}):c.items.filter(i=>['HP','MP','REVIVE','CURE'].includes(i.kind)&&(session.state.save.inventory[i.id]??0)>0).map(i=><button key={i.id} onClick={()=>setAction({kind:'ITEM',itemId:i.id})}>{i.name} × {session.state.save.inventory[i.id]}</button>)}<button onClick={()=>setMenu(null)}>Back</button></div>}
      {action&&<div className="battle-menu"><span>Choose {support?'an ally':'a target'}:</span>{targets.map(u=><button key={u.id} disabled={session.busy} onClick={()=>execute(u.id)}>{u.name}</button>)}<button onClick={()=>setAction(null)}>Back</button></div>}
    </div>:<div className="battle-result"><h2>{b.phase==='VICTORY'?'Victory':b.phase==='DEFEAT'?'The party needs help':'Escaped'}</h2><p>{b.phase==='VICTORY'?'The way is clear.':b.phase==='DEFEAT'?'Return to school to recover. You can retry the mission.':'No battle rewards were gained.'}</p><button className="primary" disabled={session.busy} onClick={()=>void send({type:'FINISH_BATTLE'})}>Continue adventure</button></div>}
  </>;
}
