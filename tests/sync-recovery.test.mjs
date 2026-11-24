import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import * as db from '../js/db.js';
import {defaultSettings} from '../js/model.js';
import {createRelay} from '../server/sync-relay.mjs';
import {relayClient,prepareSync,executeSync,syncStatus} from '../js/sync.js';
const token='R'.repeat(43),replacement='S'.repeat(43),password='recovery-synthetic-password';
test('recover from acknowledged remote write with stale local data; restart preserves revision and revoked access is denied',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'teachapp-sync-recovery-'));
 let server,endpoint;
 async function start(tokens){
  server=await createRelay({directory,tokens:{school:tokens},allowedOrigin:'https://test.example'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));endpoint='http://127.0.0.1:'+server.address().port;
 }
 async function stop(){
  if(!server)return;
  await new Promise(resolve=>server.close(resolve));server=null;
  for(let i=0;i<100;i++){try{await access(join(directory,'.relay-lock'));}catch(e){if(e.code==='ENOENT')return;throw e;}await delay(10);}
  throw Error('Relay lock was not released');
 }
 try{
  await start([token]);
  await db.replaceAll(Object.fromEntries(Object.keys(db.SCHEMA).map(n=>[n,[]])));
  await db.put('meta',defaultSettings());await db.put('classes',{id:'c',name:'Синтетический класс'});
  const client=relayClient(endpoint,'school',token);
  const prepare=()=>prepareSync({area:'school',endpoint,password,client});
  const run=plan=>executeSync({plan,choices:{},password,client,confirmed:true});
  assert.equal((await run(await prepare())).revision,1);
  await db.put('classes',{id:'d',name:'Новый класс'});
  const plan=await prepare();
  const interleaved={get:client.get,put:async(rev,envelope)=>{
   const result=await client.put(rev,envelope);
   await db.put('classes',{id:'late',name:'Параллельная запись'});
   return result;
  }};
  await assert.rejects(executeSync({plan,choices:{},password,client:interleaved,confirmed:true}),/локальная запись не завершилась/);
  assert.equal((await syncStatus('school')).revision,1);
  assert.equal((await client.get()).revision,2);
  assert.ok(await db.get('classes','late'));
  assert.equal((await run(await prepare())).revision,3);
  assert.ok(await db.get('classes','late'));
  const persisted=await client.get();
  await stop();await start([replacement]);
  await assert.rejects(relayClient(endpoint,'school',token).get(),/отказал в доступе/);
  assert.deepEqual(await relayClient(endpoint,'school',replacement).get(),persisted);
 }finally{await stop();await rm(directory,{recursive:true,force:true});}
});
