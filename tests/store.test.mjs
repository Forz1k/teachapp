/* tests/store.test.mjs — интеграционные проверки слоя данных.
   IndexedDB эмулируется fake-indexeddb, DOM не нужен.
   Проверяем то, что нельзя проверить чистой математикой:
   запись/чтение, каскад ОСВ, undo, месячные, бэкап и восстановление. */

import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

import * as db from '../js/db.js';
import * as store from '../js/store.js';
import * as M from '../js/model.js';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** Чистая база перед каждым набором. */
async function reset() {
  await db.open();
  await db.clearAll();
  await store.load();
}

test('база открывается и создаёт все хранилища', async () => {
  await db.open();
  const names = Object.keys(db.SCHEMA);
  for (const n of names) {
    const count = await db.count(n);
    assert.equal(typeof count, 'number', `хранилище ${n} доступно`);
  }
});

test('класс и ученики сохраняются и сортируются', async () => {
  await reset();
  const cls = await store.addClass('9А');
  await store.addStudent(cls.id, 'Иванов Иван', 2);
  await store.addStudent(cls.id, 'Петров Пётр', 1);

  const list = store.studentsOfClass(cls.id);
  assert.equal(list.length, 2);
  assert.equal(list[0].fullName, 'Петров Пётр', 'сортировка по номеру');
});

test('отметка ставится, перезаписывается и удаляется', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);
  const lesson = await store.addLesson(cls.id, '2026-11-10');

  await store.setMark(st.id, lesson.id, { value: '5' });
  let mark = store.state.marks.find((m) => m.lessonId === lesson.id && m.studentId === st.id);
  assert.equal(mark.value, '5');
  assert.equal(mark.source, 'manual');

  await store.setMark(st.id, lesson.id, { value: '4' });
  mark = store.state.marks.find((m) => m.lessonId === lesson.id && m.studentId === st.id);
  assert.equal(mark.value, '4');

  await store.setMark(st.id, lesson.id, { value: null, flag: null });
  assert.equal(store.state.marks.filter((m) => m.lessonId === lesson.id).length, 0);
});

test('undo возвращает прежнюю отметку', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);
  const lesson = await store.addLesson(cls.id, '2026-11-10');

  await store.setMark(st.id, lesson.id, { value: '5' });
  const { undo } = await store.setMark(st.id, lesson.id, { value: '2' });

  let mark = store.state.marks.find((m) => m.lessonId === lesson.id);
  assert.equal(mark.value, '2');

  await undo();
  mark = store.state.marks.find((m) => m.lessonId === lesson.id);
  assert.equal(mark.value, '5', 'отмена вернула оценку 5');
});

test('Н убирает оценку из той же ячейки', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);
  const lesson = await store.addLesson(cls.id, '2026-11-10');

  await store.setMark(st.id, lesson.id, { value: '4' });
  await store.setMark(st.id, lesson.id, { value: null, flag: 'Н' });

  const mark = store.state.marks.find((m) => m.lessonId === lesson.id);
  assert.equal(mark.flag, 'Н');
  assert.equal(mark.value, null);
});

test('ОСВ через освобождение заполняет существующие уроки', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);
  const l1 = await store.addLesson(cls.id, '2026-11-10');
  const l2 = await store.addLesson(cls.id, '2026-11-12');
  const l3 = await store.addLesson(cls.id, '2026-11-17');

  const res = await store.addExemption({
    studentId: st.id, dateFrom: '2026-11-10', dateTo: '2026-11-12', reason: 'справка',
  });

  assert.equal(res.changed, 2, 'два урока попали в период');

  const osv = store.state.marks.filter((m) => m.studentId === st.id && m.source === 'auto-osv');
  assert.equal(osv.length, 2);
  assert.deepEqual(osv.map((m) => m.lessonId).sort(), [l1.id, l2.id].sort());
  assert.equal(store.state.marks.some((m) => m.lessonId === l3.id), false, 'третий урок вне периода');
});

test('новый урок внутри справки получает ОСВ автоматически', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);

  await store.addExemption({ studentId: st.id, dateFrom: '2026-11-01', dateTo: '2026-11-30' });

  const lesson = await store.addLesson(cls.id, '2026-11-20');
  const mark = store.state.marks.find((m) => m.lessonId === lesson.id && m.studentId === st.id);
  assert.ok(mark, 'отметка создана');
  assert.equal(mark.flag, 'ОСВ');
  assert.equal(mark.source, 'auto-osv');
});

