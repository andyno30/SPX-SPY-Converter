import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {fixture} from './fixture.js';

test('migration enforces owner isolation, grants, atomic revisions and unauthenticated denial',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');`);
    await db.exec(readFileSync(new URL('../supabase/migrations/202609070001_private_prototype_saves.sql',import.meta.url),'utf8'));
    const actor=async(id:string,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`);};
    const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',s=fixture();
    await actor(a);
    await db.query('insert into public.arpia_profiles(user_id,display_name) values ($1,$2)',[a,'Alice']);
    await assert.rejects(()=>db.query('insert into public.arpia_profiles(user_id,display_name) values ($1,$2)',[b,'Impersonation']));
    const commit=async(revision:number,payload= s)=>db.query<{save:unknown}>('select public.commit_arpia_save($1,$2,$3::jsonb) as save',[s.characterId,revision,JSON.stringify(payload)]);
    const first=await commit(0);assert.equal((first.rows[0]!.save as {revision:number}).revision,1);
    await assert.rejects(()=>commit(0),/Save conflict/);
    await actor(b);
    assert.equal((await db.query('select * from public.arpia_saves')).rows.length,0);
    assert.equal((await db.query('select * from public.arpia_profiles')).rows.length,0);
    assert.equal((await db.query('update public.arpia_profiles set display_name=$1 where user_id=$2 returning *',['Bad',a])).rows.length,0);
    assert.equal((await db.query('delete from public.arpia_profiles where user_id=$1 returning *',[a])).rows.length,0);
    await assert.rejects(()=>commit(0),/Save conflict/);
    await assert.rejects(()=>commit(1,{...s,revision:1}),/Save conflict/);
    await assert.rejects(()=>db.query('update public.arpia_saves set revision=9 where character_id=$1',[s.characterId]),/permission denied/);
    await actor(a);
    const second=await commit(1,{...s,revision:1});assert.equal((second.rows[0]!.save as {revision:number}).revision,2);
    await assert.rejects(()=>commit(1,{...s,revision:1}),/Save conflict/);
    await assert.rejects(()=>commit(2,{...s,revision:2,saveSchemaVersion:9} as never),/Invalid save envelope/);
    assert.equal((await db.query<{revision:number}>('select revision from public.arpia_saves')).rows[0]!.revision,2);
    await actor('', 'anon');await assert.rejects(()=>db.query('select * from public.arpia_saves'),/permission denied/);await assert.rejects(()=>commit(0),/permission denied/);
    await actor('', 'authenticated');await assert.rejects(()=>commit(0),/Authentication required/);
    await db.exec('reset role');
    await db.exec(readFileSync(new URL('../supabase/migrations/202609070002_lock_prototype_writes.sql',import.meta.url),'utf8'));
    await actor(a);await assert.rejects(()=>commit(2,{...s,revision:2}),/permission denied/);
  }finally{await db.close();}
});
