import {validateAdventure} from './validate-state.js';
import {commandSchema,type Command} from './commands.js';
export type {Command} from './commands.js';
import {meets,ranks,type Element} from '../engine/model.js';
import {findPath,type Point} from '../engine/navigation.js';
import {SaveConflict} from '../engine/saves.js';
import type {Campaign,WorldMap} from './schema.js';
import {act,tickBattle,type BattleAction} from './combat.js';
import {adventureStateSchema,newAdventure,currentQuest,currentStep,openStepDialogue,nextDialogue,beginEncounter,finishEncounter,applyEffects,playerStats,notice,type AdventureState} from './state.js';

export interface AdventureStore {load():Promise<AdventureState|null>;commit(state:AdventureState,expectedRevision:number):Promise<AdventureState>}
export const distance=(a:Point,b:Point)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
export function mapFor(s:AdventureState,c:Campaign):WorldMap {const map=c.maps.find(m=>m.id===s.save.world.mapId);if(!map)throw new Error('Unknown saved map');return map;}
export function visibleTargets(s:AdventureState,c:Campaign){
  const m=mapFor(s,c),allowed=(conditions:WorldMap['portals'][number]['conditions'])=>conditions.every(x=>meets(s.save,x));
  return [
    ...m.npcs.filter(n=>allowed(n.conditions)).map(n=>({id:n.actorId,name:c.actors.find(a=>a.id===n.actorId)!.name,position:n.position,kind:'NPC' as const})),
    ...m.objects.filter(o=>allowed(o.conditions)).map(o=>({id:o.id,name:o.name,position:o.position,kind:'OBJECT' as const})),
    ...m.encounters.filter(e=>allowed(e.conditions)&&!s.completedBattles.includes(e.battleId)).map(e=>({id:e.battleId,name:c.battles.find(b=>b.id===e.battleId)!.name,position:e.position,kind:'BATTLE' as const})),
    ...m.portals.filter(p=>allowed(p.conditions)&&(!p.element||p.element===s.save.character.element)).map(p=>({id:p.id,name:p.name,position:p.position,kind:'PORTAL' as const})),
  ];
}
export function reduceCommand(input:AdventureState,c:Campaign,intent:Command):AdventureState {
  const command=commandSchema.parse(intent);
  let s=structuredClone(input);
  const inWorld=()=>{if(s.battle||s.dialogue)throw new Error('Finish the current conversation or encounter first');};
  const near=(id:string)=>{const target=visibleTargets(s,c).find(t=>t.id===id);if(!target||distance(s.save.world,target.position)>1)throw new Error('Move closer to interact');return target;};
  const service=(id:string)=>{
    inWorld();const service=c.services.find(x=>x.id===id);
    if(!service||service.mapId!==s.save.world.mapId||!service.conditions.every(p=>meets(s.save,p)))throw new Error('Service is unavailable');near(service.actorId);return service;
  };
  if(command.type==='NEXT_DIALOGUE')return nextDialogue(s,c);
  if(command.type==='INTERACT'||command.type==='PHRASE'){
    inWorld();const target=near(command.targetId);const q=currentQuest(s,c),step=currentStep(s,c);
    if(command.type==='PHRASE'){
      if(target.kind!=='OBJECT')throw new Error('There is no object here that responds to a phrase');
      notice(s,s.save.character.name+': '+command.phrase);
    }
    if(target.kind==='PORTAL')return reduceCommand(s,c,{type:'PORTAL',portalId:target.id});
    if(target.kind==='BATTLE')return beginEncounter(s,c,target.id);
    if(q&&step&&step.mapId===s.save.world.mapId&&step.targetId===target.id&&step.conditions.every(x=>meets(s.save,x))){
      if(step.type==='TYPE_PHRASE'){
        if(command.type!=='PHRASE'||command.phrase!==step.phrase){notice(s,'The words do not open the way.');return s;}
      }else if(command.type==='PHRASE')throw new Error('This interaction does not use a phrase');
      return openStepDialogue(s,c,q);
    }
    if(target.kind==='NPC'){const a=c.actors.find(a=>a.id===target.id)!;s.dialogue={id:a.defaultDialogueId,line:0,questId:null,stepId:null};}
    else if(target.id==='object.bed'){applyEffects(s,c,[{type:'restore'}]);notice(s,'Rested. HP and MP restored.');}
    else notice(s,'Nothing else happens here yet.');
  }else if(command.type==='PORTAL'){
    inWorld();const target=near(command.portalId);if(target.kind!=='PORTAL')throw new Error('Not a portal');
    const portal=mapFor(s,c).portals.find(p=>p.id===target.id)!;
    Object.assign(s.save.world,{mapId:portal.toMapId,...portal.spawn});
    s.save.world.unlockedMaps=[...new Set([...s.save.world.unlockedMaps,portal.toMapId])];
    s.visitedMaps=[...new Set([...s.visitedMaps,portal.toMapId])];
    const q=currentQuest(s,c),step=currentStep(s,c);
    if(q&&step?.type==='ENTER_MAP'&&step.mapId===portal.toMapId&&step.conditions.every(p=>meets(s.save,p)))s=openStepDialogue(s,c,q);
  }else if(command.type==='BATTLE_ACTION'){
    if(!s.battle||s.battle.units.find(u=>u.id===command.action.actorId)?.side!=='ALLY')throw new Error('Invalid allied action');
    let item:BattleAction['item'];
    if(command.action.kind==='ITEM'){
      const definition=c.items.find(i=>i.id===command.itemId);
      if(!definition||!(s.save.inventory[definition.id]!>0)||!['HP','MP','CURE','REVIVE'].includes(definition.kind))throw new Error('Item is unavailable');
      item={kind:definition.kind as NonNullable<BattleAction['item']>['kind'],power:definition.power};
    }
    s.battle=act(s.battle,{...command.action,item},c.spells);
    if(item)applyEffects(s,c,[{type:'transaction',items:{[command.itemId!]:-1}}]);
  }else if(command.type==='FINISH_BATTLE')return finishEncounter(s,c);
  else if(command.type==='EQUIP'){
    inWorld();const item=c.items.find(i=>i.id===command.itemId);
    if(!item?.slot||!(s.save.inventory[item.id]!>0)||ranks.indexOf(s.save.character.rank)<ranks.indexOf(item.minimumRank))throw new Error('Equipment requirements are not met');
    s.save.equipment[item.slot]=item.id;notice(s,item.name+' equipped.');
  }else if(command.type==='UNEQUIP'){
    inWorld();delete s.save.equipment[command.slot];const max=playerStats(s,c);s.hp=Math.min(s.hp,max.hp);s.mp=Math.min(s.mp,max.mp);
  }else if(command.type==='USE_ITEM'){
    inWorld();const item=c.items.find(i=>i.id===command.itemId),max=playerStats(s,c);
    if(!item||!(s.save.inventory[item.id]!>0)||!['HP','MP'].includes(item.kind))throw new Error('This item cannot be used here');
    if(item.kind==='HP'){if(s.hp===max.hp)throw new Error('HP is already full');s.hp=Math.min(max.hp,s.hp+item.power);}
    else {if(s.mp===max.mp)throw new Error('MP is already full');s.mp=Math.min(max.mp,s.mp+item.power);}
    applyEffects(s,c,[{type:'transaction',items:{[item.id]:-1}}]);
  }else if(command.type==='BUY'||command.type==='SELL'){
    const shop=service(command.serviceId),item=c.items.find(i=>i.id===command.itemId),n=command.quantity;
    if(shop.kind!=='SHOP'||!item||!Number.isSafeInteger(n)||n<1||n>99)throw new Error('Invalid shop transaction');
    if(command.type==='BUY'){
      if(!shop.itemIds.includes(item.id))throw new Error('This shop does not stock that item');
      applyEffects(s,c,[{type:'transaction',pin:-item.price*n,items:{[item.id]:n}}]);
    }else{
      if(item.kind==='QUEST'||item.sellPrice===0||Object.values(s.save.equipment).includes(item.id)&&(s.save.inventory[item.id]??0)-n<1)throw new Error('Quest or equipped items cannot be sold');
      applyEffects(s,c,[{type:'transaction',pin:item.sellPrice*n,items:{[item.id]:-n}}]);
    }
    notice(s,(command.type==='BUY'?'Bought ':'Sold ')+n+' × '+item.name+'.');
  }else if(command.type==='SERVICE'){
    const definition=service(command.serviceId);
    if(definition.kind==='SHOP')throw new Error('Choose an item to purchase');
    if(definition.kind==='LESSON'){
      const spell=c.spells.find(x=>x.id===definition.spellId)!;
      if(!spell||ranks.indexOf(s.save.character.rank)<ranks.indexOf(spell.minimumRank)||(s.save.spells[spell.id]??0)>=3)throw new Error('No eligible lesson');
      s.lessons[spell.id]=(s.lessons[spell.id]??0)+1;
      if(s.lessons[spell.id]!%definition.lessonCount===0){s.save.spells[spell.id]=(s.save.spells[spell.id]??0)+1;notice(s,spell.name+' proficiency increased.');}
      else notice(s,spell.name+': lesson '+s.lessons[spell.id]+' completed.');
    }else if(definition.kind==='HEAL')applyEffects(s,c,[{type:'restore'}]);
    else if(definition.kind==='PET_TRAIN'){
      const pet=s.save.pets.find(p=>p.id===command.petId);if(!pet)throw new Error('Select an owned pet');
      const species=c.pets.find(p=>p.id===pet.definitionId)!;if(pet.level>=species.maxLevel)throw new Error('Pet is at maximum level');
      pet.level++;pet.affinity=Math.min(100,pet.affinity+5);notice(s,species.name+' completed training.');
    }else if(definition.kind==='PROMOTION'){
      if(!definition.rank||ranks.indexOf(definition.rank)!==ranks.indexOf(s.save.character.rank)+1)throw new Error('Promotion is unavailable');
      applyEffects(s,c,[{type:'rank',rank:definition.rank}]);
    }else if(definition.kind==='TELEPORT'){
      const map=c.maps.find(m=>m.id===definition.toMapId);if(!map)throw new Error('Unknown teleport destination');Object.assign(s.save.world,{mapId:map.id,...map.spawn});
    }
    applyEffects(s,c,[{type:'transaction',pin:-definition.pinCost,virtuePoints:-definition.virtueCost}]);
  }else if(command.type==='TOGGLE_PET'){
    inWorld();if(!s.save.pets.some(p=>p.id===command.petId))throw new Error('Pet is not owned');
    if(s.save.activePetIds.includes(command.petId))s.save.activePetIds=s.save.activePetIds.filter(id=>id!==command.petId);
    else{if(s.save.activePetIds.length>=2)throw new Error('Only two pets can join the active party');s.save.activePetIds.push(command.petId);}
  }else if(command.type==='SELECT_QUEST'){
    inWorld();const q=c.quests.find(q=>q.id===command.questId);if(!q||!q.prerequisites.every(p=>meets(s.save,p))||s.save.quests[q.id]?.completed)throw new Error('Mission is unavailable');s.selectedQuestId=q.id;
  }
  return adventureStateSchema.parse(s);
}

