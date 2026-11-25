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

test('alternative candidates exclude matching restrictions, unknown tags and full exemptions',async()=>{
 const {catalog}=await import('../js/health.js'),lesson={classId:'c',date:'2026-11-24',activityIds:['run']},students=[{id:'a',classId:'c'},{id:'b',classId:'c'}],exercises=['run','jump','pass','unknown'].map(activityId=>({kind:'exercise',activityId})),ctx={students,activities:catalog,restrictions:[{studentId:'a',activityId:'jump',type:'avoid',dateFrom:'2026-01-01'}],exemptions:[{studentId:'b',dateFrom:'2026-01-01',dateTo:null}]};
 assert.deepEqual(W.alternativeExerciseCandidates(lesson,'a',exercises,ctx).rows.map(r=>r.exercise.activityId),['pass']);assert.equal(W.alternativeExerciseCandidates(lesson,'b',exercises,ctx).full,true);assert.deepEqual(W.alternativeExerciseCandidates(lesson,'b',exercises,ctx).rows,[]);assert.throws(()=>W.alternativeExerciseCandidates(lesson,'foreign',exercises,ctx));
});

test('Broad exercise preview includes potential restrictions without classifying them as confirmed',async()=>{
 const {catalog}=await import('../js/health.js');
 const plan={context:'school',items:[{phase:'main',exercise:{activityId:'run'},minutes:5}]};
 const result=W.lessonPlanReview(plan,{classId:'c',date:'2026-11-24'},{students:[{id:'a',classId:'c'}],activities:catalog,restrictions:[{studentId:'a',activityId:'sprint',type:'avoid',dateFrom:'2026-11-01'}],exemptions:[]});
 assert.equal(result.items[0].matches.length,0);assert.equal(result.items[0].potentialMatches.length,1);assert.equal(result.items[0].needsReview,true);
});

test('Reserve plan is an independent editable ordinary plan without original hall assumptions',async()=>{
 await db.clearAll();await S.load();
 const original=await W.saveWork({kind:'plan',name:'Основной',context:'school',minutes:45,goal:'Цель',equipment:'Мячи',audience:'7А',items:[{phase:'main',exercise:W.builtinExercises[1],minutes:8,notes:'Техника'}],resources:[{itemId:'stock',name:'Мячи',unit:'шт.',qty:8}],gymBoards:[]});
 const before=structuredClone(original),draft=W.fallbackPlanDraft(original,'equipment');
 assert.equal(draft.id,undefined);assert.equal(draft.resources.length,0);assert.equal(draft.equipment,'');assert.match(draft.goal,/Недостаточно инвентаря/);
 draft.items[0].notes='Новые условия';const saved=await W.saveWork(draft);
 assert.notEqual(saved.id,original.id);assert.deepEqual((await W.listWork('plan')).find(p=>p.id===original.id),before);
 assert.throws(()=>W.fallbackPlanDraft(original,'wrong'));
 const backup=await S.makeBackup();await S.restoreBackup(backup);assert.equal((await W.listWork('plan')).length,2);
});
test('Circuit uses parallel station inventory, actual elapsed slots, capacities and immutable exercise snapshots',()=>{
 const stock={id:'balls',name:'Мячи',unit:'шт.',initial:{good:5,repair:2,unusable:0},movements:[],archived:false},r={itemId:'balls',name:'Мячи',unit:'шт.',qty:3};
 const station={exercise:W.builtinExercises[1],capacity:8,notes:'',resources:[r]};
 const args={name:'Круг',minutes:45,rounds:2,work:3,transition:1,warmup:{exercise:W.builtinExercises[0],minutes:5},cooldown:{exercise:W.builtinExercises[3],minutes:5},stations:[station,{...station,exercise:W.builtinExercises[2]}],pupilCount:17,inventory:[stock]};
 const before=structuredClone(args),result=W.circuitDraft(args);
 assert.equal(result.total,26);assert.deepEqual(result.rotation,[[1,2],[2,1]]);assert.equal(result.groups,2);assert.equal(result.groupSize,9);assert.equal(result.capacityIssues.length,2);
 assert.equal(result.plan.resources[0].qty,6);assert.equal(result.stock[0].available,5);assert.equal(result.stock[0].shortage,1);
 assert.equal(result.plan.items.length,6);assert.equal(result.plan.items.reduce((n,i)=>n+i.minutes,0),26);assert.match(result.plan.items[1].notes,/параллельно/);
 assert.deepEqual(args,before);result.plan.items[1].exercise.name='Copy';assert.equal(args.stations[0].exercise.name,before.stations[0].exercise.name);
 assert.throws(()=>W.circuitDraft({...args,minutes:25}),/не помещается/);
 assert.throws(()=>W.circuitDraft({...args,stations:[station]}),/параметры/);
 assert.throws(()=>W.circuitDraft({...args,stations:[{...station,resources:[r,r]},station]}),/Повторяющийся/);
 assert.equal(W.circuitDraft({...args,inventory:[]}).stock[0].available,null);
});
