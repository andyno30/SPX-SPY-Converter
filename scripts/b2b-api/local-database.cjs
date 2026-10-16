// Local Unix-socket PostgreSQL only. Cannot accept a database URL or remote host.
const runtime=require('../../tests/helpers/premium-quota-postgres-runtime.cjs');
const {Client,Pool}=require(runtime.pgModule);
const fs=require('node:fs');
const path=require('node:path');
exports.createLocalDatabase=async function(label='test'){
 if(!/^[a-z]+$/.test(label))throw new Error('Invalid local database label');
 await runtime.verifyCluster();
 const name=`spy_quota_b2b_${label}_${process.pid}_${Date.now()}`;
 const control=new Client(runtime.getConfig());await control.connect();
 await control.query(`create database ${name}`);
 const pool=new Pool({...runtime.getConfig(name),max:32});
 try{
  await pool.query('create schema auth; create table auth.users(id uuid primary key)');
  // Exercise the permissive public-function defaults found in Supabase projects.
  await pool.query("do $$ declare r text; begin foreach r in array array['anon','authenticated','service_role'] loop if not exists(select from pg_roles where rolname=r) then execute format('create role %I nologin',r); end if; end loop; end $$; alter default privileges in schema public grant execute on functions to anon,authenticated,service_role");
  await pool.query(fs.readFileSync(path.join(__dirname,'../../supabase/sql/b2b_api_setup.sql'),'utf8'));await pool.query(fs.readFileSync(path.join(__dirname,'../../supabase/sql/b2b_api_review.sql'),'utf8'));await pool.query(fs.readFileSync(path.join(__dirname,'../../supabase/sql/b2b_api_signing.sql'),'utf8'));
 }
 catch(e){await pool.end();await control.query(`drop database ${name} with(force)`);await control.end();throw e;}
 return{pool,name,
 async rpc(fn,args){if(!/^b2b_api_[a-z_]+$/.test(fn)||!Object.keys(args).every(k=>/^p_[a-z_]+$/.test(k)))throw new Error('Invalid RPC');const keys=Object.keys(args);return(await pool.query(`select public.${fn}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as result`,Object.values(args).map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v))).rows[0].result;},
 async close(){await pool.end();await control.query(`drop database ${name} with(force)`);await control.end();},
 };
};
