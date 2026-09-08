import {readFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceSchema,researchRecordSchema,missionSchema} from '../../src/content/research-schema.js';
import {questDefinitionSchema,mapDefinitionSchema,mazeDefinitionSchema} from '../../src/content/runtime-schema.js';
import {manifestSchema} from '../../src/game/engine/assets.js';

export const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
export const readJson=(path:string):unknown=>JSON.parse(readFileSync(join(root,path),'utf8'));
const array=(x:unknown):unknown[]=>{if(!Array.isArray(x))throw new Error('Expected catalog array');return x;};
export function loadCatalog(){
  const sources=array(readJson('content/research/sources.json')).map(x=>sourceSchema.parse(x));
  const main=array(readJson('content/research/missions.json')).map(x=>missionSchema.parse(x));
  const free=array(readJson('content/research/free-missions.json')).map(x=>missionSchema.parse(x));
  const records=['npcs','maps','pets','spells','monsters','items'].flatMap(name=>array(readJson(`content/research/${name}.json`)).map(x=>researchRecordSchema.parse(x)));
  return {sources,main,free,records};
}
export function assertAcyclic(graph:Map<string,string[]>):void {
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(id:string)=>{if(visiting.has(id))throw new Error(`Quest dependency cycle: ${id}`);if(done.has(id))return;visiting.add(id);for(const dep of graph.get(id)??[]){if(!graph.has(dep))throw new Error(`Unknown quest dependency: ${dep}`);visit(dep);}visiting.delete(id);done.add(id);};
  for(const id of graph.keys())visit(id);
}
const jsonFiles=(dir:string):string[]=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?jsonFiles(path):name.endsWith('.json')?[path]:[];});
export function checkContent(){
  const catalog=loadCatalog(),{sources,main,free,records}=catalog;
  const sourceIds=new Map(sources.map(s=>[s.id,s]));
  if(sourceIds.size!==sources.length)throw new Error('Duplicate source ID');
  const all=[...main,...free,...records],ids=new Set(all.map(x=>x.id));
  if(ids.size!==all.length)throw new Error('Duplicate content ID');
  const nums=main.map(m=>m.episodeNumber);
  if(main.length!==103||new Set(nums).size!==103||nums.some((_,i)=>!nums.includes(i)))throw new Error('Episodes must cover exactly 0–102');
  for(const record of all){
    for(const ev of [record,...record.claims])for(const n of ev.sourceNotes){
      const source=sourceIds.get(n.sourceId);
      if(!source||source.accessStatus==='UNAVAILABLE')throw new Error(`${record.id}: unavailable/unknown claim source ${n.sourceId}`);
      if(ev.provenance==='VERIFIED'&&source.type==='USER_BRIEF')throw new Error(`${record.id}: brief alone cannot verify history`);
    }
    for(const c of record.claims)if(c.field.endsWith('Id')&&typeof c.value==='string'&&!ids.has(c.value))throw new Error(`${record.id}: broken claim ID ${c.value}`);
  }
  for(const m of [...main,...free])for(const v of m.titleVariants)if(!sourceIds.has(v.sourceId))throw new Error(`Unknown title source ${v.sourceId}`);
  for(const r of records)for(const id of r.relatedIds)if(!ids.has(id))throw new Error(`Broken research relationship ${id}`);
  const manifest=manifestSchema.parse(readJson('public/assets/packs/public/manifest.json'));
  const discovery=readJson('content/research/discovery.json') as {accessedDate?:unknown;method?:unknown;articles?:unknown};
  if(typeof discovery.accessedDate!=='string'||typeof discovery.method!=='string'||!Array.isArray(discovery.articles))throw new Error('Invalid source discovery envelope');
  for(const a of discovery.articles){
    if(!a||typeof a.url!=='string'||!/^https:\/\/(wonavy|alicer)\.tistory\.com\/\d+$/.test(a.url)||typeof a.title!=='string'||typeof a.accessible!=='boolean')throw new Error('Invalid discovery record');
    if(a.accessible&&(!Array.isArray(a.episodeHeadings)||a.episodeHeadings.some((s:unknown)=>typeof s!=='string')||!Number.isInteger(a.imageReferences)))throw new Error('Invalid accessible discovery evidence');
  }
  // Unknown schemas fail closed: catalog records can never silently become runtime content.
  const quests:ReturnType<typeof questDefinitionSchema.parse>[]=[],maps:ReturnType<typeof mapDefinitionSchema.parse>[]=[];
  const knownResearch=new Set(['sources','missions','free-missions','npcs','maps','pets','spells','monsters','items','discovery']);
  for(const path of jsonFiles(join(root,'content'))){
    const rel=relative(join(root,'content'),path),data=JSON.parse(readFileSync(path,'utf8'));
    if(rel.startsWith('research/')){if(!knownResearch.has(rel.slice(9,-5)))throw new Error(`Unregistered research schema: ${rel}`);continue;}
    if(rel.startsWith('missions/'))quests.push(questDefinitionSchema.parse(data));
    else if(rel.startsWith('maps/'))maps.push(mapDefinitionSchema.parse(data));
    else if(rel.startsWith('mazes/'))mazeDefinitionSchema.parse(data);
    else throw new Error(`Runtime schema must be added before activating ${rel}`);
  }
  const runtimeMapIds=new Set(maps.map(m=>m.id)),runtimeQuestIds=new Set(quests.map(q=>q.id));
  if(runtimeMapIds.size!==maps.length||runtimeQuestIds.size!==quests.length)throw new Error('Duplicate runtime ID');
  for(const m of maps){
    if(!manifest.assets[m.backgroundAssetId])throw new Error(`Missing runtime map asset ${m.backgroundAssetId}`);
    for(const p of m.portals)if(!runtimeMapIds.has(p.toMapId))throw new Error(`Broken portal ${p.id}`);
    for(const npc of m.npcs){if(!ids.has(npc.id)||!manifest.assets[npc.assetId])throw new Error(`Broken NPC/asset ${npc.id}`);throw new Error(`Dialogue schema required before activating ${npc.dialogueId}`);}
  }
  assertAcyclic(new Map(quests.map(q=>[q.id,[...q.prerequisites,...q.steps.flatMap(s=>s.conditions)].filter(c=>c.type==='quest').map(c=>c.id)])));
  for(const m of [...main,...free])if(m.runtimeDefinitionId&&!runtimeQuestIds.has(m.runtimeDefinitionId))throw new Error(`Missing runtime definition ${m.runtimeDefinitionId}`);
  for(const q of quests){
    for(const step of q.steps){
      if(step.event.type==='ENTER_MAP'&&!runtimeMapIds.has(step.event.targetId))throw new Error(`Unknown runtime map ${step.event.targetId}`);
      if(step.event.type!=='ENTER_MAP')throw new Error(`Register runtime target/dialogue schema before activating ${step.id}`);
    }
    for(const tx of [q.rewards,...q.steps.map(s=>s.effects)])for(const id of Object.keys(tx.items??{}))if(!records.some(r=>r.kind==='item'&&r.id===id))throw new Error(`Unknown reward item ${id}`);
  }
  return {...catalog,runtimeQuestCount:quests.length,runtimeMapCount:maps.length,approvedAssets:Object.keys(manifest.assets).length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const c=checkContent();console.log(`Validated ${c.main.length} main missions, ${c.free.length} Free Missions, ${c.records.length} entity records and ${c.sources.length} sources. Runtime quests: ${c.runtimeQuestCount}. Approved assets: ${c.approvedAssets}.`);
}
