/* Writable route lifecycle, synthetic LAB only. No live application toggle,
 * no plaintext fallback. Nonextractable PBKDF2 material derives per revision. */
import {createDataAccess} from '../../js/db.js';
const check=(ok,message)=>{if(!ok)throw Error(message);};
export function routedVaultLifecycleLab(router,{id,document:doc=globalThis.document,window:win=globalThis.window,Channel=globalThis.BroadcastChannel,idleMs=5*60*1000,now=()=>performance.now(),onLock=()=>{}}={}){
 check(typeof router?.transaction==='function'&&typeof router?.openKeySession==='function'&&typeof id==='string'&&/^[a-z0-9-]{1,48}$/.test(id),'Некорректный маршрут LAB');
 check(typeof doc?.addEventListener==='function'&&typeof win?.addEventListener==='function'&&typeof Channel==='function','Требуется браузерный lifecycle и BroadcastChannel LAB');
 check(Number.isSafeInteger(idleMs)&&idleMs>0&&idleMs<=30*60*1000&&typeof now==='function'&&typeof onLock==='function','Некорректный тайм-аут LAB');
 const channel=new Channel('teachapp-vault-writable-lock-lab-'+id);
 let epoch=0,current=null,disposed=false,channelFailed=false;
 const visible=()=>!disposed&&!channelFailed&&doc.visibilityState==='visible';
 function lock(){
  epoch++;const s=current;current=null;
  if(s){clearTimeout(s.timer);s.keySession?.close();s.keySession=null;try{onLock();}catch{}}
 }
 const fail=()=>{channelFailed=true;lock();};
 const remote=e=>{const m=e.data;if(m&&typeof m==='object'&&Object.keys(m).sort().join('|')==='kind|version'&&m.kind==='lock-all'&&m.version===1)lock();};
 const visibility=()=>{if(!visible())lock();};
 function guard(s){
  if(current===s&&(!visible()||now()>=s.deadline))lock();
  check(current===s&&s.epoch===epoch&&visible(),'Сеанс LAB заблокирован; откройте заново');
 }
 function arm(s){
  clearTimeout(s.timer);s.deadline=now()+idleMs;
  s.timer=setTimeout(()=>{if(current===s)lock();},idleMs);s.timer?.unref?.();
 }
 channel.addEventListener('message',remote);channel.addEventListener('messageerror',fail);
 doc.addEventListener('visibilitychange',visibility);doc.addEventListener('freeze',lock);win.addEventListener('pagehide',lock);
 return Object.freeze({
  async unlock(password){
   check(visible(),'Скрытый или закрытый экран LAB заблокирован');
   lock();const s={epoch,keySession:null,deadline:0,timer:null,ready:false};current=s;arm(s);
   const active=()=>guard(s);
   try{
    // Authenticate the entire encrypted snapshot without handing any rows to UI.
    const opening=router.openKeySession({password,assertActive:active});password=undefined;
    const session=await opening;
    try{active();}catch(e){session.close();throw e;}
    s.keySession=session;s.ready=true;arm(s);
    const access=createDataAccess(async(names,mode,fn)=>{
     active();
     try{
      const result=await router.transaction(names,mode,fn,{expectedGeneration:2,keySession:s.keySession,assertActive:active});
      active();arm(s);return result;
     }catch(e){if(current===s)lock();throw e;}
    });
    return Object.freeze({...access,close(){if(current===s)lock();}});
   }catch(e){if(current===s)lock();throw e;}
  },
  isUnlocked(){if(!current)return false;try{guard(current);return current.ready;}catch{return false;}},
  lock,
  lockEveryTab(){lock();check(!disposed&&!channelFailed,'Канал LAB недоступен');try{channel.postMessage({kind:'lock-all',version:1});}catch{fail();throw Error('Канал LAB недоступен');}},
  dispose(){if(disposed)return;disposed=true;lock();channel.removeEventListener('message',remote);channel.removeEventListener('messageerror',fail);channel.close();doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('freeze',lock);win.removeEventListener('pagehide',lock);}
 });
}
