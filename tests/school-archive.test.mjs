import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';
import * as db from '../js/db.js';
import * as C from '../js/coach.js';
import * as A from '../js/school-archive.js';
import * as W from '../js/workbench.js';
test('Архив: атомарный перевод, старые оценки и отдельный режим тренера',async()=>{
 await db.clearAll();await S.load();
 await S.setYear('2024-09-01','2025-05-31');
 const cls=await S.addClass('7А'),p=await S.addStudent(cls.id,'Тест',1,'girls'),graduate=await S.addClass('11Б');await S.addStudent(graduate.id,'Выпускник',1);
 const l=await S.addLesson(cls.id,'2025-01-01');await S.setMark(p.id,l.id,{value:'5'});
 await C.saveTeam({name:'Команда'});
 const data=await A.readSchool(),preview=A.archivePreview(data),transfers=[{id:cls.id,name:'8А',gradeLevel:8},{id:graduate.id,name:'',gradeLevel:null}],year={from:'2025-09-01',to:'2026-05-31'};
 assert.equal(A.suggestClassName(cls),'8А');
 await assert.rejects(A.rollSchoolYear({year,transfers,kind:'quarter',expected:'stale',confirmed:true}),/изменились/);
 assert.equal((await W.listWork('archive')).length,0);
 const result=await A.rollSchoolYear({year,transfers,kind:'quarter',expected:preview.token,confirmed:true});
 assert.equal(result.students,1);assert.equal(S.state.classes[0].name,'8А');assert.equal(S.state.marks.length,0);assert.notEqual(S.state.students[0].id,p.id);assert.equal(S.state.students[0].lineageId,p.id);assert.equal(S.state.students[0].normGroup,'girls');
 assert.equal(A.archiveClass(result.record,cls.id).students[0].marks[0].value,'5');
 assert.equal((await C.loadCoach()).coachTeams.length,1);
 const backup=await S.makeBackup();await S.restoreBackup(backup);assert.equal((await W.listWork('archive')).length,1);
 const broken=structuredClone(backup);broken.data.workRecords.find(x=>x.kind==='archive').snapshot.marks[0].lessonId='missing';await assert.rejects(S.restoreBackup(broken));assert.equal(S.state.classes[0].name,'8А');
});

test('Year comparison preserves weighted denominators, ignores future marks, and excludes duplicate archives',()=>{const make=(from,to)=>({meta:[{id:'settings',year:{from,to}}],classes:[{id:'c',name:'7А'},{id:'d',name:'8Б'}],students:[{id:'p',classId:'c'},{id:'q',classId:'c'},{id:'x',classId:'d'}],lessons:[{id:'l',classId:'c',date:from,held:true},{id:'f',classId:'c',date:to,held:true}],marks:[{lessonId:'l',studentId:'p',value:'5',weight:2,source:'manual'},{lessonId:'l',studentId:'q',value:'3',source:'manual'},{lessonId:'f',studentId:'p',value:'1',source:'manual'}],participation:[]});const old=make('2024-09-01','2025-05-31'),current=make('2026-09-01','2027-05-31'),archive={year:old.meta[0].year,snapshot:old};const [a,b]=A.schoolYearComparison(current,[archive],{gradeLevel:7,today:'2026-11-25'});assert.equal(a.gradeCount,3);assert.equal(b.gradeCount,2);assert.equal(b.mean,13/3);assert.equal(b.present,2);assert.equal(b.pct,100);assert.equal(b.classes,1);assert.equal(b.students,2);assert.equal(A.schoolYearComparison(current,[archive,archive],{today:'2026-11-25'})[0].conflict,true);});
