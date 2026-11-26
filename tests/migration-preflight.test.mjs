import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {inspectMigrationSnapshot,inspectLocalMigration} from '../js/migration-preflight.js';
const fixture=()=>({...Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]])),meta:[{id:'fixture',value:'PRIVATE'}]});
const env={secure:true,webLocks:true,estimate:{usage:1,quota:1000000}};
test('Migration screening exposes aggregate values only and never authorizes switching',async()=>{
 const raw=fixture();raw.meta.push({id:'sync-checkpoint-school',value:'SECRET'});
 const before=structuredClone(raw);
 const result=await inspectLocalMigration({load:async()=>raw,storage:{estimate:async()=>env.estimate},secure:true,webLocks:true});
 assert.equal(result.records,1);assert.equal(result.checkpoints,1);assert.deepEqual(result.blockers,[]);assert.deepEqual(result.warnings,['device-checkpoints']);
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
