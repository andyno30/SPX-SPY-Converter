import { z } from 'zod';
const safePath=z.string().regex(/^(characters|npcs|pets|monsters|maps|tilesets|portraits|ui|effects|bgm|sfx|items|equipment|furniture)\/[a-zA-Z0-9_/-]+\.(png|webp|jpg|svg|ogg|mp3|wav)$/).refine(p=>!p.split('/').some(part=>part==='..'||part==='.'||!part));
export const manifestSchema=z.object({
  id:z.enum(['public','reference']),version:z.number().int().positive(),
  assets:z.record(z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),z.object({
    path:safePath,type:z.enum(['image','audio']),
    rights:z.object({license:z.enum(['ORIGINAL','COMMISSIONED','CC0','REFERENCE_ONLY']),creator:z.string().min(1),source:z.string().min(1)}).strict(),
  }).strict()),
}).strict().superRefine((m,ctx)=>{
  if(m.id==='public'&&Object.values(m.assets).some(a=>a.rights.license==='REFERENCE_ONLY'))ctx.addIssue({code:'custom',message:'Public manifest contains reference-only media'});
});
export type AssetManifest=z.infer<typeof manifestSchema>;
export function assertPackSelection(pack:string,production:boolean):void {
  if(!['public','reference'].includes(pack))throw new Error('Unknown asset pack');
  if(production&&pack!=='public')throw new Error('Reference assets cannot be used in production');
}
export class AssetResolver {
  readonly manifest:AssetManifest;
  constructor(manifest:unknown,readonly base='/game/assets/packs/',production=false) {
    this.manifest=manifestSchema.parse(manifest);
    assertPackSelection(this.manifest.id,production);
    if(!base.startsWith('/')||base.startsWith('//')||base.includes('..')||/[?#%\\]/.test(base)||!base.endsWith('/'))throw new Error('Asset base must be a safe local directory');
  }
  resolve(id:string):string {
    const entry=Object.hasOwn(this.manifest.assets,id)?this.manifest.assets[id]:undefined;
    if(!entry)throw new Error(`Unresolved asset ID: ${id}`);
    return `${this.base}${this.manifest.id}/${entry.path}`;
  }
}
