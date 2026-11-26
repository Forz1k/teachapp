import test from 'node:test';import assert from 'node:assert/strict';
import {vaultSessionLifecycleLab} from '../tools/prototypes/vault-session-lifecycle-lab.mjs';
function events(){const document=new EventTarget(),window=new EventTarget();document.visibilityState='visible';return {document,window};}
function session(data){let locked=false;return {close(){locked=true;},isLocked:()=>locked,read:async()=>data};}
test('Lifecycle locks every scope when hidden, frozen or pagehidden and requires explicit unlock again',async()=>{
 const env=events(),l=vaultSessionLifecycleLab({openScopeSession:async({scope})=>session(scope)},env);
 await l.unlock('school','synthetic');await l.unlock('coach','synthetic');
 assert.equal(await l.read('school'),'school');l.lock('school');assert.equal(l.isUnlocked('coach'),true);
 env.document.visibilityState='hidden';env.document.dispatchEvent(new Event('visibilitychange'));assert.equal(l.isUnlocked('coach'),false);
 await assert.rejects(l.unlock('coach','synthetic'),/Скрытый/);
 env.document.visibilityState='visible';await assert.rejects(l.read('coach'),/заблокирован/);
 await l.unlock('workspace','synthetic');env.document.dispatchEvent(new Event('freeze'));assert.equal(l.isUnlocked('workspace'),false);
 await l.unlock('school','synthetic');env.window.dispatchEvent(new Event('pagehide'));assert.equal(l.isUnlocked('school'),false);
 l.dispose();await assert.rejects(l.unlock('school','synthetic'),/закрытый/);
});
test('Lifecycle invalidates unlock and read results after lock or a new unlock',async()=>{
 const env=events(),pending=[];const l=vaultSessionLifecycleLab({openScopeSession:()=>new Promise(resolve=>pending.push(resolve))},env);
 const first=l.unlock('school','synthetic');l.lock('school');const stale=session('stale');pending.shift()(stale);
 await assert.rejects(first,/во время открытия/);assert.equal(stale.isLocked(),true);
 const a=l.unlock('school','synthetic'),b=l.unlock('school','synthetic');const old=session('old'),fresh=session('fresh');
 pending.shift()(old);pending.shift()(fresh);await assert.rejects(a,/во время открытия/);await b;
 assert.equal(await l.read('school'),'fresh');
 let finish;const slow=session('slow');slow.read=()=>new Promise(resolve=>finish=resolve);
 const c=l.unlock('school','synthetic');pending.shift()(slow);await c;const reading=l.read('school');env.window.dispatchEvent(new Event('pagehide'));finish('secret');
 await assert.rejects(reading,/заблокирован/);assert.equal(slow.isLocked(),true);l.dispose();
});

class TestChannel extends EventTarget{
 static instances=new Set();
 constructor(name){super();this.name=name;this.sent=[];TestChannel.instances.add(this);}
 postMessage(message){this.sent.push(message);for(const peer of TestChannel.instances)if(peer!==this&&peer.name===this.name)peer.dispatchEvent(new MessageEvent('message',{data:structuredClone(message)}));}
 close(){TestChannel.instances.delete(this);}
}
test('Explicit cross-tab LAB lock is bundle-scoped, closes pending sessions, never broadcasts data or echoes',async()=>{
 const bundle={openScopeSession:async({scope})=>session(scope)},env=events();
 let remote=0,resolveOpen;
 const a=vaultSessionLifecycleLab(bundle,{...env,bundleId:'shared',Channel:TestChannel});
 const b=vaultSessionLifecycleLab({openScopeSession:()=>new Promise(resolve=>resolveOpen=resolve)},{...events(),bundleId:'shared',Channel:TestChannel,onRemoteLock:()=>remote++});
 const c=vaultSessionLifecycleLab(bundle,{...events(),bundleId:'other',Channel:TestChannel});
 try{
  await a.unlock('school','synthetic');await c.unlock('school','synthetic');
  const pending=b.unlock('coach','synthetic');a.lockEveryTab();
  const stale=session('stale');resolveOpen(stale);await assert.rejects(pending,/во время открытия/);
  assert.equal(stale.isLocked(),true);assert.equal(a.isUnlocked('school'),false);assert.equal(c.isUnlocked('school'),true);assert.equal(remote,1);
  const sent=[...TestChannel.instances].flatMap(x=>x.sent);assert.deepEqual(sent,[{kind:'lock-all',version:1}]);
  await a.unlock('school','synthetic');a.lock('school');assert.equal(remote,1);
 }finally{a.dispose();b.dispose();c.dispose();}
 assert.equal(TestChannel.instances.size,0);
});
test('LAB cross-tab transport fails closed and refuses malformed lock messages',async()=>{
 const bundle={openScopeSession:async()=>session('synthetic')};
 assert.throws(()=>vaultSessionLifecycleLab(bundle,{...events(),bundleId:'test',Channel:null}),/BroadcastChannel/);
 const l=vaultSessionLifecycleLab(bundle,{...events(),bundleId:'test',Channel:TestChannel});
 try{
  await l.unlock('school','synthetic');const channel=[...TestChannel.instances][0];
  channel.dispatchEvent(new MessageEvent('message',{data:{kind:'lock-all',version:1,password:'ignored'}}));assert.equal(l.isUnlocked('school'),true);
  channel.dispatchEvent(new Event('messageerror'));assert.equal(l.isUnlocked('school'),false);
  await assert.rejects(l.unlock('school','synthetic'),/заблокирован/);assert.throws(()=>l.lockEveryTab(),/недоступен/);
 }finally{l.dispose();}
});
