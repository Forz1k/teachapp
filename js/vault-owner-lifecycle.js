/* One-document, all-key owner session gate. Never selects a storage backend.
 * The caller supplies one explicit backend and a terminal UI revocation hook.
 * No keys/passwords/storage in the lifecycle; no fallback or re-open after lock. */
const check=(ok,message)=>{if(!ok)throw Error(message);};
export function createOwnerSessionLifecycle({openSession,onLock=()=>{},channelName,documentTarget=globalThis.document,windowTarget=globalThis.window,Channel=globalThis.BroadcastChannel,idleMs=5*60*1000,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}){
 check(typeof openSession==='function'&&typeof onLock==='function'&&typeof channelName==='string'&&channelName.length>0&&channelName.length<=180,'Требуется явный сеанс владельца');
 check(typeof documentTarget?.addEventListener==='function'&&typeof windowTarget?.addEventListener==='function'&&typeof Channel==='function','Межвкладочная блокировка недоступна');
 check(Number.isSafeInteger(idleMs)&&idleMs>0&&idleMs<=30*60*1000,'Некорректный тайм-аут');
 const channel=new Channel(channelName),doc=documentTarget,win=windowTarget;
 let cell=null,terminal=false,disposed=false;
 const visible=()=>!disposed&&!terminal&&doc.visibilityState==='visible';
 function revoke(reason){
  if(terminal)return;
  terminal=true;const previous=cell;cell=null;
  if(previous){clearTimer(previous.timer);try{previous.access?.close();}catch{}previous.access=null;}
  try{onLock(reason);}catch{}
 }
 const lock=()=>revoke('manual'),background=()=>{if(doc.visibilityState!=='visible'&&cell)revoke('hidden');},freeze=()=>revoke('freeze'),pagehide=()=>revoke('pagehide'),transport=()=>revoke('transport');
 const remote=e=>{const m=e.data;if(m&&typeof m==='object'&&Object.keys(m).sort().join('|')==='kind|version'&&m.kind==='lock-owner'&&m.version===1)revoke('remote');};
 function allowed(c){
  if(cell===c&&!terminal&&(!visible()||now()>=c.deadline||c.access?.isClosed?.()))revoke(!visible()?'hidden':'expired');
  return cell===c&&visible();
 }
 function arm(c){
  clearTimer(c.timer);c.deadline=now()+idleMs;
  c.timer=setTimer(()=>{if(cell===c)revoke('expired');},idleMs);c.timer?.unref?.();
 }
 function activity(){if(cell&&allowed(cell))arm(cell);}
 const events=['pointerdown','keydown','touchstart'];
 for(const event of events)doc.addEventListener(event,activity,{passive:true});
 doc.addEventListener('visibilitychange',background);doc.addEventListener('freeze',freeze);win.addEventListener('pagehide',pagehide);
 channel.addEventListener('message',remote);channel.addEventListener('messageerror',transport);
 return Object.freeze({
  async unlock(passwords){
   check(visible()&&!cell,'Сеанс закрыт или уже открывается');
   const c={access:null,timer:null,deadline:0};cell=c;arm(c);
   try{
    const pending=openSession({passwords,stillAllowed:()=>allowed(c)});passwords=undefined;
    const access=await pending;
    if(!allowed(c)){access?.close?.();throw Error('Сеанс владельца заблокирован');}
    c.access=access;
    check(typeof access?.transaction==='function'&&typeof access?.close==='function','Некорректный backend владельца');
    arm(c);
    return true;
   }catch(error){
    if(cell===c){clearTimer(c.timer);try{c.access?.close?.();}catch{}cell=null;}
    throw error;
   }
  },
  async transaction(names,mode,fn){
   const c=cell;check(c?.access&&allowed(c),'Сеанс владельца заблокирован');
   try{const result=await c.access.transaction(names,mode,fn);
    check(allowed(c),'Сеанс владельца заблокирован');return result;
   }catch(e){allowed(c);throw e;}
  },
  isUnlocked(){return !!cell?.access&&allowed(cell);},
  lock,
  lockEveryTab(){
   revoke('manual');
   if(disposed)throw Error('Канал блокировки закрыт');
   try{channel.postMessage({kind:'lock-owner',version:1});}catch{throw Error('Межвкладочная блокировка недоступна');}
  },
  dispose(){
   if(disposed)return;revoke('dispose');disposed=true;
   for(const event of events)doc.removeEventListener(event,activity);
   doc.removeEventListener('visibilitychange',background);doc.removeEventListener('freeze',freeze);win.removeEventListener('pagehide',pagehide);
   channel.removeEventListener('message',remote);channel.removeEventListener('messageerror',transport);channel.close();
  }
 });
}
/** Synchronously remove the old screen before a full document reload.
 * Never claim to erase arbitrary JS references or already committed writes. */
export function scrubPrivateDocument(documentTarget=globalThis.document){
 const body=documentTarget.body;
 const message=documentTarget.createElement('main');message.setAttribute('role','status');message.textContent='Доступ закрыт. Перезагрузите TeachApp.';
 body.replaceChildren(message);
}
