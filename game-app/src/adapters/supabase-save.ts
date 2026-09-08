import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {saveSchema,type Save} from '../game/engine/model.js';
import {SaveConflict,type SaveStore} from '../game/engine/saves.js';

export interface ArpiaCloudConfig {url:string;publishableKey:string;privatePrototype:boolean}
export function createArpiaClient(config:ArpiaCloudConfig):SupabaseClient {
  if(!config.privatePrototype)throw new Error('Cloud reward validation is not ready for public play');
  const url=new URL(config.url);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use the dedicated new Supabase project URL');
  if(url.hostname==='isvzhpqrmjtqnqyyidxr.supabase.co')throw new Error('The existing SpyConverter Supabase project is forbidden for Arpia');
  if(!config.publishableKey.startsWith('sb_publishable_'))throw new Error('Use a publishable key from the NEW project; no secret/service-role keys');
  return createClient(config.url,config.publishableKey,{auth:{storageKey:'arpia.auth.v1',persistSession:true,autoRefreshToken:true}});
}
/** Private prototype snapshots only. Ownership is protected; rewards are not server verified. */
export class SupabaseSaveStore implements SaveStore {
  constructor(private client:SupabaseClient){}
  async load(id:string):Promise<Save|null> {
    const {data,error}=await this.client.from('arpia_saves').select('payload,revision').eq('character_id',id).maybeSingle();
    if(error)throw error;
    if(!data)return null;
    const parsed=saveSchema.parse(data.payload);
    if(parsed.characterId!==id||parsed.revision!==data.revision)throw new Error('Cloud save metadata mismatch');
    return parsed;
  }
  async commit(state:Save,expectedRevision:number):Promise<Save> {
    saveSchema.parse(state);
    if(expectedRevision!==state.revision)throw new SaveConflict();
    const {data,error}=await this.client.rpc('commit_arpia_save',{p_character_id:state.characterId,p_expected_revision:expectedRevision,p_payload:state});
    if(error){if(error.code==='40001')throw new SaveConflict();throw error;}
    const parsed=saveSchema.parse(data);
    if(parsed.characterId!==state.characterId||parsed.revision!==expectedRevision+1)throw new Error('Unexpected cloud commit result');
    return parsed;
  }
}
