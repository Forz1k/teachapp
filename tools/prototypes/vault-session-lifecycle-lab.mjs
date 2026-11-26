/* LAB-only browser lifecycle adapter. Does not load or render live records.
 * Locks on hidden/frozen/pagehide, including in-progress unlocks and reads. */
const scopes=['school','coach','workspace'],check=(ok,msg)=>{if(!ok)throw Error(msg);};
export function vaultSessionLifecycleLab(bundle,{document:doc=globalThis.document,window:win=globalThis.window}={}){
 check(typeof bundle?.openScopeSession==='function'&&typeof doc?.addEventListener==='function'&&typeof win?.addEventListener==='function'&&typeof doc.visibilityState==='string','Требуется браузерный lifecycle LAB');
 const entries=new Map(scopes.map(s=>[s,{epoch:0,session:null}]));
 let disposed=false;
 const entry=scope=>{check(entries.has(scope),'Неизвестная область LAB');return entries.get(scope);};
 const visible=()=>!disposed&&doc.visibilityState==='visible';
 const lock=scope=>{const e=entry(scope);e.epoch++;e.session?.close();e.session=null;};
 const lockAll=()=>{for(const s of scopes)lock(s);};
 const visibility=()=>{if(!visible())lockAll();};
 doc.addEventListener('visibilitychange',visibility);
 doc.addEventListener('freeze',lockAll);
 win.addEventListener('pagehide',lockAll);
 return Object.freeze({
  async unlock(scope,password,options={}){
   check(visible(),'Скрытый или закрытый экран LAB заблокирован');
   const e=entry(scope);lock(scope);const epoch=e.epoch;
   const session=await bundle.openScopeSession({scope,password,idleMs:options.idleMs,now:options.now});
   if(!visible()||epoch!==e.epoch){session.close();throw Error('Сеанс LAB заблокирован во время открытия');}
   e.session=session;return true;
  },
  async read(scope){
   const e=entry(scope);
   if(!visible()){lockAll();throw Error('Скрытый или закрытый экран LAB заблокирован');}
   const session=e.session,epoch=e.epoch;
   check(session&&!session.isLocked(),'Сеанс LAB заблокирован; откройте заново');
   const data=await session.read();
   check(visible()&&e.epoch===epoch&&e.session===session&&!session.isLocked(),'Сеанс LAB заблокирован; откройте заново');
   return data;
  },
  isUnlocked(scope){
   if(!visible()){lockAll();return false;}
   const session=entry(scope).session;return !!session&&!session.isLocked();
  },
  lock,lockAll,
  dispose(){
   if(disposed)return;disposed=true;lockAll();
   doc.removeEventListener('visibilitychange',visibility);
   doc.removeEventListener('freeze',lockAll);
   win.removeEventListener('pagehide',lockAll);
  }
 });
}
