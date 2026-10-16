import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import postgres from 'npm:postgres@3.4.5';
import {sqlStore} from '../../supabase/b2b-api/sql-store.mjs';
const require=createRequire(import.meta.url);
const {createLocalDatabase}=require('../../scripts/b2b-api/local-database.cjs');
const runtime=require('../helpers/premium-quota-postgres-runtime.cjs');
Deno.test({name:'production SQL driver preserves JSONB objects and nested values',sanitizeResources:false,sanitizeOps:false,fn:async()=>{
 const db=await createLocalDatabase('driver'),config=runtime.getConfig(db.name);
 const sql=postgres({host:config.host,port:config.port,user:config.user,database:config.database,prepare:false,max:1});
 try{
  const actor=crypto.randomUUID();await db.pool.query('insert into auth.users values($1)',[actor]);
  const store=sqlStore(sql);
  const org=await store.account('create',actor,null,{name:'Driver verification',legal_name:'Synthetic fixture',email:'driver@example.test',intended_use:'JSONB round trip',plan:'developer'});
  assert.equal(org.name,'Driver verification');assert.equal((await store.account('dashboard',actor,org.id)).role,'owner');
  const nested={number:0,empty:null,array:[1,null,{enabled:false}]};
  const result=await sql`select ${sql.json(nested)}::jsonb as fixture`;
  assert.deepEqual(result[0].fixture,nested);
 }finally{await sql.end();await db.close();}
}});
