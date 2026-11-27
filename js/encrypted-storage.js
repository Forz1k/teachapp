/* Fixed TeachApp v11 candidate. No native fallback or implicit migration. */
import {SCHEMA,assertMigrationSchema} from './db.js';
import {splitSchoolVaultLayout,joinSchoolVaultLayout,verifyVaultLayoutRoundtrip} from './vault-layout.js';
import {splitDeviceSnapshot,joinDeviceSnapshot,validateDeviceCheckpoints} from './device-checkpoint-migration.js';
import {storageCipher as cipher} from './vault-cipher.js';
import {prepareSchemaSnapshotTransaction} from './vault-snapshot-transaction.js';
import {encryptBackup,decryptBackup} from './privacy.js';
import {localSyncState} from './sync.js';
import {inspectMigrationSnapshot,migrationLabLimits} from './migration-preflight.js';
const DB='teachapp',LEGACY=10,VERSION=11,names=Object.keys(SCHEMA);
const scopes=['school','coach','workspace'],stores=['state',...scopes];
const check=(v,m)=>{if(!v)throw Error(m);};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,rev=/^[0-9a-f]{32}$/;
const withMeta=(scope,bundleId,data)=>({...data,bundleMeta:[{id:'bundle',scope,bundleId}]});
function validPointer(p){
 return p&&Object.keys(p).sort().join('|')==='bundleId|id|revisions'&&p.id==='active'&&typeof p.bundleId==='string'&&uuid.test(p.bundleId)&&p.revisions&&Object.keys(p.revisions).length===3&&scopes.every(s=>Object.hasOwn(p.revisions,s)&&typeof p.revisions[s]==='string'&&rev.test(p.revisions[s]));
}
function readSlices(db,selected){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(['state',...selected],'readonly'),pointer=tx.objectStore('state').get('active'),requests=Object.fromEntries(selected.map(s=>[s,tx.objectStore(s).getAll()]));
  tx.oncomplete=()=>resolve({pointer:pointer.result,rows:Object.fromEntries(selected.map(s=>[s,requests[s].result]))});
  tx.onabort=()=>reject(tx.error||Error('Чтение хранилища отменено'));
 });
}
function requireActive(snapshot,selected){
 check(validPointer(snapshot.pointer),'Набор хранилища не активирован или указатель повреждён');
 for(const s of selected){
  const h=snapshot.rows[s].find(r=>r.id==='header');
  check(h?.scope===s&&h.vaultId===snapshot.pointer.revisions[s],'Ревизия области хранилища изменилась');
 }
 return snapshot;
}

const canonical=value=>{
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return JSON.stringify(value);
 check(value&&typeof value==='object'&&Object.getOwnPropertySymbols(value).length===0,'Non-JSON LAB value');
 if(Array.isArray(value)){check(Object.keys(value).length===value.length,'Non-JSON LAB array');return '['+Array.from({length:value.length},(_,i)=>{check(Object.hasOwn(value,i),'Sparse LAB array');return canonical(value[i]);}).join(',')+']';}
 check([Object.prototype,null].includes(Object.getPrototypeOf(value)),'Non-JSON LAB object');
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
};
function snapshotIdentity(data){
 check(data&&Object.keys(data).length===names.length&&names.every(n=>Array.isArray(data[n])),'Incomplete LAB snapshot');
 return canonical(Object.fromEntries(names.map(n=>[n,[...data[n]].sort((a,b)=>indexedDB.cmp(a.id,b.id))])));
}

