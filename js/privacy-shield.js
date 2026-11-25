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

// Optional interface lock. A verifier, not the passcode, is stored locally.
// Browser/devtools access can bypass this; encrypted backup is separate.
const LOCK='teachapp.screen-lock.v1',ITERATIONS=600000;
const b64=b=>btoa(String.fromCharCode(...b));
const decode=(s,length)=>{if(typeof s!=='string'||s.length!==Math.ceil(length/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('Повреждены настройки блокировки');const b=Uint8Array.from(atob(s),c=>c.charCodeAt(0));if(b.length!==length)throw Error('Повреждены настройки блокировки');return b;};
const validCode=s=>typeof s==='string'&&s.length<=128&&(/^[0-9]{6,12}$/.test(s)||s.length>=8&&!/^\d+$/.test(s));
async function deriveLock(code,salt){if(typeof code!=='string'||!code.length||code.length>128||!globalThis.crypto?.subtle)throw Error('Для блокировки требуется защищённый контекст HTTPS или localhost');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(code),'PBKDF2',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},key,256));}
export function screenLockEnabled(storage=globalThis.localStorage){try{return storage.getItem(LOCK)!==null;}catch{return false;}}
export async function verifyScreenLock(code,storage=globalThis.localStorage){
 const raw=storage.getItem(LOCK);if(raw===null)return true;
 let r;try{r=JSON.parse(raw);if(r.version!==1||r.iterations!==ITERATIONS)throw Error();const expected=decode(r.verifier,32),actual=await deriveLock(code,decode(r.salt,16));let diff=0;for(let i=0;i<32;i++)diff|=expected[i]^actual[i];return diff===0;}catch{return false;}
}
export async function changeScreenLock({current='',next=null}={},storage=globalThis.localStorage){
 if(screenLockEnabled(storage)&&!await verifyScreenLock(current,storage))throw Error('Неверный действующий PIN или пароль');
 if(next===null){storage.removeItem(LOCK);return false;}
 if(!validCode(next))throw Error('Укажите PIN из 6–12 цифр или пароль длиной от 8 до 128 символов');
 const salt=crypto.getRandomValues(new Uint8Array(16)),verifier=await deriveLock(next,salt);
 storage.setItem(LOCK,JSON.stringify({version:1,iterations:ITERATIONS,salt:b64(salt),verifier:b64(verifier)}));return true;
}
