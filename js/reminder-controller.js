/* Device-local opt-in. No network, background push, or personal fields in storage. */
import {foregroundReminderBatch} from './work-calendar.js';
import {addDays} from './model.js';
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
 let busy=false,epoch=0,stopped=false,seen=new Set();
 const invalidate=()=>{epoch++;};
 const stop=()=>{stopped=true;invalidate();seen.clear();};
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
   for(const key of batch.keys)seen.add(key);
   // Bound per-tab memory. Repeats remain possible after restart or very large histories.
   while(seen.size>5000)seen.delete(seen.values().next().value);
   return batch.keys.length;
  }catch{return 0;}finally{busy=false;}
 }
 return {poll,invalidate,stop};
}
function todayIsoAt(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
export function installReminders({load,documentTarget=globalThis.document,windowTarget=globalThis.window,navigatorTarget=globalThis.navigator}){
 const allowed=()=>documentTarget.visibilityState==='visible'&&!documentTarget.body.classList.contains('privacy-covered')&&globalThis.Notification?.permission==='granted';
 const controller=reminderController({load,allowed,prepare:async()=>{
  const registration=await navigatorTarget.serviceWorker?.getRegistration();
  if(registration?.showNotification)return (title,opts)=>registration.showNotification(title,opts);
  if(typeof globalThis.Notification==='function')return (title,opts)=>new Notification(title,opts);
  return null;
 }});
 const changed=()=>{controller.invalidate();void controller.poll();};
 const storageChanged=e=>{if(e.key===REMINDER_KEY||e.key===null)changed();};
 const tick=()=>void controller.poll();
 const timer=setInterval(tick,30000);
 documentTarget.addEventListener('visibilitychange',changed);
 windowTarget.addEventListener(REMINDER_EVENT,changed);windowTarget.addEventListener('storage',storageChanged);windowTarget.addEventListener('focus',tick);
 tick();
 return ()=>{clearInterval(timer);controller.stop();documentTarget.removeEventListener('visibilitychange',changed);windowTarget.removeEventListener(REMINDER_EVENT,changed);windowTarget.removeEventListener('storage',storageChanged);windowTarget.removeEventListener('focus',tick);};
}
