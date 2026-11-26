import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {createSchoolSession} from '../js/store.js';
import {partitionedVaultLab} from '../tools/prototypes/vault-partitioned-lab.mjs';
import {openPartitionLegacyLab,preparePartitionLegacyMigrationLab,migratePartitionLegacyLab,restorePartitionLegacyCopyLab,partitionMigrationNameLab} from '../tools/prototypes/vault-partition-migration-lab.mjs';
import {samePartitionSnapshotLab} from '../tools/prototypes/vault-partition-recovery-lab.mjs';
const passwords={school:'synthetic-school-key',coach:'synthetic-coach-key',workspace:'synthetic-owner-key'};
const backupPasswords={school:'synthetic-backup-school',coach:'synthetic-backup-coach',workspace:'synthetic-backup-owner'};
const data=()=>{const d=Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]]));d.classes=[{id:'c',name:'Synthetic class',gradeLevel:7}];d.students=[{id:'p',classId:'c',fullName:'Synthetic pupil',number:1,normGroup:'girls'}];d.meta=[{id:'settings',year:{from:'2025-09-01',to:'2026-08-31'},theme:'dark'}];d.coachTeams=[{id:'t',name:'Synthetic team',archived:false}];return d;};
function put(db,name,row){return new Promise((resolve,reject)=>{const tx=db.transaction(name,'readwrite');tx.objectStore(name).put(row);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}
async function seed(id,d){const db=await openPartitionLegacyLab(id);for(const [n,rows] of Object.entries(d))for(const row of rows)await put(db,n,row);return db;}
const plain=async db=>new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(SCHEMA),'readonly'),requests=Object.keys(SCHEMA).map(n=>[n,tx.objectStore(n).getAll()]);tx.oncomplete=()=>resolve(Object.fromEntries(requests.map(([n,q])=>[n,q.result])));tx.onabort=()=>reject(tx.error);});
const options=backupFile=>({passwords,backupPasswords,backupFile,saved:true,confirmed:true});
test('Atomic version upgrade fences old clients, removes LAB plaintext, writes via independent key and restores latest copy',async t=>{
 const id='atomic-migrate',d=data(),old=await seed(id,d);t.after(()=>old.close());
 const lab=partitionedVaultLab(id,{layout:'school-v2-migrated'});
 await assert.rejects(lab.stage({data:d,passwords}),/явный перенос/);
 const copy=await preparePartitionLegacyMigrationLab(id,{backupPasswords});
 assert.doesNotMatch(copy.file,/Synthetic pupil|Synthetic team/);
 await assert.rejects(migratePartitionLegacyLab(id,{...options(copy.file),confirmed:false}),/Подтвердите/);
 const other=await seed('different-source',d);other.close();
 await assert.rejects(migratePartitionLegacyLab('different-source',options(copy.file)),/другому исходнику/);
 const proto=IDBObjectStore.prototype,add=proto.add;
 proto.add=function(...args){if(this.transaction.db.name===partitionMigrationNameLab(id)&&this.name==='state')throw new DOMException('Synthetic quota','QuotaExceededError');return add.apply(this,args);};
 try{await assert.rejects(migratePartitionLegacyLab(id,options(copy.file)),e=>e.name==='QuotaExceededError');}finally{proto.add=add;}
 const reopened=await openPartitionLegacyLab(id);assert.equal(reopened.version,10);assert.ok(samePartitionSnapshotLab(await plain(reopened),d));reopened.close();
 const pointer=await migratePartitionLegacyLab(id,options(copy.file));
 assert.deepEqual(await lab.status(),{active:true,...pointer});
 await assert.rejects(openPartitionLegacyLab(id),e=>e.name==='VersionError');
 assert.ok(samePartitionSnapshotLab(await lab.snapshot({passwords}),d));
 const raw=await new Promise((resolve,reject)=>{const q=indexedDB.open(partitionMigrationNameLab(id),11);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 assert.deepEqual(Array.from(raw.objectStoreNames).sort(),['coach','school','state','workspace']);
 const sealed=await new Promise((resolve,reject)=>{const tx=raw.transaction('school'),q=tx.objectStore('school').getAll();tx.oncomplete=()=>resolve(q.result);tx.onabort=()=>reject(tx.error);});raw.close();
 assert.doesNotMatch(JSON.stringify(sealed),/Synthetic pupil/);
 const school=createSchoolSession(await lab.openScope({scope:'school',password:passwords.school}));t.after(()=>school.close());await school.load();
 const lesson=await school.addLesson('c','2025-10-01',null,'',{slot:1,time:'09:00'});await school.setMark('p',lesson.id,{value:'5'});
 const latest=await lab.prepareRecoveryCopy({passwords,backupPasswords}),latestData=await lab.snapshot({passwords});
 assert.equal(latestData.marks[0].value,'5');
 await assert.rejects(restorePartitionLegacyCopyLab('rollback',{file:latest.file,backupPasswords}),/Подтвердите/);
 assert.equal((await restorePartitionLegacyCopyLab('rollback',{file:latest.file,backupPasswords,confirmed:true})).verified,true);
 const rollback=await openPartitionLegacyLab('rollback');assert.ok(samePartitionSnapshotLab(await plain(rollback),latestData));rollback.close();
 await assert.rejects(restorePartitionLegacyCopyLab('rollback',{file:latest.file,backupPasswords,confirmed:true}),/перезапись запрещена/);
 await assert.rejects(openPartitionLegacyLab(id),e=>e.name==='VersionError');
});
test('Legacy edit during encryption aborts versionchange without deleting source',async t=>{
 const id='concurrent-legacy',d=data(),old=await seed(id,d);t.after(()=>old.close());const copy=await preparePartitionLegacyMigrationLab(id,{backupPasswords});
 const encrypt=crypto.subtle.encrypt;let changed=false;
 crypto.subtle.encrypt=async function(...args){
  if(!changed){changed=true;await put(old,'classes',{id:'c',name:'Changed during encryption',gradeLevel:7});}
  return encrypt.apply(this,args);
 };
 try{await assert.rejects(migratePartitionLegacyLab(id,options(copy.file)),/Исходник LAB изменился/);}finally{crypto.subtle.encrypt=encrypt;}
 const again=await openPartitionLegacyLab(id);assert.equal((await plain(again)).classes[0].name,'Changed during encryption');assert.equal(again.version,10);again.close();
 await assert.rejects(migratePartitionLegacyLab(id,options(copy.file)),/Копия устарела/);
 const fresh=await preparePartitionLegacyMigrationLab(id,{backupPasswords});await migratePartitionLegacyLab(id,options(fresh.file));
 assert.equal((await partitionedVaultLab(id,{layout:'school-v2-migrated'}).snapshot({passwords})).classes[0].name,'Changed during encryption');
});