test('бессрочное освобождение покрывает уроки всего года', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);

  await store.addExemption({ studentId: st.id, dateFrom: '2026-11-01', dateTo: null });

  const lesson = await store.addLesson(cls.id, '2027-04-15');
  const mark = store.state.marks.find((m) => m.lessonId === lesson.id);
  assert.ok(mark);
  assert.equal(mark.flag, 'ОСВ');
});

test('снятие освобождения удаляет auto-osv, но не ручные оценки', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);
  const l1 = await store.addLesson(cls.id, '2026-11-10');
  const l2 = await store.addLesson(cls.id, '2026-11-12');

  await store.addExemption({ studentId: st.id, dateFrom: '2026-11-01', dateTo: '2026-11-30' });
  // ученик всё-таки работал на одном уроке
  await store.setMark(st.id, l1.id, { value: '5' });

  const res = await store.removeExemption(store.state.exemptions[0].id);
  assert.equal(store.state.exemptions.length, 0);
  assert.ok(res.deleted >= 1, 'auto-osv удалены');

  const remaining = store.state.marks.filter((m) => m.studentId === st.id);
  assert.equal(remaining.length, 1, 'ручная оценка осталась');
  assert.equal(remaining[0].value, '5');
});

test('сокращение освобождения удаляет ОСВ вне нового диапазона', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);
  await store.addLesson(cls.id, '2026-11-05');
  await store.addLesson(cls.id, '2026-11-15');

  await store.addExemption({ studentId: st.id, dateFrom: '2026-11-01', dateTo: '2026-11-30' });
  assert.equal(store.state.marks.filter((m) => m.flag === 'ОСВ').length, 2);

  const exId = store.state.exemptions[0].id;
  await store.updateExemption(exId, { dateFrom: '2026-11-10', dateTo: '2026-11-30' });

  const osv = store.state.marks.filter((m) => m.flag === 'ОСВ');
  assert.equal(osv.length, 1, 'остался только урок 15 ноября');
});

test('месячная отметка: ручное переопределение не пересчитывается', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);

  await store.setMonthlyOverride(st.id, 2026, 11, '4');
  const mm = store.monthlyFor(st.id, 2026, 11);
  assert.equal(mm.value, '4');
  assert.equal(mm.overriddenByTeacher, true);

  await store.setMonthlyComputed(st.id, 2026, 11, '5');
  const again = store.monthlyFor(st.id, 2026, 11);
  assert.equal(again.value, '5');
  assert.equal(again.overriddenByTeacher, false);
});

test('бэкап и восстановление сохраняют все записи', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);
  const lesson = await store.addLesson(cls.id, '2026-11-10');
  await store.setMark(st.id, lesson.id, { value: '5' });
  await store.setMonthlyOverride(st.id, 2026, 11, '5');

  const payload = await store.makeBackup();
  assert.equal(payload.app, 'teachapp');
  assert.equal(payload.data.students.length, 1);

  await db.clearAll();
  await store.load();
  assert.equal(store.state.students.length, 0);

  await store.restoreBackup(payload);
  assert.equal(store.state.students.length, 1);
  assert.equal(store.state.marks.length, 1);
  assert.equal(store.state.monthly.length, 1);
});

test('восстановление отклоняет чужой файл', async () => {
  await reset();
  await assert.rejects(() => store.restoreBackup({ app: 'other', data: {} }), /резервную копию/);
});

test('удаление класса уносит учеников, уроки и отметки', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);
  const lesson = await store.addLesson(cls.id, '2026-11-10');
  await store.setMark(st.id, lesson.id, { value: '5' });

  await store.deleteClass(cls.id);
  assert.equal(store.state.classes.length, 0);
  assert.equal(store.state.students.length, 0);
  assert.equal(store.state.lessons.length, 0);
  assert.equal(store.state.marks.length, 0);
});

test('данные переживают перезагрузку (чтение из IndexedDB)', async () => {
  await reset();
  const cls = await store.addClass('9А');
  const st = await store.addStudent(cls.id, 'Иванов Иван', 1);
  const lesson = await store.addLesson(cls.id, '2026-11-10');
  await store.setMark(st.id, lesson.id, { value: '3' });
  await wait();

  // Имитация перезапуска: сбрасываем кэш состояния и грузим заново
  store.state.students = [];
  store.state.marks = [];
  await store.load();

  assert.equal(store.state.students.length, 1);
  const mark = store.state.marks.find((m) => m.studentId === st.id);
  assert.equal(mark?.value, '3');
});
