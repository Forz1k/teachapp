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

test('Последовательные правки шаблонного и добавленного урока переживают перезагрузку',async () => {
  const date = '2026-11-23';
  const a = await store.addClass('А'), b = await store.addClass('Б');
  const rule = await store.setScheduleEntry({weekday:1,slot:1,classId:a.id,time:'08:00'});
  for (const start of [{ruleId:rule.id,action:'move'},{ruleId:null,action:'add',classId:a.id,slot:3}]) {
    const row = await store.setScheduleOverride({date,...start,time:'09:30'});
    await store.setScheduleOverride({id:row.id,date,action:start.action,slot:2});
    await store.setScheduleOverride({id:row.id,date,action:start.action,classId:b.id});
    await store.load();
    const edited = store.scheduleForDate(date).find(r => r.override?.id === row.id);
    assert.deepEqual([edited.slot,edited.time,edited.classId],[2,'09:30',b.id]);
  }
});

test('Планирование учитывает каникулы, отмены и добавленные уроки',async () => {
  const {planLessonDates} = await import('../js/model.js');
  const result = planLessonDates({classId:'a',from:'2026-11-23',to:'2026-12-08',
    rules:[{id:'mon',weekday:1,classId:'a'}],holidays:[{from:'2026-11-30',to:'2026-12-02'}],
    overrides:[{date:'2026-11-23',ruleId:'mon',action:'cancel'},{date:'2026-11-24',classId:'a',action:'add'}]});
  assert.deepEqual(result,['2026-11-24','2026-12-07']);
});

test('Перенос темы сохраняет ручные теги и оставляет проведённый урок на месте',async () => {
  const cls = await store.addClass('План');
  const topic = await store.addTopic('Бег',1);
  const a = await store.addLesson(cls.id,'2025-01-10',topic.id);
  const b = await store.addLesson(cls.id,'2025-01-12');
  await store.updateLesson(a.id,{activityIds:['sprint']});
  await store.transferTopic(a.id,b.id);
  await store.load();
  const target = store.state.lessons.find(l => l.id === b.id);
  assert.deepEqual([target.topicId,target.activityIds],[topic.id,['sprint']]);
  await store.updateLesson(b.id,{held:true});
  assert.equal(store.lessonHeld(target),true);
  await assert.rejects(store.transferTopic(b.id,a.id),/проведён/);
});
