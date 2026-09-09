import {findPath} from '../engine/navigation.js';
import type {Campaign} from './schema.js';
import {adventureStateSchema,playerStats,type AdventureState} from './state.js';

/** Reject damaged/incompatible local saves without deleting or replacing them. This is not a cloud authorization boundary. */
export function validateAdventure(input:unknown,c:Campaign):AdventureState {
  const s=adventureStateSchema.parse(input),v=s.save;
  const fail=(reason:string):never=>{throw new Error('This save cannot be loaded: '+reason);};
  const known=(rows:{id:string}[],id:string,kind:string)=>{if(!rows.some(x=>x.id===id))fail('unknown '+kind+' '+id);};
  const origin=c.origins.find(o=>o.element===v.character.element);
  if(!origin||![origin.maleAssetId,origin.femaleAssetId].includes(v.character.appearanceId))fail('invalid character origin or appearance');
  const map=c.maps.find(m=>m.id===v.world.mapId);
  if(!map||!findPath(map,v.world,v.world))fail('invalid map position');
  for(const id of [...v.world.unlockedMaps,...s.visitedMaps])known(c.maps,id,'map');
  for(const id of Object.keys(v.inventory))known(c.items,id,'item');
  for(const [slot,id] of Object.entries(v.equipment)){
    const item=c.items.find(i=>i.id===id);if(!item||item.slot!==slot||!(v.inventory[id]!>0))fail('equipment is not an owned item for this slot');
  }
  for(const [id,n] of Object.entries(v.spells)){known(c.spells,id,'spell');if(n<1||n>3)fail('invalid spell proficiency');}
  for(const id of Object.keys(s.lessons))known(c.spells,id,'lesson');
  for(const pet of v.pets){const species=c.pets.find(p=>p.id===pet.definitionId);if(!species||pet.level>species.maxLevel||pet.affinity>100)fail('invalid pet');}
  if(new Set(v.pets.map(p=>p.definitionId)).size!==v.pets.length)fail('duplicate pet species');
  for(const id of v.companionIds)known(c.actors,id,'companion');
  for(const [id,progress] of Object.entries(v.quests)){
    const q=c.quests.find(q=>q.id===id);if(!q||progress.stepIndex>q.steps.length||progress.completed!==(progress.stepIndex===q.steps.length))fail('invalid mission progress');
  }
  if(s.selectedQuestId)known(c.quests,s.selectedQuestId,'selected mission');
  if(s.dialogue){
    const d=s.dialogue,dialogue=c.dialogue.find(x=>x.id===d.id);if(!dialogue||d.line>=dialogue.lines.length)fail('invalid conversation');
    if((d.questId===null)!==(d.stepId===null))fail('incomplete conversation objective');
    if(d.questId){const q=c.quests.find(q=>q.id===d.questId),step=q?.steps[v.quests[d.questId]?.stepIndex??0];if(!step||step.id!==d.stepId||step.dialogueId!==d.id)fail('conversation does not match mission progress');}
  }
  for(const id of s.completedBattles)known(c.battles,id,'completed battle');
  const max=playerStats(s,c);if(s.hp>max.hp||s.mp>max.mp)fail('HP or MP exceeds maximum');
  if(s.battle){
    const b=s.battle;known(c.battles,b.id,'battle');
    const allies=b.units.filter(u=>u.side==='ALLY');
    if(allies.filter(u=>u.role==='PLAYER').length!==1||allies.filter(u=>u.role==='PET').length>2||allies.filter(u=>u.role==='NPC').length>2||!b.units.some(u=>u.side==='ENEMY'))fail('invalid battle party');
    const expected=new Set(['player',...v.activePetIds,...v.companionIds]);
    if(allies.length!==expected.size||allies.some(u=>!expected.has(u.id)))fail('battle party differs from active companions');
    if(new Set(b.units.map(u=>u.id)).size!==b.units.length)fail('duplicate battle unit');
    for(const u of b.units){
      if(u.hp>u.maxHP||u.mp>u.maxMP)fail('battle HP or MP exceeds maximum');
      u.skillIds.forEach(id=>known(c.spells,id,'battle skill'));
      if(u.role==='PLAYER'&&u.assetId!==v.character.appearanceId)fail('invalid player battle appearance');
      if(u.role==='PET'&&!c.pets.some(p=>[p.spriteAssetId,p.evolvedAssetId].includes(u.assetId)))fail('invalid pet appearance');
      if(['NPC','ENEMY'].includes(u.role)&&!c.actors.some(a=>a.spriteAssetId===u.assetId))fail('invalid actor appearance');
    }
  }
  return s;
}
