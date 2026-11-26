import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {vaultRouterLab} from '../tools/prototypes/vault-router-lab.mjs';
import {routedVaultLifecycleLab} from '../tools/prototypes/vault-routed-lifecycle-lab.mjs';
const password='synthetic-writable-password';
const locks=()=>{const tails=new Map();return {request(name,opts,fn){const work=(tails.get(name)||Promise.resolve()).then(fn);tails.set(name,work.catch(()=>{}));return work;}};};
class Channel extends EventTarget{
 static all=new Set();
 constructor(name){super();this.name=name;Channel.all.add(this);}
 postMessage(data){for(const target of Channel.all)if(target!==this&&target.name===this.name)target.dispatchEvent(new MessageEvent('message',{data:structuredClone(data)}));}
 close(){Channel.all.delete(this);}
}
const env=()=>{const document=new EventTarget(),window=new EventTarget();document.visibilityState='visible';return {document,window,Channel};};
async function setup(id){const router=vaultRouterLab(id,{locks:locks()});await router.initialize();await router.put('meta',{id:'x',value:1});await router.stage({password});await router.activate({password});return router;}
test('Writable lifecycle authenticates, expires, locks on hidden and remote events, and never reuses a stale handle',async t=>{
 const id='life-events',router=await setup(id),e=env(),other=env();let time=0;
 const a=routedVaultLifecycleLab(router,{id,...e,now:()=>time,idleMs:1000}),b=routedVaultLifecycleLab(router,{id,...other});t.after(()=>{a.dispose();b.dispose();});
 await assert.rejects(a.unlock('incorrect-password'),/неверный пароль/);assert.equal(a.isUnlocked(),false);
 const old=await a.unlock(password),peer=await b.unlock(password);assert.equal(a.isUnlocked(),true);
 await old.put('meta',{id:'x',value:2});assert.equal((await peer.get('meta','x')).value,2);
 a.lockEveryTab();assert.equal(a.isUnlocked(),false);assert.equal(b.isUnlocked(),false);
 await assert.rejects(peer.getAll('meta'),/заблокирован/);
 const newer=await a.unlock(password);old.close();assert.equal(a.isUnlocked(),true);
 await assert.rejects(old.getAll('meta'),/заблокирован/);
 e.document.visibilityState='hidden';e.document.dispatchEvent(new Event('visibilitychange'));
 await assert.rejects(newer.put('meta',{id:'x',value:99}),/заблокирован/);
 await assert.rejects(a.unlock(password),/Скрытый/);e.document.visibilityState='visible';
 const next=await a.unlock(password);time+=1001;assert.equal(a.isUnlocked(),false);
 await assert.rejects(next.getAll('meta'),/заблокирован/);
 const last=await a.unlock(password);e.window.dispatchEvent(new Event('pagehide'));await assert.rejects(last.getAll('meta'),/заблокирован/);
 const stale=await a.unlock(password);await router.rollback({password});await assert.rejects(stale.getAll('meta'),/Маршрут LAB изменился/);assert.equal(a.isUnlocked(),false);
 await assert.rejects(a.unlock(password),/Маршрут LAB изменился/);
 assert.equal((await router.snapshot()).meta[0].value,2);
});
test('Lock during authentication, callback or native CAS prevents pending write and read result',async t=>{
 const id='life-races',router=await setup(id),a=routedVaultLifecycleLab(router,{id,...env()});t.after(()=>a.dispose());
 const pending=a.unlock(password);a.lock();await assert.rejects(pending,/заблокирован/);
 let access=await a.unlock(password),entered,release;
 const ready=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 const writing=access.transaction('meta','readwrite',async s=>{await s.meta.put({id:'x',value:9});entered();await wait;});
 await ready;a.lock();release();await assert.rejects(writing,/заблокирован/);assert.equal((await router.snapshot({password})).meta[0].value,1);
 access=await a.unlock(password);
 const getAll=IDBObjectStore.prototype.getAll;let hit=0;
 IDBObjectStore.prototype.getAll=function(...args){if(this.transaction.db.name==='teachapp-vault-lab-routing-'+id&&this.transaction.mode==='readwrite'&&this.name==='sealed'){hit++;a.lock();}return getAll.apply(this,args);};
 try{await assert.rejects(access.put('meta',{id:'x',value:10}),/заблокирован/);}finally{IDBObjectStore.prototype.getAll=getAll;}
 assert.equal(hit,1);assert.equal((await router.snapshot({password})).meta[0].value,1);
 access=await a.unlock(password);
 await assert.rejects(access.transaction('meta','readonly',async s=>{const row=await s.meta.get('x');a.lock();return row;}),/заблокирован/);
 assert.equal(a.isUnlocked(),false);
});