const exact=(a,keys)=>a&&typeof a==='object'&&!Array.isArray(a)&&Object.keys(a).length===keys.length&&keys.every(k=>Object.hasOwn(a,k));
const validPasswords=p=>exact(p,scopes)&&scopes.every(s=>typeof p[s]==='string'&&p[s].length>=12&&p[s].length<=1024)&&new Set(scopes.map(s=>p[s])).size===3;
const independent=(p,backup)=>validPasswords(p)&&typeof backup==='string'&&backup.length>=12&&backup.length<=1024&&!scopes.some(s=>p[s]===backup);
const samePart=(a,b)=>canonical(Object.fromEntries(Object.entries(a).map(([n,rows])=>[n,[...rows].sort((x,y)=>indexedDB.cmp(x.id,y.id))])))===canonical(Object.fromEntries(Object.entries(b).map(([n,rows])=>[n,[...rows].sort((x,y)=>indexedDB.cmp(x.id,y.id))])));
const samePartitionCiphertextLab=cipher.samePartitionCiphertext;
const storageMarker='teachapp.encrypted-storage.v11';
function assertNoLostEncryptedSource(){check(globalThis.localStorage.getItem(storageMarker)===null,'Зашифрованная база отсутствует или заменена; native fallback запрещён');}
function markEncrypted(){globalThis.localStorage.setItem(storageMarker,'active');check(globalThis.localStorage.getItem(storageMarker)==='active','Не удалось сохранить защитный маркер');}
const schema=(db,list)=>db.objectStoreNames.length===list.length&&list.every(n=>db.objectStoreNames.contains(n));
const storageError=()=>Error('Не удалось открыть защищённое хранилище. Не очищайте данные браузера.');
function openExisting(version){
 return new Promise((resolve,reject)=>{
  const q=indexedDB.open(DB,version);let blocked=false;
  q.onblocked=()=>{blocked=true;reject(storageError());};q.onupgradeneeded=()=>q.transaction.abort();q.onerror=()=>reject(storageError());
  q.onsuccess=()=>{const db=q.result;if(blocked){db.close();return;}if(db.version!==version||!schema(db,version===VERSION?stores:names)){db.close();reject(storageError());return;}db.onversionchange=()=>db.close();resolve(db);};
 });
}
export function probeStorageMode(){
 return new Promise((resolve,reject)=>{
  const q=indexedDB.open(DB);let absent=false,blocked=false;
  q.onblocked=()=>{blocked=true;reject(storageError());};q.onupgradeneeded=e=>{absent=e.oldVersion===0;q.transaction.abort();};
  q.onerror=()=>{if(absent&&!blocked){try{assertNoLostEncryptedSource();resolve('empty');}catch(e){reject(e);}}else reject(storageError());};
  q.onsuccess=()=>{const db=q.result,mode=db.version<=LEGACY?'native':db.version===VERSION&&schema(db,stores)?'encrypted':null;db.close();if(blocked)return;try{if(mode==='encrypted'){markEncrypted();resolve(mode);}else if(mode==='native'){assertNoLostEncryptedSource();resolve(mode);}else reject(storageError());}catch(e){reject(e);}};
 });
}
const using=async(version,fn)=>{const db=await openExisting(version);try{return await fn(db);}finally{db.close();}};
const current=()=>using(VERSION,async db=>{
 const t=db.transaction(stores,'readonly');for(const n of stores){const s=t.objectStore(n);check(s.keyPath==='id'&&!s.autoIncrement&&s.indexNames.length===0,'Повреждена структура защищённой базы');}
 return requireActive(await readSlices(db,scopes),scopes);
});
function commitRotation(db,expected,after,selected=scopes,guard=()=>{}){
 return new Promise((resolve,reject)=>{
  guard();const tx=db.transaction(stores,'readwrite'),state=tx.objectStore('state'),p=state.get('active'),requests=Object.fromEntries(scopes.map(s=>[s,tx.objectStore(s).getAll()]));let remaining=4,failure,next;
  const compare=()=>{
   if(--remaining)return;
   try{
    guard();const pointer=p.result;
    check(validPointer(pointer)&&pointer.bundleId===expected.pointer.bundleId&&scopes.every(s=>pointer.revisions[s]===expected.pointer.revisions[s]&&samePartitionCiphertextLab(requests[s].result,expected.rows[s])),'Ревизии хранилища изменились. Подготовьте новую копию');
    for(const scope of selected){const table=tx.objectStore(scope);table.clear();for(const row of after[scope])table.add(row);}
    next={...pointer,revisions:{...pointer.revisions,...Object.fromEntries(selected.map(s=>[s,after[s][0].vaultId]))}};state.put(next);
   }catch(e){failure=e;tx.abort();}
  };
  p.onsuccess=compare;for(const request of Object.values(requests))request.onsuccess=compare;
  tx.oncomplete=()=>resolve(next);tx.onabort=()=>reject(failure||tx.error||Error('Ротация хранилища отменена'));tx.onerror=()=>{};
 });
}

