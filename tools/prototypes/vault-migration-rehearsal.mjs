/* Synthetic migration rehearsal only. Never opens the live TeachApp database.
 * Source and rollback databases are distinct; no active-storage pointer is changed. */
import {SCHEMA} from '../../js/db.js';
import {BACKUP_VERSION,validateBackup} from '../../js/backup.js';
import {stageSchemaVault,schemaVaultAdapter,prepareSchemaSnapshotTransactionLab} from './vault-schema-adapter.mjs';
const names=Object.keys(SCHEMA),pattern=/^teachapp-plain-lab-(source|rollback)-[a-z0-9-]{1,64}$/;
const check=(ok,message)=>{if(!ok)throw Error(message);};
function assertPlain(db,role){
 const match=typeof db?.name==='string'&&pattern.exec(db.name);
 check(match&&(!role||match[1]===role)&&db.version===1&&db.objectStoreNames.length===names.length&&names.every(n=>db.objectStoreNames.contains(n)),'Разрешена только отдельная база репетиции LAB');
}
export function openPlainSchemaLab(name){
 check(typeof name==='string'&&pattern.test(name),'Разрешено только имя базы репетиции LAB');
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,1);let blocked=false;
  req.onblocked=()=>{blocked=true;reject(Error('Закройте другие соединения LAB'));};
  req.onupgradeneeded=()=>{
   if(blocked){req.transaction.abort();return;}
   for(const [name,def] of Object.entries(SCHEMA)){
    const store=req.result.createObjectStore(name,{keyPath:def.keyPath});
    for(const [idx,path,opts] of def.indexes)store.createIndex(idx,path,opts||{});
   }
  };
  req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{const db=req.result;if(blocked){db.close();return;}try{assertPlain(db);db.onversionchange=()=>db.close();resolve(db);}catch(e){db.close();reject(e);}};
 });
}
export function readPlainSchemaLab(db){
 assertPlain(db);
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(names,'readonly'),requests=names.map(n=>[n,tx.objectStore(n).getAll()]);
  tx.oncomplete=()=>resolve(Object.fromEntries(requests.map(([n,r])=>[n,r.result])));
  tx.onabort=()=>reject(tx.error||Error('Чтение LAB отменено'));
 });
}
// Native IDB returns rows in primary-key order; the vault preserves the input
// order, except edited tables which the adapter sorts with indexedDB.cmp.
const ordered=data=>Object.fromEntries(names.map(n=>[n,[...data[n]].sort((a,b)=>indexedDB.cmp(a.id,b.id))]));
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const report=data=>({tables:names.length,records:names.reduce((sum,n)=>sum+data[n].length,0)});
/** Same Promise store contract on a plaintext LAB phase. Use a separate
 * readwrite CAS so a callback failure or raw concurrent edit cannot partially
 * replace the source. No callback is retried. */
export async function plainSchemaTransactionLab(db,storeNames,mode,fn){
 assertPlain(db);
 const before=await readPlainSchemaLab(db);
 const {result,data,selected}=await prepareSchemaSnapshotTransactionLab(before,storeNames,mode,fn);
 if(mode==='readonly')return result;
 await new Promise((resolve,reject)=>{
  const tx=db.transaction(names,'readwrite');let remaining=names.length,failure=null;const current={};
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(failure||tx.error||Error('Транзакция LAB отменена'));
  for(const n of names){
   const req=tx.objectStore(n).getAll();
   req.onsuccess=()=>{
    current[n]=req.result;if(--remaining)return;
    try{
     check(same(before,current),'Исходная ревизия LAB изменилась; повторите действие');
     for(const name of selected){const store=tx.objectStore(name);store.clear();for(const row of data[name])store.add(row);}
    }catch(e){failure=e;tx.abort();}
   };
  }
 });
 return result;
}
async function readEncrypted(vault,password){
 const adapter=schemaVaultAdapter(vault,{password});
 try{return await adapter.snapshot();}finally{adapter.close();}
}
export async function verifySchemaMigrationLab(source,vault,{password}){
 assertPlain(source,'source');
 const before=await readPlainSchemaLab(source),encrypted=await readEncrypted(vault,password),after=await readPlainSchemaLab(source);
 check(same(before,after)&&same(after,encrypted),'Исходник или снимок LAB изменился; переключение запрещено');
 return {verified:true,...report(after)};
}
export async function stageSchemaMigrationLab(source,vault,{password}){
 assertPlain(source,'source');
 const before=await readPlainSchemaLab(source);
 await stageSchemaVault(vault,{password,backup:{app:'teachapp',version:BACKUP_VERSION,data:before}});
 // A concurrent source write must not be mistaken for a successful migration.
 // The staged vault stays available for diagnosis; retry with a fresh name.
 const encrypted=await readEncrypted(vault,password),after=await readPlainSchemaLab(source);
 check(same(before,after)&&same(before,encrypted),'Исходник или снимок LAB изменился; переключение запрещено');
 return {verified:true,...report(after)};
}
function writeEmptyRollback(db,data,{resume=false}={}){
 assertPlain(db,'rollback');
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(names,'readwrite');let remaining=names.length,failure=null;const existing={};
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(failure||tx.error||Error('Восстановление LAB отменено'));
  for(const n of names){
   const req=tx.objectStore(n).getAll();
   req.onsuccess=()=>{
    if(failure)return;
    existing[n]=req.result;
    if(--remaining)return;
    try{
     if(names.some(name=>existing[name].length)){
      if(resume&&same(existing,data))return;
      throw Error('База восстановления LAB не пуста или изменилась; перезапись запрещена');
     }
     for(const name of names)for(const row of data[name])tx.objectStore(name).add(row);
    }
    catch(e){failure=e;tx.abort();}
   };
  }
 });
}
/** Restores a verified snapshot into a separate EMPTY plaintext LAB database.
 * Never deletes or overwrites the original source or the encrypted vault. */
export async function restoreSchemaMigrationLab(vault,destination,{password,resume=false}){
 assertPlain(destination,'rollback');
 const data=await readEncrypted(vault,password);
 validateBackup({app:'teachapp',version:BACKUP_VERSION,data});
 await writeEmptyRollback(destination,data,{resume:resume===true});
 check(same(await readPlainSchemaLab(destination),data),'Проверка восстановленной базы LAB не прошла');
 return {verified:true,...report(data)};
}
