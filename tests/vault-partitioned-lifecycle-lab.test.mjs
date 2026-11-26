import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {createSchoolSession} from '../js/store.js';
import {createCoachSession} from '../js/coach.js';
import {partitionedVaultLab} from '../tools/prototypes/vault-partitioned-lab.mjs';
import {partitionedVaultLifecycleLab} from '../tools/prototypes/vault-partitioned-lifecycle-lab.mjs';
const passwords={school:'synthetic-school-key',coach:'synthetic-coach-key',workspace:'synthetic-owner-key'};
class Channel extends EventTarget{
 static all=new Set();constructor(name){super();this.name=name;Channel.all.add(this);}
 postMessage(data){for(const peer of Channel.all)if(peer!==this&&peer.name===this.name)peer.dispatchEvent(new MessageEvent('message',{data:structuredClone(data)}));}
 close(){Channel.all.delete(this);}
}
const env=()=>{const document=new EventTarget(),window=new EventTarget();document.visibilityState='visible';return {document,window,Channel};};
async function setup(id){
 const lab=partitionedVaultLab(id,{layout:'school-v2'}),data=Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]]));
 data.classes=[{id:'c',name:'Synthetic class'}];data.students=[{id:'p',classId:'c',fullName:'Synthetic pupil',number:1,normGroup:'girls'}];data.coachTeams=[{id:'t',name:'Synthetic team',archived:false}];
 await lab.stage({data,passwords});return lab;
}
test('Independent lifecycle revokes UI state, rejects stale handles, expires and locks peers of same layout/id',async t=>{
 const id='independent-lifecycle',lab=await setup(id),aEnv=env(),bEnv=env(),otherEnv=env();let clock=0,school,coach;const locked=[];
 const a=partitionedVaultLifecycleLab(lab,{id,...aEnv,now:()=>clock,idleMs:1000,onLock:scope=>{locked.push(scope);if(scope==='school')school?.close();if(scope==='coach')coach?.close();}}),b=partitionedVaultLifecycleLab(lab,{id,...bEnv}),other=partitionedVaultLifecycleLab(lab,{id:'another-id',...otherEnv});
 t.after(()=>[a,b,other].forEach(x=>x.dispose()));
 await assert.rejects(a.unlock('school',passwords.coach),/неверный пароль/);
 const s=await a.unlock('school',passwords.school);school=createSchoolSession(s);await school.load();assert.equal(school.state.students[0].id,'p');
 const c=await a.unlock('coach',passwords.coach);coach=createCoachSession(c);
 const otherScope=await b.unlock('workspace',passwords.workspace),independent=await other.unlock('coach',passwords.coach);
 a.lock('school');assert.ok(school.isClosed());assert.equal(a.isUnlocked('coach'),true);assert.equal(b.isUnlocked('workspace'),true);
 const newer=await a.unlock('school',passwords.school);s.close();assert.ok(a.isUnlocked('school'));
 await assert.rejects(s.getAll('students'),/заблокирован/);
 a.lockEveryTab();assert.equal(a.isUnlocked('school'),false);assert.equal(a.isUnlocked('coach'),false);assert.ok(coach.isClosed());assert.equal(b.isUnlocked('workspace'),false);
 await assert.rejects(otherScope.getAll('meta'),/заблокирован/);assert.equal((await independent.getAll('coachTeams')).length,1);
 await assert.rejects(newer.getAll('students'),/заблокирован/);
 const expired=await a.unlock('school',passwords.school);clock+=1001;assert.equal(a.isUnlocked('school'),false);await assert.rejects(expired.getAll('students'),/заблокирован/);
 const hidden=await a.unlock('coach',passwords.coach);aEnv.document.visibilityState='hidden';aEnv.document.dispatchEvent(new Event('visibilitychange'));await assert.rejects(hidden.getAll('coachTeams'),/заблокирован/);await assert.rejects(a.unlock('school',passwords.school),/Скрытый/);
 assert.ok(locked.includes('school')&&locked.includes('coach'));
});
test('Opening, reading and writing cannot publish after revocation; native CAS guard blocks late writes',async t=>{
 const id='partition-life-race',lab=await setup(id),e=env(),a=partitionedVaultLifecycleLab(lab,{id,...e});t.after(()=>a.dispose());
 const opening=a.unlock('school',passwords.school);a.lock('school');await assert.rejects(opening,/заблокирован/);
 let access=await a.unlock('school',passwords.school),enter,release;
 const entered=new Promise(r=>enter=r),waiting=new Promise(r=>release=r);
 const pending=access.transaction('classes','readwrite',async s=>{await s.classes.put({id:'bad',name:'Uncommitted'});enter();await waiting;});
 await entered;e.window.dispatchEvent(new Event('pagehide'));release();await assert.rejects(pending,/заблокирован/);assert.equal((await lab.snapshot({passwords})).classes.length,1);
 access=await a.unlock('school',passwords.school);
 const proto=IDBObjectStore.prototype,getAll=proto.getAll;let hit=0;
 proto.getAll=function(...args){if(this.transaction.db.name==='teachapp-vault-mutable-school-lab-'+id&&this.transaction.mode==='readwrite'&&this.name==='school'){hit++;a.lock('school');}return getAll.apply(this,args);};
 try{await assert.rejects(access.put('classes',{id:'bad',name:'Uncommitted'}),/заблокирован/);}finally{proto.getAll=getAll;}
 assert.equal(hit,1);assert.equal((await lab.snapshot({passwords})).classes.length,1);
 access=await a.unlock('school',passwords.school);await assert.rejects(access.transaction('classes','readonly',async s=>{const rows=await s.classes.getAll();a.lock('school');return rows;}),/заблокирован/);assert.equal(a.isUnlocked('school'),false);
});
