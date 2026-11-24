import test from 'node:test';
import assert from 'node:assert/strict';
import {displayClassName,surnameAndName,canRepairLessonTopic,planLessonTopicRepair} from '../js/model.js';
test('class display and names',()=>{
  assert.equal(displayClassName('7_1'),'7-1');
  assert.equal(displayClassName('7_А'),'7А');
  assert.equal(displayClassName(' 10 б '),'10Б');
  assert.equal(displayClassName('Сборная'),'Сборная');
  assert.equal(surnameAndName('Иванов Иван Иванович'),'Иванов Иван');
});
test('repair previews missing date and protects filled lessons',()=>{
  const lessons=[{id:'a',date:'2026-09-01',topicId:'t1',held:true},{id:'b',date:'2026-09-02',topicId:null},{id:'c',date:'2026-09-03',topicId:'t2'},{id:'d',date:'2026-09-04',topicId:'t3'}];
  assert.equal(canRepairLessonTopic(lessons[0],[],[],[]),false);
  assert.equal(canRepairLessonTopic(lessons[1],[{lessonId:'b',value:'5'}],[],[]),false);
  assert.equal(canRepairLessonTopic(lessons[1],[],[{lessonId:'b'}],[]),false);
  assert.equal(canRepairLessonTopic(lessons[1],[],[],[{lessonId:'b'}]),false);
  assert.equal(canRepairLessonTopic(lessons[1],[],[],[]),true);
  assert.deepEqual(planLessonTopicRepair(lessons,[1,2,3,4].map(n=>({id:'t'+n})),['b','c','d']).map(x=>[x.id,x.topicId]),[['b','t2'],['c','t3'],['d','t4']]);
});
