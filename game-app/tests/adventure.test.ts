import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCampaign} from '../src/game/adventure/registry.js';
import {manifestSchema} from '../src/game/engine/assets.js';
import {newAdventure,currentQuest,currentStep,playerStats,makeParty,type AdventureState} from '../src/game/adventure/state.js';
import {reduceCommand,mapFor,visibleTargets,distance,type Command} from '../src/game/adventure/session.js';
import {findPath} from '../src/game/engine/navigation.js';
import {meets} from '../src/game/engine/model.js';
import {act,tickBattle,isReady,combatant,startBattle} from '../src/game/adventure/combat.js';

const read=(path:string)=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const campaign=validateCampaign(read('content/adventure/opening.json'),manifestSchema.parse(read('public/assets/packs/public/manifest.json')),new Set(read('content/research/sources.json').map((x:{id:string})=>x.id)));
function driver(element:'FLAME'|'ICE'|'EARTH'){
  let s=newAdventure(campaign,'Rowan',element,'female','test.'+element);
  const command=(cmd:Command)=>{s=reduceCommand(s,campaign,cmd);};
  const talk=()=>{while(s.dialogue)command({type:'NEXT_DIALOGUE'});};
  const move=(id:string)=>{
    const target=visibleTargets(s,campaign).find(t=>t.id===id);assert(target,id);
    const candidates=[target.position,{x:target.position.x-1,y:target.position.y},{x:target.position.x+1,y:target.position.y},{x:target.position.x,y:target.position.y-1},{x:target.position.x,y:target.position.y+1}];
    const path=candidates.map(p=>findPath(mapFor(s,campaign),s.save.world,p)).filter(p=>p!==null).sort((a,b)=>a.length-b.length)[0];assert(path,'path to '+id);
    Object.assign(s.save.world,path.at(-1));assert(distance(s.save.world,target.position)<=1);
  };
  const travel=(destination:string)=>{
    let guard=0;
    while(s.save.world.mapId!==destination){
      assert(++guard<30,'route limit to '+destination);
      const queue=[{id:s.save.world.mapId,path:[] as string[]}],seen=new Set([s.save.world.mapId]);let result:string[]|undefined;
      for(const node of queue){if(node.id===destination){result=node.path;break;}for(const p of campaign.maps.find(m=>m.id===node.id)!.portals)if(p.conditions.every(c=>meets(s.save,c))&&!seen.has(p.toMapId)){seen.add(p.toMapId);queue.push({id:p.toMapId,path:[...node.path,p.id]});}}
      assert(result?.length,'reachable '+destination);move(result[0]!);command({type:'PORTAL',portalId:result[0]!});talk();
    }
  };
  const fight=()=>{
    let guard=0;
    while(s.battle?.phase==='ACTIVE'){
      assert(++guard<1200,'battle terminates');s.battle=tickBattle(s.battle,campaign.spells,20);
      if(s.battle.phase!=='ACTIVE')break;
      const ready=s.battle.units.find(u=>u.side==='ALLY'&&isReady(u));if(!ready)continue;
      const target=s.battle.units.find(u=>u.side==='ENEMY'&&u.hp>0)!;
      const spell=campaign.spells.find(p=>ready.skillIds.includes(p.id)&&p.kind==='DAMAGE'&&p.mpCost<=ready.mp);
      command({type:'BATTLE_ACTION',action:{actorId:ready.id,kind:spell?'SPELL':'ATTACK',targetId:target.id,spellId:spell?.id}});
    }
    assert.equal(s.battle?.phase,'VICTORY');command({type:'FINISH_BATTLE'});talk();
  };
  return {get state(){return s;},command,talk,move,travel,fight,completeOpening(){
    let guard=0;
    while(!s.save.world.flags['story.forest.done']){
      assert(++guard<100,'opening terminates');const q=currentQuest(s,campaign),step=currentStep(s,campaign);assert(q&&step);
      const expected=step.id;travel(step.mapId);
      if(currentStep(s,campaign)?.id!==expected)continue;
      if(step.type==='ENTER_MAP')throw new Error('Entry step was not consumed');
      move(step.targetId);command({type:'INTERACT',targetId:step.targetId});talk();
      if(s.battle)fight();
      // Real serialized reload at every completed objective.
      s=JSON.parse(JSON.stringify(s));
    }
  }};
}
test('opening campaign validates every map, dialogue, actor, portal, asset and evidence reference',()=>{
  assert.equal(campaign.quests.length,5);assert.equal(campaign.maps.length,24);
  const broken=structuredClone(campaign);broken.maps[0]!.portals[0]!.toMapId='map.missing';assert.throws(()=>validateCampaign(broken));
});
for(const element of ['FLAME','ICE','EARTH'] as const)test(element+' character completes Episodes 0–2 with reloads, homeland travel, duel and five-unit Odangka battle',()=>{
  const d=driver(element);d.completeOpening();
  assert.equal(d.state.save.pets.length,2);assert.equal(d.state.save.companionIds.length,0);
  assert.equal(d.state.save.quests['quest.main.000']?.completed,true);
  assert.equal(d.state.save.quests['quest.main.001.'+element.toLowerCase()]?.completed,true);
  assert.equal(d.state.save.quests['quest.main.002']?.completed,true);
  assert.equal(d.state.save.inventory['item.medicine'],undefined);
  assert.deepEqual(d.state.completedBattles,['battle.kesno','battle.odangka']);
});
test('remote NPC interaction, locked portals and forged purchases cannot advance a quest or change balances',()=>{
  const d=driver('EARTH'),before=structuredClone(d.state);
  assert.throws(()=>d.command({type:'INTERACT',targetId:'npc.morris'}));
  assert.throws(()=>d.command({type:'PORTAL',portalId:campaign.maps[0]!.portals[0]!.id}));
  assert.throws(()=>d.command({type:'BUY',serviceId:'service.supplies',itemId:'item.wand',quantity:-1}));
  assert.deepEqual(d.state,before);
});
test('lessons charge Virtue Points, equipment changes stats, and pet training evolves through a real service',()=>{
  const d=driver('ICE');d.completeOpening();d.travel('map.non-elemental-classroom');d.move('npc.rie');
  const virtue=d.state.save.currencies.virtuePoints;
  for(let i=0;i<3;i++)d.command({type:'SERVICE',serviceId:'service.lesson.healing'});
  assert.equal(d.state.save.spells['spell.healing'],1);assert.equal(d.state.save.currencies.virtuePoints,virtue-9);
  const base=playerStats(d.state,campaign).magicAttack;d.command({type:'EQUIP',itemId:'item.wand'});assert.equal(playerStats(d.state,campaign).magicAttack,base+3);
  d.travel('map.pet-center');d.move('npc.pelita');const id=d.state.save.activePetIds[0]!;
  for(let i=0;i<3;i++)d.command({type:'SERVICE',serviceId:'service.training',petId:id});
  assert.match(makeParty(d.state,campaign).find(u=>u.id===id)!.assetId,/evolved$/);
});
test('battle validation rejects invalid targets and unaffordable spells without spending MP or a gauge',()=>{
  const s=newAdventure(campaign,'Test','FLAME','male','combat-test');const player=makeParty(s,campaign)[0]!;
  player.gauge=100;player.mp=0;const enemy=combatant('enemy','Enemy','npc.kesno.overworld','ENEMY','ENEMY','ICE',{hp:50,mp:0,attack:10,defense:5,magicAttack:5,magicDefense:5,agility:5},[]);
  const battle=startBattle('test',[player,enemy],false);const before=structuredClone(battle);
  assert.throws(()=>act(battle,{actorId:'player',kind:'SPELL',spellId:'spell.fire',targetId:'enemy'},campaign.spells));
  assert.throws(()=>act(battle,{actorId:'player',kind:'ATTACK',targetId:'player'},campaign.spells));
  assert.throws(()=>act(battle,{actorId:'player',kind:'ESCAPE'},campaign.spells));assert.deepEqual(battle,before);
});
test('deterministic battle ticks preserve individual gauges and status expiry',()=>{
  const s=newAdventure(campaign,'Test','ICE','male','determinism');const player=makeParty(s,campaign)[0]!;
  player.statuses=[{kind:'PARALYSIS',remaining:5}];
  const enemy=combatant('enemy','Enemy','npc.kesno.overworld','ENEMY','ENEMY','FLAME',{hp:100,mp:0,attack:8,defense:5,magicAttack:5,magicDefense:5,agility:4},[]);
  const initial=startBattle('test',[player,enemy],true);
  assert.deepEqual(tickBattle(initial,campaign.spells,8),tickBattle(tickBattle(initial,campaign.spells,3),campaign.spells,5));
  assert.equal(tickBattle(initial,campaign.spells,8).units[0]!.statuses.length,0);
});

