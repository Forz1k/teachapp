import 'fake-indexeddb/auto';
import * as store from '../js/store.js';
import * as db from '../js/db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {displayClassName,surnameAndName,canRepairLessonTopic,planLessonTopicRepair} from '../js/model.js';
test('class display and names',()=>{
  assert.equal(displayClassName('7_1'),'7-1');
  assert.equal(displayClassName('10'),'10');
  assert.equal(displayClassName('11'),'11');
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
  assert.equal(canRepairLessonTopic(lessons[1],[{lessonId:'b',source:'auto-osv',flag:'ОСВ',baseMark:null}],[],[]),true);
  assert.deepEqual(planLessonTopicRepair(lessons,[1,2,3,4].map(n=>({id:'t'+n})),['b','c','d']).map(x=>[x.id,x.topicId]),[['b','t2'],['c','t3'],['d','t4']]);
});

test('repair persists atomically, rejects a newly filled lesson, and leaves grades intact',async()=>{
  await db.clearAll();await store.load();
  const c=await store.addClass('7_1');
  const st=await store.addStudent(c.id,'Иванов Иван',1);
  const ktp=await store.addKtp({name:'План',classIds:[c.id]});
  await store.addTopic('Первая',1,ktp.id);await store.addTopic('Вторая',2,ktp.id);await store.addTopic('Третья',3,ktp.id);
  const [t1,t2,t3]=store.topicsForClass(c.id);
  const a=await store.addLesson(c.id,'2026-09-01',t1.id);
  const b=await store.addLesson(c.id,'2026-09-02');
  const d=await store.addLesson(c.id,'2026-09-03',t2.id);
  await store.setMark(st.id,a.id,{value:'5'});
  const changes=planLessonTopicRepair(store.lessonsOfClass(c.id),[t1,t2,t3],[b.id,d.id]);
  await store.repairLessonTopics(c.id,changes);
  await store.load();
  assert.deepEqual(store.lessonsOfClass(c.id).map(l=>l.topicId),[t1.id,t2.id,t3.id]);
  assert.equal(store.state.marks.find(m=>m.lessonId===a.id).value,'5');
  await store.setMark(st.id,b.id,{value:'4'});
  await assert.rejects(store.repairLessonTopics(c.id,[{id:d.id,date:d.date,previous:t3.id,topicId:null},{id:b.id,date:b.date,previous:t2.id,topicId:null}]),/Данные урока изменились/);
  await store.load();
  assert.deepEqual(store.lessonsOfClass(c.id).map(l=>l.topicId),[t1.id,t2.id,t3.id]);
});
