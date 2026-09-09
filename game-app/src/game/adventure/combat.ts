import {z} from 'zod';
import {elementalRelation,elementSchema} from '../engine/model.js';
import {statusKinds,type Spell,type Stats} from './schema.js';

const number=z.number().int().nonnegative().safe();
export const combatantSchema=z.object({
  id:z.string(),name:z.string(),assetId:z.string(),side:z.enum(['ALLY','ENEMY']),role:z.enum(['PLAYER','PET','NPC','ENEMY']),element:elementSchema,
  hp:number,maxHP:number.positive(),mp:number,maxMP:number,attack:number.positive(),defense:number,magicAttack:number.positive(),magicDefense:number,agility:number.positive(),
  gauge:number.max(100),skillIds:z.array(z.string()),statuses:z.array(z.object({kind:z.enum(statusKinds),remaining:number.positive()}).strict()),
}).strict();
export const battleStateSchema=z.object({id:z.string(),phase:z.enum(['ACTIVE','VICTORY','DEFEAT','ESCAPED']),tick:number,seed:number,units:z.array(combatantSchema),log:z.array(z.string()).max(12),canEscape:z.boolean(),escapeTicks:number.nullable()}).strict();
export type Combatant=z.infer<typeof combatantSchema>;
export type Battle=z.infer<typeof battleStateSchema>;
export type BattleAction={actorId:string;kind:'ATTACK'|'SPELL'|'ITEM'|'WAIT'|'ESCAPE';targetId?:string;spellId?:string;item?:{kind:'HP'|'MP'|'CURE'|'REVIVE';power:number}};
export const RESTORATION_COMBAT={strong:1.25,weak:0.8,defenseFactor:0.45,tickMilliseconds:100,statusPeriod:10,escapeTicks:25} as const;
const has=(u:Combatant,s:typeof statusKinds[number])=>u.statuses.some(x=>x.kind===s);
export const isReady=(u:Combatant)=>u.hp>0&&u.gauge===100&&!has(u,'PARALYSIS')&&!has(u,'SLEEP');
function random(b:Battle):number {b.seed=(Math.imul(b.seed,1664525)+1013904223)>>>0;return b.seed/4294967296;}
function log(b:Battle,text:string){b.log=[...b.log,text].slice(-12);}
function checkEnd(b:Battle){
  if(!b.units.some(u=>u.side==='ENEMY'&&u.hp>0))b.phase='VICTORY';
  else if(!b.units.some(u=>u.side==='ALLY'&&u.hp>0))b.phase='DEFEAT';
  return b;
}
export function combatant(id:string,name:string,assetId:string,side:Combatant['side'],role:Combatant['role'],element:Combatant['element'],stats:Stats,skillIds:string[]):Combatant {
  return combatantSchema.parse({id,name,assetId,side,role,element,...stats,maxHP:stats.hp,maxMP:stats.mp,gauge:0,skillIds,statuses:[]});
}
export function startBattle(id:string,units:Combatant[],canEscape:boolean,seed=73):Battle {
  const allies=units.filter(u=>u.side==='ALLY');
  if(allies.filter(u=>u.role==='PLAYER').length!==1||allies.filter(u=>u.role==='PET').length>2||allies.filter(u=>u.role==='NPC').length>2||!units.some(u=>u.side==='ENEMY')||new Set(units.map(u=>u.id)).size!==units.length)throw new Error('Invalid battle party');
  return battleStateSchema.parse({id,phase:'ACTIVE',tick:0,seed,units,log:['The encounter begins.'],canEscape,escapeTicks:null});
}
export function damage(attacker:Combatant,target:Combatant,power:number,magic:boolean,element:Combatant['element']):number {
  const attack=(magic?attacker.magicAttack:attacker.attack)*(has(attacker,'CURSE')||has(attacker,magic?'MAGIC_DOWN':'ATTACK_DOWN')?0.75:1);
  const defense=(magic?target.magicDefense:target.defense)*(has(target,'CURSE')||has(target,magic?'MAGIC_DEFENSE_DOWN':'DEFENSE_DOWN')?0.75:1);
  const relation=elementalRelation(element,target.element);
  return Math.max(1,Math.round((attack+power-defense*RESTORATION_COMBAT.defenseFactor)*(relation==='strong'?1.25:relation==='weak'?0.8:1)));
}
export function act(input:Battle,action:BattleAction,spells:Spell[]):Battle {
  if(input.phase!=='ACTIVE')throw new Error('Battle is over');
  const b=structuredClone(input),actor=b.units.find(u=>u.id===action.actorId);
  if(!actor||!isReady(actor))throw new Error('This unit is not ready');
  if(action.kind==='WAIT'){actor.gauge=0;log(b,actor.name+' waits.');return b;}
  if(action.kind==='ESCAPE'){
    if(actor.role!=='PLAYER'||!b.canEscape)throw new Error('Escape is unavailable in this encounter');
    actor.gauge=0;b.escapeTicks=RESTORATION_COMBAT.escapeTicks;log(b,'Looking for a clear escape route…');return b;
  }
  const spell=action.kind==='SPELL'?spells.find(s=>s.id===action.spellId):undefined;
  if(action.kind==='SPELL'&&(!spell||!actor.skillIds.includes(spell.id)||actor.mp<spell.mpCost||has(actor,'SILENCE')))throw new Error('Spell is unavailable or MP is insufficient');
  const item=action.kind==='ITEM'?action.item:undefined;
  if(action.kind==='ITEM'&&(!item||actor.role!=='PLAYER'||!Number.isSafeInteger(item.power)||item.power<0))throw new Error('Invalid battle item');
  const supportive=!!item||!!spell&&['HEAL','CURE','REVIVE'].includes(spell.kind);
  const revive=item?.kind==='REVIVE'||spell?.kind==='REVIVE';
  const allowed=(u:Combatant)=>((supportive?u.side===actor.side:u.side!==actor.side)&&(revive?u.hp===0:u.hp>0));
  let targets:Combatant[];
  if(spell?.target==='ALL_ENEMIES'||spell?.target==='ALL_ALLIES') targets=b.units.filter(allowed);
  else if(spell?.target==='SELF')targets=[actor];
  else {const target=b.units.find(u=>u.id===action.targetId);if(!target||!allowed(target))throw new Error('Invalid target');targets=[target];}
  if(!targets.length)throw new Error('No eligible targets');
  // A single-target blind action can hit an ally. This compatibility behavior is explicit.
  if(has(actor,'BLIND')&&!supportive&&targets.length===1&&random(b)<0.5){const living=b.units.filter(u=>u.hp>0);targets=[living[Math.floor(random(b)*living.length)]!];log(b,actor.name+' loses sight of the target!');}
  actor.gauge=0;if(spell)actor.mp-=spell.mpCost;
  for(const target of targets){
    if(item||spell&&supportive){
      const kind=item?.kind??spell!.kind,power=item?.power??spell!.power+actor.magicAttack;
      if(kind==='MP')target.mp=Math.min(target.maxMP,target.mp+power);
      else if(kind==='CURE')target.statuses=[];
      else target.hp=Math.min(target.maxHP,target.hp+power);
      log(b,`${actor.name} ${item?'uses an item':'casts '+spell!.name} on ${target.name}.`);
    }else{
      if(spell?.kind!=='STATUS'){
        const hit=damage(actor,target,spell?.power??0,!!spell,spell?.element??actor.element);
        target.hp=Math.max(0,target.hp-hit);target.statuses=target.statuses.filter(s=>s.kind!=='SLEEP');
        if(target.side==='ALLY'&&b.escapeTicks!==null){b.escapeTicks=null;log(b,'The escape attempt was interrupted.');}
        log(b,`${actor.name} ${spell?'casts '+spell.name:'attacks'}: ${target.name} loses ${hit} HP.`);
      }
      if(spell?.status&&target.hp>0){target.statuses=target.statuses.filter(s=>s.kind!==spell.status);target.statuses.push({kind:spell.status,remaining:spell.duration??30});}
      if(target.hp===0){target.gauge=0;target.statuses=[];log(b,target.name+' is unable to fight.');}
    }
  }
  return checkEnd(b);
}
/** Fixed ticks and a wait-at-ready mode make play deterministic and touch/keyboard friendly. */
export function tickBattle(input:Battle,spells:Spell[],ticks=1):Battle {
  if(!Number.isInteger(ticks)||ticks<0||ticks>1000)throw new Error('Invalid tick count');
  let b=structuredClone(input);
  for(let i=0;i<ticks&&b.phase==='ACTIVE';i++){
    if(b.units.some(u=>u.side==='ALLY'&&isReady(u)))break;
    b.tick++;
    for(const unit of b.units){
      if(unit.hp===0)continue;
      if(b.tick%RESTORATION_COMBAT.statusPeriod===0&&unit.statuses.some(s=>['POISON','BURN','BLEED'].includes(s.kind))){
        unit.hp=Math.max(0,unit.hp-Math.max(1,Math.floor(unit.maxHP/16)));
        if(unit.side==='ALLY'&&b.escapeTicks!==null){b.escapeTicks=null;log(b,'The escape attempt was interrupted.');}
        if(unit.hp===0){unit.gauge=0;unit.statuses=[];log(b,unit.name+' is unable to fight.');}
      }
      unit.statuses=unit.statuses.map(s=>({...s,remaining:s.remaining-1})).filter(s=>s.remaining>0);
      if(unit.hp>0&&!has(unit,'PARALYSIS')&&!has(unit,'SLEEP'))unit.gauge=Math.min(100,unit.gauge+Math.max(1,Math.floor(unit.agility*(has(unit,'SLOW')?0.5:1))));
    }
    checkEnd(b);if(b.phase!=='ACTIVE')break;
    for(const enemy of b.units.filter(u=>u.side==='ENEMY'&&isReady(u))){
      const targets=b.units.filter(u=>u.side==='ALLY'&&u.hp>0);if(!targets.length)break;
      const available=spells.find(s=>enemy.skillIds.includes(s.id)&&s.mpCost<=enemy.mp&&s.kind==='DAMAGE'&&!has(enemy,'SILENCE'));
      b=act(b,{actorId:enemy.id,kind:available&&b.tick%3===0?'SPELL':'ATTACK',spellId:available?.id,targetId:targets[Math.floor(random(b)*targets.length)]!.id},spells);
      if(b.phase!=='ACTIVE')break;
    }
    if(b.phase==='ACTIVE'&&b.escapeTicks!==null&&--b.escapeTicks<=0){b.phase='ESCAPED';log(b,'The party escaped.');}
  }
  return b;
}
