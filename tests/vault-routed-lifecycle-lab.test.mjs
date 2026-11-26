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
