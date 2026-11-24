import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';
import * as S from '../js/store.js';
import * as W from '../js/workbench.js';
test('Библиотека: поиск, независимые снимки упражнений, время конспекта',async()=>{
 await db.clearAll();await S.load();
 const e=await W.saveWork({...W.builtinExercises[0],id:undefined,name:'Тестовое упражнение'});
 assert.equal(W.librarySearch([e],'тестовое','warmup').length,1);
 const plan=await W.saveWork({kind:'plan',name:'Урок',context:'school',minutes:45,goal:'Цель',equipment:'',audience:'7 класс',items:[{phase:'intro',exercise:e,minutes:5,notes:''}]});
 await W.saveWork({...e,name:'Новое имя'});await W.deleteWork(e.id,'exercise');
 assert.equal((await W.listWork('plan'))[0].items[0].exercise.name,'Тестовое упражнение');
 assert.throws(()=>W.validateWorkRecord({...plan,minutes:2}),/времени/);
 assert.deepEqual(W.planExercises(plan),[{name:'Тестовое упражнение',activityId:'other',minutes:5}]);
 const backup=await S.makeBackup();await S.restoreBackup(backup);assert.equal((await W.listWork('plan')).length,1);
 const old=structuredClone(backup);old.version=10;delete old.data.workRecords;await S.restoreBackup(old);assert.equal((await W.listWork('plan')).length,0);
});
