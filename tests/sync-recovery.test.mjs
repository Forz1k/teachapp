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
import {relayClient,prepareSync,executeSync,syncStatus,syncPersonalArea,localSyncState} from '../js/sync.js';
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

test('lost response after server commit recovers with fresh revision and no duplicate upload',async()=>{
 const endpoint='https://synthetic.example.test',area='school',password='recovery-synthetic-password';
 let remote={revision:0,envelope:null},writes=0;
 const client={get:async()=>structuredClone(remote),put:async(expectedRevision,envelope)=>{
  assert.equal(expectedRevision,remote.revision);writes++;remote={revision:remote.revision+1,envelope};return structuredClone(remote);
 }};
 const params={area,endpoint,password,client};
 await db.replaceAll(Object.fromEntries(Object.keys(db.SCHEMA).map(n=>[n,[]])));
 await db.put('meta',defaultSettings());
 await executeSync({plan:await prepareSync(params),choices:{},password,client,confirmed:true});
 await db.put('classes',{id:'synthetic-lost-response',name:'Synthetic class'});
 const dropped={...client,put:async(...args)=>{
  await client.put(...args);throw Object.assign(Error('synthetic lost response'),{retryable:true});
 }};
 await assert.rejects(syncPersonalArea({...params,client:dropped}),/lost response/);
 assert.equal(remote.revision,2);assert.equal((await syncStatus(area)).revision,1);
 assert.ok(await db.get('classes','synthetic-lost-response'));
 assert.equal((await localSyncState(params)).status,'pending');
 const recovered=await syncPersonalArea(params);
 assert.equal(recovered.status,'synced');assert.equal(recovered.revision,2);
 assert.equal(writes,2);assert.equal((await localSyncState(params)).status,'clean');
 assert.ok(await db.get('classes','synthetic-lost-response'));
});

test('Permission loss blocks upload and pull, and leaves accepted remote PUT for explicit revision reconciliation',async()=>{
 const endpoint='https://synthetic.example.test',area='school',password='synthetic-guard-password';
 let remote={revision:0,envelope:null},writes=0,allowed=true;
 const client={get:async()=>structuredClone(remote),put:async(revision,envelope)=>{assert.equal(revision,remote.revision);writes++;remote={revision:revision+1,envelope};return structuredClone(remote);}};
 const params={endpoint,area,password,client};
 await db.replaceAll(Object.fromEntries(Object.keys(db.SCHEMA).map(n=>[n,[]])));await db.put('meta',defaultSettings());
 await executeSync({plan:await prepareSync(params),choices:{},password,client,confirmed:true});
 await db.put('classes',{id:'guard',name:'Guard test'});
 const plan=await prepareSync(params),before=await db.dumpAll();
 allowed=false;
 await assert.rejects(executeSync({plan,choices:{},password,client,confirmed:true,stillAllowed:()=>allowed}),e=>e.code==='sync-paused'&&!e.remoteMayHaveCommitted);
 assert.deepEqual(await db.dumpAll(),before);assert.equal(writes,1);
 // An actual accepted PUT may race disconnect. Never accept its checkpoint
 // or silently discard local records after permission is lost.
 allowed=true;const interrupted={...client,put:async(...args)=>{const ack=await client.put(...args);allowed=false;return ack;}};
 const paused=await syncPersonalArea({...params,client:interrupted,stillAllowed:()=>allowed});
 assert.deepEqual(paused,{area,status:'paused',reason:'remote-unconfirmed'});
 assert.equal(remote.revision,2);assert.equal(writes,2);assert.deepEqual(await db.dumpAll(),before);
 allowed=true;assert.equal((await syncPersonalArea(params)).revision,2);assert.equal(writes,2);
 // Abort a pull during the remote GET; keep local snapshot and checkpoint.
 await db.put('classes',{id:'remote-only',name:'Remote only'});const old=await db.dumpAll();await syncPersonalArea(params);await db.replaceAll(before);
 const readPaused={...client,get:async()=>{const value=await client.get();allowed=false;return value;}};
 assert.deepEqual(await syncPersonalArea({...params,client:readPaused,stillAllowed:()=>allowed}),{area,status:'paused'});
 assert.deepEqual(await db.dumpAll(),before);assert.ok(old.classes.some(x=>x.id==='remote-only'));
 allowed=true;assert.equal((await syncPersonalArea(params)).revision,3);assert.ok(await db.get('classes','remote-only'));assert.equal(writes,3);
});
test('Guard is rechecked after asynchronous encryption and before sending any PUT',async()=>{
 const endpoint='https://synthetic.example.test',area='school',password='synthetic-preflight-guard';
 await db.replaceAll(Object.fromEntries(Object.keys(db.SCHEMA).map(n=>[n,[]])));await db.put('meta',defaultSettings());
 let writes=0,calls=0;const client={get:async()=>({revision:0,envelope:null}),put:async()=>{writes++;throw Error('must not upload');}};
 const plan=await prepareSync({endpoint,area,password,client}),before=await db.dumpAll();
 await assert.rejects(executeSync({plan,choices:{},password,client,confirmed:true,stillAllowed:()=>++calls<=2}),e=>e.code==='sync-paused'&&!e.remoteMayHaveCommitted);
 assert.equal(writes,0);assert.deepEqual(await db.dumpAll(),before);
});

test('Relay response enforces UTF-8 bytes and rejects invalid UTF-8 before parsing',async()=>{
 const {readSyncResponse}=await import('../js/sync.js');
 const value={name:'Я🏐'};
 const json=JSON.stringify(value),bytes=new TextEncoder().encode(json);
 assert.deepEqual(await readSyncResponse(new Response(bytes),bytes.length),value);
 await assert.rejects(readSyncResponse(new Response(bytes),bytes.length-1),/Слишком большой/);
 const legacy={headers:new Headers(),text:async()=>json};
 await assert.rejects(readSyncResponse(legacy,bytes.length-1),/Слишком большой/);
 const invalid=new Uint8Array([123,34,97,34,58,34,255,34,125]);
 await assert.rejects(readSyncResponse(new Response(invalid),100),TypeError);
 await assert.rejects(readSyncResponse(new Response('{}',{headers:{'content-length':'bad'}}),100),/некорректный/);
});
test('An unconfirmed PUT result is explicitly marked without advancing local checkpoint',async()=>{
 const endpoint='https://synthetic.example.test',area='school',password='synthetic-ack-guard';
 await db.replaceAll(Object.fromEntries(Object.keys(db.SCHEMA).map(n=>[n,[]])));await db.put('meta',defaultSettings());
 const client={get:async()=>({revision:0,envelope:null}),put:async()=>({revision:3,envelope:null})};
 const plan=await prepareSync({endpoint,area,password,client}),before=await db.dumpAll();
 await assert.rejects(executeSync({plan,choices:{},password,client,confirmed:true}),e=>e.remoteMayHaveCommitted===true);
 assert.deepEqual(await db.dumpAll(),before);
});
