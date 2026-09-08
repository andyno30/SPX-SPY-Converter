import {existsSync,readFileSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,join,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import nextEnv from '@next/env';
import {assertPackSelection,manifestSchema} from '../src/game/engine/assets.js';
import {deployment} from '../src/deployment.js';

export const root=fileURLToPath(new URL('..',import.meta.url));
const privatePath=/(^|[/\\])(reference|private-assets|research|docs|tests|supabase|dev|debug)([/\\]|$)/i;
export function auditText(text:string,location:string):void {
  if (/sb_secret_[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw new Error('Secret in '+location);
  for (const jwt of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    let payload;
    try {payload=JSON.parse(Buffer.from(jwt[0].split('.')[1]!, 'base64url').toString());} catch {continue;}
    if (payload.role==='service_role') throw new Error('Service-role key in '+location);
  }
  if (/https?:\/\/(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\])(?=[:/"'\s]|$)/i.test(text)) throw new Error('Local URL in '+location);
}
export function auditEnvironment(env:Record<string,string|undefined>):void {
  assertPackSelection(env.NEXT_PUBLIC_ASSET_PACK??'public',true);
  for (const [key,value] of Object.entries(env)) {
    if (/^(NEXT_PUBLIC_)?(ARPIA_.*|GAME_.*|.*CHEATS?|.*DEBUG.*)$/.test(key) && value && !['false','0','off'].includes(value.toLowerCase())) throw new Error('Development flag enabled: '+key);
    if (/^NEXT_PUBLIC_/.test(key) && /SECRET|SERVICE_ROLE|PASSWORD|DATABASE/.test(key) && value) throw new Error('Server-only environment variable exposed: '+key);
    if (key.startsWith('NEXT_PUBLIC_') && value) auditText(value,key);
  }
}
export function walk(dir:string):string[] {
  if (lstatSync(dir).isSymbolicLink()) throw new Error('Symlink in release input: '+dir);
  return readdirSync(dir).flatMap(name=>{
    const path=join(dir,name),stat=lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Symlink in release input: '+path);
    return stat.isDirectory()?walk(path):[path];
  });
}
export function auditPublic(publicDir:string):void {
  const checkDirectories=(dir:string)=>{
    for(const entry of readdirSync(dir,{withFileTypes:true})) if(entry.isDirectory()) {
      const path=join(dir,entry.name);
      if(privatePath.test(relative(publicDir,path))) throw new Error('Private public directory: '+path);
      checkDirectories(path);
    }
  };
  checkDirectories(publicDir);
  const pack='assets/packs/public/';
  const manifest=manifestSchema.parse(JSON.parse(readFileSync(join(publicDir,pack,'manifest.json'),'utf8')));
  assertPackSelection(manifest.id,true);
  const allowed=new Set([pack+'manifest.json',...Object.values(manifest.assets).map(a=>pack+a.path)]);
  for (const file of walk(publicDir)) {
    const path=relative(publicDir,file);
    if (privatePath.test(path)||!allowed.has(path)) throw new Error('Unapproved public file: '+path);
    if (/\.(svg|json|js|html|css|txt)$/i.test(path)) auditText(readFileSync(file,'utf8'),path);
    if (path.endsWith('.svg') && /<script|<foreignObject|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|data:|\/\/)/i.test(readFileSync(file,'utf8'))) throw new Error('Active/external SVG content: '+path);
  }
  for (const path of allowed) if (!existsSync(join(publicDir,path))) throw new Error('Missing approved asset: '+path);
}
export function auditAppImports(appRoot:string,appDir=join(appRoot,'src/app')):void {
  const visited=new Set<string>();
  const visit=(file:string)=>{
    if (visited.has(file)) return;
    visited.add(file);
    const rel=relative(appRoot,file);
    if (rel.startsWith('..')||privatePath.test(rel)||!rel.startsWith('src/')) throw new Error('Non-runtime import: '+rel);
    if (/src\/(adapters|game|content)\//.test(rel)) throw new Error('Hosting preview must not load gameplay: '+rel);
    if (lstatSync(file).isSymbolicLink()) throw new Error('Symlink import: '+rel);
    const text=readFileSync(file,'utf8');auditText(text,rel);
    const imports:string[]=[];
    const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    const check=(node:ts.Node)=>{
      if ((ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(tree)==='require')) {
        const arg=node.arguments[0];
        if (!arg||!ts.isStringLiteral(arg)) throw new Error('Computed module loading not allowed in release host: '+rel);
        imports.push(arg.text);
      }
      ts.forEachChild(node,check);
    };check(tree);
    for (const name of imports) {
      if (!name.startsWith('.')) {
        if (!/^(react|react-dom|next)(\/|$)/.test(name)) throw new Error('Unexpected preview dependency: '+name);
        continue;
      }
      const base=resolve(dirname(file),name.replace(/\.js$/,''));
      const target=[base,...['.ts','.tsx','.css','/index.ts','/index.tsx'].map(ext=>base+ext)].find(p=>existsSync(p)&&lstatSync(p).isFile());
      if (!target) throw new Error('Unresolved import: '+name);
      visit(target);
    }
  };
  walk(appDir).filter(f=>/\.(tsx?|css)$/.test(f)).forEach(visit);
}
export function auditSource(appRoot=root,env=process.env):void {
  auditEnvironment(env);
  if (deployment.mode!=='hosting-preview'||deployment.gameplayEnabled||deployment.cloudSavesEnabled) throw new Error('Run gameplay release gates before enabling gameplay or cloud saves');
  auditPublic(join(appRoot,'public'));
  auditAppImports(appRoot);
}
export function auditOutput(appRoot=root):void {
  const next=join(appRoot,'.next');
  if (!existsSync(join(next,'BUILD_ID'))) throw new Error('No completed Next.js production build');
  const routes=JSON.parse(readFileSync(join(next,'routes-manifest.json'),'utf8'));
  if (routes.basePath!=='/game') throw new Error('Build does not use /game');
  for (const dir of ['server','static']) for (const file of walk(join(next,dir))) {
    const rel=relative(next,file);
    if (privatePath.test(rel)) throw new Error('Private path in output: '+rel);
    if (/\.(js|json|html|css|txt|rsc)$/.test(file)) {
      const text=readFileSync(file,'utf8');auditText(text,rel);
      if (/private-assets|content\/research|assets\/packs\/reference|commit_arpia_save|arpia_saves/.test(text)) throw new Error('Private content/prototype code in output: '+rel);
      if (file.endsWith('.nft.json')) for (const dependency of JSON.parse(text).files as string[]) {
        const target=relative(appRoot,resolve(dirname(file),dependency));
        if (target.startsWith('..')||(!target.startsWith('node_modules/')&&privatePath.test(target))) throw new Error('Unsafe deployment trace: '+target);
      }
    }
  }
}
if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    nextEnv.loadEnvConfig(root,false);
    auditSource();
    if (!process.argv.includes('--source-only')) auditOutput();
    console.log('PASS: public hosting preview audit. Gameplay/cloud saves remain disabled; this is not gameplay release approval.');
  } catch (error) {console.error('PUBLIC RELEASE BLOCKED: '+String(error));process.exitCode=1;}
}
