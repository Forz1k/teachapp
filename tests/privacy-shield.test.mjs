import test from 'node:test';
import assert from 'node:assert/strict';
import {readShieldPreferences,saveShieldPreferences,autoCoverReason,installPrivacyShield} from '../js/privacy-shield.js';
const prefs={idleMinutes:1,hideOnBackground:false};
test('auto shield is disabled by default and stores only device preferences',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 assert.deepEqual(readShieldPreferences(storage),{idleMinutes:0,hideOnBackground:false});
 assert.deepEqual(saveShieldPreferences(prefs,storage,null),prefs);
 assert.deepEqual(readShieldPreferences(storage),prefs);
 assert.throws(()=>saveShieldPreferences({idleMinutes:2,hideOnBackground:false},storage,null));
 map.set('teachapp.privacy-shield.v1','malformed');
 assert.deepEqual(readShieldPreferences(storage),{idleMinutes:0,hideOnBackground:false});
});
test('auto shield only activates when enabled, respects inactivity and background options',()=>{
 assert.equal(autoCoverReason(prefs,{lastActivity:0,now:59999}),null);
 assert.equal(autoCoverReason(prefs,{lastActivity:0,now:60000}),'idle');
 assert.equal(autoCoverReason(prefs,{lastActivity:0,now:60000,covered:true}),null);
 assert.equal(autoCoverReason({idleMinutes:0,hideOnBackground:true},{lastActivity:0,now:0,hidden:true}),'background');
 assert.equal(autoCoverReason({idleMinutes:0,hideOnBackground:false},{lastActivity:0,now:999999,hidden:true}),null);
});
test('controller resets on activity, covers on elapsed time, handles visibility and cleans listeners',()=>{
 let clock=0,scheduled=null,covered=false,preferences={...prefs},calls=[];
 const doc=new EventTarget(),win=new EventTarget();
 doc.visibilityState='visible';doc.body={classList:{contains:()=>covered}};
 const stop=installPrivacyShield({documentTarget:doc,windowTarget:win,read:()=>preferences,cover:reason=>{covered=true;calls.push(reason);},now:()=>clock,setTimer:(fn,delay)=>{scheduled={fn,at:clock+delay};return 1;},clearTimer:()=>{scheduled=null;}});
 const advance=ms=>{clock+=ms;if(scheduled&&scheduled.at<=clock){const task=scheduled;scheduled=null;task.fn();}};
 advance(40000);doc.dispatchEvent(new Event('pointerdown'));advance(20000);assert.deepEqual(calls,[]);
 advance(40000);assert.deepEqual(calls,['idle']);
 covered=false;doc.dispatchEvent(new Event('click'));
 preferences={idleMinutes:0,hideOnBackground:true};win.dispatchEvent(new Event('teachapp:privacy-shield-preferences'));
 doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));assert.deepEqual(calls,['idle','background']);
 stop();covered=false;doc.dispatchEvent(new Event('visibilitychange'));advance(90000);assert.deepEqual(calls,['idle','background']);assert.equal(scheduled,null);
});

test('Screen lock fails closed on unavailable or malformed storage',async()=>{
 const {screenLockEnabled,verifyScreenLock}=await import('../js/privacy-shield.js');
 const denied={getItem(){throw Error('denied');}};
 assert.equal(screenLockEnabled(denied),true);assert.equal(await verifyScreenLock('',denied),false);
 assert.equal(await verifyScreenLock('',{getItem:()=>null}),true);
 assert.equal(await verifyScreenLock('123456',{getItem:()=>'{broken'}),false);
});
test('Screen lock rejects stale verifier and competing changes',async()=>{
 const {changeScreenLock,verifyScreenLock}=await import('../js/privacy-shield.js');
 let raw=null;const storage={getItem:()=>raw,setItem:(k,v)=>{raw=v;},removeItem:()=>{raw=null;}};
 await changeScreenLock({next:'123456'},storage);
 assert.equal(await verifyScreenLock('123456',storage),true);
 const old=raw,checking=verifyScreenLock('123456',storage);raw=null;
 assert.equal(await checking,false);
 raw=old;const changing=changeScreenLock({current:'123456',next:'987654'},storage);raw=null;
 await assert.rejects(changing,/другой вкладке/);assert.equal(raw,null);
 const noWrite={getItem:()=>null,setItem:()=>{}};
 await assert.rejects(changeScreenLock({next:'123456'},noWrite),/Не удалось сохранить/);
});
