import {saveSchema,type Save} from './model.js';

export interface SaveStore {
  load(characterId:string):Promise<Save|null>;
  commit(state:Save,expectedRevision:number):Promise<Save>;
}
export class SaveConflict extends Error { constructor(){super('Save changed elsewhere. Reload or resolve the conflict before saving.');} }
/** Reject corrupt/future saves. v0 is our own foundation format, not historical client data. */
export function migrateSave(input:unknown):Save {
  if(typeof input!=='object'||input===null)throw new Error('Invalid save envelope');
  const data=input as Record<string,unknown>;
  if(data.saveSchemaVersion===0)return saveSchema.parse({...data,saveSchemaVersion:1,revision:0});
  return saveSchema.parse(data);
}
export const autosaveReasons=['QUEST_STEP','BATTLE_END','ITEM_TRANSACTION','SPELL_LESSON','RANK_PROMOTION','PET_TRAINING','EQUIPMENT_CHANGE','WORLD_UNLOCK','CURRENCY_CHANGE'] as const;
export type AutosaveReason=typeof autosaveReasons[number];
/** The host invokes this for committed transactions, never animation/movement frames. */
export class SaveSystem {
  constructor(private store:SaveStore){}
  async save(state:Save,reason:AutosaveReason):Promise<Save> {
    if(!autosaveReasons.includes(reason))throw new Error('Unsupported save trigger');
    const validated=saveSchema.parse(state);
    return this.store.commit(validated,validated.revision);
  }
}
