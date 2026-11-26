import test from 'node:test';import assert from 'node:assert/strict';
import {reminderController,readReminderPreferences,saveReminderPreferences,validateReminderPreferences,REMINDER_KEY} from '../js/reminder-controller.js';
const now=()=>new Date(2026,10,26,12),event={source:'custom',id:'private-id',title:'PRIVATE',date:'2026-11-26',time:'12:00',remind:0,done:false};
test('Device preferences persist only source categories and fail closed on invalid values',()=>{
 const m=new Map(),storage={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};
 assert.equal(readReminderPreferences(storage).enabled,false);
 saveReminderPreferences({enabled:true,sources:['custom'],private:'SECRET'},storage,null);
 assert.deepEqual(readReminderPreferences(storage),{enabled:true,sources:['custom']});assert.doesNotMatch(m.get(REMINDER_KEY),/SECRET|private/);
 assert.throws(()=>validateReminderPreferences({enabled:true,sources:[]}));m.set(REMINDER_KEY,'bad');assert.equal(readReminderPreferences(storage).enabled,false);
});
test('App-wide controller deduplicates, filters sources and never sends personal fields',async()=>{
 let settings={enabled:false,sources:['custom']},allowed=true,reads=0;const sent=[];
 const c=reminderController({read:()=>settings,allowed:()=>allowed,now,load:async(from,to)=>{reads++;assert.equal(from,'2026-10-27');assert.equal(to,'2026-11-27');return [event,event,{...event,source:'school',id:'lesson'}];},prepare:async()=>(title,opts)=>sent.push({title,...opts})});
 assert.equal(await c.poll(),0);assert.equal(reads,0);settings={...settings,enabled:true};assert.equal(await c.poll(),1);assert.equal(await c.poll(),0);assert.equal(sent.length,1);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE|private-id/);
 allowed=false;assert.equal(await c.poll(),0);c.stop();allowed=true;assert.equal(await c.poll(),0);
});
test('Revocation while awaiting permission/registration or source read never dispatches',async()=>{
 let settings={enabled:true,sources:['custom']},allowed=true,unblock,dispatched=0;
 const c=reminderController({read:()=>settings,allowed:()=>allowed,now,load:async()=>[event],prepare:()=>new Promise(resolve=>{unblock=resolve;})});
 const pending=c.poll();await Promise.resolve();allowed=false;unblock(()=>dispatched++);assert.equal(await pending,0);assert.equal(dispatched,0);
 allowed=true;let finish;const d=reminderController({read:()=>settings,allowed:()=>allowed,now,load:()=>new Promise(resolve=>finish=resolve),prepare:async()=>()=>dispatched++});
 const second=d.poll();settings={...settings,enabled:false};d.invalidate();finish([event]);assert.equal(await second,0);assert.equal(dispatched,0);
});

import {installReminders} from '../js/reminder-controller.js';
import {PRIVACY_VISIBILITY_EVENT} from '../js/privacy-shield.js';
test('Reminder install fences pagehide, freeze and quick privacy cover/reveal while reading; cleans listeners',async()=>{
 const doc=new EventTarget(),win=new EventTarget();let covered=false;
 doc.visibilityState='visible';doc.body={classList:{contains:()=>covered}};
 const pending=[],sent=[];let tick,cleared=false;
 const drain=()=>new Promise(resolve=>setImmediate(resolve));
 const stop=installReminders({documentTarget:doc,windowTarget:win,read:()=>({enabled:true,sources:['custom']}),permission:()=> 'granted',now,
  load:()=>new Promise(resolve=>pending.push(resolve)),prepare:async()=>(title,opts)=>sent.push({title,...opts}),
  setTimer:fn=>{tick=fn;return 1;},clearTimer:id=>{assert.equal(id,1);cleared=true;}});
 assert.equal(pending.length,1);
 win.dispatchEvent(new Event('pagehide'));pending.shift()([event]);await drain();assert.equal(sent.length,0);
 tick();win.dispatchEvent(new Event('focus'));assert.equal(pending.length,0);
 win.dispatchEvent(new Event('pageshow'));assert.equal(pending.length,1);
 doc.dispatchEvent(new Event('freeze'));doc.dispatchEvent(new Event('resume'));pending.shift()([event]);await drain();assert.equal(sent.length,0);
 assert.equal(pending.length,1);covered=true;win.dispatchEvent(new Event(PRIVACY_VISIBILITY_EVENT));covered=false;win.dispatchEvent(new Event(PRIVACY_VISIBILITY_EVENT));
 pending.shift()([event]);await drain();assert.equal(sent.length,0);
 assert.equal(pending.length,1);pending.shift()([event]);await drain();assert.equal(sent.length,1);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE|private-id/);
 stop();assert.equal(cleared,true);win.dispatchEvent(new Event('pageshow'));doc.dispatchEvent(new Event('resume'));tick();assert.equal(pending.length,0);
});

