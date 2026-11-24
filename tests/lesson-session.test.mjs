import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';
import * as db from '../js/db.js';
async function seed(){
 await db.clearAll();await S.load();
 const c=await S.addClass('7А'),a=await S.addStudent(c.id,'Первый',1),b=await S.addStudent(c.id,'Второй',2),d=await S.addStudent(c.id,'Третий',3);
 const l=await S.addLesson(c.id,'2026-01-01');await S.updateLesson(l.id,{activityIds:['standing']});return {c,a,b,d,l};
}
test('Массовая явка и оценка: явно выбранные ученики, защита заполненных клеток',async()=>{
 const {c,a,b,d,l}=await seed();
 await assert.rejects(S.applyLessonBatch(l.id,[a.id],'normal'),/Подтвердите/);
 await S.applyLessonBatch(l.id,[a.id],'normal',null,true);
 await S.applyLessonBatch(l.id,[b.id],'absent',null,true);
 await S.applyLessonBatch(l.id,[a.id],'grade','5',true);
 assert.equal(S.state.participation.length,1);assert.equal(S.state.marks.length,2);
 assert.equal(S.attendanceFor([l],S.studentsOfClass(c.id),c.id).unknown,1);
 await assert.rejects(S.applyLessonBatch(l.id,[d.id,b.id],'grade','4',true),/уже есть/);
 assert.equal(S.state.marks.length,2);
 await S.load();assert.equal(S.state.marks.length,2);assert.equal(S.state.participation.length,1);
});
test('Массовое действие не игнорирует действующие ограничения, чужой класс и будущее',async()=>{
 const {c,a,b,l}=await seed();
 await S.saveRestriction({studentId:b.id,activityId:'jump',type:'avoid',dateFrom:'2025-01-01',dateTo:null});
 await assert.rejects(S.applyLessonBatch(l.id,[a.id,b.id],'normal',null,true),/ограничение/);
 assert.equal(S.state.participation.length,0);
 const other=await S.addClass('8А'),st=await S.addStudent(other.id,'Другой',1);
 await assert.rejects(S.applyLessonBatch(l.id,[st.id],'grade','5',true),/Состав/);
 const future=await S.addLesson(c.id,'2099-01-01');
 await assert.rejects(S.applyLessonBatch(future.id,[a.id],'absent',null,true),/ещё не/);
 assert.equal(S.state.marks.length,0);
});
