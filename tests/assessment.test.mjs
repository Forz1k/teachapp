import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/assessment.js';
import * as S from '../js/store.js';
import * as db from '../js/db.js';
test('Периоды: четыре четверти, границы и пересечения',()=>{
 const year={from:'2026-09-01',to:'2027-05-31'},p=A.periodDraft('quarter',year);
 assert.equal(p.length,4);assert.equal(p[0].from,year.from);assert.equal(p[3].to,year.to);
 assert.equal(A.validatePeriods(p,year).length,4);
 assert.throws(()=>A.validatePeriods([p[0],{...p[1],from:p[0].to}],year));
});
test('Посещаемость без будущих и пустых клеток, авто-ОСВ не подтверждает явку',()=>{
 const lessons=[{id:'a',date:'2026-01-01',held:true},{id:'b',date:'2026-01-02',held:true},{id:'c',date:'2026-01-03',held:true},{id:'d',date:'2027-01-01'}];
 const a=A.attendanceDetails(lessons,[{id:'s'}],new Map([['a|s',{flag:'Н'}],['b|s',{flag:'ОСВ',source:'auto-osv'}]]),new Map(),'2026-11-24');
 assert.equal(a.pct,0);assert.equal(a.future,1);assert.equal(a.unknown,2);assert.equal(a.exempt,1);
});
test('Нормативы: история, ограничения, перенос, копия и каскадное удаление',async()=>{
 await db.clearAll();await S.load();
 const c=await S.addClass('8А'),s=await S.addStudent(c.id,'Ученик',1),l=await S.addLesson(c.id,'2026-01-01');
 const n=await S.saveNorm({name:'Бег',activityId:'30m',unit:'с',direction:'min',scale:[10,9,8,7,6]});
 assert.equal(A.gradeNorm(n,7),'4');assert.equal(A.gradeNorm(n,11),null);
 const r=await S.saveNormResult({normId:n.id,studentId:s.id,lessonId:l.id,status:'done',value:7});
 await assert.rejects(S.transferNormGrade(r.id),/Подтвердите/);await S.transferNormGrade(r.id,true);
 assert.equal(S.state.marks[0].value,'4');await assert.rejects(S.transferNormGrade(r.id,true),/уже есть/);
 await S.saveRestriction({studentId:s.id,activityId:'run',type:'avoid',dateFrom:'2025-01-01',dateTo:null,instruction:'Не выполнять'});
 await assert.rejects(S.saveNormResult({normId:n.id,studentId:s.id,lessonId:l.id,status:'done',value:7}),/не разрешена/);
 const skipped=await S.saveNormResult({normId:n.id,studentId:s.id,lessonId:l.id,status:'restricted'});
 assert.equal(skipped.grade,null);assert.equal(S.state.marks[0].value,'4');
 const backup=await S.makeBackup();assert.equal(backup.version,5);await S.restoreBackup(backup);
 assert.equal(S.state.normResults.length,2);
 await S.deleteStudent(s.id);assert.equal(S.state.normResults.length,0);
 await S.restoreBackup(backup);await S.deleteClass(c.id);assert.equal(S.state.normResults.length,0);
});
