import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';
import * as H from '../js/health.js';

const date = '2026-11-24';
test('Наследование, несколько родителей, границы действия и неподтверждённые теги', () => {
  const r = { studentId:'s',activityId:'run',dateFrom:date,dateTo:date,type:'avoid' };
  const check = (tags,patch = {},day = date) => H.checkLessonRestrictions({
    lesson:{classId:'c',activityIds:tags,date:day},activities:H.catalog,
    students:[{id:'s',classId:'c'}], restrictions:[{...r,...patch}] });
  for (const tag of ['sprint','long','3x10']) assert.equal(check([tag]).matches.length,1);
  for (const patch of [{enabled:false},{activityId:'shuttle'},{studentId:'other'},{type:'no_test'}]) assert.equal(check(['sprint'],patch).matches.length,0);
  assert.equal(check(['3x10'],{type:'no_test',activityId:'test'}).matches.length,1);
  assert.equal(check(['sprint','test'],{type:'no_test'}).matches.length,1);
  assert.equal(check(['sprint'],{},'2026-11-25').matches.length,0);
  assert.equal(check(['sprint'],{},'2026-11-23').matches.length,0);
  assert.equal(check([]).needsReview,true);
  assert.equal(check(['missing']).needsReview,true);
  assert.equal(H.validPeriod('2026-02-31',null),false);
});

test('Группа, ограничения, тема и правка урока сохраняются и входят в копию', async () => {
  await S.load();
  const cls = await S.addClass('Класс'), s = await S.addStudent(cls.id,'Ученик',1);
  const topic = await S.addTopic('Тема',1), lesson = await S.addLesson(cls.id,date,topic.id);
  assert.equal(S.lessonCheck(lesson).needsReview,true);
  for (const group of ['Основная','Подготовительная']) await S.saveProfiles([s.id],group,date,null);
  assert.equal(S.state.studentHealthProfiles.length,1);
  assert.equal(S.state.studentHealthProfiles[0].group,'Подготовительная');
  const custom = await S.addActivity('Тестовое упражнение',['shuttle','test']);
  await S.updateTopic(topic.id,{activityIds:[custom.id]});
  assert.equal(S.lessonCheck(lesson).matches.length,0);
  for (const activityId of ['shuttle','test']) await S.saveRestriction({studentId:s.id,activityId,type:'no_test',dateFrom:date});
  assert.equal(S.lessonCheck(lesson).matches.length,2);
  await S.updateLesson(lesson.id,{activityIds:['jump']});
  assert.equal(S.lessonCheck(lesson).matches.length,0);
  await S.updateLesson(lesson.id,{activityIds:null});
  await S.saveParticipation(s.id,lesson.id,{mode:'adapted',basis:'document',alternative:H.alternatives[5],activityId:custom.id});
  assert.deepEqual(S.state.marks,[]);
  const backup = await S.makeBackup();
  await S.restoreBackup(backup);
  assert.equal(S.lessonCheck(S.state.lessons[0]).matches.length,2);
  assert.equal(S.state.studentHealthProfiles[0].group,'Подготовительная');
  assert.equal(S.state.participation[0].activityId,custom.id);
  assert.equal(S.state.participation[0].alternative,H.alternatives[5]);
  await S.deleteStudent(s.id); await S.load();
  assert.equal(S.state.activityRestrictions.length,0);
  assert.equal(S.state.studentHealthProfiles.length,0);
});
