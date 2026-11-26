/* Device-local opt-in. No network, background push, or personal fields in storage. */
import {foregroundReminderBatch} from './work-calendar.js';
import {addDays} from './model.js';
import {PRIVACY_VISIBILITY_EVENT} from './privacy-shield.js';
export const reminderSources={school:'Уроки',coach:'Волейбол',tournament:'Турниры',schoolCompetition:'Олимпиады и соревнования',normRetake:'Пересдачи',custom:'Свои события',review:'Проверки',backup:'Резервные копии'};
export const REMINDER_KEY='teachapp.reminder-preferences.v1',REMINDER_EVENT='teachapp:reminder-preferences';
const defaults=()=>({enabled:false,sources:Object.keys(reminderSources)});
export function validateReminderPreferences(value){
 if(!value||typeof value.enabled!=='boolean'||!Array.isArray(value.sources)||value.sources.some(s=>!Object.hasOwn(reminderSources,s))||new Set(value.sources).size!==value.sources.length||value.enabled&&!value.sources.length)throw Error('Выберите хотя бы один источник напоминаний');
 return {enabled:value.enabled,sources:Object.keys(reminderSources).filter(s=>value.sources.includes(s))};
}
export function readReminderPreferences(storage){
 try{const raw=(storage??globalThis.localStorage).getItem(REMINDER_KEY);return raw?validateReminderPreferences(JSON.parse(raw)):defaults();}catch{return defaults();}
}
export function saveReminderPreferences(value,storage,windowTarget=globalThis.window){
 const p=validateReminderPreferences(value),target=storage??globalThis.localStorage;
 target.setItem(REMINDER_KEY,JSON.stringify(p));
 const actual=readReminderPreferences(target);
 if(JSON.stringify(actual)!==JSON.stringify(p))throw Error('Не удалось сохранить настройки напоминаний');
 windowTarget?.dispatchEvent(new Event(REMINDER_EVENT));return p;
}
/** Injected dependencies enable deterministic tests. Recheck consent, privacy
 * and permission immediately before dispatch; stale reads never send alerts. */
export function reminderController({read=readReminderPreferences,allowed,load,prepare,now=()=>new Date()}){
 let busy=false,epoch=0,stopped=false,queued=false,seen=new Set();
 const invalidate=()=>{epoch++;};
 const stop=()=>{stopped=true;queued=false;invalidate();seen.clear();};
 // A lifecycle/settings change must not wait for the next periodic tick.
 // Coalesce all changes during a running check into one fresh read.
 function refresh(){if(stopped)return;invalidate();if(busy){queued=true;return;}void poll();}
 async function poll(){
  if(stopped||busy||!allowed())return 0;
  const settings=read();if(!settings.enabled)return 0;
  const fingerprint=JSON.stringify(settings),generation=epoch,valid=()=>!stopped&&generation===epoch&&allowed()&&JSON.stringify(read())===fingerprint;
  busy=true;
  try{
   const day=todayIsoAt(now()),all=await load(addDays(day,-30),addDays(day,1));
   if(!valid())return 0;
   const batch=foregroundReminderBatch(all.filter(e=>settings.sources.includes(e.source)),seen,now());
   if(!batch.keys.length)return 0;
   const dispatch=await prepare();
   if(!valid()||typeof dispatch!=='function')return 0;
   await dispatch(batch.title,{body:batch.body,tag:'teachapp-calendar-reminders'});
   if(stopped)return 0;
   for(const key of batch.keys)seen.add(key);
   // Bound per-tab memory. Repeats remain possible after restart or very large histories.
   while(seen.size>5000)seen.delete(seen.values().next().value);
   return batch.keys.length;
  }catch{return 0;}finally{busy=false;if(queued){queued=false;if(!stopped)void poll();}}
 }
 return {poll,invalidate,refresh,stop};
}
function todayIsoAt(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
// Page lifecycle is a fence even if visibilityState has not changed yet.
// Explicit privacy events invalidate old reads when cover + reveal happen
// before an awaited calendar/registration operation completes.
export function installReminders({load,documentTarget=globalThis.document,windowTarget=globalThis.window,navigatorTarget=globalThis.navigator,read=readReminderPreferences,permission=()=>globalThis.Notification?.permission,now,prepare,setTimer=setInterval,clearTimer=clearInterval}){
 let pageActive=true,frozen=false,disposed=false;
 const allowed=()=>!disposed&&pageActive&&!frozen&&documentTarget.visibilityState==='visible'&&!documentTarget.body.classList.contains('privacy-covered')&&permission()==='granted';
 const controller=reminderController({load,read,now,allowed,prepare:prepare??(async()=>{
  const registration=await navigatorTarget.serviceWorker?.getRegistration();
  if(registration?.showNotification)return (title,opts)=>registration.showNotification(title,opts);
  if(typeof globalThis.Notification==='function')return (title,opts)=>new Notification(title,opts);
  return null;
 })});
 const changed=()=>controller.refresh();
 const storageChanged=e=>{if(e.key===REMINDER_KEY||e.key===null)changed();};
 const tick=()=>void controller.poll();
 const hidePage=()=>{pageActive=false;changed();};
 const showPage=()=>{pageActive=true;frozen=false;changed();};
 const freeze=()=>{frozen=true;changed();};
 const resume=()=>{frozen=false;changed();};
 const timer=setTimer(tick,30000);
 const docEvents=[['visibilitychange',changed],['freeze',freeze],['resume',resume]];
 const winEvents=[[REMINDER_EVENT,changed],[PRIVACY_VISIBILITY_EVENT,changed],['storage',storageChanged],['focus',tick],['pagehide',hidePage],['pageshow',showPage]];
 for(const [event,listener] of docEvents)documentTarget.addEventListener(event,listener);
 for(const [event,listener] of winEvents)windowTarget.addEventListener(event,listener);
 tick();
 return ()=>{if(disposed)return;disposed=true;clearTimer(timer);controller.stop();for(const [event,listener] of docEvents)documentTarget.removeEventListener(event,listener);for(const [event,listener] of winEvents)windowTarget.removeEventListener(event,listener);};
}
