import {z} from 'zod';
import {saveSchema,meets,ranks,type Save,type Element} from '../engine/model.js';
import {transact} from '../engine/transactions.js';
import {battleStateSchema,combatant,startBattle,type Battle,type Combatant} from './combat.js';
import type {Campaign,Effect,Stats,AdventureQuest} from './schema.js';

export const adventureStateSchema=z.object({
  adventureVersion:z.literal(1),save:saveSchema,hp:z.number().int().nonnegative(),mp:z.number().int().nonnegative(),
  lessons:z.record(z.number().int().nonnegative()),battle:battleStateSchema.nullable(),
  completedBattles:z.array(z.string()),sequence:z.number().int().nonnegative(),
  dialogue:z.object({id:z.string(),line:z.number().int().nonnegative(),questId:z.string().nullable(),stepId:z.string().nullable()}).strict().nullable(),
  visitedMaps:z.array(z.string()),selectedQuestId:z.string().nullable(),notices:z.array(z.string()).max(8),
}).strict();
export type AdventureState=z.infer<typeof adventureStateSchema>;
export function playerStats(state:AdventureState,c:Campaign):Stats {
  const origin=c.origins.find(o=>o.element===state.save.character.element)!;
  const stats={...origin.stats},level=state.save.character.level-1;
  for(const key of ['hp','mp','attack','defense','magicAttack','magicDefense'] as const)stats[key]+=level*(key==='hp'?8:key==='mp'?4:2);
  for(const id of Object.values(state.save.equipment)){const item=c.items.find(i=>i.id===id);for(const [key,value] of Object.entries(item?.bonus??{}))stats[key as keyof Stats]+=value;}
  return stats;
}
export function newAdventure(c:Campaign,name:string,element:Exclude<Element,'NONE'>,appearance:'male'|'female',characterId:string):AdventureState {
  const origin=c.origins.find(o=>o.element===element);if(!origin)throw new Error('Unknown homeland');
  const map=c.maps.find(m=>m.id===c.startMapId)!;
  return adventureStateSchema.parse({adventureVersion:1,save:{saveSchemaVersion:1,revision:0,characterId,
    character:{name:name.trim(),element,appearanceId:appearance==='male'?origin.maleAssetId:origin.femaleAssetId,level:1,rank:'APPRENTICE',exp:0},
    currencies:{pin:60,virtuePoints:12},inventory:{'item.small-tonic':3,'item.mana-tonic':2},equipment:{},spells:{[origin.startingSpellId]:1},pets:[],activePetIds:[],companionIds:[],
    world:{mapId:map.id,...map.spawn,flags:{},discoveredRooms:[],unlockedMaps:[map.id]},quests:{}},
    hp:origin.stats.hp,mp:origin.stats.mp,lessons:{},battle:null,completedBattles:[],sequence:0,dialogue:null,visitedMaps:[map.id],selectedQuestId:null,notices:['Welcome to Arpia. Click the path to walk; approach George to begin.'],
  });
}
export const notice=(s:AdventureState,text:string)=>{s.notices=[...s.notices,text].slice(-8);};
export function eligibleQuests(s:AdventureState,c:Campaign):AdventureQuest[]{return c.quests.filter(q=>!s.save.quests[q.id]?.completed&&q.prerequisites.every(p=>meets(s.save,p)));}
export function currentQuest(s:AdventureState,c:Campaign):AdventureQuest|undefined {const available=eligibleQuests(s,c);return available.find(q=>q.id===s.selectedQuestId)??available[0];}
export function currentStep(s:AdventureState,c:Campaign){const q=currentQuest(s,c);return q?.steps[s.save.quests[q.id]?.stepIndex??0];}
export function applyEffects(s:AdventureState,c:Campaign,effects:Effect[]):void {
  for(const e of effects){
    if(e.type==='transaction'){const {type,...tx}=e;s.save=transact(s.save,tx);}
    if(e.type==='exp'){s.save.character.exp+=e.amount;while(s.save.character.exp>=s.save.character.level*50){s.save.character.exp-=s.save.character.level*50;s.save.character.level++;const stats=playerStats(s,c);s.hp=stats.hp;s.mp=stats.mp;notice(s,'Level '+s.save.character.level+'! HP and MP restored.');}}
    if(e.type==='restore'){const stats=playerStats(s,c);s.hp=stats.hp;s.mp=stats.mp;}
    if(e.type==='spell')s.save.spells[e.spellId]=Math.max(1,s.save.spells[e.spellId]??0);
    if(e.type==='rank'){if(ranks.indexOf(e.rank)>ranks.indexOf(s.save.character.rank))s.save.character.rank=e.rank;}
    if(e.type==='companion'){
      s.save.companionIds=s.save.companionIds.filter(id=>id!==e.actorId);
      if(e.join){if(s.save.companionIds.length>=2)throw new Error('Temporary party is full');s.save.companionIds.push(e.actorId);}
    }
    if(e.type==='pet'||e.type==='starterPet'){
      const petId=e.type==='pet'?e.petId:c.origins.find(o=>o.element===s.save.character.element)!.petId;
      if(!s.save.pets.some(p=>p.definitionId===petId)){
        const id='owned.'+petId;s.save.pets.push({id,definitionId:petId,level:1,affinity:0});
        if(s.save.activePetIds.length<2)s.save.activePetIds.push(id);
        notice(s,c.pets.find(p=>p.id===petId)!.name+' joined your pets.');
      }
    }
  }
}
export function completeStep(input:AdventureState,c:Campaign,questId:string,stepId:string):AdventureState {
  const q=c.quests.find(q=>q.id===questId);if(!q)throw new Error('Unknown quest');
  const progress=input.save.quests[q.id]??{stepIndex:0,completed:false,processedEventIds:[]};
  const step=q.steps[progress.stepIndex];
  if(progress.completed||!step||step.id!==stepId||!q.prerequisites.every(p=>meets(input.save,p))||!step.conditions.every(p=>meets(input.save,p)))return input;
  const s=structuredClone(input);applyEffects(s,c,step.effects);s.sequence++;
  const complete=progress.stepIndex+1===q.steps.length;
  s.save.quests[q.id]={stepIndex:progress.stepIndex+1,completed:complete,processedEventIds:[...progress.processedEventIds,q.id+':'+step.id]};
  if(complete){applyEffects(s,c,q.rewards);notice(s,'Mission complete: '+q.name);s.selectedQuestId=null;}
  return adventureStateSchema.parse(s);
}
export function openStepDialogue(input:AdventureState,c:Campaign,q:AdventureQuest):AdventureState {
  const step=q.steps[input.save.quests[q.id]?.stepIndex??0];if(!step)return input;
  if(!step.dialogueId)return completeStep(input,c,q.id,step.id);
  return {...input,dialogue:{id:step.dialogueId,line:0,questId:q.id,stepId:step.id}};
}
export function nextDialogue(input:AdventureState,c:Campaign):AdventureState {
  const d=input.dialogue;if(!d)return input;
  const definition=c.dialogue.find(x=>x.id===d.id);if(!definition)throw new Error('Dialogue is missing');
  if(d.line+1<definition.lines.length)return {...input,dialogue:{...d,line:d.line+1}};
  const s={...input,dialogue:null};return d.questId&&d.stepId?completeStep(s,c,d.questId,d.stepId):s;
}
export function makeParty(s:AdventureState,c:Campaign):Combatant[]{
  const player=combatant('player',s.save.character.name,s.save.character.appearanceId,'ALLY','PLAYER',s.save.character.element,playerStats(s,c),Object.keys(s.save.spells).filter(id=>s.save.spells[id]!>0));
  player.hp=s.hp;player.mp=s.mp;
  return [player,...s.save.activePetIds.map(id=>{
    const owned=s.save.pets.find(p=>p.id===id)!,definition=c.pets.find(p=>p.id===owned.definitionId)!;
    const stats={...definition.stats};for(const key of ['hp','attack','magicAttack','defense','magicDefense'] as const)stats[key]+=(owned.level-1)*2;
    return combatant(id,definition.name,owned.level>=definition.evolutionLevel?definition.evolvedAssetId:definition.spriteAssetId,'ALLY','PET',definition.element,stats,definition.skillIds);
  }),...s.save.companionIds.map(id=>{const a=c.actors.find(a=>a.id===id)!;return combatant(id,a.name,a.spriteAssetId,'ALLY','NPC',a.element,a.stats,a.skillIds);})];
}
export function beginEncounter(input:AdventureState,c:Campaign,battleId:string):AdventureState {
  if(input.battle||input.dialogue||input.hp<=0)throw new Error('Cannot start an encounter now');
  const definition=c.battles.find(b=>b.id===battleId);if(!definition)throw new Error('Unknown encounter');
  const enemies=definition.enemyIds.map((id,index)=>{const a=c.actors.find(a=>a.id===id)!;return combatant(id+'.'+index,a.name,a.spriteAssetId,'ENEMY','ENEMY',a.element,a.stats,a.skillIds);});
  return {...input,battle:startBattle(battleId,[...makeParty(input,c),...enemies],definition.canEscape,73+input.sequence)};
}
export function finishEncounter(input:AdventureState,c:Campaign):AdventureState {
  if(!input.battle||input.battle.phase==='ACTIVE')throw new Error('Encounter is not finished');
  const s=structuredClone(input),battle=s.battle!,player=battle.units.find(u=>u.role==='PLAYER')!;
  s.battle=null;s.hp=player.hp;s.mp=player.mp;s.sequence++;
  if(battle.phase==='DEFEAT'){
    const map=c.maps.find(m=>m.id===c.startMapId)!;s.save.world.mapId=map.id;s.save.world.x=map.spawn.x;s.save.world.y=map.spawn.y;
    applyEffects(s,c,[{type:'restore'}]);notice(s,'The school nurse helped you recover. Your mission can be retried.');return s;
  }
  // Restoration recovery rule: surviving allies help a fallen student stand, without a full heal.
  // Otherwise a pet-led victory or escape can leave the next story encounter impossible to enter.
  if(s.hp===0){s.hp=1;notice(s,'Your companions help you stand with 1 HP. Rest before the next encounter.');}
  if(battle.phase==='ESCAPED'){notice(s,'Escaped without rewards.');return s;}
  const q=currentQuest(s,c),step=currentStep(s,c);
  if(!s.completedBattles.includes(battle.id)){applyEffects(s,c,c.battles.find(b=>b.id===battle.id)!.rewards);s.completedBattles.push(battle.id);}
  for(const pet of s.save.pets.filter(p=>s.save.activePetIds.includes(p.id))){const definition=c.pets.find(p=>p.id===pet.definitionId)!;pet.affinity=Math.min(100,pet.affinity+2);pet.level=Math.min(definition.maxLevel,pet.level+1);}
  if(q&&step?.type==='BATTLE'&&step.targetId===battle.id)return openStepDialogue(s,c,q);
  return s;
}
