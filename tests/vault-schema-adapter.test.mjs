import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';
import * as D from '../js/db.js';import * as S from '../js/store.js';import * as C from '../js/coach.js';import {openVaultLab,exportVaultLab,restoreVaultLab,stageVaultLab,readVaultLab} from '../tools/prototypes/local-vault.mjs';import {stageSchemaVault,schemaVaultAdapter} from '../tools/prototypes/vault-schema-adapter.mjs';
const password='synthetic-full-schema-password';
const name='teachapp-vault-lab-schema';
test('Current full schema: actual school and coach fixture, indexed reads, atomic update, conflicting writer and recovery',async t=>{
 await D.clearAll();await S.load();const c=await S.addClass('7А'),p=await S.addStudent(c.id,'Synthetic pupil',1,'girls'),l=await S.addLesson(c.id,'2026-11-24');await S.setMark(p.id,l.id,{value:'4'});const team=await C.saveTeam({name:'Synthetic team'});await C.savePlayer({teamId:team.id,name:'Synthetic athlete',number:1,position:'setter'});
 const before=await D.dumpAll(),backup=JSON.parse(JSON.stringify(await S.makeBackup())),db=await openVaultLab(name),dest=await openVaultLab(name+'-restore');t.after(()=>{db.close();dest.close();});
 await stageSchemaVault(db,{backup,password});const a=schemaVaultAdapter(db,{password}),b=schemaVaultAdapter(db,{password});
 const read=s=>Promise.all([s.students.index('classId_number').getAll([c.id,1]),s.marks.index('lessonId_studentId').get([l.id,p.id]),s.coachPlayers.index('teamId').getAllKeys(team.id)]);
 const stores=['students','marks','coachPlayers'],native=await D.transaction(stores,'readonly',read);assert.deepEqual(await a.transaction(stores,'readonly',read),JSON.parse(JSON.stringify(native)));
 const update=async(s,value)=>{const old=await s.marks.index('lessonId_studentId').get([l.id,p.id]);await s.marks.put({...old,value});};
 await a.transaction('marks','readwrite',s=>update(s,'5'));assert.equal((await a.snapshot()).marks[0].value,'5');
 await assert.rejects(a.transaction('marks','readwrite',async s=>{await update(s,'3');throw Error('abort');}),/abort/);assert.equal((await a.snapshot()).marks[0].value,'5');
 await assert.rejects(a.transaction('marks','readwrite',async s=>{const old=await s.marks.index('lessonId_studentId').get([l.id,p.id]);await s.marks.add({...old,id:'duplicate'});}),e=>e.name==='ConstraintError');
 await assert.rejects(a.transaction('marks','readonly',s=>s.marks.clear()),e=>e.name==='ReadOnlyError');
 let release,entered;const wait=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const first=a.transaction('marks','readwrite',async s=>{await update(s,'2');entered();await wait;});await started;await b.transaction('marks','readwrite',s=>update(s,'3'));release();await assert.rejects(first,/изменился/);
 const snapshot=await b.snapshot();assert.equal(snapshot.marks[0].value,'3');assert.deepEqual(await D.dumpAll(),before);
 const file=await exportVaultLab(db,{scope:'workspace',password});assert.doesNotMatch(file,/Synthetic pupil|Synthetic athlete/);
 await restoreVaultLab(dest,{scope:'workspace',password,file});assert.deepEqual(await schemaVaultAdapter(dest,{password}).snapshot(),snapshot);
 a.close();await assert.rejects(a.snapshot(),/закрыто/);
});
test('Vault migration rejects incomplete, partial, device checkpoints and lossy JSON before writes',async t=>{
 const db=await openVaultLab(name+'-invalid');t.after(()=>db.close());const backup=JSON.parse(JSON.stringify(await S.makeBackup()));
 await assert.rejects(stageSchemaVault(db,{backup:{...backup,scope:{kind:'class'}},password}),/полная/);
 const invalid=structuredClone(backup);invalid.data.meta.push({id:'sync-checkpoint-school'});await assert.rejects(stageSchemaVault(db,{backup:invalid,password}),/Контрольные точки/);
 const partial=structuredClone(backup);delete partial.data.marks;await assert.rejects(stageSchemaVault(db,{backup:partial,password}),/полный снимок/);
 for(const x of [undefined,NaN,new Date(),new Uint8Array([1])])await assert.rejects(stageVaultLab(db,{scope:'workspace',password,data:{meta:[{id:'x',x}]}}),/неподдерживаем/);
 const tx=db.transaction('sealed');const count=await new Promise((resolve,reject)=>{const q=tx.objectStore('sealed').count();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});assert.equal(count,0);
});

test('LAB query validation and range get match native IndexedDB even when the selected table is empty',async t=>{
 const {prepareSchemaSnapshotTransactionLab}=await import('../tools/prototypes/vault-schema-adapter.mjs');
 const {openPlainSchemaLab,plainSchemaTransactionLab}=await import('../tools/prototypes/vault-migration-rehearsal.mjs');
 const data=Object.fromEntries(Object.keys(D.SCHEMA).map(n=>[n,[]]));
 const db=await openPlainSchemaLab('teachapp-plain-lab-source-query-contract');t.after(()=>db.close());
 await plainSchemaTransactionLab(db,'meta','readwrite',async s=>{await s.meta.put({id:'a',value:1});await s.meta.put({id:'b',value:2});});
 data.meta=[{id:'a',value:1},{id:'b',value:2}];
 const tx=(stores,fn)=>prepareSchemaSnapshotTransactionLab(data,stores,'readonly',fn).then(r=>r.result);
 const native=(stores,fn)=>new Promise((resolve,reject)=>{
  const tr=db.transaction(stores,'readonly'),s=Object.fromEntries(stores.map(name=>[name,tr.objectStore(name)]));let result;
  try{result=fn(s);}catch(e){reject(e);return;}
  tr.oncomplete=()=>resolve(result?.result);tr.onabort=()=>reject(tr.error);
 });
 const range=IDBKeyRange.bound('a','b');
 assert.deepEqual(await tx(['meta'],s=>s.meta.get(range)),await native(['meta'],s=>s.meta.get(range)));
 for(const [name,fn] of [
  ['students',s=>s.students.getAll({bad:true})],
  ['students',s=>s.students.index('classId').getAll(NaN)],
  ['students',s=>s.students.index('classId').count({bad:true})],
  ['students',s=>s.students.index('classId').getAllKeys(false)],
  ['students',s=>s.students.index('classId').get(null)],
  ['students',s=>s.students.get(undefined)]
 ]){
  await assert.rejects(native([name],fn),e=>e.name==='DataError');await assert.rejects(tx([name],fn),e=>e.name==='DataError');
 }
 assert.deepEqual(await tx(['students'],s=>s.students.index('classId').getAll(null)),[]);
});
