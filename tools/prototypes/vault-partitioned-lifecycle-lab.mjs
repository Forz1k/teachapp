/* Independent writable scope lifecycle. Browser LAB only, no native fallback.
 * A closed or superseded cell cannot publish results or begin a later CAS. */
import {createDataAccess} from '../../js/db.js';
const scopes=['school','coach','workspace'],check=(v,m)=>{if(!v)throw Error(m);};
export function partitionedVaultLifecycleLab(vault,{id,layout='school-v2',document:doc=globalThis.document,window:win=globalThis.window,Channel=globalThis.BroadcastChannel,idleMs=5*60*1000,now=()=>performance.now(),onLock=()=>{}}={}){
 check(typeof vault?.openScope==='function'&&typeof id==='string'&&/^[a-z0-9-]{1,48}$/.test(id)&&['v1','school-v2','school-v2-migrated','school-v3-device-migrated'].includes(layout),'Некорректный набор LAB');
 check(typeof doc?.addEventListener==='function'&&typeof doc.visibilityState==='string'&&typeof win?.addEventListener==='function'&&typeof Channel==='function','Требуется браузерный lifecycle и BroadcastChannel LAB');
 check(Number.isSafeInteger(idleMs)&&idleMs>0&&idleMs<=30*60*1000&&typeof now==='function'&&typeof onLock==='function','Некорректный тайм-аут LAB');
 const channel=new Channel('teachapp-vault-partition-lock-lab-'+layout+'-'+id),cells=new Map(scopes.map(s=>[s,null]));
 let disposed=false,failed=false;
 const visible=()=>!disposed&&!failed&&doc.visibilityState==='visible';
 const get=scope=>{check(cells.has(scope),'Неизвестная область LAB');return cells.get(scope);};
 function lock(scope){
  const cell=get(scope);cells.set(scope,null);
  if(cell){clearTimeout(cell.timer);cell.access?.close();cell.access=null;try{onLock(scope);}catch{}}
 }
 const lockAll=()=>scopes.forEach(lock);
 const fail=()=>{failed=true;lockAll();};
 const remote=e=>{const m=e.data;if(m&&typeof m==='object'&&Object.keys(m).sort().join('|')==='kind|version'&&m.kind==='lock-all'&&m.version===1)lockAll();};
 const visibility=()=>{if(!visible())lockAll();};
 function guard(scope,cell){
  if(get(scope)===cell&&(!visible()||now()>=cell.deadline||cell.access?.isClosed()))lock(scope);
  check(get(scope)===cell&&visible(),'Сеанс LAB заблокирован; откройте заново');
 }
 function arm(scope,cell){clearTimeout(cell.timer);cell.deadline=now()+idleMs;cell.timer=setTimeout(()=>{if(get(scope)===cell)lock(scope);},idleMs);cell.timer?.unref?.();}
 channel.addEventListener('message',remote);channel.addEventListener('messageerror',fail);doc.addEventListener('visibilitychange',visibility);doc.addEventListener('freeze',lockAll);win.addEventListener('pagehide',lockAll);
 return Object.freeze({
  async unlock(scope,password){
   check(visible(),'Скрытый или закрытый экран LAB заблокирован');
   lock(scope);const cell={access:null,timer:null,deadline:0};cells.set(scope,cell);arm(scope,cell);
   const active=()=>guard(scope,cell);
   try{
    const pending=vault.openScope({scope,password,idleMs,now,assertActive:active});password=undefined;
    const access=await pending;
    try{active();check(access.scope===scope,'Другая область LAB');}catch(e){access.close();throw e;}
    cell.access=access;arm(scope,cell);
    const a=createDataAccess(async(names,mode,fn)=>{
     active();
     try{const result=await access.transaction(names,mode,fn);active();arm(scope,cell);return result;}
     catch(e){if(get(scope)===cell)lock(scope);throw e;}
    });
    return Object.freeze({scope,...(access.settingsScope==='school'?{settingsScope:'school'}:{}),transaction:a.transaction,readSnapshot:a.readSnapshot,get:a.get,getAll:a.getAll,put:a.put,del:a.del,bulkPut:a.bulkPut,byIndex:a.byIndex,count:a.count,close(){if(get(scope)===cell)lock(scope);}});
   }catch(e){if(get(scope)===cell)lock(scope);throw e;}
  },
  isUnlocked(scope){const cell=get(scope);if(!cell)return false;try{guard(scope,cell);return !!cell.access;}catch{return false;}},
  lock,lockAll,
  lockEveryTab(){lockAll();check(!disposed&&!failed,'Канал LAB недоступен');try{channel.postMessage({kind:'lock-all',version:1});}catch{fail();throw Error('Канал LAB недоступен');}},
  dispose(){if(disposed)return;disposed=true;lockAll();channel.removeEventListener('message',remote);channel.removeEventListener('messageerror',fail);channel.close();doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('freeze',lockAll);win.removeEventListener('pagehide',lockAll);}
 });
}