test('Preference refresh coalesces concurrent changes, rechecks consent immediately and never dispatches a stale batch',async()=>{
 let settings={enabled:true,sources:['custom']};const pending=[],sent=[],drain=()=>new Promise(resolve=>setImmediate(resolve));
 const c=reminderController({read:()=>settings,allowed:()=>true,now,load:()=>new Promise(resolve=>pending.push(resolve)),prepare:async()=>(title,opts)=>sent.push({title,...opts})});
 const first=c.poll();assert.equal(pending.length,1);
 settings={enabled:false,sources:['custom']};c.refresh();c.refresh();
 settings={enabled:true,sources:['school']};c.refresh();c.refresh();
 assert.equal(pending.length,1);pending.shift()([event]);assert.equal(await first,0);await drain();
 assert.equal(pending.length,1);pending.shift()([event,{...event,source:'school',id:'synthetic-lesson'}]);await drain();
 assert.equal(sent.length,1);assert.equal(sent[0].body,'Есть актуальные напоминания: 1');
 assert.doesNotMatch(JSON.stringify(sent),/PRIVATE|synthetic-lesson/);
 const final=c.poll();c.refresh();settings={enabled:false,sources:['school']};c.refresh();pending.shift()([event]);await final;await drain();assert.equal(pending.length,0);
 settings={enabled:true,sources:['custom']};const stopped=c.poll();c.refresh();c.stop();pending.shift()([event]);await stopped;await drain();assert.equal(pending.length,0);assert.equal(sent.length,1);
});

import {enableReminderPermission,REMINDER_EVENT,REMINDER_SHEET_EVENT} from '../js/reminder-controller.js';
test('Permission grant cannot recreate revoked consent or survive changed source, sheet or privacy context',async()=>{
 const win=new EventTarget(),doc=new EventTarget(),source=new EventTarget();
 let prefs={enabled:false,sources:['custom']},active=true,resolve,writes=0;
 const start=()=>enableReminderPermission({sources:['custom'],read:()=>prefs,save:p=>{writes++;prefs=p;},active:()=>active,request:()=>new Promise(r=>resolve=r),windowTarget:win,documentTarget:doc,sourceTarget:source});
 for(const [target,event] of [[win,REMINDER_EVENT],[win,REMINDER_SHEET_EVENT],[win,PRIVACY_VISIBILITY_EVENT],[win,'pagehide'],[doc,'freeze'],[doc,'visibilitychange'],[source,'change']]){
  const work=start();target.dispatchEvent(new Event(event));resolve('granted');assert.equal(await work,'stale');assert.equal(writes,0);
 }
 const changed=start();prefs={enabled:false,sources:['school']};resolve('granted');assert.equal(await changed,'stale');prefs={enabled:false,sources:['custom']};
 const storage=start(),e=new Event('storage');Object.defineProperty(e,'key',{value:REMINDER_KEY});win.dispatchEvent(e);resolve('granted');assert.equal(await storage,'stale');
 const hidden=start();active=false;resolve('granted');assert.equal(await hidden,'stale');active=true;
 const denied=start();resolve('denied');assert.equal(await denied,'denied');assert.equal(writes,0);
 const granted=start();resolve('granted');assert.equal(await granted,'enabled');assert.equal(writes,1);assert.deepEqual(prefs,{enabled:true,sources:['custom']});
 assert.equal(await start(),'stale');assert.equal(writes,1);
});
