import {type Save,saveSchema} from '../game/engine/model.js';
import {migrateSave,SaveConflict,type SaveStore} from '../game/engine/saves.js';
export interface StoragePort {getItem(key:string):string|null;setItem(key:string,value:string):void}
export interface LockPort {request<T>(name:string,run:()=>Promise<T>):Promise<T>}
export class LocalSaveStore implements SaveStore {
  constructor(private storage:StoragePort,private locks:LockPort,private namespace='arpia.local.v1'){}
  private key(id:string){return `${this.namespace}:${encodeURIComponent(id)}`;}
  async load(id:string):Promise<Save|null> {
    const raw=this.storage.getItem(this.key(id));
    if(raw===null)return null;
    const save=migrateSave(JSON.parse(raw));
    if(save.characterId!==id)throw new Error('Save identity mismatch');
    return save;
  }
  async commit(state:Save,expectedRevision:number):Promise<Save> {
    return this.locks.request(this.key(state.characterId),async()=>{
      const current=await this.load(state.characterId);
      if((current?.revision??0)!==expectedRevision||state.revision!==expectedRevision)throw new SaveConflict();
      const next=saveSchema.parse({...state,revision:expectedRevision+1});
      // setItem is atomic; quota/security failures propagate and leave the previous save intact.
      this.storage.setItem(this.key(next.characterId),JSON.stringify(next));
      return next;
    });
  }
}
export function browserLocalSaveStore():LocalSaveStore {
  if(!navigator.locks)throw new Error('Reliable multi-tab saves require Web Locks in a secure browser context');
  return new LocalSaveStore(localStorage,{request:(name,run)=>navigator.locks.request(name,run)});
}
