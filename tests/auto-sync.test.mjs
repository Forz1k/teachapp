import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as db from '../js/db.js';
import {defaultSettings} from '../js/model.js';
import {prepareSync,executeSync,syncPersonalArea,localSyncState,disconnectSync,relayClient,describeSyncConflict} from '../js/sync.js';
import {createPersonalCode} from '../js/personal-sync.js';
import {runPersonalSync,openSyncSession,autoSyncStatus,syncRetryDelay} from '../js/auto-sync.js';
const endpoint='https://sync.example.test',area='school',password='synthetic-only-long-passphrase';
const empty=()=>Object.fromEntries(Object.keys(db.SCHEMA).map(n=>[n,[]]));
test('auto never initializes, avoids redundant PUT, pulls without revision churn and blocks deletion',async()=>{
 let remote={revision:0,envelope:null},writes=0;
 const client={get:async()=>structuredClone(remote),put:async(revision,envelope)=>{assert.equal(revision,remote.revision);writes++;remote={revision:revision+1,envelope};return structuredClone(remote);}};
 const params={area,endpoint,password,client};
 const sync=async()=>executeSync({plan:await prepareSync(params),choices:{},password,client,confirmed:true});
 await db.replaceAll(empty());await db.put('meta',defaultSettings());
 assert.equal((await syncPersonalArea(params)).status,'setup');assert.equal(writes,0);
 await sync();assert.equal(writes,1);
 const a=await db.dumpAll();
 assert.equal((await syncPersonalArea(params)).status,'synced');assert.equal(writes,1);
 await db.put('classes',{id:'c1',name:'Synthetic class'});
 assert.equal((await syncPersonalArea(params)).status,'synced');assert.equal(writes,2);
 const b=await db.dumpAll();
 await db.replaceAll(a);
 const pull=await syncPersonalArea(params);
 assert.equal(pull.status,'synced');assert.equal(pull.changed,true);assert.equal(writes,2);
 assert.ok(await db.get('classes','c1'));
 await db.del('classes','c1');
 assert.equal((await syncPersonalArea(params)).status,'review');assert.equal(writes,2);
 await db.replaceAll(b);
});
test('runner stays local when disconnected and treats areas independently',async()=>{
 const code=createPersonalCode(endpoint),seen=[];
 const opts={getCode:()=>code,clientFactory:()=>({}),runArea:async ({area})=>{seen.push(area);if(area==='school')throw Error('synthetic');return {area,status:'synced'};}};
 assert.equal((await runPersonalSync({...opts,getCode:()=>null})).phase,'off');
 assert.equal((await runPersonalSync({...opts,online:()=>false})).phase,'offline');assert.deepEqual(seen,[]);
 const result=await runPersonalSync(opts);
 assert.deepEqual(result.areas.map(x=>x.status),['error','synced']);
 assert.deepEqual(seen,['school','coach']);
 assert.equal(await openSyncSession(null),null);
});

test('offline and disconnected states replace stale successful status',async()=>{
 const code=createPersonalCode(endpoint);
 const opts={getCode:()=>code,online:()=>true,clientFactory:()=>({}),runArea:async({area})=>({area,status:'synced'})};
 const result=await runPersonalSync(opts);
 assert.equal(result.phase,'finished');
 assert.ok(result.areas.every(x=>Number.isFinite(Date.parse(x.successfulAt))));
 await runPersonalSync({...opts,online:()=>false});
 assert.deepEqual(autoSyncStatus(),{phase:'offline',areas:[],at:null});
 await runPersonalSync({...opts,getCode:()=>null});
 assert.deepEqual(autoSyncStatus(),{phase:'off',areas:[],at:null});
});
test('network loss between areas is not reported as a complete exchange',async()=>{
 const code=createPersonalCode(endpoint),seen=[];
 let online=true;
 const report=await runPersonalSync({getCode:()=>code,online:()=>online,clientFactory:()=>({}),runArea:async({area})=>{
  seen.push(area);online=false;return {area,status:'synced'};
 }});
 assert.equal(report.phase,'interrupted');
 assert.deepEqual(seen,['school']);
 assert.deepEqual(report.areas.map(x=>x.status),['synced','paused']);
 assert.ok(report.areas[0].successfulAt);
 assert.equal(report.areas[1].successfulAt,undefined);
});
test('concurrent offline request cannot reset active exchange',async()=>{
 const code=createPersonalCode(endpoint);
 let release,entered;
 const started=new Promise(resolve=>{entered=resolve;});
 const wait=new Promise(resolve=>{release=resolve;});
 const opts={getCode:()=>code,online:()=>true,clientFactory:()=>({}),runArea:async({area})=>{entered();await wait;return {area,status:'synced'};}};
 const active=runPersonalSync(opts);
 await started;
 try{
  assert.equal((await runPersonalSync({...opts,online:()=>false})).phase,'running');
  assert.equal(autoSyncStatus().phase,'running');
 }finally{release();await active;}
 assert.equal(autoSyncStatus().phase,'finished');
});

