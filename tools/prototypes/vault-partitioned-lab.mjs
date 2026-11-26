/* Three independently keyed writable partitions in one native LAB database.
 * All initial ciphertext and the active pointer commit together. Each later
 * scope commit atomically compares ciphertext and updates its pointer revision.
 * No connection to live TeachApp DB, no plaintext fallback, no cross-scope
 * transactions. Only snapshots independently valid in each scope are accepted. */
import {SCHEMA,createDataAccess} from '../../js/db.js';
import {splitVaultScopesLab,joinVaultScopesLab,validateVaultScopeResultLab} from './vault-scope-bundle.mjs';
import {sealPartitionScopeLab,openPartitionKeySessionLab,samePartitionCiphertextLab} from './local-vault.mjs';
import {prepareSchemaSnapshotTransactionLab} from './vault-schema-adapter.mjs';
import {validPartitionPasswordsLab as passwordsOK,independentPartitionPasswordsLab,createPartitionRecoveryCopyLab,openPartitionRecoveryCopyLab,sourceMatchesPartitionLab,samePartitionSnapshotLab} from './vault-partition-recovery-lab.mjs';
const scopes=['school','coach','workspace'],stores=['state',...scopes];
const check=(v,m)=>{if(!v)throw Error(m);};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,rev=/^[0-9a-f]{32}$/;
const empty=()=>Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]]));
const blankParts=()=>splitVaultScopesLab(empty());
const fullPart=(scope,part)=>joinVaultScopesLab({...blankParts(),[scope]:part});
const withMeta=(scope,bundleId,data)=>({...data,bundleMeta:[{id:'bundle',scope,bundleId}]});
function validPointer(p){
 return p&&Object.keys(p).sort().join('|')==='bundleId|id|revisions'&&p.id==='active'&&typeof p.bundleId==='string'&&uuid.test(p.bundleId)&&p.revisions&&Object.keys(p.revisions).length===3&&scopes.every(s=>Object.hasOwn(p.revisions,s)&&typeof p.revisions[s]==='string'&&rev.test(p.revisions[s]));
}
function open(name){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,1);let blocked=false;
  request.onblocked=()=>{blocked=true;reject(Error('Закройте другие соединения LAB'));};
  request.onupgradeneeded=()=>{if(blocked)request.transaction.abort();else for(const n of stores)request.result.createObjectStore(n,{keyPath:'id'});};
  request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>db.close();resolve(db);};
 });
}
function readSlices(db,selected){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(['state',...selected],'readonly'),pointer=tx.objectStore('state').get('active'),requests=Object.fromEntries(selected.map(s=>[s,tx.objectStore(s).getAll()]));
  tx.oncomplete=()=>resolve({pointer:pointer.result,rows:Object.fromEntries(selected.map(s=>[s,requests[s].result]))});
  tx.onabort=()=>reject(tx.error||Error('Чтение LAB отменено'));
 });
}
function requireActive(snapshot,selected){
 check(validPointer(snapshot.pointer),'Набор LAB не активирован или указатель повреждён');
 for(const s of selected){
  const h=snapshot.rows[s].find(r=>r.id==='header');
  check(h?.scope===s&&h.vaultId===snapshot.pointer.revisions[s],'Ревизия области LAB изменилась');
 }
 return snapshot;
}
function commitInitial(db,pointer,rows){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(stores,'readwrite'),counts=stores.map(n=>tx.objectStore(n).count());let remaining=counts.length,failure;
  for(const req of counts)req.onsuccess=()=>{
   if(--remaining)return;
   try{
    check(counts.every(q=>q.result===0),'Набор LAB уже существует; перезапись запрещена');
    for(const s of scopes)for(const row of rows[s])tx.objectStore(s).add(row);
    tx.objectStore('state').add(pointer);
   }catch(e){failure=e;tx.abort();}
  };
  tx.oncomplete=()=>resolve(pointer);tx.onabort=()=>reject(failure||tx.error||Error('Активация LAB отменена'));tx.onerror=()=>{};
 });
}
function commitScope(db,scope,expected,after,guard){
 return new Promise((resolve,reject)=>{
  guard();const tx=db.transaction(['state',scope],'readwrite'),state=tx.objectStore('state'),table=tx.objectStore(scope),p=state.get('active'),rows=table.getAll();let remaining=2,failure;
  const compare=()=>{
   if(--remaining)return;
   try{
    guard();const current=p.result;
    check(validPointer(current)&&current.bundleId===expected.pointer.bundleId&&current.revisions[scope]===expected.pointer.revisions[scope]&&samePartitionCiphertextLab(rows.result,expected.rows[scope]),'Ревизия области LAB изменилась. Откройте заново');
    table.clear();for(const row of after)table.add(row);
    // Keep other scopes' latest revisions even if they changed while we were encrypting.
    state.put({...current,revisions:{...current.revisions,[scope]:after[0].vaultId}});
   }catch(e){failure=e;tx.abort();}
  };
  p.onsuccess=rows.onsuccess=compare;
  tx.oncomplete=resolve;tx.onabort=()=>reject(failure||tx.error||Error('Запись LAB отменена'));tx.onerror=()=>{};
 });
}
async function sealAll(parts,bundleId,passwords){
 const rows={};
 for(const scope of scopes)rows[scope]=await sealPartitionScopeLab({scope,bundleId,password:passwords[scope],data:withMeta(scope,bundleId,parts[scope])});
 return rows;
}
function commitRotation(db,expected,after){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(stores,'readwrite'),state=tx.objectStore('state'),p=state.get('active'),requests=Object.fromEntries(scopes.map(s=>[s,tx.objectStore(s).getAll()]));let remaining=4,failure,next;
  const compare=()=>{
   if(--remaining)return;
   try{
    const pointer=p.result;
    check(validPointer(pointer)&&pointer.bundleId===expected.pointer.bundleId&&scopes.every(s=>pointer.revisions[s]===expected.pointer.revisions[s]&&samePartitionCiphertextLab(requests[s].result,expected.rows[s])),'Ревизии LAB изменились. Подготовьте новую копию');
    for(const scope of scopes){const table=tx.objectStore(scope);table.clear();for(const row of after[scope])table.add(row);}
    next={...pointer,revisions:Object.fromEntries(scopes.map(s=>[s,after[s][0].vaultId]))};state.put(next);
   }catch(e){failure=e;tx.abort();}
  };
  p.onsuccess=compare;for(const request of Object.values(requests))request.onsuccess=compare;
  tx.oncomplete=()=>resolve(next);tx.onabort=()=>reject(failure||tx.error||Error('Ротация LAB отменена'));tx.onerror=()=>{};
 });
}
export function partitionedVaultLab(id){
 check(typeof id==='string'&&/^[a-z0-9-]{1,48}$/.test(id),'Некорректный ID LAB');
 const name='teachapp-vault-mutable-lab-'+id;
 const using=async fn=>{const db=await open(name);try{return await fn(db);}finally{db.close();}};
 const current=selected=>using(async db=>requireActive(await readSlices(db,selected),selected));
 const stage=async({data,passwords})=>{
  check(passwordsOK(passwords),'Требуются три независимых пароля LAB');
  const parts=splitVaultScopesLab(data);
  // Deliberately refuse cross-scope-dependent records until shared metadata is designed.
  for(const scope of scopes)fullPart(scope,parts[scope]);
  const bundleId=crypto.randomUUID(),rows=await sealAll(parts,bundleId,passwords);
  const pointer={id:'active',bundleId,revisions:Object.fromEntries(scopes.map(s=>[s,rows[s][0].vaultId]))};
  return using(db=>commitInitial(db,pointer,rows));
 };
 const authenticate=async passwords=>{
  check(passwordsOK(passwords),'Требуются три независимых пароля LAB');
  const snapshot=await current(scopes),parts={};
  for(const scope of scopes){
   const key=await openPartitionKeySessionLab({scope,bundleId:snapshot.pointer.bundleId,password:passwords[scope],rows:snapshot.rows[scope]});
   try{parts[scope]=validateVaultScopeResultLab(await key.read(snapshot.rows[scope]),scope).data;}finally{key.close();}
  }
  return {snapshot,parts,data:joinVaultScopesLab(parts)};
 };
 return Object.freeze({
  stage,
  async status(){
   const {pointer}=await using(db=>readSlices(db,[]));
   if(pointer===undefined)return {active:false};check(validPointer(pointer),'Указатель LAB повреждён');return {active:true,...pointer};
  },
  async snapshot({passwords}){return (await authenticate(passwords)).data;},
  async prepareRecoveryCopy({passwords,backupPasswords}){
   check(independentPartitionPasswordsLab(passwords,backupPasswords),'Пароли копии должны быть независимыми от активного набора LAB');
   const {snapshot,data}=await authenticate(passwords);
   return createPartitionRecoveryCopyLab({data,pointer:snapshot.pointer,passwords:backupPasswords});
  },
  async restoreRecoveryCopy({file,backupPasswords,newPasswords,confirmed=false}){
   check(confirmed===true&&independentPartitionPasswordsLab(backupPasswords,newPasswords),'Подтвердите восстановление в пустой LAB с независимыми паролями');
   const {data}=await openPartitionRecoveryCopyLab(file,{passwords:backupPasswords});
   return stage({data,passwords:newPasswords});
  },
  async rotatePasswords({passwords,newPasswords,backupPasswords,backupFile,saved=false}){
   check(saved===true&&independentPartitionPasswordsLab(passwords,newPasswords,backupPasswords),'Требуется сохранённая независимая копия и три новых пароля LAB');
   const {snapshot,parts,data}=await authenticate(passwords);
   const backup=await openPartitionRecoveryCopyLab(backupFile,{passwords:backupPasswords});
   check(sourceMatchesPartitionLab(backup.source,snapshot.pointer)&&samePartitionSnapshotLab(backup.data,data),'Копия устарела или не совпадает с текущими ревизиями LAB');
   const after=await sealAll(parts,snapshot.pointer.bundleId,newPasswords);
   return using(db=>commitRotation(db,snapshot,after));
  },
  async openScope({scope,password,idleMs=5*60*1000,now=()=>performance.now(),assertActive=()=>{}}){
   check(scopes.includes(scope)&&Number.isSafeInteger(idleMs)&&idleMs>0&&idleMs<=30*60*1000&&typeof now==='function'&&typeof assertActive==='function','Некорректный сеанс LAB');
   assertActive();const initial=await current([scope]),bundleId=initial.pointer.bundleId;
   let revision=initial.pointer.revisions[scope],key=null,closed=false,timer,deadline=0,tail=Promise.resolve();
   const close=()=>{closed=true;clearTimeout(timer);key?.close();key=null;};
   const guard=()=>{if(!closed&&now()>=deadline)close();check(!closed,'Сеанс LAB заблокирован');try{assertActive();}catch(e){close();throw e;}};
   const arm=()=>{clearTimeout(timer);deadline=now()+idleMs;timer=setTimeout(close,idleMs);timer?.unref?.();};
   arm();
   let allowed;
   try{
    key=await openPartitionKeySessionLab({scope,bundleId,password,rows:initial.rows[scope],assertActive:guard});password=undefined;guard();
    const part=validateVaultScopeResultLab(await key.read(initial.rows[scope]),scope).data;fullPart(scope,part);allowed=new Set(Object.keys(part));guard();arm();
   }catch(e){close();throw e;}
   const run=async(names,mode,fn)=>{
    guard();const job=tail.then(async()=>{
     try{
      guard();const selected=[].concat(names);
      check(selected.length&&new Set(selected).size===selected.length&&selected.every(n=>allowed.has(n)),'Хранилище недоступно в этой области');
      const before=await current([scope]);guard();
      check(before.pointer.bundleId===bundleId&&before.pointer.revisions[scope]===revision,'Ревизия области LAB изменилась. Откройте заново');
      const part=validateVaultScopeResultLab(await key.read(before.rows[scope]),scope).data;
      const prepared=await prepareSchemaSnapshotTransactionLab(fullPart(scope,part),selected,mode,fn,{guard,isOpen:()=>{try{guard();return true;}catch{return false;}}});guard();
      if(mode==='readwrite'){
       const next=splitVaultScopesLab(prepared.data);
       check(scopes.every(s=>s===scope||Object.values(next[s]).every(rows=>rows.length===0)),'Запись другой области LAB');
       const after=await key.seal(withMeta(scope,bundleId,next[scope]));guard();
       await using(db=>commitScope(db,scope,before,after,guard));guard();revision=after[0].vaultId;
      }
      guard();arm();return prepared.result;
     }catch(e){close();throw e;}
    });
    tail=job.then(()=>undefined,()=>undefined);return job;
   };
   const a=createDataAccess(run);
   return Object.freeze({scope,close,isClosed:()=>closed,transaction:a.transaction,readSnapshot:a.readSnapshot,get:a.get,getAll:a.getAll,put:a.put,del:a.del,bulkPut:a.bulkPut,byIndex:a.byIndex,count:a.count});
  }
 });
}
