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

test('lesson plan preview uses per-exercise restrictions and lesson date without writes',async()=>{
 const {catalog}=await import('../js/health.js');
 const students=[{id:'a',classId:'c'},{id:'b',classId:'c'},{id:'foreign',classId:'other'}];
 const plan={context:'school',items:[{phase:'intro',exercise:{activityId:'run'},minutes:5},{phase:'main',exercise:{activityId:'standing'},minutes:20}]};
 const lesson={classId:'c',date:'2026-11-24'};
 const restrictions=[{studentId:'a',activityId:'jump',type:'avoid',dateFrom:'2026-11-01',dateTo:'2026-11-30'},{studentId:'b',activityId:'run',type:'avoid',dateFrom:'2026-11-25',dateTo:null},{studentId:'foreign',activityId:'run',type:'avoid',dateFrom:'2026-11-01',dateTo:null}];
 const result=W.lessonPlanReview(plan,lesson,{students,activities:catalog,restrictions,exemptions:[{studentId:'b',dateFrom:'2026-11-23',dateTo:'2026-11-25'}]});
 assert.equal(result.minutes,25);assert.deepEqual(result.full,['b']);assert.equal(result.items[0].matches.length,0);assert.deepEqual(result.items[1].matches.map(m=>m.studentId),['a']);
 assert.equal(result.total,2);assert.deepEqual(lesson,{classId:'c',date:'2026-11-24'});
});
