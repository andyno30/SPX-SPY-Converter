import { saveSchema, type Save } from './model.js';

export interface Transaction {
  pin?: number; virtuePoints?: number; items?: Record<string,number>; flags?: Record<string,boolean>;
}
function adjusted(value:number, delta:number):number {
  if(!Number.isSafeInteger(delta) || !Number.isSafeInteger(value+delta) || value+delta<0) throw new Error('Invalid or unaffordable transaction');
  return value+delta;
}
/** Pure and atomic: original state is untouched even if the last item is unaffordable. */
export function transact(state:Save, tx:Transaction):Save {
  const next=structuredClone(state);
  next.currencies.pin=adjusted(next.currencies.pin,tx.pin??0);
  next.currencies.virtuePoints=adjusted(next.currencies.virtuePoints,tx.virtuePoints??0);
  for(const [id,delta] of Object.entries(tx.items??{})) {
    next.inventory[id]=adjusted(next.inventory[id]??0,delta);
    if(next.inventory[id]===0) delete next.inventory[id];
  }
  Object.assign(next.world.flags,tx.flags??{});
  return saveSchema.parse(next);
}
