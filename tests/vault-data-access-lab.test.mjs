import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/db.js';
import {schoolViewStores} from '../js/store.js';
import {vaultRouterLab,routedDataAccessLab} from '../tools/prototypes/vault-router-lab.mjs';
const password='synthetic-facade-password';
const locks=()=>{const tails=new Map();return {request(name,opts,fn){assert.equal(opts.mode,'exclusive');const work=(tails.get(name)||Promise.resolve()).then(fn);tails.set(name,work.catch(()=>{}));return work;}};};
test('Same application data facade covers school/coach reads and mutations across isolated migration phases',async()=>{
 await D.clearAll();await D.put('meta',{id:'native-only',value:9});
 const original=await D.dumpAll(),router=vaultRouterLab('data-facade',{locks:locks()});await router.initialize();
 assert.throws(()=>routedDataAccessLab(router),/поколение/);
 assert.throws(()=>routedDataAccessLab(router,{expectedGeneration:2}),/пароль/);
 const source=routedDataAccessLab(router,{expectedGeneration:1});
 assert.equal(Object.isFrozen(source),true);
 await source.bulkPut('classes',[{id:'c',name:'7А',gradeLevel:7}]);
 await source.put('students',{id:'p',classId:'c',fullName:'Synthetic pupil',number:1,normGroup:'girls'});
 await source.put('lessons',{id:'l',classId:'c',date:'2026-11-24',slot:1,time:'09:00'});
 await source.put('marks',{id:'m',studentId:'p',lessonId:'l',value:'4',source:'manual'});
 await source.put('coachTeams',{id:'t',name:'Synthetic team'});
 const before=await source.dumpAll(),school=await source.readSnapshot(schoolViewStores);
 assert.deepEqual(await source.byIndex('students','classId','c'),school.students);
 assert.equal(await source.count('marks'),1);
 await router.stage({password});await router.activate({password});
 await assert.rejects(source.put('meta',{id:'stale',value:1}),/Маршрут LAB изменился/);
 const vault=routedDataAccessLab(router,{expectedGeneration:2,password}),wrong=routedDataAccessLab(router,{expectedGeneration:2,password:'wrong-password'});
 await assert.rejects(wrong.getAll('marks'),/неверный пароль/);wrong.close();
 assert.deepEqual(await vault.dumpAll(),before);
 assert.deepEqual(await vault.readSnapshot(schoolViewStores),school);
 await vault.transaction(['marks','meta'],'readwrite',async s=>{const mark=await s.marks.index('lessonId_studentId').get(['l','p']);await s.marks.put({...mark,value:'5'});await s.meta.put({id:'fixture',value:2});});
 await assert.rejects(vault.transaction(['marks','meta'],'readwrite',async s=>{await s.marks.clear();await s.meta.put({id:'fixture',value:99});throw Error('abort');}),/abort/);
 assert.equal((await vault.get('marks','m')).value,'5');assert.equal((await vault.get('meta','fixture')).value,2);
 const updated=await vault.dumpAll();assert.deepEqual(updated.coachTeams,before.coachTeams);
 await router.rollback({password});await assert.rejects(vault.getAll('meta'),/Маршрут LAB изменился/);
 const rollback=routedDataAccessLab(router,{expectedGeneration:3});assert.deepEqual(await rollback.dumpAll(),updated);
 await rollback.del('meta','fixture');assert.equal(await rollback.get('meta','fixture'),undefined);
 await rollback.replaceAll(updated,{guardMigration:true});assert.deepEqual(await rollback.dumpAll(),updated);
 rollback.close();await assert.rejects(rollback.getAll('meta'),/закрыт/);
 assert.deepEqual(await D.dumpAll(),original);await D.clearAll();
});
test('Facade shares native migration guard and has no backend switching API',async()=>{
 assert.throws(()=>D.createDataAccess(null),TypeError);
 await D.clearAll();try{
  await D.put('meta',{id:'sync-checkpoint-migration-school'});
  const before=await D.dumpAll(),empty=Object.fromEntries(Object.keys(D.SCHEMA).map(n=>[n,[]]));
  await assert.rejects(D.replaceAll(empty,{guardMigration:true}),/незавершённого Delta/);
  assert.deepEqual(await D.dumpAll(),before);
 }finally{await D.clearAll();}
});
