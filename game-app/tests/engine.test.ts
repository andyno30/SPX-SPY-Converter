import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.js';
import {elementalRelation,meets,saveSchema} from '../src/game/engine/model.js';
import {transact} from '../src/game/engine/transactions.js';
import {advanceQuest,unmetConditions,type QuestDefinition} from '../src/game/engine/quests.js';
import {findPath,toIso,fromIso,traverseMaze,type Maze} from '../src/game/engine/navigation.js';
import {tickGauges,readyUnits,type GaugeUnit} from '../src/game/engine/gauges.js';
import {AssetResolver} from '../src/game/engine/assets.js';
import {migrateSave,SaveConflict,SaveSystem} from '../src/game/engine/saves.js';
import {LocalSaveStore,type LockPort} from '../src/adapters/local-save.js';
import {createArpiaClient} from '../src/adapters/supabase-save.js';
import {assertAcyclic,checkContent} from '../scripts/research/check-content.js';

test('element triangle is directional and neutral has no guessed multiplier',()=>{
  for(const [a,b] of [['FLAME','ICE'],['ICE','EARTH'],['EARTH','FLAME']] as const){assert.equal(elementalRelation(a,b),'strong');assert.equal(elementalRelation(b,a),'weak');}
  assert.equal(elementalRelation('NONE','FLAME'),'neutral');assert.equal(elementalRelation('ICE','ICE'),'neutral');
});
test('transactions are atomic, finite and cannot overdraw either currency or inventory',()=>{
  const s=fixture(),original=structuredClone(s);
  assert.throws(()=>transact(s,{pin:-10,items:{'fixture.resin':-2}}));assert.deepEqual(s,original);
  assert.throws(()=>transact(s,{virtuePoints:-11}));assert.throws(()=>transact(s,{pin:Infinity}));assert.throws(()=>transact(s,{pin:0.5}));
  const n=transact(s,{pin:-5,items:{'fixture.resin':-1,'fixture.wand':1}});assert.equal(n.currencies.pin,15);assert.equal(n.inventory['fixture.wand'],1);assert.equal(n.inventory['fixture.resin'],undefined);
});
test('rank, class proficiency and active-pet conditions do not imply ownership equals equipped',()=>{
  const s=fixture();s.pets=[{id:'owned',definitionId:'fixture.pet',level:1,affinity:0}];
  assert.equal(meets(s,{type:'pet',definitionId:'fixture.pet'}),false);s.activePetIds=['owned'];assert.equal(meets(s,{type:'pet',definitionId:'fixture.pet'}),true);
  assert.equal(meets(s,{type:'rank',minimum:'NOVICE'}),false);s.character.rank='MAGE';assert.equal(meets(s,{type:'rank',minimum:'NOVICE'}),true);
  assert.equal(meets(s,{type:'spell',id:'fixture.fire',proficiency:2}),false);s.spells['fixture.fire']=2;assert.equal(meets(s,{type:'spell',id:'fixture.fire',proficiency:2}),true);
  assert.throws(()=>saveSchema.parse({...s,activePetIds:['owned','owned']}));
});
const quest:QuestDefinition={id:'fixture.tutorial',prerequisites:[],steps:[
  {id:'greet',event:{type:'TALK',targetId:'fixture.guide'},conditions:[],effects:{flags:{metGuide:true}},dialogueId:'fixture.guide.hello'},
  {id:'door',event:{type:'TYPE_PHRASE',targetId:'fixture.door',phrase:'Open'},conditions:[{type:'inventory',id:'fixture.resin',quantity:1}],effects:{items:{'fixture.resin':-1},flags:{doorOpen:true}}},
],rewards:{pin:7,virtuePoints:2}};
test('data-driven sequence survives save reload and awards rewards once',()=>{
  const start=fixture();const early={id:'e0',type:'TYPE_PHRASE',targetId:'fixture.door',phrase:'Open'} as const;
  assert.equal(advanceQuest(start,quest,early),start);
  const talk={id:'e1',type:'TALK',targetId:'fixture.guide'} as const;
  const first=advanceQuest(start,quest,talk);assert.equal(first.quests[quest.id]?.stepIndex,1);assert.equal(first.world.flags.metGuide,true);
  const reload=migrateSave(JSON.parse(JSON.stringify(first)));
  assert.equal(advanceQuest(reload,quest,talk),reload);
  assert.equal(advanceQuest(reload,quest,{...early,id:'e2',phrase:'open'}),reload);
  const done=advanceQuest(reload,quest,{...early,id:'e3'});assert.equal(done.quests[quest.id]?.completed,true);assert.equal(done.currencies.pin,27);assert.equal(done.currencies.virtuePoints,12);
  assert.equal(advanceQuest(done,quest,{...early,id:'e4'}),done);assert.deepEqual(unmetConditions(done,quest),[]);
});
test('quest final reward failure rolls back all step effects',()=>{
  const s=advanceQuest(fixture(),quest,{id:'e1',type:'TALK',targetId:'fixture.guide'});const copy=structuredClone(s);
  assert.throws(()=>advanceQuest(s,{...quest,rewards:{pin:-100}},{id:'e2',type:'TYPE_PHRASE',targetId:'fixture.door',phrase:'Open'}));assert.deepEqual(s,copy);
});
test('pathfinding respects blocked tiles and unreachable destinations; isometric transform round-trips',()=>{
  const g={width:4,height:3,blocked:[{x:1,y:0},{x:1,y:1}]};const path=findPath(g,{x:0,y:0},{x:3,y:0})!;
  assert.ok(path.some(p=>p.y===2));assert.ok(path.every(p=>!g.blocked.some(b=>b.x===p.x&&b.y===p.y)));
  assert.equal(findPath({...g,blocked:[...g.blocked,{x:1,y:2}]},{x:0,y:0},{x:3,y:0}),null);
  assert.equal(findPath(g,{x:0,y:0},{x:1,y:0}),null);assert.equal(findPath(g,{x:-1,y:0},{x:0,y:0}),null);
  assert.deepEqual(fromIso(toIso({x:3,y:2},64,32),64,32),{x:3,y:2});
});
test('maze edges are directed and conditional, and discovery can persist through saves',()=>{
  const s=fixture(),maze:Maze={id:'fixture.maze',rooms:['a','b'],connections:[{id:'star',from:'a',to:'b',conditions:[{type:'flag',id:'doorOpen',value:true}]}]};
  assert.equal(traverseMaze(s,maze,'a','star'),null);s.world.flags.doorOpen=true;
  const next=traverseMaze(s,maze,'a','star')!;assert.equal(next.room,'b');s.world.discoveredRooms=next.discoveredRooms;
  const loaded=migrateSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(loaded.world.discoveredRooms,['a','b']);assert.equal(traverseMaze(loaded,maze,'b','star'),null);
});
test('per-unit gauges are deterministic; dead and disabled units never become actionable',()=>{
  const units:GaugeUnit[]=[{id:'hero',side:'ALLY',role:'PLAYER',hp:10,gauge:0,rate:10,disabled:false},{id:'pet',side:'ALLY',role:'PET',hp:10,gauge:0,rate:20,disabled:false},{id:'enemy',side:'ENEMY',role:'ENEMY',hp:0,gauge:100,rate:10,disabled:false}];
  assert.deepEqual(tickGauges(tickGauges(units,2),3),tickGauges(units,5));assert.deepEqual(readyUnits(tickGauges(units,5)),['pet']);
  assert.deepEqual(readyUnits([{...units[0]!,gauge:100,disabled:true}]),[]);assert.throws(()=>tickGauges(units,NaN));
});
test('asset resolver has no public-to-reference fallback and rejects unsafe mappings',()=>{
  const manifest={id:'public',version:1,assets:{'npc.fixture.portrait':{path:'portraits/fixture.webp',type:'image',rights:{license:'ORIGINAL',creator:'Test',source:'Synthetic fixture'}}}};
  assert.equal(new AssetResolver(manifest,undefined,true).resolve('npc.fixture.portrait'),'/game/assets/packs/public/portraits/fixture.webp');
  assert.throws(()=>new AssetResolver({...manifest,id:'reference'},undefined,true));assert.throws(()=>new AssetResolver(manifest).resolve('npc.missing'));
  for(const path of ['../reference/a.webp','portraits/../../a.webp','https://example.org/a.webp','portraits/%2e%2e/a.webp'])assert.throws(()=>new AssetResolver({...manifest,assets:{'npc.fixture.portrait':{...manifest.assets['npc.fixture.portrait'],path}}}));
});
test('save migration rejects corrupt/future saves instead of replacing progress',()=>{
  const s=fixture();assert.deepEqual(migrateSave(s),s);assert.equal(migrateSave({...s,saveSchemaVersion:0}).saveSchemaVersion,1);
  assert.throws(()=>migrateSave({...s,saveSchemaVersion:9}));assert.throws(()=>migrateSave({...s,currencies:{pin:-1,virtuePoints:0}}));
});
test('local autosave detects concurrent revisions and retains last save on quota error',async()=>{
  const data=new Map<string,string>();let fail=false;let tail=Promise.resolve();
  const locks:LockPort={request:async(_name,fn)=>{let release!:()=>void;const previous=tail;tail=new Promise<void>(r=>{release=r;});await previous;try{return await fn();}finally{release();}}};
  const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,v:string)=>{if(fail)throw new Error('quota');data.set(key,v);}};
  const store=new LocalSaveStore(storage,locks),system=new SaveSystem(store),s=fixture();
  const results=await Promise.allSettled([system.save(s,'QUEST_STEP'),system.save(s,'QUEST_STEP')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected');assert.ok(rejected?.status==='rejected'&&rejected.reason instanceof SaveConflict);
  const saved=(await store.load(s.characterId))!;assert.equal(saved.revision,1);fail=true;await assert.rejects(()=>system.save(saved,'ITEM_TRANSACTION'),/quota/);assert.deepEqual(await store.load(s.characterId),saved);
});
test('Supabase config refuses existing project and privileged key formats before connecting',()=>{
  assert.throws(()=>createArpiaClient({url:'https://isvzhpqrmjtqnqyyidxr.supabase.co',publishableKey:'sb_publishable_test',privatePrototype:true}));
  assert.throws(()=>createArpiaClient({url:'https://new-test.supabase.co',publishableKey:'sb_secret_test',privatePrototype:true}));
  assert.throws(()=>createArpiaClient({url:'https://new-test.supabase.co',publishableKey:'sb_publishable_test',privatePrototype:false}));
});
test('content numbers and provenance validate; dependency cycles and missing IDs fail',()=>{
  const c=checkContent();assert.equal(c.main.length,103);assert.equal(c.free.length,37);assert.equal(c.runtimeQuestCount,8);assert.equal(c.runtimeMapCount,40);
  assert.throws(()=>assertAcyclic(new Map([['a',['b']],['b',['a']]])),/cycle/);assert.throws(()=>assertAcyclic(new Map([['a',['missing']]])),/Unknown/);
});