function partsFor(data){
 const {portable,device}=splitDeviceSnapshot(data);verifyVaultLayoutRoundtrip(portable);
 const parts=splitSchoolVaultLayout(portable);parts.workspace.deviceMeta=device;return parts;
}
function mergeParts(parts){
 const {deviceMeta,...owner}=parts.workspace;
 check(Object.hasOwn(parts.workspace,'deviceMeta')&&!Object.hasOwn(parts.school,'deviceMeta')&&!Object.hasOwn(parts.coach,'deviceMeta'),'Повреждена область устройства');
 return joinDeviceSnapshot(joinSchoolVaultLayout({...parts,workspace:owner}),validateDeviceCheckpoints(deviceMeta));
}
async function sourceData(){
 return using(LEGACY,db=>new Promise((resolve,reject)=>{
  const tx=db.transaction(names,'readonly');assertMigrationSchema(tx);
  const counts=names.map(n=>tx.objectStore(n).count());let left=counts.length,reads=null,failure;
  for(const q of counts)q.onsuccess=()=>{if(--left)return;try{check(counts.reduce((n,c)=>n+c.result,0)<=migrationLabLimits.records,'Слишком много записей для безопасного переноса');reads=names.map(n=>tx.objectStore(n).getAll());}catch(e){failure=e;tx.abort();}};
  tx.oncomplete=()=>resolve(Object.fromEntries(names.map((n,i)=>[n,reads[i].result])));tx.onabort=()=>reject(failure||tx.error||storageError());
 }));
}
function checkSource(data){
 const report=inspectMigrationSnapshot(data,{secure:!!globalThis.crypto?.subtle,webLocks:typeof globalThis.navigator?.locks?.request==='function'});
 check(!report.blockers.some(b=>b!=='unmigrated-device-checkpoints'),'Источник не соответствует условиям безопасного переноса');
 partsFor(data);return snapshotIdentity(data);
}
export const migrationFileLimit=90*1024*1024;
function noPersistentSyncCredentials(){
 for(const k of ['teachapp.personal-sync.v1','teachapp.trusted-device.v2'])check(globalThis.localStorage.getItem(k)===null,'Сначала отключите сохранённый код/профиль синхронизации без удаления контрольных точек.');
}
async function checkCheckpoints(data,passwords){
 const {device}=splitDeviceSnapshot(data);
 for(const area of ['school','coach']){
  const cp=device.find(r=>r.id==='sync-checkpoint-'+area);if(!cp)continue;
  check(typeof passwords?.[area]==='string'&&passwords[area].length>=12,'Требуется пароль существующего контура синхронизации');
  const state=await localSyncState({area,endpoint:cp.endpoint,password:passwords[area],data});
  check(['clean','pending'].includes(state.status),'Контрольная точка не прошла аутентификацию');
 }
}
export async function prepareNativeEncryptionCopy({backupPassword}){
 check(typeof backupPassword==='string'&&backupPassword.length>=12&&backupPassword.length<=1024,'Независимый пароль копии от 12 символов');
 assertNoLostEncryptedSource();noPersistentSyncCredentials();const data=await sourceData();checkSource(data);
 const envelope=await encryptBackup({app:'teachapp-native-encryption-recovery',version:1,data},backupPassword),reopened=await decryptBackup(envelope,backupPassword);
 check(snapshotIdentity(reopened.data)===snapshotIdentity(data),'Проверка независимой копии не пройдена');
 const file=JSON.stringify(envelope);check(file.length<=migrationFileLimit,'Копия слишком велика');return file;
}
/** Independent recovery file from a confirmed snapshot, never a portable backup. */
export async function exportEncryptedRecoveryCopy({data,backupPassword}){
 check(typeof backupPassword==='string'&&backupPassword.length>=12&&backupPassword.length<=1024,'Независимый пароль копии от 12 символов');
 const expected=checkSource(data),envelope=await encryptBackup({app:'teachapp-native-encryption-recovery',version:1,data},backupPassword);
 const reopened=await decryptBackup(envelope,backupPassword);check(checkSource(reopened.data)===expected,'Проверка независимой копии не пройдена');
 const file=JSON.stringify(envelope);check(file.length<=migrationFileLimit,'Копия слишком велика');return file;
}
async function readRecovery(file,password){
 check(typeof file==='string'&&file.length<=migrationFileLimit,'Некорректный размер копии');
 const copy=await decryptBackup(JSON.parse(file),password);check(exact(copy,['app','version','data'])&&copy.app==='teachapp-native-encryption-recovery'&&copy.version===1,'Неверный формат независимой копии');checkSource(copy.data);return copy.data;
}
/** Recover only into a genuinely absent database in a new browser profile.
 * Never delete/overwrite an existing v10, v11 or unknown database. */
