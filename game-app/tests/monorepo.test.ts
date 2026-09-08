import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

test('Vercel builds for game changes and skips News-only changes; missing history builds',()=>{
  const dir=mkdtempSync(join(tmpdir(),'arpia-monorepo-'));
  const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    mkdirSync(join(dir,'game-app/scripts'),{recursive:true});mkdirSync(join(dir,'news-app'));
    copyFileSync(new URL('../scripts/vercel-ignore-build.mjs',import.meta.url),join(dir,'game-app/scripts/vercel-ignore-build.mjs'));
    git('init');
    const commit=(name:string)=>{git('add','.');git('-c','user.name=Arpia Test','-c','user.email=test@example.invalid','commit','-m',name);return git('rev-parse','HEAD');};
    const first=commit('Initial');writeFileSync(join(dir,'news-app/change'),'news');const news=commit('News');
    writeFileSync(join(dir,'game-app/change'),'game');const game=commit('Game');
    const run=(before:string,after:string)=>spawnSync(process.execPath,['game-app/scripts/vercel-ignore-build.mjs'],{cwd:dir,env:{...process.env,VERCEL_GIT_PREVIOUS_SHA:before,VERCEL_GIT_COMMIT_SHA:after}}).status;
    assert.equal(run(first,news),0);assert.equal(run(news,game),1);assert.equal(run('',game),1);assert.equal(run('a'.repeat(40),game),1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
