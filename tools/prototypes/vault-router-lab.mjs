/* LAB only: cooperative cross-tab fence for the migration rehearsal.
 * All callers must use this router; raw IndexedDB connections bypass Web Locks.
 * No live database, application switch, persistent password or plaintext fallback. */
import {SCHEMA,createDataAccess} from '../../js/db.js';
import {BACKUP_VERSION,validateBackup} from '../../js/backup.js';
import {encryptBackup,decryptBackup} from '../../js/privacy.js';
import {openVaultLab,readVaultLab} from './local-vault.mjs';
import {schemaVaultAdapter} from './vault-schema-adapter.mjs';
import {openPlainSchemaLab,readPlainSchemaLab,stageSchemaMigrationLab,verifySchemaMigrationLab,restoreSchemaMigrationLab,plainSchemaTransactionLab} from './vault-migration-rehearsal.mjs';
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const phases=['source','vault','rollback'];
const validState=s=>s&&Object.keys(s).sort().join('|')==='generation|id|phase'&&s.id==='active'&&Number.isInteger(s.generation)&&s.generation>=1&&s.generation<=phases.length&&phases[s.generation-1]===s.phase;
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
  const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),req=store.get('active');let conflict=false,failure=null;
  req.onsuccess=()=>{
   const current=req.result;
   if(expected?(!validState(current)||current.phase!==expected.phase||current.generation!==expected.generation):current!==undefined){conflict=true;tx.abort();return;}
   try{store.put(next);}catch(e){failure=e;tx.abort();}
  };
  tx.oncomplete=resolve;tx.onabort=()=>reject(conflict?Error('Маршрут LAB изменился'):failure||tx.error||Error('Запись маршрута LAB отменена'));
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
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
const sameSnapshot=(a,b)=>JSON.stringify(Object.keys(SCHEMA).map(k=>[...a[k]].sort((x,y)=>indexedDB.cmp(x.id,y.id))))===JSON.stringify(Object.keys(SCHEMA).map(k=>[...b[k]].sort((x,y)=>indexedDB.cmp(x.id,y.id))));
function independentPassword(password,backupPassword){
 check(typeof backupPassword==='string'&&backupPassword.length>=12&&backupPassword.length<=1024&&password!==backupPassword,'Нужен отдельный пароль копии LAB');
}
export async function openRouterActivationBackupLab({id,backupPassword,file}){
 check(typeof id==='string'&&/^[a-z0-9-]{1,48}$/.test(id),'Некорректный ID репетиции LAB');
 independentPassword(undefined,backupPassword);
 check(typeof file==='string'&&file.length<=96*1024*1024,'Некорректный файл копии LAB');
 const p=await decryptBackup(JSON.parse(file),backupPassword);
 check(exact(p,['app','version','backupVersion','id','generation','data'])&&p.app==='teachapp-vault-activation-backup'&&p.version===1&&p.backupVersion===BACKUP_VERSION&&p.id===id&&p.generation===1,'Копия другого маршрута или версии LAB');
 check(exact(p.data,Object.keys(SCHEMA)),'Требуется полная схема LAB');
 check(Array.isArray(p.data.meta)&&p.data.meta.every(r=>typeof r?.id==='string'&&!r.id.startsWith('sync-checkpoint-')),'Контрольные точки синхронизации не переносятся в LAB');
 return validateBackup({app:'teachapp',version:BACKUP_VERSION,data:p.data});
}
export async function openRouterRollbackBackupLab({id,backupPassword,file}){
 check(typeof id==='string'&&/^[a-z0-9-]{1,48}$/.test(id),'Некорректный ID репетиции LAB');
 independentPassword(undefined,backupPassword);
 check(typeof file==='string'&&file.length<=96*1024*1024,'Некорректный файл копии LAB');
 const p=await decryptBackup(JSON.parse(file),backupPassword);
 check(exact(p,['app','version','backupVersion','id','generation','revision','data'])&&p.app==='teachapp-vault-rollback-backup'&&p.version===1&&p.backupVersion===BACKUP_VERSION&&p.id===id&&p.generation===2&&typeof p.revision==='string'&&/^[0-9a-f]{32}$/.test(p.revision),'Копия другого маршрута или версии LAB');
 check(exact(p.data,Object.keys(SCHEMA))&&Array.isArray(p.data.meta)&&p.data.meta.every(r=>typeof r?.id==='string'&&!r.id.startsWith('sync-checkpoint-')),'Требуется полный переносимый снимок LAB');
 return {revision:p.revision,data:validateBackup({app:'teachapp',version:BACKUP_VERSION,data:p.data})};
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
  transaction:(storeNames,mode,fn,{password,expectedGeneration}={})=>guarded(async db=>{
   const s=await state(db);
   check(expectedGeneration===undefined||expectedGeneration===s.generation,'Маршрут LAB изменился; откройте данные заново');
   return s.phase==='vault'?encrypted(v=>adapter(v,password,a=>a.transaction(storeNames,mode,fn))):plain(s.phase,p=>plainSchemaTransactionLab(p,storeNames,mode,fn));
  }),
  put:(table,row,{password}={})=>{
   check(Object.hasOwn(SCHEMA,table)&&typeof row?.id==='string'&&row.id.length>0,'Некорректная запись LAB');
   const copy=structuredClone(row);
   return guarded(async db=>{
    const s=await state(db);
    return s.phase==='vault'?encrypted(v=>adapter(v,password,a=>a.transaction(table,'readwrite',stores=>stores[table].put(copy)))):plain(s.phase,p=>nativePut(p,table,copy));
   });
  },
  stage:({password,resume=false})=>guarded(async db=>{
   expect(await state(db),'source');
   return plain('source',p=>encrypted(async v=>resume===true&&(await countSealed(v))>0?verifySchemaMigrationLab(p,v,{password}):stageSchemaMigrationLab(p,v,{password})));
  }),
  // Separate strict rehearsal: caller saves an independently encrypted file
  // and reads it back before explicitly authorizing activation.
  prepareActivationBackup:({password,backupPassword})=>guarded(async db=>{
   const s=await state(db);expect(s,'source');independentPassword(password,backupPassword);
   await plain('source',p=>encrypted(v=>verifySchemaMigrationLab(p,v,{password})));
   const data=await encrypted(v=>adapter(v,password,a=>a.snapshot()));
   const file=JSON.stringify(await encryptBackup({app:'teachapp-vault-activation-backup',version:1,backupVersion:BACKUP_VERSION,id,generation:s.generation,data},backupPassword));
   const reopened=await openRouterActivationBackupLab({id,backupPassword,file});
   check(sameSnapshot(data,reopened)&&sameSnapshot(data,await plain('source',readPlainSchemaLab)),'Снимок LAB изменился; повторите подготовку копии');
   return {file,generation:s.generation,records:Object.values(data).reduce((sum,rows)=>sum+rows.length,0)};
  }),
  activateWithBackup:({password,backupPassword,file,expectedGeneration,saved=false})=>guarded(async db=>{
   const s=await state(db);expect(s,'source');independentPassword(password,backupPassword);
   check(saved===true&&expectedGeneration===s.generation,'Подтвердите сохранённую копию и поколение LAB');
   const backup=await openRouterActivationBackupLab({id,backupPassword,file});
   await plain('source',p=>encrypted(v=>verifySchemaMigrationLab(p,v,{password})));
   const current=await encrypted(v=>adapter(v,password,a=>a.snapshot()));
   check(sameSnapshot(backup,current)&&sameSnapshot(backup,await plain('source',readPlainSchemaLab)),'Сохранённая копия LAB устарела; переключение запрещено');
   const nextState=next(s,'vault');await setState(db,s,nextState);return nextState;
  }),
  activate:({password})=>guarded(async db=>{
   const s=await state(db);expect(s,'source');
   await plain('source',p=>encrypted(v=>verifySchemaMigrationLab(p,v,{password})));
   const n=next(s,'vault');await setState(db,s,n);return n;
  }),
  prepareRollbackBackup:({password,backupPassword})=>guarded(async db=>{
   const s=await state(db);expect(s,'vault');independentPassword(password,backupPassword);
   return encrypted(async v=>{
    const before=await readVaultLab(v,{scope:'workspace',password});
    const file=JSON.stringify(await encryptBackup({app:'teachapp-vault-rollback-backup',version:1,backupVersion:BACKUP_VERSION,id,generation:s.generation,revision:before.revision,data:before.data},backupPassword));
    const opened=await openRouterRollbackBackupLab({id,backupPassword,file});
    const after=await readVaultLab(v,{scope:'workspace',password});
    check(opened.revision===before.revision&&after.revision===before.revision&&sameSnapshot(opened.data,before.data)&&sameSnapshot(before.data,after.data),'Снимок LAB изменился; повторите подготовку копии');
    return {file,generation:s.generation,revision:before.revision,records:Object.values(before.data).reduce((n,rows)=>n+rows.length,0)};
   });
  }),
  rollbackWithBackup:({password,backupPassword,file,expectedGeneration,saved=false,resume=false})=>guarded(async db=>{
   const s=await state(db);expect(s,'vault');independentPassword(password,backupPassword);
   check(saved===true&&expectedGeneration===s.generation,'Подтвердите сохранённую копию и поколение LAB');
   const backup=await openRouterRollbackBackupLab({id,backupPassword,file});
   await encrypted(async v=>{
    const matches=async()=>{const current=await readVaultLab(v,{scope:'workspace',password});check(backup.revision===current.revision&&sameSnapshot(backup.data,current.data),'Сохранённая копия LAB устарела; откат запрещён');};
    await matches();
    await plain('rollback',p=>restoreSchemaMigrationLab(v,p,{password,resume:resume===true}));
    await matches();
    check(sameSnapshot(backup.data,await plain('rollback',readPlainSchemaLab)),'Восстановленный снимок LAB изменился; откат запрещён');
    await matches();
   });
   const n=next(s,'rollback');await setState(db,s,n);return n;
  }),
  rollback:({password,resume=false})=>guarded(async db=>{
   const s=await state(db);expect(s,'vault');
   await encrypted(v=>plain('rollback',p=>restoreSchemaMigrationLab(v,p,{password,resume:resume===true})));
   const n=next(s,'rollback');await setState(db,s,n);return n;
  })
 };
}

/** Generation-pinned facade for an explicit LAB route. A stale handle cannot
 * silently move to another phase; neither native open nor raw IDB is exposed.
 * Password lives only in the handle closure. Not a production unlock session. */
export function routedDataAccessLab(router,{expectedGeneration,password}={}){
 check(typeof router?.transaction==='function'&&Number.isInteger(expectedGeneration)&&expectedGeneration>=1&&expectedGeneration<=3,'Требуется явное поколение LAB');
 if(expectedGeneration===2)check(typeof password==='string'&&password.length>0,'Требуется пароль vault LAB');
 else check(password===undefined,'Пароль разрешён только для vault LAB');
 let closed=false,secret=password;
 const access=createDataAccess(async(names,mode,fn)=>{
  check(!closed,'Интерфейс LAB закрыт');
  // Check again when queued work enters the router callback. Already submitted
  // write transactions cannot be retroactively revoked by close().
  return router.transaction(names,mode,stores=>{check(!closed,'Интерфейс LAB закрыт');return fn(stores);},{expectedGeneration,password:secret});
 });
 return Object.freeze({...access,close(){closed=true;secret=undefined;}});
}