export async function recoverIntoEmptyEncryptedStorage({passwords,backupPassword,file,checkpointPasswords={},confirmed=false,stillAllowed=()=>true}){
 check(confirmed===true&&independent(passwords,backupPassword),'Требуются независимые пароли и подтверждение');
 const guard=()=>check(stillAllowed(),'Восстановление отменено');guard();assertNoLostEncryptedSource();noPersistentSyncCredentials();
 const data=await readRecovery(file,backupPassword);backupPassword=undefined;await checkCheckpoints(data,checkpointPasswords);checkpointPasswords=undefined;guard();
 const parts=partsFor(data),bundleId=crypto.randomUUID(),rows={};
 try{for(const s of scopes){rows[s]=await cipher.sealPartitionScope({scope:s,bundleId,password:passwords[s],data:withMeta(s,bundleId,parts[s])});guard();}}finally{passwords=undefined;}
 const pointer={id:'active',bundleId,revisions:Object.fromEntries(scopes.map(s=>[s,rows[s][0].vaultId]))};
 return new Promise((resolve,reject)=>{
  const q=indexedDB.open(DB,VERSION);let blocked=false,created=false,failure;
  q.onblocked=()=>{blocked=true;reject(storageError());};
  q.onupgradeneeded=e=>{const db=q.result,tx=q.transaction;try{guard();noPersistentSyncCredentials();check(!blocked&&e.oldVersion===0,'Восстановление возможно только в пустой профиль без базы TeachApp');for(const s of scopes){const table=db.createObjectStore(s,{keyPath:'id'});for(const row of rows[s])table.add(row);}db.createObjectStore('state',{keyPath:'id'}).add(pointer);created=true;}catch(e){failure=e;tx.abort();}};
  q.onerror=()=>reject(failure||q.error||storageError());q.onsuccess=()=>{q.result.close();if(created&&!blocked){try{markEncrypted();resolve(true);}catch(e){reject(e);}}else reject(Error('База уже существует; перезапись запрещена'));};
 });
}
function upgrade(expected,pointer,rows,guard){
 return new Promise((resolve,reject)=>{
  const q=indexedDB.open(DB,VERSION);let blocked=false,failure,upgraded=false;
  q.onblocked=()=>{blocked=true;reject(Error('Закройте другие вкладки и повторите перенос.'));};
  q.onupgradeneeded=e=>{
   const db=q.result,tx=q.transaction,fail=error=>{failure=error;try{tx.abort();}catch{}};
   if(blocked||e.oldVersion!==LEGACY||!schema(db,names)){fail(storageError());return;}
   try{
    for(const [n,def] of Object.entries(SCHEMA)){const s=tx.objectStore(n);check(JSON.stringify(s.keyPath)===JSON.stringify(def.keyPath)&&!s.autoIncrement&&s.indexNames.length===def.indexes.length,'Исходная схема изменилась');for(const [i,k,o] of def.indexes){const x=s.index(i);check(JSON.stringify(x.keyPath)===JSON.stringify(k)&&x.unique===!!o?.unique&&x.multiEntry===!!o?.multiEntry,'Исходный индекс изменился');}}
    guard();noPersistentSyncCredentials();
   }catch(error){fail(error);return;}
   const values={};let left=names.length;
   for(const n of names){const request=tx.objectStore(n).getAll();request.onsuccess=()=>{if(failure)return;values[n]=request.result;if(--left)return;try{
    guard();noPersistentSyncCredentials();check(snapshotIdentity(values)===expected,'Источник изменился. Создайте новую копию.');
    for(const name of names)db.deleteObjectStore(name);
    for(const s of scopes){const table=db.createObjectStore(s,{keyPath:'id'});for(const row of rows[s])table.add(row);}
    db.createObjectStore('state',{keyPath:'id'}).add(pointer);upgraded=true;
   }catch(error){fail(error);}};}
  };
  q.onerror=()=>reject(failure||q.error||storageError());q.onsuccess=()=>{const db=q.result,ok=upgraded&&schema(db,stores);db.close();if(blocked||!ok)reject(storageError());else resolve(true);};
 });
}
export async function activateNativeEncryption({passwords,backupPassword,file,checkpointPasswords={},confirmed=false,stillAllowed=()=>true}){
 check(confirmed===true&&independent(passwords,backupPassword)&&typeof file==='string'&&file.length<=migrationFileLimit,'Требуются независимые ключи, сохранённая копия и подтверждение');
 const locks=globalThis.navigator?.locks;check(locks?.request,'Web Locks недоступен');const guard=()=>check(stillAllowed(),'Перенос отменён');
 return locks.request('teachapp-encryption-migration-v11',{mode:'exclusive',ifAvailable:true},async lock=>{
  check(lock,'Другой перенос уже выполняется');guard();assertNoLostEncryptedSource();noPersistentSyncCredentials();
  const data=await sourceData(),expected=checkSource(data);guard();
  const copy=await decryptBackup(JSON.parse(file),backupPassword);backupPassword=undefined;
  check(exact(copy,['app','version','data'])&&copy.app==='teachapp-native-encryption-recovery'&&copy.version===1&&checkSource(copy.data)===expected,'Копия не соответствует текущим данным');
  await checkCheckpoints(data,checkpointPasswords);checkpointPasswords=undefined;guard();
  const parts=partsFor(data),bundleId=crypto.randomUUID(),rows={};
  try{for(const scope of scopes){rows[scope]=await cipher.sealPartitionScope({scope,bundleId,password:passwords[scope],data:withMeta(scope,bundleId,parts[scope])});guard();}}
  finally{passwords=undefined;}
  const pointer={id:'active',bundleId,revisions:Object.fromEntries(scopes.map(s=>[s,rows[s][0].vaultId]))};
  guard();const result=await upgrade(expected,pointer,rows,guard);markEncrypted();return result;
 });
}
export async function openEncryptedStorage({passwords,stillAllowed=()=>true}){
 check(validPasswords(passwords),'Требуются три независимых пароля от 12 символов');
 let closed=false,bundleId;const keys={};
 const allowed=()=>!closed&&stillAllowed(),guard=()=>check(allowed(),'Защищённый сеанс закрыт'),close=()=>{closed=true;for(const s of scopes){keys[s]?.close();delete keys[s];}};
 try{guard();const initial=await current();bundleId=initial.pointer.bundleId;
  for(const s of scopes){const key=await cipher.openPartitionKeySession({scope:s,bundleId,password:passwords[s],rows:initial.rows[s],assertActive:guard});try{guard();keys[s]=key;}catch(e){key.close();throw e;}}
 }catch(e){close();throw e;}finally{passwords=undefined;}
 async function read(){
  try{guard();const snapshot=await current();check(snapshot.pointer.bundleId===bundleId,'Защищённый набор изменился');const parts={};
   for(const scope of scopes){guard();const {data}=await keys[scope].read(snapshot.rows[scope]);const {bundleMeta,...part}=data;parts[scope]=part;}
   const data=mergeParts(parts);guard();return {snapshot,parts,data};
  }catch(e){close();throw e;}
 }
 async function run(names,mode,fn,sync=false){
  guard();const {snapshot,parts,data}=await read(),prepared=await prepareSchemaSnapshotTransaction(data,names,mode,fn,{guard,isOpen:allowed,deviceLocal:true});guard();
  if(mode==='readwrite'){
   const next=partsFor(prepared.data);
   if(!sync)check(samePart({device:next.workspace.deviceMeta},{device:parts.workspace.deviceMeta}),'Изменение контрольных точек через общий интерфейс запрещено');
   const selected=scopes.filter(s=>!samePart(next[s],parts[s])),after={};
   for(const s of selected){guard();after[s]=await keys[s].seal(withMeta(s,bundleId,next[s]));}
   guard();await using(VERSION,db=>commitRotation(db,snapshot,after,selected,guard));guard();
  }
  return prepared.result;
 }
 try{await read();}catch(e){close();throw e;}
 return Object.freeze({transaction:(n,m,fn)=>run(n,m,fn),syncTransaction:(n,m,fn)=>run(n,m,fn,true),close,isClosed:()=>closed});
}

