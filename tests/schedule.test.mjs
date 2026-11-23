import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, scheduleForDate } from '../js/model.js';
import * as store from '../js/store.js';

test('Расписание учитывает правки только на выбранную дату', () => {
  const date = '2026-11-23';
  const rules = [
    { id: 'a', weekday: 1, slot: 1, time: '08:00', classId: 'A' },
    { id: 'b', weekday: 1, slot: 2, time: '09:00', classId: 'B' },
  ];
  const changes = [
    { date, ruleId: 'a', action: 'cancel' },
    { date, ruleId: 'b', action: 'move', slot: 3, time: '10:00', classId: 'C' },
    { date, id: 'extra', action: 'add', slot: 1, time: '08:15', classId: 'D' },
  ];
  const slots = day => scheduleForDate(rules, changes, day).map(r => [r.slot, r.time, r.classId]);
  assert.deepEqual(slots(date), [[1, '08:15', 'D'], [3, '10:00', 'C']]);
  assert.deepEqual(slots('2026-11-30'), [[1, '08:00', 'A'], [2, '09:00', 'B']]);
  assert.equal(parseTime('8.15'), 495);
  assert.equal(parseTime('25:10'), null);
});

test('Привязки КТП и порядок тем сохраняются после загрузки и входят в копию', async () => {
  await store.load();
  const { id } = await store.addKtp({ name: 'План', classIds: ['a', 'b'] });
  await store.addTopic('Вторая', 2, id);
  await store.addTopic('Первая', 1, id);
  await store.load();
  for (const cls of ['a', 'b']) assert.deepEqual(store.topicsForClass(cls).map(t => t.name), ['Первая', 'Вторая']);
  assert.deepEqual(store.topicsForClass('c'), []);
  const { data } = await store.makeBackup();
  assert.deepEqual(data.ktp[0].classIds, ['a', 'b']);
  assert.equal(data.topics.filter(t => t.ktpId === id).length, 2);
});
