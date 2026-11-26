import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';
import {vaultRouterLab} from '../tools/prototypes/vault-router-lab.mjs';
import {openPlainSchemaLab,readPlainSchemaLab} from '../tools/prototypes/vault-migration-rehearsal.mjs';
const password='synthetic-routing-password';
function lockQueue(){
 const tails=new Map();
 return {request(name,options,fn){
  assert.equal(options.mode,'exclusive');
  const current=(tails.get(name)||Promise.resolve()).then(fn);
  tails.set(name,current.catch(()=>{}));return current;
 }};
}
test('LAB routes across cooperating clients; queued writes follow the active phase, never plaintext fallback',async t=>{
 const locks=lockQueue(),a=vaultRouterLab('switch',{locks}),b=vaultRouterLab('switch',{locks});
 await assert.rejects(a.snapshot(),/fallback запрещён/);
 assert.equal((await a.initialize()).phase,'source');
 await a.put('meta',{id:'fixture',value:1});
 await a.stage({password});
 const activation=a.activate({password}),write=b.put('meta',{id:'fixture',value:2},{password});
 assert.equal((await activation).generation,2);await write;
 assert.equal((await b.status()).phase,'vault');
 await assert.rejects(b.snapshot({password:'wrong-password'}),/неверный пароль/);
 assert.equal((await b.snapshot({password})).meta[0].value,2);
 const original=await openPlainSchemaLab('teachapp-plain-lab-source-switch');t.after(()=>original.close());
 assert.equal((await readPlainSchemaLab(original)).meta[0].value,1);
 await assert.rejects(a.initialize(),/уже существует/);
 const rollback=a.rollback({password}),newWrite=b.put('meta',{id:'fixture',value:3});
 assert.equal((await rollback).generation,3);await newWrite;
 assert.equal((await b.snapshot()).meta[0].value,3);
 assert.equal((await readPlainSchemaLab(original)).meta[0].value,1);
 await assert.rejects(b.activate({password}),/Недопустимый этап/);
});
test('Changes between stage and activation fail closed and missing Web Locks cannot opt out',async()=>{
 assert.throws(()=>vaultRouterLab('nolock',{locks:null}),/Web Locks/);
 const locks=lockQueue(),a=vaultRouterLab('stale',{locks}),b=vaultRouterLab('stale',{locks});
 await a.initialize();await a.put('meta',{id:'fixture',value:1});await a.stage({password});
 await b.put('meta',{id:'fixture',value:9});await assert.rejects(a.activate({password}),/изменился/);
 assert.equal((await b.status()).phase,'source');assert.equal((await b.snapshot()).meta[0].value,9);
});
test('Missing or corrupt route never falls back and cannot be initialized over existing data',async t=>{
 const locks=lockQueue(),a=vaultRouterLab('missing',{locks});
 await a.initialize();await a.put('meta',{id:'fixture',value:1});await a.stage({password});await a.activate({password});
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('teachapp-vault-routing-lab-missing',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});t.after(()=>db.close());
 await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put({id:'active',generation:0,phase:undefined});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
 await assert.rejects(a.snapshot({password}),/fallback запрещён/);
 await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').clear();tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
 await assert.rejects(a.snapshot({password}),/fallback запрещён/);await assert.rejects(a.initialize(),/не пуста/);
});

test('Simulated quota error aborts complete rollback; retry resumes only verified snapshot after pointer failure',async t=>{
 const locks=lockQueue(),a=vaultRouterLab('resume',{locks}),b=vaultRouterLab('resume',{locks});
 await a.initialize();await a.put('meta',{id:'fixture',value:1});await a.stage({password});
 assert.equal((await a.stage({password,resume:true})).verified,true);
 await a.activate({password});await a.put('meta',{id:'fixture',value:2},{password});await a.put('meta',{id:'second',value:3},{password});
 const proto=IDBObjectStore.prototype,add=proto.add,put=proto.put;
 let writes=0;
 proto.add=function(...args){
  if(this.transaction.db.name==='teachapp-plain-lab-rollback-resume'&&++writes===2)throw new DOMException('Simulated quota','QuotaExceededError');
  return add.apply(this,args);
 };
 try{await assert.rejects(a.rollback({password}),e=>e.name==='QuotaExceededError');}finally{proto.add=add;}
 assert.equal((await b.status()).phase,'vault');
 const target=await openPlainSchemaLab('teachapp-plain-lab-rollback-resume');t.after(()=>target.close());
 assert.ok(Object.values(await readPlainSchemaLab(target)).every(rows=>rows.length===0));
 proto.put=function(value,...args){
  if(this.transaction.db.name==='teachapp-vault-routing-lab-resume'&&value.phase==='rollback')throw new DOMException('Simulated pointer quota','QuotaExceededError');
  return put.call(this,value,...args);
 };
 try{await assert.rejects(a.rollback({password}),e=>e.name==='QuotaExceededError');}finally{proto.put=put;}
 assert.equal((await b.status()).phase,'vault');
 assert.equal((await readPlainSchemaLab(target)).meta[0].value,2);
 await assert.rejects(b.rollback({password}),/не пуста/);
 await assert.rejects(b.rollback({password:'incorrect-password',resume:true}),/неверный пароль/);
 assert.equal((await b.rollback({password,resume:true})).phase,'rollback');
 assert.deepEqual((await a.snapshot()).meta,[{id:'fixture',value:2},{id:'second',value:3}]);
});
test('Recovery refuses stale completed rollback instead of overwriting it',async()=>{
 const a=vaultRouterLab('resume-stale',{locks:lockQueue()});
 await a.initialize();await a.put('meta',{id:'fixture',value:1});await a.stage({password});await a.activate({password});
 const proto=IDBObjectStore.prototype,put=proto.put;
 proto.put=function(value,...args){
  if(this.transaction.db.name==='teachapp-vault-routing-lab-resume-stale'&&value.phase==='rollback')throw new DOMException('Simulated pointer failure','QuotaExceededError');
  return put.call(this,value,...args);
 };
 try{await assert.rejects(a.rollback({password}),e=>e.name==='QuotaExceededError');}finally{proto.put=put;}
 await a.put('meta',{id:'fixture',value:9},{password});
 await assert.rejects(a.rollback({password,resume:true}),/изменилась/);
 assert.equal((await a.status()).phase,'vault');assert.equal((await a.snapshot({password})).meta[0].value,9);
});