import {openVaultLab,stageVaultLab,readVaultLab,openVaultWritableKeySessionLab,exportVaultLab,restoreVaultLab,replaceVaultLab} from '../tools/prototypes/local-vault.mjs';
test('Writable key material is imported once, nonextractable, with fresh v1 salts and password-compatible recovery',async t=>{
 const db=await openVaultLab('teachapp-vault-lab-key-write'),dest=await openVaultLab('teachapp-vault-lab-key-write-restore');t.after(()=>{db.close();dest.close();});
 await stageVaultLab(db,{scope:'workspace',password,data:{meta:[{id:'x',value:1}]}});
 const header=()=>new Promise((resolve,reject)=>{const tx=db.transaction('sealed'),q=tx.objectStore('sealed').get('header');tx.oncomplete=()=>resolve(q.result);tx.onabort=()=>reject(tx.error);});
 const before=await header(),originalImport=crypto.subtle.importKey,originalDerive=crypto.subtle.deriveKey;
 let imports=0,derivations=0,session,importedKey;const derivedKeys=[];
 crypto.subtle.importKey=async function(...args){const k=await originalImport.apply(this,args);imports++;importedKey=k;return k;};
 crypto.subtle.deriveKey=async function(...args){derivations++;const k=await originalDerive.apply(this,args);derivedKeys.push({materialExtractable:args[1].extractable,keyExtractable:k.extractable});return k;};
 try{
  session=await openVaultWritableKeySessionLab(db,{scope:'workspace',password});
  for(const value of [2,3]){const s=await session.read(db);await session.replace(db,{expectedRevision:s.revision,data:{meta:[{id:'x',value}]}});}
  assert.equal(imports,1);assert.equal(importedKey.extractable,false);assert.equal(importedKey.algorithm.name,'PBKDF2');await assert.rejects(async()=>crypto.subtle.exportKey('raw',importedKey));assert.ok(derivations>=3);assert.ok(derivedKeys.every(k=>!k.materialExtractable&&!k.keyExtractable));assert.equal((await session.read(db)).data.meta[0].value,3);
 }finally{crypto.subtle.importKey=originalImport;crypto.subtle.deriveKey=originalDerive;}
 t.after(()=>session?.close());const after=await header();assert.notDeepEqual(after.salt,before.salt);assert.notEqual(after.vaultId,before.vaultId);assert.equal(after.version,1);
 const peer=await readVaultLab(db,{scope:'workspace',password});assert.equal(peer.data.meta[0].value,3);
 const file=await exportVaultLab(db,{scope:'workspace',password});await restoreVaultLab(dest,{scope:'workspace',password,file});assert.deepEqual((await readVaultLab(dest,{scope:'workspace',password})).data,peer.data);
 await assert.rejects(session.read(dest),/Другая база/);assert.equal(session.isLocked(),true);
 const stale=await openVaultWritableKeySessionLab(db,{scope:'workspace',password}),opened=await stale.read(db);
 await replaceVaultLab(db,{scope:'workspace',password,expectedRevision:opened.revision,data:{meta:[{id:'x',value:4}]}});
 await assert.rejects(stale.replace(db,{expectedRevision:opened.revision,data:{meta:[{id:'x',value:99}]}}),/изменился/);
 assert.equal(stale.isLocked(),true);assert.equal((await readVaultLab(db,{scope:'workspace',password})).data.meta[0].value,4);
});
