import 'fake-indexeddb/auto';
import {IDBFactory} from 'fake-indexeddb';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/db.js';
import {probeStorageMode,prepareNativeEncryptionCopy,activateNativeEncryption,openEncryptedStorage,exportEncryptedRecoveryCopy,recoverIntoEmptyEncryptedStorage,rotateEncryptedStorage} from '../js/encrypted-storage.js';
import {createVaultCipher,storageCipher} from '../js/vault-cipher.js';
import {BACKUP_VERSION} from '../js/backup.js';
import {encryptBackup} from '../js/privacy.js';
import {projectScope,prepareSync,executeSync,localSyncState} from '../js/sync.js';
import {createPersonalCode,savePersonalCode,readPersonalCode} from '../js/personal-sync.js';
import {clearSessionSyncCredentials} from '../js/sync-credential-storage.js';
const passwords={school:'synthetic-school-key',coach:'synthetic-coach-key',workspace:'synthetic-owner-key'},next={school:'synthetic-school-next',coach:'synthetic-coach-next',workspace:'synthetic-owner-next'},backupPassword='independent-copy-password',syncPassword='synthetic-sync-password';
const area='school',endpoint='https://synthetic.invalid',workspaceId='12345678-1234-1234-1234-123456789abc';
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};};
const locks={request:async(name,options,fn)=>fn({name})};
function setupGlobals(t){
 const saved=Object.fromEntries(['navigator','localStorage','indexedDB'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const install=(k,value)=>Object.defineProperty(globalThis,k,{configurable:true,value,writable:true});install('navigator',{locks});install('localStorage',storage());install('indexedDB',new IDBFactory());
 t.after(()=>{for(const [k,d] of Object.entries(saved)){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}});
}
async function seed(data){
 const q=indexedDB.open('teachapp',10),db=await new Promise((resolve,reject)=>{q.onupgradeneeded=()=>{for(const [n,d] of Object.entries(D.SCHEMA)){const s=q.result.createObjectStore(n,{keyPath:d.keyPath});for(const [i,k,o] of d.indexes)s.createIndex(i,k,o||{});}};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 await new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(D.SCHEMA),'readwrite');for(const [n,rows] of Object.entries(data))for(const row of rows)tx.objectStore(n).add(row);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
}
async function fixture(){
 const data=Object.fromEntries(Object.keys(D.SCHEMA).map(n=>[n,[]]));
 data.classes=[{id:'c',name:'Synthetic class',gradeLevel:7}];data.students=[{id:'p',classId:'c',fullName:'Synthetic pupil',number:1,normGroup:'girls'}];data.coachTeams=[{id:'t',name:'Synthetic team',archived:false}];
 const envelope=await encryptBackup({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area,workspaceId,revision:1,snapshot:projectScope(data,area)},syncPassword);
 data.meta=[{id:'sync-checkpoint-school',endpoint,workspaceId,revision:1,envelope}];return data;
}
const read=(a,n)=>a.transaction(n,'readonly',s=>s[n].getAll());
test('Shared codec rejects cross-domain ciphertext even with the same scope, bundle and password',async()=>{
 const bundleId=workspaceId,data={bundleMeta:[{id:'bundle',scope:area,bundleId}],classes:[{id:'c',name:'Synthetic'}]};
 const lab=createVaultCipher('teachapp-vault-lab'),rows=await lab.sealPartitionScope({scope:area,bundleId,password:passwords.school,data});
 await assert.rejects(storageCipher.openPartitionKeySession({scope:area,bundleId,password:passwords.school,rows}),/не удалось открыть/i);
});
test('Actual v10 → v11 requires verified independent file and checkpoint password; routes normal app/sync, rotates and recovers into empty profile',async t=>{
 setupGlobals(t);assert.equal(await probeStorageMode(),'empty');const data=await fixture();await seed(data);assert.equal(await probeStorageMode(),'native');
 localStorage.setItem('teachapp.personal-sync.v1','unsafe');await assert.rejects(prepareNativeEncryptionCopy({backupPassword}),/код/);localStorage.removeItem('teachapp.personal-sync.v1');
 const file=await prepareNativeEncryptionCopy({backupPassword});assert.doesNotMatch(file,/Synthetic|sync-checkpoint/);
 const args={passwords,backupPassword,file,checkpointPasswords:{school:syncPassword},confirmed:true};
 await assert.rejects(activateNativeEncryption({...args,checkpointPasswords:{school:'wrong-password'}}),/аутентификацию/);assert.equal(await probeStorageMode(),'native');
 await assert.rejects(activateNativeEncryption({...args,confirmed:false}),/подтверждение/);
 await activateNativeEncryption(args);assert.equal(await probeStorageMode(),'encrypted');
 await assert.rejects(openEncryptedStorage({passwords:{...passwords,coach:'incorrect-password'}}),/не удалось открыть/i);
 const access=await openEncryptedStorage({passwords});let active=true;D.configureEncryptedStorage({...access,isUnlocked:()=>active&&!access.isClosed()});
 assert.equal(D.isEncryptedStorage(),true);await assert.rejects(D.open(),{name:'NativeStorageFencedError'});
 assert.deepEqual(await D.getAll('students'),data.students);
 await assert.rejects(D.del('meta','sync-checkpoint-school'),/контрольных точек/);
 await D.put('classes',{id:'c',name:'Edited class',gradeLevel:7});
 const code=createPersonalCode(endpoint);savePersonalCode(code);assert.equal(readPersonalCode(),code);assert.equal(localStorage.getItem('teachapp.personal-sync.v1'),null);
 let remote={revision:1,envelope:data.meta[0].envelope};const client={get:async()=>structuredClone(remote),put:async(expected,envelope)=>{assert.equal(expected,remote.revision);return remote={revision:expected+1,envelope};}};
 const plan=await prepareSync({area,endpoint,password:syncPassword,client});await executeSync({plan,choices:{},password:syncPassword,client,confirmed:true});
 assert.equal((await D.get('meta','sync-checkpoint-school')).revision,2);assert.equal((await localSyncState({area,endpoint,password:syncPassword})).status,'clean');
 await assert.rejects(rotateEncryptedStorage({...args,newPasswords:next}),/устарела/);
 const latest=await exportEncryptedRecoveryCopy({data:await D.dumpAll(),backupPassword});
 await rotateEncryptedStorage({...args,file:latest,newPasswords:next});
 await assert.rejects(D.getAll('classes'),/не удалось открыть/i);assert.equal(access.isClosed(),true);active=false;clearSessionSyncCredentials();assert.equal(readPersonalCode(),null);
 const newAccess=await openEncryptedStorage({passwords:next});assert.equal((await read(newAccess,'classes'))[0].name,'Edited class');
 await assert.rejects(recoverIntoEmptyEncryptedStorage({...args,file:latest}),/зашифрованная|native fallback|заменена|существует/i);
 const original=indexedDB;newAccess.close();globalThis.indexedDB=new IDBFactory();globalThis.localStorage=storage();
 assert.equal(await probeStorageMode(),'empty');await recoverIntoEmptyEncryptedStorage({...args,file:latest,passwords:next});
 const recovered=await openEncryptedStorage({passwords:next});assert.equal((await read(recovered,'classes'))[0].name,'Edited class');assert.equal((await read(recovered,'meta')).find(r=>r.id==='sync-checkpoint-school').revision,2);recovered.close();
 globalThis.indexedDB=original;assert.equal(await probeStorageMode(),'encrypted');
 globalThis.indexedDB=new IDBFactory();await assert.rejects(probeStorageMode(),/fallback/);
});
