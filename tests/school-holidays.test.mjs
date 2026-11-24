import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import * as S from '../js/store.js';
import * as db from '../js/db.js';

test('holidays are shared, inclusive, persisted and do not delete existing lessons',async()=>{
  await db.clearAll();await S.load();
  const a=await S.addClass('7А'),b=await S.addClass('8Б');
  const date='2026-11-23';
  await S.setScheduleEntry({weekday:1,slot:1,classId:a.id,time:'08:00'});
  await S.setScheduleEntry({weekday:1,slot:2,classId:b.id,time:'09:00'});
  const lesson=await S.addLesson(a.id,date);
  const student=await S.addStudent(a.id,'Иванов Иван',1);
  await S.setMark(student.id,lesson.id,{value:'5'});
  assert.equal(S.scheduleForDate(date).length,2);
  await S.saveSchoolHolidays([{from:date,to:'2026-11-29'}]);
  await S.load();
  assert.deepEqual(S.scheduleForDate(date),[]);
  assert.equal(S.scheduleForDate('2026-11-30').length,2);
  for(const cls of [a,b])assert.deepEqual(M.planLessonDates({classId:cls.id,from:date,to:'2026-11-30',rules:S.state.schedule,overrides:S.state.scheduleOverrides,holidays:S.state.settings.holidays,days:new Set()}),['2026-11-30']);
  assert.equal(S.state.lessons.find(l=>l.id===lesson.id).date,date);
  assert.equal(S.state.marks.find(m=>m.lessonId===lesson.id).value,'5');
  await assert.rejects(S.saveSchoolHolidays([{from:date,to:'2026-11-29'},{from:'2026-11-28',to:'2026-12-01'}]),/пересекаются/);
  await assert.rejects(S.saveSchoolHolidays([{from:'2026-02-30',to:'2026-03-01'}]),/даты/);
  await S.saveSchoolHolidays([]);
  assert.equal(S.scheduleForDate(date).length,2);
});
