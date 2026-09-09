import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {manifestSchema} from '../../../../src/game/engine/assets';
import source from '../../../../public/assets/packs/public/manifest.json';
const manifest=manifestSchema.parse(source);
export async function GET(_request:Request,{params}:{params:Promise<{path:string[]}>}){
  if(process.env.NODE_ENV!=='development')return new Response(null,{status:404});
  const {path}=await params;
  const name=path.join('/');
  const allowed=new Set(Object.values(manifest.assets).map(a=>'packs/public/'+a.path));
  if(!allowed.has(name))return new Response(null,{status:404});
  const bytes=await readFile(resolve(process.cwd(),'public/assets',name));
  return new Response(bytes,{headers:{'Content-Type':name.endsWith('.svg')?'image/svg+xml':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
