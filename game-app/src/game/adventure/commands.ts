import {z} from 'zod';

const id=z.string().min(1).max(160);
const action=z.object({actorId:id,kind:z.enum(['ATTACK','SPELL','ITEM','WAIT','ESCAPE']),targetId:id.optional(),spellId:id.optional()}).strict();
/** Commands carry player intent only. Rewards, item power and destinations come from validated content. */
export const commandSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('INTERACT'),targetId:id}).strict(),
  z.object({type:z.literal('PORTAL'),portalId:id}).strict(),
  z.object({type:z.literal('NEXT_DIALOGUE')}).strict(),
  z.object({type:z.literal('PHRASE'),targetId:id,phrase:z.string().max(120)}).strict(),
  z.object({type:z.literal('BATTLE_ACTION'),action,itemId:id.optional()}).strict(),
  z.object({type:z.literal('FINISH_BATTLE')}).strict(),
  z.object({type:z.literal('EQUIP'),itemId:id}).strict(),
  z.object({type:z.literal('UNEQUIP'),slot:z.enum(['WAND','CLOTHES','HAT','ACCESSORY'])}).strict(),
  z.object({type:z.literal('USE_ITEM'),itemId:id}).strict(),
  z.object({type:z.literal('BUY'),serviceId:id,itemId:id,quantity:z.number().int().min(1).max(99)}).strict(),
  z.object({type:z.literal('SELL'),serviceId:id,itemId:id,quantity:z.number().int().min(1).max(99)}).strict(),
  z.object({type:z.literal('SERVICE'),serviceId:id,petId:id.optional()}).strict(),
  z.object({type:z.literal('TOGGLE_PET'),petId:id}).strict(),
  z.object({type:z.literal('SELECT_QUEST'),questId:id}).strict(),
  z.object({type:z.literal('SAVE')}).strict(),
]).superRefine((command,ctx)=>{
  if(command.type!=='BATTLE_ACTION')return;
  const {action,itemId}=command;
  const reject=(message:string)=>ctx.addIssue({code:'custom',message});
  if((action.kind==='ITEM')!==!!itemId)reject('Only an item action requires an inventory item');
  if((action.kind==='SPELL')!==!!action.spellId)reject('Only a spell action requires a spell');
  if(['ATTACK','ITEM'].includes(action.kind)&&!action.targetId)reject('This action requires a target');
  if(['WAIT','ESCAPE'].includes(action.kind)&&action.targetId)reject('This action does not use a target');
});
export type Command=z.infer<typeof commandSchema>;
