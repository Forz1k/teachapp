/* Atomic legacy -> three-key encrypted database upgrade. Synthetic LAB only.
 * A verified independent copy is mandatory; the versionchange transaction
 * rechecks every legacy record before deleting plaintext and installing the
 * active encrypted partitions. No live names, no implicit fallback. */
import {SCHEMA} from '../../js/db.js';
import {snapshotIdentity} from './vault-version-fence-lab.mjs';
import {splitSchoolVaultLayoutLab,validateSchoolVaultLayoutResultLab} from './vault-school-layout-lab.mjs';
import {sealPartitionScopeLab} from './local-vault.mjs';
import {validPartitionPasswordsLab,independentPartitionPasswordsLab,createPartitionRecoveryCopyLab,openPartitionRecoveryCopyLab,sourceMatchesPartitionLab,samePartitionSnapshotLab} from './vault-partition-recovery-lab.mjs';
const names=Object.keys(SCHEMA),scopes=['school','coach','workspace'],encryptedStores=['state',...scopes];
export const partitionLegacyVersionLab=10,partitionEncryptedVersionLab=11;
const check=(v,m)=>{if(!v)throw Error(m);};
export function partitionMigrationNameLab(id){
 check(typeof id==='string'&&/^[a-z0-9-]{1,48}$/.test(id),'Некорректный ID миграции LAB');
 return 'teachapp-partition-migration-lab-'+id;
}
const hasLegacy=db=>db.objectStoreNames.length===names.length&&names.every(n=>db.objectStoreNames.contains(n));
function openLegacyName(name,create){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,partitionLegacyVersionLab);let blocked=false,failure;
  req.onblocked=()=>{blocked=true;reject(Error('Закройте старые соединения LAB'));};
  req.onupgradeneeded=e=>{
   if(blocked||!create||e.oldVersion!==0){failure=Error('Требуется существующая исходная схема LAB');req.transaction.abort();return;}
   for(const [n,d] of Object.entries(SCHEMA)){const s=req.result.createObjectStore(n,{keyPath:d.keyPath});for(const [i,k,o] of d.indexes)s.createIndex(i,k,o||{});}
  };
  req.onerror=()=>reject(failure||req.error);
  req.onsuccess=()=>{const db=req.result;if(blocked||!hasLegacy(db)){db.close();reject(Error('Неверная исходная схема LAB'));return;}db.onversionchange=()=>db.close();resolve(db);};
 });
}
export function openPartitionLegacyLab(id){return openLegacyName(partitionMigrationNameLab(id),true);}
function readLegacy(db){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(names,'readonly'),requests=names.map(n=>[n,tx.objectStore(n).getAll()]);
  tx.oncomplete=()=>resolve(Object.fromEntries(requests.map(([n,q])=>[n,q.result])));tx.onabort=()=>reject(tx.error||Error('Чтение исходника LAB отменено'));
 });
}
async function sourceData(id){
 const db=await openLegacyName(partitionMigrationNameLab(id),false);
 try{return await readLegacy(db);}finally{db.close();}
}
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const digest=async s=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
async function sourcePointer(id,identity){
 const hash=await digest(partitionMigrationNameLab(id)),bundleId=hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32);
 const contentHash=await digest(identity),revisions={};
 for(const s of scopes)revisions[s]=(await digest(hash+':'+contentHash+':'+s)).slice(0,32);
 return {id:'active',bundleId,revisions};
}
function checkedParts(data){
 const parts=splitSchoolVaultLayoutLab(data),bundleId=crypto.randomUUID();
 for(const scope of scopes)validateSchoolVaultLayoutResultLab({scope,data:{...parts[scope],bundleMeta:[{id:'bundle',scope,bundleId}]}},scope);
 return parts;
}
export async function preparePartitionLegacyMigrationLab(id,{backupPasswords}){
 check(validPartitionPasswordsLab(backupPasswords),'Требуются три независимых пароля копии LAB');
 const data=await sourceData(id),identity=snapshotIdentity(data);checkedParts(data);
 const pointer=await sourcePointer(id,identity);
 return createPartitionRecoveryCopyLab({data,pointer,passwords:backupPasswords});
}
function atomicUpgrade(id,identity,pointer,rows){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(partitionMigrationNameLab(id),partitionEncryptedVersionLab);let blocked=false,failure=null,upgraded=false;
  req.onblocked=()=>{blocked=true;reject(Error('Старое соединение LAB не закрыто; перенос отменён'));};
  req.onupgradeneeded=e=>{
   const db=req.result,tx=req.transaction;
   const fail=err=>{failure=err;try{tx.abort();}catch{}};
   if(blocked||e.oldVersion!==partitionLegacyVersionLab||!hasLegacy(db)){fail(Error('Требуется существующий исходник LAB'));return;}
   const current={};let remaining=names.length;
   for(const n of names){
    const read=tx.objectStore(n).getAll();
    read.onsuccess=()=>{
     if(failure)return;current[n]=read.result;if(--remaining)return;
     try{
      check(snapshotIdentity(current)===identity,'Исходник LAB изменился; перенос отменён');
      // This destructive step is permitted only in this synthetic database.
      // The independently verified external recovery copy remains available.
      for(const n of names)db.deleteObjectStore(n);
      for(const scope of scopes){const store=db.createObjectStore(scope,{keyPath:'id'});for(const row of rows[scope])store.add(row);}
      db.createObjectStore('state',{keyPath:'id'}).add(pointer);upgraded=true;
     }catch(err){fail(err);}
    };
   }
  };
  req.onerror=()=>reject(failure||req.error);
  req.onsuccess=()=>{const db=req.result,correct=db.objectStoreNames.length===encryptedStores.length&&encryptedStores.every(n=>db.objectStoreNames.contains(n));db.close();if(blocked||!upgraded||!correct){reject(Error('Набор уже перенесён или неверная схема LAB'));return;}resolve(pointer);};
 });
}
export async function migratePartitionLegacyLab(id,{passwords,backupPasswords,backupFile,saved=false,confirmed=false}){
 check(saved===true&&confirmed===true&&independentPartitionPasswordsLab(passwords,backupPasswords),'Подтвердите перенос и сохранённую независимую копию LAB');
 const data=await sourceData(id),identity=snapshotIdentity(data),parts=checkedParts(data),source=await sourcePointer(id,identity);
 const copy=await openPartitionRecoveryCopyLab(backupFile,{passwords:backupPasswords});
 check(sourceMatchesPartitionLab(copy.source,source)&&samePartitionSnapshotLab(copy.data,data),'Копия устарела или относится к другому исходнику LAB');
 const bundleId=crypto.randomUUID(),rows={};
 for(const scope of scopes)rows[scope]=await sealPartitionScopeLab({scope,bundleId,password:passwords[scope],data:{...parts[scope],bundleMeta:[{id:'bundle',scope,bundleId}]}});
 const pointer={id:'active',bundleId,revisions:Object.fromEntries(scopes.map(s=>[s,rows[s][0].vaultId]))};
 return atomicUpgrade(id,identity,pointer,rows);
}
/** Explicit rollback into a distinct, empty synthetic legacy DB. Never
 * resurrect the old database or overwrite any existing legacy rows. */
export async function restorePartitionLegacyCopyLab(id,{file,backupPasswords,confirmed=false}){
 check(confirmed===true,'Подтвердите восстановление LAB');
 const {data}=await openPartitionRecoveryCopyLab(file,{passwords:backupPasswords});snapshotIdentity(data);
 const db=await openPartitionLegacyLab(id);
 try{
  await new Promise((resolve,reject)=>{
   const tx=db.transaction(names,'readwrite'),counts=names.map(n=>tx.objectStore(n).count());let remaining=counts.length,failure;
   for(const q of counts)q.onsuccess=()=>{
    if(--remaining)return;
    try{check(counts.every(c=>c.result===0),'База восстановления LAB не пуста; перезапись запрещена');for(const n of names)for(const row of data[n])tx.objectStore(n).add(row);}
    catch(e){failure=e;tx.abort();}
   };
   tx.oncomplete=resolve;tx.onabort=()=>reject(failure||tx.error||Error('Восстановление LAB отменено'));
  });
  check(snapshotIdentity(await readLegacy(db))===snapshotIdentity(data),'Проверка восстановленного исходника LAB не прошла');
  return {verified:true,records:names.reduce((n,k)=>n+data[k].length,0)};
 }finally{db.close();}
}
