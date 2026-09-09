import {z} from 'zod';
import {evidenceShape} from '../../content/research-schema.js';
import {conditionSchema} from '../../content/runtime-schema.js';
import {elementSchema,rankSchema} from '../engine/model.js';

const id=z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const count=z.number().int().nonnegative().safe();
const point=z.object({x:count,y:count}).strict();
const evidence=z.object(evidenceShape).strict();
export const effectSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('transaction'),pin:z.number().int().safe().optional(),virtuePoints:z.number().int().safe().optional(),items:z.record(z.number().int().safe()).optional(),flags:z.record(z.boolean()).optional()}).strict(),
  z.object({type:z.literal('exp'),amount:count}).strict(),
  z.object({type:z.literal('pet'),petId:id}).strict(),
  z.object({type:z.literal('starterPet')}).strict(),
  z.object({type:z.literal('spell'),spellId:id}).strict(),
  z.object({type:z.literal('companion'),actorId:id,join:z.boolean()}).strict(),
  z.object({type:z.literal('restore')}).strict(),
  z.object({type:z.literal('rank'),rank:rankSchema}).strict(),
]);
export const adventureQuestSchema=z.object({
  id,episodeNumber:count.max(102).nullable(),name:z.string().min(1),summary:z.string(),...evidenceShape,
  prerequisites:z.array(conditionSchema),repeatable:z.boolean().default(false),
  steps:z.array(z.object({
    id,label:z.string().min(1),mapId:id,targetId:id,
    type:z.enum(['TALK','ENTER_MAP','INTERACT','TYPE_PHRASE','BATTLE','COLLECT','ATTEND_CLASS','EQUIP','PET_TRAIN','QUIZ']),
    phrase:z.string().optional(),quantity:count.positive().optional(),dialogueId:id.optional(),
    conditions:z.array(conditionSchema),effects:z.array(effectSchema),...evidenceShape,
  }).strict()).min(1),rewards:z.array(effectSchema),balanceNotes:z.string(),
}).strict();
export const worldMapSchema=z.object({
  id,name:z.string().min(1),...evidenceShape,geometryEvidence:evidence,
  width:count.min(5).max(64),height:count.min(5).max(64),spawn:point,blocked:z.array(point),
  backgroundAssetId:id,theme:z.enum(['GROUNDS','HALL','CLASSROOM','OFFICE','VILLAGE','SHOP','FOREST','BASEMENT','ARENA','MAZE','LIBRARY','DORM']),
  npcs:z.array(z.object({actorId:id,position:point,conditions:z.array(conditionSchema).default([])}).strict()),
  objects:z.array(z.object({id,name:z.string(),assetId:id,position:point,conditions:z.array(conditionSchema).default([])}).strict()),
  portals:z.array(z.object({id,name:z.string(),position:point,toMapId:id,spawn:point,conditions:z.array(conditionSchema),element:elementSchema.optional()}).strict()),
  encounters:z.array(z.object({id,battleId:id,position:point,conditions:z.array(conditionSchema)}).strict()),
}).strict();
const stats=z.object({hp:count.positive(),mp:count,attack:count.positive(),defense:count,magicAttack:count.positive(),magicDefense:count,agility:count.positive().max(100)}).strict();
export const actorSchema=z.object({id,name:z.string(),koOriginal:z.string().nullable(),spriteAssetId:id,portraitAssetId:id,element:elementSchema,defaultDialogueId:id,stats,skillIds:z.array(id),...evidenceShape,balanceEvidence:evidence}).strict();
export const dialogueSchema=z.object({id,lines:z.array(z.object({speakerId:id,text:z.string().min(1).max(600)}).strict()).min(1),...evidenceShape}).strict();
export const statusKinds=['POISON','BURN','BLEED','PARALYSIS','SLEEP','SILENCE','BLIND','SLOW','ATTACK_DOWN','MAGIC_DOWN','DEFENSE_DOWN','MAGIC_DEFENSE_DOWN','CURSE'] as const;
export const spellDefinitionSchema=z.object({id,name:z.string(),element:elementSchema,mpCost:count,power:count,target:z.enum(['ENEMY','ALL_ENEMIES','ALLY','ALL_ALLIES','SELF']),kind:z.enum(['DAMAGE','HEAL','CURE','REVIVE','STATUS']),status:z.enum(statusKinds).optional(),duration:count.optional(),minimumRank:rankSchema,assetId:id,...evidenceShape,balanceEvidence:evidence}).strict();
export const itemDefinitionSchema=z.object({id,name:z.string(),description:z.string(),kind:z.enum(['HP','MP','CURE','REVIVE','QUEST','EQUIPMENT','MATERIAL','FURNITURE']),power:count,price:count,sellPrice:count,slot:z.enum(['WAND','CLOTHES','HAT','ACCESSORY']).optional(),bonus:stats.partial().optional(),minimumRank:rankSchema,assetId:id,...evidenceShape,balanceEvidence:evidence}).strict();
export const petDefinitionSchema=z.object({id,name:z.string(),element:elementSchema,maxLevel:count.positive(),evolutionLevel:count.positive(),spriteAssetId:id,evolvedAssetId:id,skillIds:z.array(id),stats,...evidenceShape,balanceEvidence:evidence}).strict();
export const battleDefinitionSchema=z.object({id,name:z.string(),enemyIds:z.array(id).min(1).max(5),backgroundAssetId:id,canEscape:z.boolean(),rewards:z.array(effectSchema),...evidenceShape,balanceEvidence:evidence}).strict();
export const serviceSchema=z.object({id,actorId:id,mapId:id,name:z.string(),kind:z.enum(['SHOP','LESSON','HEAL','PET_TRAIN','PROMOTION','TELEPORT','DORM']),itemIds:z.array(id).default([]),spellId:id.optional(),rank:rankSchema.optional(),toMapId:id.optional(),pinCost:count,virtueCost:count,lessonCount:count.positive(),conditions:z.array(conditionSchema),...evidenceShape,balanceEvidence:evidence}).strict();
export const campaignSchema=z.object({version:z.literal(1),title:z.string(),startMapId:id,
  origins:z.array(z.object({element:elementSchema,name:z.string(),mapId:id,startingSpellId:id,petId:id,maleAssetId:id,femaleAssetId:id,stats,...evidenceShape,balanceEvidence:evidence}).strict()).length(3),
  quests:z.array(adventureQuestSchema),maps:z.array(worldMapSchema),actors:z.array(actorSchema),dialogue:z.array(dialogueSchema),spells:z.array(spellDefinitionSchema),items:z.array(itemDefinitionSchema),pets:z.array(petDefinitionSchema),battles:z.array(battleDefinitionSchema),services:z.array(serviceSchema)}).strict();
export type Campaign=z.infer<typeof campaignSchema>;
export type AdventureQuest=Campaign['quests'][number];
export type WorldMap=Campaign['maps'][number];
export type Actor=Campaign['actors'][number];
export type Effect=z.infer<typeof effectSchema>;
export type Spell=Campaign['spells'][number];
export type Item=Campaign['items'][number];
export type Stats=z.infer<typeof stats>;
