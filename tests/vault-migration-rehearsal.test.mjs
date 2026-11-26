import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';
import * as D from '../js/db.js';import * as S from '../js/store.js';import * as C from '../js/coach.js';
import {openVaultLab} from '../tools/prototypes/local-vault.mjs';
import {schemaVaultAdapter} from '../tools/prototypes/vault-schema-adapter.mjs';
import {openPlainSchemaLab,readPlainSchemaLab,stageSchemaMigrationLab,verifySchemaMigrationLab,restoreSchemaMigrationLab} from '../tools/prototypes/vault-migration-rehearsal.mjs';
const password='synthetic-rehearsal-password';
function putData(db,data){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(Object.keys(data),'readwrite');
  tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  for(const [name,rows] of Object.entries(data))for(const row of rows)tx.objectStore(name).put(row);
 });
}
test('Native LAB migration and rollback retain both school and coach records and refuse overwrite',async t=>{
 await D.clearAll();await S.load();const c=await S.addClass('7А'),p=await S.addStudent(c.id,'Synthetic pupil',1,'girls'),l=await S.addLesson(c.id,'2026-11-24');await S.setMark(p.id,l.id,{value:'4'});const team=await C.saveTeam({name:'Synthetic team'});await C.savePlayer({teamId:team.id,name:'Synthetic athlete',number:1,position:'setter'});
 const original=await D.dumpAll();
 const source=await openPlainSchemaLab('teachapp-plain-lab-source-rehearsal'),dest=await openPlainSchemaLab('teachapp-plain-lab-rollback-rehearsal'),vault=await openVaultLab('teachapp-vault-lab-rehearsal');t.after(()=>{source.close();dest.close();vault.close();});
 await putData(source,JSON.parse(JSON.stringify(original)));const before=await readPlainSchemaLab(source);
 assert.equal((await stageSchemaMigrationLab(source,vault,{password})).verified,true);
 assert.equal((await verifySchemaMigrationLab(source,vault,{password})).verified,true);
 await assert.rejects(restoreSchemaMigrationLab(vault,dest,{password:'incorrect-password'}),/неверный пароль/);
 assert.ok(Object.values(await readPlainSchemaLab(dest)).every(rows=>rows.length===0));
 const adapter=schemaVaultAdapter(vault,{password});t.after(()=>adapter.close());
 await adapter.transaction('marks','readwrite',async s=>{const mark=await s.marks.index('lessonId_studentId').get([l.id,p.id]);await s.marks.put({...mark,value:'5'});});
 await assert.rejects(verifySchemaMigrationLab(source,vault,{password}),/изменился/);
 assert.equal((await restoreSchemaMigrationLab(vault,dest,{password})).verified,true);
 const restored=await readPlainSchemaLab(dest);assert.equal(restored.marks[0].value,'5');assert.deepEqual(restored.coachPlayers,before.coachPlayers);
 await assert.rejects(restoreSchemaMigrationLab(vault,dest,{password}),/не пуста/);
 await assert.rejects(restoreSchemaMigrationLab(vault,source,{password}),/только отдельная/);
 assert.deepEqual(await readPlainSchemaLab(dest),restored);assert.deepEqual(await readPlainSchemaLab(source),before);assert.deepEqual(await D.dumpAll(),original);
});
test('Migration rejects live DB names and detects native source changes after staging',async t=>{
 assert.throws(()=>openPlainSchemaLab('teachapp'),/только имя/);
 const source=await openPlainSchemaLab('teachapp-plain-lab-source-stale'),vault=await openVaultLab('teachapp-vault-lab-stale');t.after(()=>{source.close();vault.close();});
 await putData(source,{meta:[{id:'synthetic',value:1}]});
 await stageSchemaMigrationLab(source,vault,{password});
 await putData(source,{meta:[{id:'synthetic',value:2}]});
 await assert.rejects(verifySchemaMigrationLab(source,vault,{password}),/изменился/);
 assert.equal((await readPlainSchemaLab(source)).meta[0].value,2);
 await assert.rejects(stageSchemaMigrationLab(source,vault,{password}),/перезапись запрещена/);
});
