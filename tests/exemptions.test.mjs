import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';
import * as db from '../js/db.js';
import { hasOsv } from '../js/model.js';
import { buildSummary,buildFlat } from '../js/export.js';

async function setup() {
  await db.clearAll(); await S.load();
  const cls = await S.addClass('Тест'), st = await S.addStudent(cls.id,'Ученик',1);
  const lesson = await S.addLesson(cls.id,'2026-11-24');
  const add = (dateFrom,dateTo) => S.addExemption({studentId:st.id,dateFrom,dateTo});
  const mark = () => S.markMap(cls.id).get(lesson.id+'|'+st.id);
  return {cls,st,lesson,add,mark};
}

test('Пересечения, перенос даты, отмена и ручная оценка с весом',async () => {
  const {st,lesson,add,mark} = await setup();
  await S.setMark(st.id,lesson.id,{value:'5',weight:2});
  const [a,b] = await Promise.all([add('2026-11-20','2026-11-25'),add('2026-11-23',null)]);
  const removed = await S.removeExemption(a.exemption.id);
  assert.equal(hasOsv(mark()),true);
  const change = await S.updateExemption(b.exemption.id,{dateFrom:'2026-12-01',dateTo:null});
  assert.equal(mark().flag,null);
  await change.undo(); await removed.undo(); await S.load();
  assert.equal(S.state.exemptions.length,2);
  await S.updateLesson(lesson.id,{date:'2026-11-10'});
  assert.deepEqual([mark().flag,mark().value,mark().weight],[null,'5',2]);
  await S.updateLesson(lesson.id,{date:'2026-11-24'});
  assert.equal(hasOsv(mark()),true);
});

test('ОСВ и Н учитываются вместе в журнале, посещаемости и выгрузке',async () => {
  const {cls,st,lesson,add,mark} = await setup();
  const a = await add(lesson.date,null);
  const save = data => S.saveParticipation(st.id,lesson.id,data);
  await save({mode:'paused',basis:'document',full:true});
  const changed = await S.setMark(st.id,lesson.id,{flag:'Н'});
  await S.load();
  assert.deepEqual([mark().flag,mark().osv],['Н',true]);
  const range = {classId:cls.id,from:lesson.date,to:lesson.date};
  assert.deepEqual(buildSummary(range).rows[0].slice(2),['ОСВ + Н','','0%']);
  assert.equal(buildFlat(range)[1][4],'ОСВ + Н');
  await S.removeExemption(a.exemption.id);
  assert.equal(hasOsv(mark()),true);
  await save(null);
  assert.deepEqual([mark().flag,hasOsv(mark())],['Н',false]);
  await changed.undo();
  assert.equal(mark(),undefined);
});

test('Ошибка записи ОСВ откатывает справку и все отметки в базе и кеше',async t => {
  const {cls,st,lesson,add,mark} = await setup();
  const a = await add(lesson.date,lesson.date);
  await S.addLesson(cls.id,'2026-11-25');
  const original = IDBObjectStore.prototype.put;
  const mock = t.mock.method(IDBObjectStore.prototype,'put',function(value) {
    if (this.name === 'marks') throw new Error('Ошибка записи');
    return original.call(this,value);
  });
  await assert.rejects(S.updateExemption(a.exemption.id,{dateTo:null}),/Ошибка записи/);
  assert.equal(S.state.exemptions[0].dateTo,lesson.date);
  assert.equal(S.state.marks.length,1);
  mock.mock.restore();
  await S.load();
  assert.equal(S.state.exemptions[0].dateTo,lesson.date);
  assert.equal(S.state.marks.length,1);
  assert.equal(mark().studentId,st.id);
});
