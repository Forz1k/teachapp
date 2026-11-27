import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {encryptBackup} from '../js/privacy.js';
import {splitDeviceSnapshot,joinDeviceSnapshot,validateDeviceCheckpoints} from '../js/device-checkpoint-migration.js';
import {inspectMigrationSnapshot} from '../js/migration-preflight.js';
import {partitionedVaultLab} from '../tools/prototypes/vault-partitioned-lab.mjs';
import {openPartitionLegacyLab,preparePartitionLegacyMigrationLab,migratePartitionLegacyLab,restorePartitionLegacyCopyLab,partitionMigrationNameLab} from '../tools/prototypes/vault-partition-migration-lab.mjs';
import {openPartitionRecoveryCopyLab,samePartitionSnapshotLab} from '../tools/prototypes/vault-partition-recovery-lab.mjs';
const passwords={school:'synthetic-school-key',coach:'synthetic-coach-key',workspace:'synthetic-owner-key'};
const backupPasswords={school:'synthetic-backup-school',coach:'synthetic-backup-coach',workspace:'synthetic-backup-owner'};
const nextPasswords={school:'synthetic-new-school',coach:'synthetic-new-coach',workspace:'synthetic-new-owner'};
const flags={deviceLocal:true};
async function fixture(){
 const data=Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]]));
 data.classes=[{id:'c',name:'Synthetic class',gradeLevel:7}];
 const identity={endpoint:'https://synthetic.invalid',workspaceId:'12345678-1234-1234-1234-123456789abc',revision:3};
 const envelope=await encryptBackup({synthetic:'never-public'},'synthetic-sync-password');
 data.meta=[{id:'settings',theme:'dark'},{id:'sync-checkpoint-school',...identity,envelope},{id:'sync-checkpoint-status-school',...identity,successfulAt:'2026-01-01T00:00:00Z'},{id:'sync-checkpoint-coach',...identity,envelope}];
 return data;
}
async function seed(id,data){
 const db=await openPartitionLegacyLab(id,flags);
 await new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(SCHEMA),'readwrite');for(const [n,rows] of Object.entries(data))for(const row of rows)tx.objectStore(n).add(row);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
 db.close();
}
test('Device checkpoint split keeps exact opaque packets outside portable data and rejects corrupt/unknown/active migration markers',async()=>{
 const data=await fixture(),{portable,device}=splitDeviceSnapshot(data);
 assert.equal(device.length,3);assert.equal(portable.meta.length,1);assert.ok(samePartitionSnapshotLab(joinDeviceSnapshot(portable,device),data));
 assert.throws(()=>validateDeviceCheckpoints([...device,{id:'sync-checkpoint-migration-school'}]),/Delta/);
 assert.throws(()=>validateDeviceCheckpoints([...device,{...device[0],id:'sync-checkpoint-unknown'}]),/Неизвестная/);
 assert.throws(()=>validateDeviceCheckpoints(device.map(r=>r.id.includes('status')?{...r,revision:99}:r)),/не совпадает/);
 assert.throws(()=>validateDeviceCheckpoints(device.map(r=>r.envelope?{...r,envelope:{...r.envelope,iv:'bad'}}:r)),/конверт/);
 assert.throws(()=>joinDeviceSnapshot(data,device),/переносимой части/);
 const report=inspectMigrationSnapshot(data,{secure:true,webLocks:true,estimate:{usage:0,quota:1e8}});
 assert.deepEqual(report.blockers,['unmigrated-device-checkpoints']);assert.equal(report.activationAllowed,false);
 assert.ok(report.bytes>JSON.stringify(portable).length);assert.doesNotMatch(JSON.stringify(report),/synthetic|12345678/);
});
test('Explicit device-local migration preserves checkpoints through scope writes, rotation and verified rollback without exposing them to ordinary scope API',async()=>{
 const id='device-checkpoints',data=await fixture();await seed(id,data);
 const copy=await preparePartitionLegacyMigrationLab(id,{backupPasswords,...flags});
 assert.equal(JSON.parse(copy.file).version,2);assert.doesNotMatch(copy.file,/synthetic.invalid|sync-checkpoint|never-public/);
 await assert.rejects(openPartitionRecoveryCopyLab(copy.file,{passwords:backupPasswords}),/Некорректная копия/);
 assert.ok(samePartitionSnapshotLab((await openPartitionRecoveryCopyLab(copy.file,{passwords:backupPasswords,...flags})).data,data));
 await migratePartitionLegacyLab(id,{passwords,backupPasswords,backupFile:copy.file,saved:true,confirmed:true,...flags});
 await assert.rejects(openPartitionLegacyLab(id,flags),{name:'VersionError'});
 const lab=partitionedVaultLab(id,{layout:'school-v3-device-migrated'});
 assert.ok(samePartitionSnapshotLab(await lab.snapshot({passwords}),data));
 const school=await lab.openScope({scope:'school',password:passwords.school});
 const owner=await lab.openScope({scope:'workspace',password:passwords.workspace});
 try{
  assert.doesNotMatch(JSON.stringify(await school.getAll('meta')),/sync-checkpoint|synthetic.invalid/);
  assert.doesNotMatch(JSON.stringify(await owner.getAll('meta')),/sync-checkpoint|synthetic.invalid/);
  await owner.put('meta',{id:'settings',theme:'light'});
  await school.put('classes',{id:'c',name:'Edited synthetic class',gradeLevel:7});
  const updated=await lab.snapshot({passwords});assert.deepEqual(splitDeviceSnapshot(updated).device.sort((a,b)=>a.id.localeCompare(b.id)),splitDeviceSnapshot(data).device.sort((a,b)=>a.id.localeCompare(b.id)));
  await assert.rejects(lab.rotatePasswords({passwords,newPasswords:nextPasswords,backupPasswords,backupFile:copy.file,saved:true}),/Копия устарела/);
  const fresh=await lab.prepareRecoveryCopy({passwords,backupPasswords});
  await lab.rotatePasswords({passwords,newPasswords:nextPasswords,backupPasswords,backupFile:fresh.file,saved:true});
  assert.ok(samePartitionSnapshotLab(await lab.snapshot({passwords:nextPasswords}),updated));
  await restorePartitionLegacyCopyLab('device-rollback',{file:fresh.file,backupPasswords,confirmed:true,...flags});
  const rollback=await openPartitionLegacyLab('device-rollback',flags);
  try{
   const restored=await new Promise((resolve,reject)=>{const tx=rollback.transaction(Object.keys(SCHEMA),'readonly'),req=Object.keys(SCHEMA).map(n=>[n,tx.objectStore(n).getAll()]);tx.oncomplete=()=>resolve(Object.fromEntries(req.map(([n,r])=>[n,r.result])));tx.onabort=()=>reject(tx.error);});
   assert.ok(samePartitionSnapshotLab(restored,updated));
  }finally{rollback.close();}
 }finally{school.close();owner.close();}
});
test('Active Delta migration and corrupted status stop device-local migration before deleting plaintext',async()=>{
 const data=await fixture();data.meta.push({id:'sync-checkpoint-migration-school'});await seed('device-delta',data);
 await assert.rejects(preparePartitionLegacyMigrationLab('device-delta',{backupPasswords,...flags}),/Delta/);
 const db=await openPartitionLegacyLab('device-delta',flags);assert.equal(db.version,10);db.close();
});
