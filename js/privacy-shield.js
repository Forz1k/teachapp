/* Device-only opt-in privacy screen. Does not encrypt data or authenticate users. */
const KEY='teachapp.privacy-shield.v1',EVENT='teachapp:privacy-shield-preferences';
export const privacyIdleOptions=[0,1,3,5,10,15,30];
const defaults=()=>({idleMinutes:0,hideOnBackground:false});
export function validateShieldPreferences(value){
 if(!value||typeof value!=='object'||!privacyIdleOptions.includes(value.idleMinutes)||typeof value.hideOnBackground!=='boolean')throw Error('Некорректные настройки экранной ширмы');
 return {idleMinutes:value.idleMinutes,hideOnBackground:value.hideOnBackground};
}
export function readShieldPreferences(storage){
 try{const raw=(storage??globalThis.localStorage).getItem(KEY);return raw?validateShieldPreferences(JSON.parse(raw)):defaults();}catch{return defaults();}
}
export function saveShieldPreferences(value,storage,windowTarget=globalThis.window){
 const valid=validateShieldPreferences(value),target=storage??globalThis.localStorage;
 target.setItem(KEY,JSON.stringify(valid));
 const stored=readShieldPreferences(target);
 if(stored.idleMinutes!==valid.idleMinutes||stored.hideOnBackground!==valid.hideOnBackground)throw Error('Не удалось сохранить экранную ширму');
 windowTarget?.dispatchEvent(new Event(EVENT));return stored;
}
export function autoCoverReason(preferences,{lastActivity,now,hidden=false,covered=false}){
 if(covered)return null;
 const p=validateShieldPreferences(preferences);
 if(hidden&&p.hideOnBackground)return 'background';
 if(p.idleMinutes>0&&now-lastActivity>=p.idleMinutes*60000)return 'idle';
 return null;
}
export function installPrivacyShield({documentTarget=globalThis.document,windowTarget=globalThis.window,read=readShieldPreferences,cover,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let preferences=read(),lastActivity=now(),timer=null,stopped=false;
 const covered=()=>documentTarget.body.classList.contains('privacy-covered');
 const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
 function check(){
  clear();if(stopped)return;
  const reason=autoCoverReason(preferences,{lastActivity,now:now(),hidden:documentTarget.visibilityState==='hidden',covered:covered()});
  if(reason){cover(reason);return;}
  if(!covered()&&preferences.idleMinutes>0)timer=setTimer(check,Math.max(1,lastActivity+preferences.idleMinutes*60000-now()));
 }
 function activity(){
  if(documentTarget.visibilityState==='hidden')return;
  lastActivity=now();check();
 }
 function changed(){preferences=read();lastActivity=now();check();}
 function storageChanged(event){if(event.key===KEY||event.key===null)changed();}
 const events=['pointerdown','keydown','click','touchstart','wheel'];
 for(const event of events)documentTarget.addEventListener(event,activity,{passive:true});
 documentTarget.addEventListener('visibilitychange',check);
 windowTarget.addEventListener(EVENT,changed);windowTarget.addEventListener('storage',storageChanged);
 check();
 return ()=>{stopped=true;clear();for(const event of events)documentTarget.removeEventListener(event,activity);documentTarget.removeEventListener('visibilitychange',check);windowTarget.removeEventListener(EVENT,changed);windowTarget.removeEventListener('storage',storageChanged);};
}