/** Owns transactions and persistence. Scenes never decide rewards or quest transitions. */
export class AdventureSession {
  state:AdventureState;
  busy=false;
  error:string|null=null;
  private listeners=new Set<()=>void>();
  constructor(readonly campaign:Campaign,state:AdventureState,private store:AdventureStore){this.state=validateAdventure(state,campaign);}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private emit(){this.listeners.forEach(fn=>fn());}
  moveTo(position:Point):boolean {
    if(this.busy||this.state.dialogue||this.state.battle)return false;
    const path=findPath(mapFor(this.state,this.campaign),this.state.save.world,position);
    if(!path||path.length>2)return false;
    this.state={...this.state,save:{...this.state.save,world:{...this.state.save.world,...position}}};this.emit();return true;
  }
  tick(ticks=1){if(this.busy||!this.state.battle||this.state.battle.phase!=='ACTIVE')return;const next=tickBattle(this.state.battle,this.campaign.spells,ticks);if(next.tick!==this.state.battle.tick){this.state={...this.state,battle:next};this.emit();}}
  async dispatch(command:Command):Promise<void>{
    if(this.busy)throw new Error('A save is in progress');
    this.busy=true;this.error=null;this.emit();
    try {const next=reduceCommand(this.state,this.campaign,command);this.state=await this.store.commit(next,this.state.save.revision);}
    catch(error){this.error=error instanceof Error?error.message:String(error);throw error;}
    finally{this.busy=false;this.emit();}
  }
  async reload(){if(this.busy)return;const saved=await this.store.load();if(saved)this.state=saved;this.error=null;this.emit();}
}
export class BrowserAdventureStore implements AdventureStore {
  private key='arpia.adventure.v1';
  constructor(private campaign:Campaign){}
  async load(){const raw=localStorage.getItem(this.key);return raw?validateAdventure(JSON.parse(raw),this.campaign):null;}
  async commit(state:AdventureState,expectedRevision:number){
    if(!navigator.locks)throw new Error('This browser needs Web Locks for reliable saves.');
    return navigator.locks.request(this.key,async()=>{
      const current=await this.load();
      if((current?.save.revision??0)!==expectedRevision||current&&current.save.characterId!==state.save.characterId)throw new SaveConflict();
      const next=validateAdventure({...state,save:{...state.save,revision:expectedRevision+1}},this.campaign);
      localStorage.setItem(this.key,JSON.stringify(next));return next;
    });
  }
  async create(c:Campaign,name:string,element:Exclude<Element,'NONE'>,appearance:'male'|'female'){
    if(await this.load())throw new Error('A character already exists. Continue it or export and reset it first.');
    return this.commit(newAdventure(c,name,element,appearance,crypto.randomUUID()),0);
  }
  export(state:AdventureState){return JSON.stringify(validateAdventure(state,this.campaign),null,2);}
  prepareImport(raw:string){
    if(raw.length>2_000_000)throw new Error('Save backups must be smaller than 2 MB');
    return {state:validateAdventure(JSON.parse(raw),this.campaign),expectedRaw:localStorage.getItem(this.key)};
  }
  async import(raw:string,expectedRaw:string|null){
    const {state}=this.prepareImport(raw);
    if(!navigator.locks)throw new Error('Web Locks are required');
    return navigator.locks.request(this.key,async()=>{
      if(localStorage.getItem(this.key)!==expectedRaw)throw new SaveConflict();
      // An explicitly reviewed backup can recover an unreadable local save. Retain the raw original until setItem succeeds.
      let revision=0;try{revision=(await this.load())?.save.revision??0;}catch{/* The candidate has already passed full validation. */}
      const next=validateAdventure({...state,save:{...state.save,revision:revision+1}},this.campaign);
      localStorage.setItem(this.key,JSON.stringify(next));return next;
    });
  }
}
