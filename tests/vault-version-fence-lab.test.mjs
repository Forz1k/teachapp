import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {openLegacyFenceLab,fenceLegacyLab} from '../tools/prototypes/vault-version-fence-lab.mjs';
const fixture=()=>({...Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]])),meta:[{id:'synthetic',value:1}]});
const write=(db,row)=>new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.objectStore('meta').put(row);});
const read=db=>new Promise((resolve,reject)=>{const tx=db.transaction('meta'),q=tx.objectStore('meta').getAll();tx.oncomplete=()=>resolve(q.result);tx.onabort=()=>reject(tx.error);});
const openRaw=(id,version)=>new Promise((resolve,reject)=>{const q=indexedDB.open('teachapp-vault-fence-lab-'+id,version);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
test('Fence compares all rows atomically, closes cooperative old clients, rejects old version and preserves source',async()=>{
 const id='success',data=fixture(),old=await openLegacyFenceLab(id);await write(old,data.meta[0]);
 const stale=fixture();stale.meta[0].value=0;
 await assert.rejects(fenceLegacyLab(id,stale),/snapshot changed/);
 const reopened=await openLegacyFenceLab(id);assert.deepEqual(await read(reopened),data.meta);
 const fenced=await fenceLegacyLab(id,data);assert.deepEqual(fenced,{legacyVersion:10,version:11,fenced:true});
 assert.throws(()=>reopened.transaction('meta','readwrite'),{name:'InvalidStateError'});
 await assert.rejects(openLegacyFenceLab(id),{name:'VersionError'});
 const raw=await openRaw(id,11);try{assert.deepEqual(await read(raw),data.meta);assert.ok(raw.objectStoreNames.contains('migrationFence'));}finally{raw.close();}
 await assert.rejects(fenceLegacyLab(id,data),/already activated/);
});
test('Fence refuses missing source and a noncooperative connection; late upgrade aborts without mutating source',async()=>{
 const id='blocked',data=fixture();const old=await openLegacyFenceLab(id);await write(old,data.meta[0]);old.onversionchange=()=>{};
 await assert.rejects(fenceLegacyLab(id,data),/still open/);old.close();
 const restored=await openLegacyFenceLab(id);try{assert.equal(restored.version,10);assert.deepEqual(await read(restored),data.meta);assert.equal(restored.objectStoreNames.contains('migrationFence'),false);}finally{restored.close();}
 await assert.rejects(fenceLegacyLab('missing',data),/existing legacy/);
 assert.throws(()=>openLegacyFenceLab('../teachapp'),/Invalid/);
 assert.throws(()=>fenceLegacyLab('test',{}),/Incomplete/);
});
