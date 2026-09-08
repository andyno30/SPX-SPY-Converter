import { z } from 'zod';

export const elementSchema = z.enum(['FLAME', 'ICE', 'EARTH', 'NONE']);
export type Element = z.infer<typeof elementSchema>;
export const ranks = ['APPRENTICE', 'NOVICE', 'SKILLED', 'MAGE', 'ARCHMAGE', 'SAGE', 'GRAND_SAGE'] as const;
export const rankSchema = z.enum(ranks);
const integer = z.number().int().nonnegative().safe();
export const saveSchema = z.object({
  saveSchemaVersion: z.literal(1), revision: integer, characterId: z.string().min(1),
  character: z.object({ name: z.string().min(1).max(32), element: elementSchema, appearanceId: z.string().min(1), level: integer.min(1), rank: rankSchema, exp: integer }).strict(),
  currencies: z.object({ pin: integer, virtuePoints: integer }).strict(),
  inventory: z.record(integer), equipment: z.record(z.string()), spells: z.record(integer),
  pets: z.array(z.object({ id: z.string(), definitionId: z.string(), level: integer.min(1), affinity: integer }).strict()),
  activePetIds: z.array(z.string()).max(2), companionIds: z.array(z.string()).max(2),
  world: z.object({ mapId: z.string().min(1), x: z.number().finite(), y: z.number().finite(), flags: z.record(z.boolean()), discoveredRooms: z.array(z.string()), unlockedMaps: z.array(z.string()) }).strict(),
  quests: z.record(z.object({ stepIndex: integer, completed: z.boolean(), processedEventIds: z.array(z.string()) }).strict()),
}).strict().superRefine((s,ctx) => {
  const petIds = s.pets.map(p => p.id);
  if (new Set(petIds).size !== petIds.length || new Set(s.activePetIds).size !== s.activePetIds.length || s.activePetIds.some(id => !petIds.includes(id))) ctx.addIssue({code:'custom',message:'Active pets must be distinct owned pets'});
  if (new Set(s.companionIds).size !== s.companionIds.length) ctx.addIssue({code:'custom',message:'Duplicate companion'});
});
export type Save = z.infer<typeof saveSchema>;

/** Stable type-level support for all researched objective families, not implemented handlers. */
export const plannedObjectiveTypes = ['TALK','TRAVEL','ENTER_MAP','INTERACT','COLLECT','KILL','BATTLE','BOSS','ESCORT','FOLLOW','DELIVER','USE_ITEM','USE_MAGIC','LEARN_MAGIC','ATTEND_CLASS','EQUIP','PET_REQUIRED','PET_TRAIN','PUZZLE','QUIZ','TYPE_PHRASE','FIND_HIDDEN_OBJECT','MINIGAME','CUTSCENE','WAIT','MAIL_RECEIVE','MAIL_SEND','SHOP_PURCHASE','DORM_ACTION','CUSTOM_SCRIPT'] as const;

export type Condition =
  | { type: 'flag'; id: string; value: boolean }
  | { type: 'inventory'; id: string; quantity: number }
  | { type: 'quest'; id: string }
  | { type: 'level'; minimum: number }
  | { type: 'rank'; minimum: typeof ranks[number] }
  | { type: 'element'; value: Element }
  | { type: 'spell'; id: string; proficiency: number }
  | { type: 'pet'; definitionId: string };

export function meets(state: Save, condition: Condition): boolean {
  switch(condition.type) {
    case 'flag': return (state.world.flags[condition.id] ?? false) === condition.value;
    case 'inventory': return (state.inventory[condition.id] ?? 0) >= condition.quantity;
    case 'quest': return state.quests[condition.id]?.completed === true;
    case 'level': return state.character.level >= condition.minimum;
    case 'rank': return ranks.indexOf(state.character.rank) >= ranks.indexOf(condition.minimum);
    case 'element': return state.character.element === condition.value;
    case 'spell': return (state.spells[condition.id] ?? 0) >= condition.proficiency;
    case 'pet': return state.activePetIds.some(id => state.pets.some(p => p.id === id && p.definitionId === condition.definitionId));
  }
}

export function elementalRelation(a: Element,b: Element): 'strong'|'weak'|'neutral' {
  if(a==='NONE'||b==='NONE'||a===b) return 'neutral';
  return ({FLAME:'ICE',ICE:'EARTH',EARTH:'FLAME'} as const)[a]===b?'strong':'weak';
}

/** No historical multiplier is assumed. Balancing must be injected and labeled. */
export interface BalanceValue { historicalValue: number|null; runtimeValue: number; reason: string; provenance: 'RESTORATION'|'RECONSTRUCTED'|'VERIFIED' }
