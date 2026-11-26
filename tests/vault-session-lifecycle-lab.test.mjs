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
