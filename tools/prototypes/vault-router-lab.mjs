/* LAB only: cooperative cross-tab fence for the migration rehearsal.
 * All callers must use this router; raw IndexedDB connections bypass Web Locks.
 * No live database, application switch, persistent password or plaintext fallback. */
import {SCHEMA} from '../../js/db.js';
import {openVaultLab} from './local-vault.mjs';
import {schemaVaultAdapter} from './vault-schema-adapter.mjs';
import {openPlainSchemaLab,readPlainSchemaLab,stageSchemaMigrationLab,verifySchemaMigrationLab,restoreSchemaMigrationLab} from './vault-migration-rehearsal.mjs';
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const phases=['source','vault','rollback'];
const validState=s=>s&&Object.keys(s).sort().join('|')==='generation|id|phase'&&s.id==='active'&&phases[s.generation-1]===s.phase&&Number.isInteger(s.generation);
function control(name){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,1);let blocked=false;
  req.onblocked=()=>{blocked=true;reject(Error('Закройте другие вкладки LAB'));};
  req.onupgradeneeded=()=>{if(blocked)req.transaction.abort();else req.result.createObjectStore('state',{keyPath:'id'});};
  req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;if(blocked){db.close();return;}db.onversionchange=()=>db.close();resolve(db);};
 });
}
function readState(db){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('state'),req=tx.objectStore('state').get('active');
  tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error||Error('Чтение маршрута LAB отменено'));
 });
}
function setState(db,expected,next){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),req=store.get('active');let conflict=false;
  req.onsuccess=()=>{
   const current=req.result;
   if(expected?(!validState(current)||current.phase!==expected.phase||current.generation!==expected.generation):current!==undefined){conflict=true;tx.abort();return;}
   store.put(next);
  };
  tx.oncomplete=resolve;tx.onabort=()=>reject(conflict?Error('Маршрут LAB изменился'):tx.error||Error('Запись маршрута LAB отменена'));
 });
}
function countSealed(db){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('sealed'),req=tx.objectStore('sealed').count();
  tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error||Error('Чтение LAB отменено'));
 });
}
function nativePut(db,table,row){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(table,'readwrite'),req=tx.objectStore(table).put(row);
  tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error||Error('Запись LAB отменена'));
 });
}
export function vaultRouterLab(id,{locks=globalThis.navigator?.locks}={}){
 check(typeof id==='string'&&/^[a-z0-9-]{1,48}$/.test(id),'Некорректный ID репетиции LAB');
 check(typeof locks?.request==='function','Для LAB необходим Web Locks API; небезопасный fallback запрещён');
 const lock='teachapp-vault-routing-lab-'+id;
 const names={source:'teachapp-plain-lab-source-'+id,vault:'teachapp-vault-lab-routing-'+id,rollback:'teachapp-plain-lab-rollback-'+id};
 const use=async(open,name,fn)=>{const db=await open(name);try{return await fn(db);}finally{db.close();}};
 const plain=(phase,fn)=>use(openPlainSchemaLab,names[phase],fn);
 const encrypted=fn=>use(openVaultLab,names.vault,fn);
 const guarded=fn=>locks.request(lock,{mode:'exclusive'},()=>use(control,lock,fn));
 const state=async db=>{const s=await readState(db);check(validState(s),'Маршрут LAB отсутствует или повреждён; fallback запрещён');return s;};
 const expect=(s,p)=>check(s.phase===p,'Недопустимый этап переключения LAB');
 const next=(s,phase)=>({id:'active',generation:s.generation+1,phase});
 const adapter=async(vault,password,fn)=>{const a=schemaVaultAdapter(vault,{password});try{return await fn(a);}finally{a.close();}};
 return {
  initialize:()=>guarded(async db=>{
   check((await readState(db))===undefined,'Маршрут LAB уже существует');
   for(const phase of ['source','rollback'])check(await plain(phase,async p=>Object.values(await readPlainSchemaLab(p)).every(rows=>rows.length===0)),'База LAB не пуста; инициализация запрещена');
   check(await encrypted(async v=>(await countSealed(v))===0),'Хранилище LAB не пусто; инициализация запрещена');
   const s={id:'active',phase:'source',generation:1};await setState(db,null,s);return s;
  }),
  status:()=>guarded(state),
  snapshot:({password}={})=>guarded(async db=>{
   const s=await state(db);
   return s.phase==='vault'?encrypted(v=>adapter(v,password,a=>a.snapshot())):plain(s.phase,readPlainSchemaLab);
  }),
  put:(table,row,{password}={})=>{
   check(Object.hasOwn(SCHEMA,table)&&typeof row?.id==='string'&&row.id.length>0,'Некорректная запись LAB');
   const copy=structuredClone(row);
   return guarded(async db=>{
    const s=await state(db);
    return s.phase==='vault'?encrypted(v=>adapter(v,password,a=>a.transaction(table,'readwrite',stores=>stores[table].put(copy)))):plain(s.phase,p=>nativePut(p,table,copy));
   });
  },
  stage:({password})=>guarded(async db=>{
   expect(await state(db),'source');
   return plain('source',p=>encrypted(v=>stageSchemaMigrationLab(p,v,{password})));
  }),
  activate:({password})=>guarded(async db=>{
   const s=await state(db);expect(s,'source');
   await plain('source',p=>encrypted(v=>verifySchemaMigrationLab(p,v,{password})));
   const n=next(s,'vault');await setState(db,s,n);return n;
  }),
  rollback:({password})=>guarded(async db=>{
   const s=await state(db);expect(s,'vault');
   await encrypted(v=>plain('rollback',p=>restoreSchemaMigrationLab(v,p,{password})));
   const n=next(s,'rollback');await setState(db,s,n);return n;
  })
 };
}