/** Rotate all three partitions only after opening the exact current copy and
 * authenticating every current key. No mutation of other browser storage. */
export async function rotateEncryptedStorage({passwords,newPasswords,backupPassword,file,confirmed=false,stillAllowed=()=>true}){
 check(confirmed===true&&independent(passwords,backupPassword)&&independent(newPasswords,backupPassword)&&new Set([...Object.values(passwords),...Object.values(newPasswords)]).size===6,'Требуются шесть разных ключей и независимый пароль копии');
 const guard=()=>check(stillAllowed(),'Смена ключей отменена');
 guard();const copy=await readRecovery(file,backupPassword);backupPassword=undefined;guard();
 const snapshot=await current(),parts={};
 try{
  for(const scope of scopes){
   guard();const key=await cipher.openPartitionKeySession({scope,bundleId:snapshot.pointer.bundleId,password:passwords[scope],rows:snapshot.rows[scope],assertActive:guard});
   try{const {data}=await key.read(snapshot.rows[scope]),{bundleMeta,...part}=data;parts[scope]=part;}finally{key.close();}
  }
 }finally{passwords=undefined;}
 check(snapshotIdentity(mergeParts(parts))===snapshotIdentity(copy),'Копия устарела. Сохраните новую независимую копию.');
 const after={};
 try{for(const scope of scopes){guard();after[scope]=await cipher.sealPartitionScope({scope,bundleId:snapshot.pointer.bundleId,password:newPasswords[scope],data:withMeta(scope,snapshot.pointer.bundleId,parts[scope])});}}finally{newPasswords=undefined;}
 guard();await using(VERSION,db=>commitRotation(db,snapshot,after,scopes,guard));return true;
}