test('local state detects unsent changes and retains only matching confirmation metadata',async()=>{
 let remote={revision:0,envelope:null},writes=0;
 const client={get:async()=>structuredClone(remote),put:async(revision,envelope)=>{
  assert.equal(revision,remote.revision);writes++;remote={revision:revision+1,envelope};return structuredClone(remote);
 }};
 const params={area,endpoint,password,client};
 await db.replaceAll(empty());await db.put('meta',defaultSettings());
 assert.equal((await localSyncState(params)).status,'setup');
 await executeSync({plan:await prepareSync(params),choices:{},password,client,confirmed:true});
 const first=await localSyncState(params);
 assert.equal(first.status,'clean');assert.equal(first.revision,1);
 assert.ok(Number.isFinite(Date.parse(first.successfulAt)));
 const before=await db.get('meta','sync-checkpoint-school');
 await syncPersonalArea(params);
 assert.equal(writes,1);
 assert.deepEqual(await db.get('meta','sync-checkpoint-school'),before);
 await db.put('classes',{id:'pending-class',name:'Synthetic class'});
 assert.equal((await localSyncState(params)).status,'pending');
 assert.equal(writes,1);
 assert.equal((await localSyncState({...params,endpoint:'https://other.example.test'})).status,'review');
 await syncPersonalArea(params);
 assert.equal(writes,2);
 const next=await localSyncState(params);
 assert.equal(next.status,'clean');assert.equal(next.revision,2);
 assert.ok(Number.isFinite(Date.parse(next.successfulAt)));
 const record=await db.get('meta','sync-checkpoint-status-school');
 await db.put('meta',{...record,revision:1});
 assert.equal((await localSyncState(params)).successfulAt,null);
 await disconnectSync(area,true);
 assert.equal((await localSyncState(params)).status,'setup');
 assert.equal(await db.get('meta','sync-checkpoint-status-school'),undefined);
 assert.ok(await db.get('classes','pending-class'));
});

test('only transient transport failures receive bounded expedited retries',async()=>{
 const token='a'.repeat(43);
 const clientFor=status=>relayClient(endpoint,area,token,{fetcher:async()=>new Response('{}',{status})});
 await assert.rejects(clientFor(503).get(),e=>e.retryable===true);
 await assert.rejects(clientFor(401).get(),e=>e.retryable!==true);
 await assert.rejects(clientFor(409).get(),e=>e.retryable!==true);
 await assert.rejects(clientFor(429).get(),e=>e.retryable!==true);
 const offline=relayClient(endpoint,area,token,{fetcher:async()=>{throw new TypeError('synthetic network error');}});
 await assert.rejects(offline.get(),e=>e.retryable===true);
 const code=createPersonalCode(endpoint);
 const report=await runPersonalSync({getCode:()=>code,online:()=>true,clientFactory:()=>({}),runArea:async({area})=>{
  if(area==='school')throw Object.assign(Error('temporary'),{retryable:true});return {area,status:'synced'};
 }});
 assert.equal(report.areas[0].retryable,true);
 assert.equal(syncRetryDelay(report,0),5000);
 assert.equal(syncRetryDelay(report,1),15000);
 assert.equal(syncRetryDelay(report,2),null);
 assert.equal(syncRetryDelay({phase:'finished',areas:[{status:'conflict'}]},0),null);
 assert.equal(syncRetryDelay({...report,phase:'interrupted'},0),null);
});

test('conflict summary explains only divergent fields and does not modify records',()=>{
 const base={id:'a',mark:3,note:'old',same:true};
 const local={...base,mark:4},remote={...base,mark:5,note:'new'};
 const originals=structuredClone({base,local,remote});
 const result=describeSyncConflict({base,local,remote});
 assert.equal(result.kind,'changed');
 assert.deepEqual(result.fields,[
  {key:'mark',local:4,remote:5,localChanged:true,remoteChanged:true},
  {key:'note',local:'old',remote:'new',localChanged:false,remoteChanged:true}
 ]);
 assert.deepEqual({base,local,remote},originals);
 assert.equal(describeSyncConflict({base,local:null,remote}).kind,'deleted');
 assert.equal(describeSyncConflict({base:null,local,remote}).kind,'created');
});
