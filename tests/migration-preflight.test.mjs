import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA,bulkPut,clearAll,readBoundedSnapshot,assertMigrationSchema} from '../js/db.js';
import {inspectMigrationSnapshot,inspectLocalMigration} from '../js/migration-preflight.js';
const fixture=()=>({...Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]])),meta:[{id:'fixture',value:'PRIVATE'}]});
const env={secure:true,webLocks:true,estimate:{usage:1,quota:1000000}};
test('Migration screening exposes aggregate values only and never authorizes switching',async()=>{
 const raw=fixture();raw.meta.push({id:'sync-checkpoint-school',value:'SECRET'});
 const before=structuredClone(raw);
 const result=await inspectLocalMigration({load:async()=>raw,storage:{estimate:async()=>env.estimate},secure:true,webLocks:true});
 assert.equal(result.records,1);assert.equal(result.checkpoints,1);assert.deepEqual(result.blockers,['unmigrated-device-checkpoints','checkpoint-invalid']);assert.deepEqual(result.warnings,['device-checkpoints']);
 assert.equal(result.activationAllowed,false);assert.deepEqual(raw,before);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET|fixture/);
});
test('Migration screening flags active Delta marker, non-JSON data, schema integrity and missing capabilities',()=>{
 const raw=fixture();raw.meta.push({id:'sync-checkpoint-migration-school',value:1},{id:'bad',value:new Date()});
 raw.students.push({id:'orphan',fullName:'PRIVATE',classId:'missing'});
 const res=inspectMigrationSnapshot(raw,{estimate:{usage:10,quota:10}});
 for(const x of ['active-delta-migration','non-json','integrity','crypto-unavailable','locks-unavailable'])assert.ok(res.blockers.includes(x),x);
 assert.ok(res.warnings.includes('low-estimated-space'));assert.equal(res.activationAllowed,false);
 assert.deepEqual(inspectMigrationSnapshot({},env).blockers,['schema']);
 const large=fixture();large.meta=Array.from({length:10001},(_,i)=>({id:'r'+i}));assert.ok(inspectMigrationSnapshot(large,env).blockers.includes('record-limit'));
});

test('Native bounded snapshot refuses to materialize oversized databases before getAll',async()=>{
 await clearAll();
 try{
  await bulkPut('meta',[{id:'a',value:'PRIVATE'},{id:'b',value:'SECRET'}]);
  const original=IDBObjectStore.prototype.getAll;let reads=0;
  IDBObjectStore.prototype.getAll=function(...args){reads++;return original.apply(this,args);};
  try{
   assert.deepEqual(await readBoundedSnapshot(1),{records:2,data:null});assert.equal(reads,0);
   const exact=await readBoundedSnapshot(2);assert.equal(exact.records,2);assert.equal(exact.data.meta.length,2);assert.equal(reads,Object.keys(SCHEMA).length);
   const result=await inspectLocalMigration({readBounded:()=>readBoundedSnapshot(1),secure:true,webLocks:true,storage:{estimate:()=>{throw Error('Must not estimate');}}});
   assert.deepEqual(result,{records:2,bytes:null,checkpoints:null,blockers:['record-limit'],warnings:['snapshot-not-loaded'],activationAllowed:false});assert.equal(reads,Object.keys(SCHEMA).length);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET/);
  }finally{IDBObjectStore.prototype.getAll=original;}
 }finally{await clearAll();}
});

test('Native migration screening rejects changed store/index definitions and fails closed on version mismatch',async()=>{
 const req=indexedDB.open('synthetic-schema-rc3',10);
 const db=await new Promise((resolve,reject)=>{
  req.onupgradeneeded=()=>{for(const [n,d] of Object.entries(SCHEMA)){const s=req.result.createObjectStore(n,{keyPath:d.keyPath});for(const [i,k,o] of d.indexes)s.createIndex(i,k,n==='marks'&&i==='lessonId_studentId'?{unique:false}:o||{});}};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
 try{const tx=db.transaction(Object.keys(SCHEMA),'readonly');assert.throws(()=>assertMigrationSchema(tx),{name:'MigrationSchemaError'});}finally{db.close();}
 for(const name of ['VersionError','NotFoundError','MigrationSchemaError','NativeStorageFencedError']){
  const res=await inspectLocalMigration({readBounded:async()=>{throw new DOMException('PRIVATE',name);},secure:true,webLocks:true});
  assert.deepEqual(res,{records:null,bytes:null,checkpoints:null,blockers:['schema'],warnings:[],activationAllowed:false});
 }
});
test('Current three-scope preflight uses the exact shared layout without mutating data',()=>{
 const raw=fixture();
 raw.meta.push({id:'settings',year:{from:'2025-09-01',to:'2026-08-31'},theme:'dark',futureOwnerField:'PRIVATE'});
 raw.classes.push({id:'c',name:'Synthetic class',gradeLevel:7});
 raw.students.push({id:'p',classId:'c',fullName:'Synthetic pupil',number:1,normGroup:'girls'});
 raw.coachTeams.push({id:'t',name:'Synthetic team',archived:false});
 const before=structuredClone(raw),res=inspectMigrationSnapshot(raw,env);
 assert.deepEqual(res.blockers,[]);assert.equal(res.activationAllowed,false);assert.deepEqual(raw,before);
 assert.doesNotMatch(JSON.stringify(res),/PRIVATE|Synthetic/);
});
