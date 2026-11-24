import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';
import * as store from '../js/store.js';

const full = { mode: 'paused', basis: 'document', full: true };
const note = { mode: 'adapted', basis: 'parent' };

test('Обновление базы v2 сохраняет архив и добавляет уникальный индекс участия', async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('teachapp', 2);
    req.onupgradeneeded = () => {
      for (const [name, def] of Object.entries(db.SCHEMA)) {
        if (name === 'participation') continue;
        const s = req.result.createObjectStore(name, { keyPath: def.keyPath });
        for (const index of def.indexes) s.createIndex(...index);
        if (name === 'monthly') s.put({ id: 'archive', studentId: 'old', year: 2025, month: 11, value: '5' });
      }
    };
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  });
  const database = await db.open();
  assert.equal(database.transaction('participation').objectStore('participation').index('studentLesson').unique, true);
  assert.equal((await db.get('monthly', 'archive')).value, '5');
});

test('Участие, основание, отмена и восстановление из копии', async () => {
  await store.load();
  const cls = await store.addClass('Тест');
  const { id: studentId } = await store.addStudent(cls.id, 'Ученик', 1);
  const lesson = await store.addLesson(cls.id, '2026-11-20');
  const other = await store.addLesson(cls.id, '2026-11-21');
  const save = data => store.saveParticipation(studentId, lesson.id, data);
  const mark = () => store.markMap(cls.id).get(lesson.id + '|' + studentId);
  await save(note);
  assert.equal(mark(), undefined);
  await assert.rejects(save({ ...note, full: true }));
  await store.setMark(studentId, lesson.id, { value: '5', weight: 2 });
  const undo = await save(full);
  await store.load();
  assert.equal(store.state.participation.length, 1);
  assert.equal(mark().id, store.state.participation[0].markId);
  assert.equal(mark().flag, 'ОСВ');
  assert.equal(mark().weight, 2);
  assert.equal(store.state.marks.some(m => m.lessonId === other.id), false);
  await undo();
  assert.equal(mark().value, '5');
  assert.equal(mark().flag, null);
  assert.equal(store.state.participation[0].basis, 'parent');
  await save(full);
  const backup = await store.makeBackup();
  await store.restoreBackup(backup);
  assert.equal(mark().participationId, store.state.participation[0].id);
  const { exemption } = await store.addExemption({ studentId, dateFrom: lesson.date, dateTo: lesson.date });
  await store.removeExemption(exemption.id);
  assert.equal(mark().flag, 'ОСВ');
  await save(null);
  assert.equal(mark().value, '5');
  assert.equal(mark().flag, null);
  await save(note);
  await store.deleteLesson(lesson.id);
  await store.load();
  assert.equal(store.state.participation.length, 0);
});
