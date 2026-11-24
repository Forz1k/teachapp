import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';
import * as S from '../js/store.js';
import * as W from '../js/workbench.js';
import {physicalPassport,normChecklist,scoreRubric} from '../js/school-tools.js';
const old={id:'old',classId:'old-c',fullName:'Тест'},student={id:'new',lineageId:'old',classId:'c',fullName:'Новое имя'};
const d={id:'n',name:'Прыжок',activityId:'standing',unit:'см',direction:'max',scale:[100,110,120,130,140]};
const year={from:'2026-09-01',to:'2027-05-31'};
const r=(id,studentId,date,value,basis='')=>({id,normId:'n',studentId,date,value,grade:'5',status:'done',definition:d,basis});
test('Паспорт: стабильная связь, разные имена не мешают, однофамильцы не объединяются',()=>{
 const current={students:[student],classes:[{id:'c',name:'8А'}],normResults:[r('b','new','2026-11-24',170),r('c','new','2026-11-25',200,'адаптация')],settings:{year}};
 const archive={year:{from:'2025-09-01',to:'2026-05-31'},snapshot:{students:[old,{id:'unrelated',classId:'old-c',fullName:'Новое имя'}],classes:[{id:'old-c',name:'7А'}],normResults:[r('a','old','2026-05-01',160),r('u','unrelated','2026-05-01',250)]}};
 const p=physicalPassport(current,[archive],student.id);
 assert.equal(p.years.length,2);assert.equal(p.groups[0].history.length,3);assert.equal(p.groups[0].best,170);assert.equal(p.groups[0].first,160);
});
test('План сдачи отличает отсутствие результата от ограничения и заданной цели',()=>{
 const s={classes:[{id:'c',name:'8А'}],students:[student,{id:'missing',classId:'c'},{id:'restricted',classId:'c'}],norms:[d],normResults:[r('a','new','2026-11-20',140)],activityCategories:[],activityRestrictions:[{studentId:'restricted',activityId:'jump',type:'avoid',dateFrom:'2026-09-01'}],exemptions:[]};
 assert.deepEqual(normChecklist(s,{classId:'c',normId:'n',from:year.from,to:year.to,today:'2026-11-24',targetGrade:5}).map(x=>x.status),['done','missing','review']);
});
test('Критерии: явные баллы, без автоматических оценок, резервная копия',async()=>{
 await db.clearAll();await S.load();
 const rubric=await W.saveWork({kind:'rubric',name:'Передача',criteria:[{name:'Стойка',max:4,description:''},{name:'Движение',max:6,description:''}],thresholds:[0,40,60,75,90]});
 assert.deepEqual(scoreRubric(rubric,[3,5]),{sum:8,max:10,percent:80,grade:'4'});
 assert.throws(()=>scoreRubric(rubric,[null,5]));assert.throws(()=>scoreRubric(rubric,[5,5]));
 assert.equal(S.state.marks.length,0);
 const b=await S.makeBackup();assert.equal(b.version,15);await S.restoreBackup(b);assert.equal((await W.listWork('rubric')).length,1);
 const bad=structuredClone(b);bad.data.workRecords[0].thresholds=[0,0,60,75,90];await assert.rejects(S.restoreBackup(bad));
});