test('save validation rejects incompatible map, equipment, dialogue and pet references without replacing the original',async()=>{
  const {validateAdventure}=await import('../src/game/adventure/validate-state.js');
  const original=newAdventure(campaign,'Aria','EARTH','female','validation');
  for(const mutate of [
    (s:AdventureState)=>{s.save.world.mapId='map.missing';},
    (s:AdventureState)=>{s.save.world.x=.5;},
    (s:AdventureState)=>{s.save.equipment.WAND='item.wand';},
    (s:AdventureState)=>{s.dialogue={id:'dialogue.missing',line:0,questId:null,stepId:null};},
    (s:AdventureState)=>{s.save.pets=[{id:'pet.bad',definitionId:'pet.missing',level:1,affinity:0}];},
  ]){const corrupted=structuredClone(original);mutate(corrupted);assert.throws(()=>validateAdventure(corrupted,campaign),/cannot be loaded/);}
  assert.deepEqual(validateAdventure(original,campaign),original);
});
test('session failed save and concurrent revision preserve the last committed mission progress',async()=>{
  const {AdventureSession}=await import('../src/game/adventure/session.js');
  const initial=newAdventure(campaign,'Aria','ICE','female','persistence');let saved:AdventureState|null=null;let unavailable=false;
  const store={async load(){return saved;},async commit(next:AdventureState,revision:number){if(unavailable)throw new Error('Storage is full');if((saved?.save.revision??0)!==revision)throw new Error('Save conflict');saved=structuredClone(next);saved.save.revision++;return saved;}};
  const first=new AdventureSession(campaign,initial,store),second=new AdventureSession(campaign,initial,store);
  await first.dispatch({type:'SAVE'});const committed=structuredClone(first.state);
  await assert.rejects(second.dispatch({type:'SAVE'}),/Save conflict/);assert.equal(second.state.save.revision,0);
  unavailable=true;await assert.rejects(first.dispatch({type:'SAVE'}),/Storage is full/);assert.deepEqual(first.state,committed);assert.deepEqual(saved,committed);
  await second.reload();assert.deepEqual(second.state,committed);
});
