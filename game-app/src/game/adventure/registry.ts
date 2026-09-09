import {campaignSchema,type Campaign,type Effect} from './schema.js';
import {findPath} from '../engine/navigation.js';
import type {AssetManifest} from '../engine/assets.js';

export function validateCampaign(input:unknown,manifest?:AssetManifest,sourceIds?:Set<string>):Campaign {
  const c=campaignSchema.parse(input);
  const fail=(message:string):never=>{throw new Error('Campaign: '+message);};
  for(const category of ['quests','maps','actors','dialogue','spells','items','pets','battles','services'] as const){
    const rows=c[category];if(new Set(rows.map(r=>r.id)).size!==rows.length)fail('duplicate '+category+' ID');
  }
  const ids=(rows:{id:string}[])=>new Set(rows.map(r=>r.id));
  const maps=ids(c.maps),actors=ids(c.actors),dialogues=ids(c.dialogue),spells=ids(c.spells),items=ids(c.items),pets=ids(c.pets),battles=ids(c.battles),quests=ids(c.quests);
  const ref=(set:Set<string>,id:string,label:string)=>{if(!set.has(id))fail('unknown '+label+' '+id);};
  const asset=(id:string)=>{if(manifest&&!manifest.assets[id])fail('missing public asset '+id);};
  const conditions=(list:Campaign['quests'][number]['prerequisites'])=>{for(const condition of list){
    if(condition.type==='inventory')ref(items,condition.id,'condition item');
    if(condition.type==='quest')ref(quests,condition.id,'condition quest');
    if(condition.type==='spell'){ref(spells,condition.id,'condition spell');if(condition.proficiency>3)fail('unreachable spell proficiency');}
    if(condition.type==='pet')ref(pets,condition.definitionId,'condition pet');
  }};
  const effects=(list:Effect[])=>{for(const effect of list){
    if(effect.type==='transaction')for(const id of Object.keys(effect.items??{}))ref(items,id,'reward item');
    if(effect.type==='pet')ref(pets,effect.petId,'pet');
    if(effect.type==='spell')ref(spells,effect.spellId,'spell');
    if(effect.type==='companion')ref(actors,effect.actorId,'companion');
  }};
  const checkEvidence=(value:unknown)=>{
    if(!value||typeof value!=='object')return;
    const object=value as Record<string,unknown>;
    if(sourceIds&&Array.isArray(object.sourceNotes))for(const n of object.sourceNotes as {sourceId:string}[])if(!sourceIds.has(n.sourceId))fail('unknown source '+n.sourceId);
    for(const child of Object.values(object))if(child&&typeof child==='object')Array.isArray(child)?child.forEach(checkEvidence):checkEvidence(child);
  };checkEvidence(c);
  ref(maps,c.startMapId,'start map');
  if(new Set(c.origins.map(o=>o.element)).size!==3||c.origins.some(o=>o.element==='NONE'))fail('three distinct homelands required');
  for(const o of c.origins){ref(maps,o.mapId,'homeland');ref(spells,o.startingSpellId,'starting spell');ref(pets,o.petId,'starter pet');asset(o.maleAssetId);asset(o.femaleAssetId);}
  for(const actor of c.actors){ref(dialogues,actor.defaultDialogueId,'idle dialogue');asset(actor.spriteAssetId);asset(actor.portraitAssetId);actor.skillIds.forEach(id=>ref(spells,id,'actor spell'));}
  for(const d of c.dialogue)for(const line of d.lines)if(line.speakerId!=='player'&&line.speakerId!=='narrator')ref(actors,line.speakerId,'speaker');
  for(const s of c.spells)asset(s.assetId);
  for(const i of c.items){asset(i.assetId);if(i.sellPrice>i.price)fail('item sells for more than purchase price');}
  for(const p of c.pets){asset(p.spriteAssetId);asset(p.evolvedAssetId);if(p.evolutionLevel>p.maxLevel)fail('unreachable evolution');p.skillIds.forEach(id=>ref(spells,id,'pet spell'));}
  for(const b of c.battles){asset(b.backgroundAssetId);b.enemyIds.forEach(id=>ref(actors,id,'enemy'));effects(b.rewards);}
  const portalIds=c.maps.flatMap(m=>m.portals.map(p=>p.id));
  if(new Set(portalIds).size!==portalIds.length)fail('duplicate portal ID');
  for(const m of c.maps){
    const inside=(p:{x:number;y:number})=>p.x<m.width&&p.y<m.height;
    if(!inside(m.spawn)||m.blocked.some(p=>!inside(p))||!findPath(m,m.spawn,m.spawn))fail('invalid map grid '+m.id);
    asset(m.backgroundAssetId);
    const targetIds=[...m.npcs.map(n=>n.actorId),...m.objects.map(o=>o.id),...m.portals.map(p=>p.id),...m.encounters.map(e=>e.battleId)];
    if(new Set(targetIds).size!==targetIds.length)fail('ambiguous map interaction '+m.id);
    for(const target of [...m.npcs,...m.objects,...m.portals,...m.encounters])conditions(target.conditions);
    const targets=[...m.npcs.map(n=>n.position),...m.objects.map(o=>o.position),...m.portals.map(p=>p.position),...m.encounters.map(e=>e.position)];
    for(const target of targets){if(!inside(target))fail('target outside map '+m.id);const reachable=[target,{x:target.x+1,y:target.y},{x:target.x-1,y:target.y},{x:target.x,y:target.y+1},{x:target.x,y:target.y-1}].some(p=>findPath(m,m.spawn,p));if(!reachable)fail('unreachable target '+m.id);}
    for(const n of m.npcs)ref(actors,n.actorId,'map NPC');
    for(const o of m.objects)asset(o.assetId);
    for(const p of m.portals){ref(maps,p.toMapId,'portal');const dest=c.maps.find(m=>m.id===p.toMapId)!;if(!findPath(dest,p.spawn,p.spawn))fail('blocked portal destination '+p.id);}
    for(const e of m.encounters)ref(battles,e.battleId,'encounter');
  }
  const graph=new Map<string,string[]>();
  for(const q of c.quests){
    if(q.repeatable)fail('repeatable adventure quests are not implemented');
    conditions(q.prerequisites);
    if(new Set(q.steps.map(s=>s.id)).size!==q.steps.length)fail('duplicate quest step '+q.id);
    graph.set(q.id,[...q.prerequisites,...q.steps.flatMap(s=>s.conditions)].filter(s=>s.type==='quest').map(s=>s.id));
    for(const s of q.steps){
      conditions(s.conditions);
      if(!['TALK','ENTER_MAP','INTERACT','TYPE_PHRASE','BATTLE'].includes(s.type))fail('objective handler is not implemented: '+s.type);
      ref(maps,s.mapId,'quest map');if(s.dialogueId)ref(dialogues,s.dialogueId,'quest dialogue');
      const map=c.maps.find(m=>m.id===s.mapId)!;
      if(s.type==='ENTER_MAP'&&s.targetId!==s.mapId)fail('entry objective must target its own map');
      if(s.type==='TALK'&&!map.npcs.some(n=>n.actorId===s.targetId))fail('quest NPC not on map '+s.id);
      if(s.type==='BATTLE'&&!map.encounters.some(e=>e.battleId===s.targetId))fail('quest battle not on map '+s.id);
      if(['INTERACT','TYPE_PHRASE','QUIZ'].includes(s.type)&&!map.objects.some(o=>o.id===s.targetId))fail('quest object not on map '+s.id);
      if(s.type==='TYPE_PHRASE'&&(!s.phrase||s.phrase.length>120))fail('missing or oversized puzzle phrase');
      effects(s.effects);
    }effects(q.rewards);
  }
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(id:string)=>{ref(quests,id,'quest prerequisite');if(visiting.has(id))fail('cyclic quest prerequisites');if(done.has(id))return;visiting.add(id);for(const next of graph.get(id)??[])visit(next);visiting.delete(id);done.add(id);};
  c.quests.forEach(q=>visit(q.id));
  for(const service of c.services){
    ref(actors,service.actorId,'service NPC');ref(maps,service.mapId,'service map');conditions(service.conditions);
    if(!c.maps.find(m=>m.id===service.mapId)!.npcs.some(n=>n.actorId===service.actorId))fail('service NPC is not on its map');
    service.itemIds.forEach(id=>ref(items,id,'shop item'));if(service.spellId)ref(spells,service.spellId,'lesson');if(service.toMapId)ref(maps,service.toMapId,'teleport');
    if(service.kind==='DORM')fail('dorm service is not implemented');
    if(service.kind==='LESSON'&&!service.spellId)fail('lesson requires a spell');
    if(service.kind==='PROMOTION'&&!service.rank)fail('promotion requires a rank');
    if(service.kind==='TELEPORT'&&!service.toMapId)fail('teleport requires a destination');
  }
  return c;
}
