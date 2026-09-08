import {z} from 'zod';
import {evidenceShape} from './research-schema.js';
import {elementSchema,rankSchema} from '../game/engine/model.js';
const id=z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const count=z.number().int().nonnegative().safe();
export const conditionSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('flag'),id,value:z.boolean()}).strict(),
  z.object({type:z.literal('inventory'),id,quantity:count.min(1)}).strict(),
  z.object({type:z.literal('quest'),id}).strict(),
  z.object({type:z.literal('level'),minimum:count.min(1)}).strict(),
  z.object({type:z.literal('rank'),minimum:rankSchema}).strict(),
  z.object({type:z.literal('element'),value:elementSchema}).strict(),
  z.object({type:z.literal('spell'),id,proficiency:count.min(1)}).strict(),
  z.object({type:z.literal('pet'),definitionId:id}).strict(),
]);
const transactionSchema=z.object({pin:z.number().int().safe().optional(),virtuePoints:z.number().int().safe().optional(),items:z.record(id,z.number().int().safe()).optional(),flags:z.record(id,z.boolean()).optional()}).strict();
export const questDefinitionSchema=z.object({
  id,...evidenceShape,prerequisites:z.array(conditionSchema),rewards:transactionSchema,
  steps:z.array(z.object({id,event:z.object({type:z.enum(['TALK','ENTER_MAP','INTERACT','TYPE_PHRASE','BATTLE']),targetId:id,phrase:z.string().min(1).optional()}).strict(),conditions:z.array(conditionSchema),effects:transactionSchema,dialogueId:id.optional(),...evidenceShape}).strict()).min(1),
}).strict().superRefine((q,ctx)=>{
  if(new Set(q.steps.map(s=>s.id)).size!==q.steps.length)ctx.addIssue({code:'custom',message:'Duplicate step ID'});
  for(const s of q.steps)if(s.event.type==='TYPE_PHRASE'&&!s.event.phrase)ctx.addIssue({code:'custom',message:'TYPE_PHRASE requires exact phrase'});
});
export const mapDefinitionSchema=z.object({
  id,...evidenceShape,backgroundAssetId:id,
  width:count.min(1).max(512),height:count.min(1).max(512),
  blocked:z.array(z.object({x:count,y:count}).strict()),
  portals:z.array(z.object({id,toMapId:id,conditions:z.array(conditionSchema)}).strict()),
  npcs:z.array(z.object({id,assetId:id,x:count,y:count,dialogueId:id}).strict()),
}).strict().superRefine((m,ctx)=>{
  for(const p of [...m.blocked,...m.npcs])if(p.x>=m.width||p.y>=m.height)ctx.addIssue({code:'custom',message:'Map position outside bounds'});
});
export const mazeDefinitionSchema=z.object({id,...evidenceShape,rooms:z.array(id).min(1),connections:z.array(z.object({id,from:id,to:id,conditions:z.array(conditionSchema)}).strict())}).strict().superRefine((m,ctx)=>{
  if(new Set(m.rooms).size!==m.rooms.length||new Set(m.connections.map(c=>c.id)).size!==m.connections.length)ctx.addIssue({code:'custom',message:'Duplicate maze room/door'});
  for(const c of m.connections)if(!m.rooms.includes(c.from)||!m.rooms.includes(c.to))ctx.addIssue({code:'custom',message:'Broken maze connection'});
});
