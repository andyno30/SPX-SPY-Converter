import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditEnvironment,auditText,auditPublic,auditAppImports} from '../scripts/public-release-audit.js';
import {gameUrl} from '../src/deployment.js';

test('release environment rejects reference selection, cheats, exposed secrets and local endpoints',()=>{
  auditEnvironment({NEXT_PUBLIC_ASSET_PACK:'public',ARPIA_CLOUD_PROTOTYPE:'false'});
  for(const env of [{NEXT_PUBLIC_ASSET_PACK:'reference'},{NEXT_PUBLIC_GAME_DEBUG:'true'},{ARPIA_CLOUD_PROTOTYPE:'true'},{NEXT_PUBLIC_SERVICE_ROLE_KEY:'bad'},{NEXT_PUBLIC_SUPABASE_URL:'http://localhost:1234'}]) assert.throws(()=>auditEnvironment(env));
  assert.throws(()=>auditText('sb_secret_'+'a'.repeat(20),'fixture'));
  const jwt=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from('{"role":"service_role"}').toString('base64url')+'.signature';
  assert.throws(()=>auditText(jwt,'fixture'));
});
test('public allowlist rejects renamed reference bytes, directories, and symlink escapes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'arpia-release-'));
  try {
    const pack=join(dir,'assets/packs/public');mkdirSync(pack,{recursive:true});
    writeFileSync(join(pack,'manifest.json'),JSON.stringify({id:'public',version:1,assets:{}}));auditPublic(dir);
    const stray=join(pack,'renamed.png');writeFileSync(stray,'historical bytes');assert.throws(()=>auditPublic(dir));rmSync(stray);
    const reference=join(dir,'assets/packs/reference');mkdirSync(reference);writeFileSync(join(reference,'portrait.png'),'private');assert.throws(()=>auditPublic(dir));rmSync(reference,{recursive:true});
    const documentation=join(dir,'game-docs');mkdirSync(documentation);assert.throws(()=>auditPublic(dir),/Private public directory/);rmSync(documentation,{recursive:true});
    symlinkSync(tmpdir(),join(dir,'escape'));assert.throws(()=>auditPublic(dir));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('host imports cannot pull research, prototype gameplay, computed modules, or outside files',()=>{
  const dir=mkdtempSync(join(tmpdir(),'arpia-imports-'));
  try {
    mkdirSync(join(dir,'src/app'),{recursive:true});mkdirSync(join(dir,'research'));
    writeFileSync(join(dir,'research/private.ts'),'export default 1;');
    mkdirSync(join(dir,'src/game-docs'));writeFileSync(join(dir,'src/game-docs/private.ts'),'export default 1;');
    for(const code of ["import secret from '../../research/private'", "import notes from '../game-docs/private'", "import('phaser')", 'import(someVariable)']) {
      writeFileSync(join(dir,'src/app/page.ts'),code);assert.throws(()=>auditAppImports(dir));
    }
    writeFileSync(join(dir,'src/app/page.ts'),'export default 1;');auditAppImports(dir);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('game URL helper preserves mounting prefix and refuses traversal',()=>{
  assert.equal(gameUrl('/api/health'),'/game/api/health');assert.equal(gameUrl(),'/game');
  for(const path of ['//elsewhere','/../research','/%2e%2e','relative']) assert.throws(()=>gameUrl(path));
});
