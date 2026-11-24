import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';
import * as S from '../js/store.js';
import { readBackupFile } from '../js/export.js';
import { seedDemo } from '../js/demo.js';

async function seed() {
  await db.clearAll(); await S.load();
  const cls = await S.addClass('Тест');
  const student = await S.addStudent(cls.id,'Ученик',1);
  const lesson = await S.addLesson(cls.id,'2026-11-24');
  await S.setMark(student.id,lesson.id,{value:'5'});
  return S.makeBackup();
}
test('Повреждение, неизвестная версия, утраченные связи и неполная копия сохраняют рабочую базу',async () => {
  const backup = await seed();
  const before = await db.dumpAll();
  const edits = [
    p => {p.version = 50;}, p => {delete p.data.participation;},
    p => {p.data = {};}, p => {p.data.students[0].classId = 'missing';},
    p => {p.data.marks[0].lessonId = 'missing';}, p => {p.data.classes.push(p.data.classes[0]);},
    p => {p.data.meta = [{id:'settings',trimesters:[null]}];},
    p => {p.data.marks.push({...p.data.marks[0],id:'second'});},
  ];
  for (const edit of edits) {
    const damaged = structuredClone(backup); edit(damaged);
    await assert.rejects(S.restoreBackup(damaged));
    assert.deepEqual(await db.dumpAll(),before);
    assert.equal(S.state.marks[0].value,'5');
  }
  await assert.rejects(readBackupFile(new Blob(['{broken'])),/JSON/);
});

test('Сбой после очистки хранилищ откатывает замену целиком',async t => {
  const backup = await seed();
  const before = await db.dumpAll();
  const original = IDBObjectStore.prototype.add;
  t.mock.method(IDBObjectStore.prototype,'add',function(row) {
    if (this.name === 'marks') throw new DOMException('Quota','QuotaExceededError');
    return original.call(this,row);
  });
  backup.data.classes[0].name = 'Другой класс';
  await assert.rejects(S.restoreBackup(backup),/Недостаточно места/);
  assert.deepEqual(await db.dumpAll(),before);
  assert.equal(S.state.classes[0].name,'Тест');
});

test('Копия первого формата восстанавливается без новых хранилищ',async () => {
  const backup = await seed();
  backup.version = 1;
  for (const name of ['participation','studentHealthProfiles','activityCategories','activityRestrictions','ktp','schedule','scheduleOverrides']) delete backup.data[name];
  await S.addClass('Временный');
  await S.restoreBackup(backup);
  assert.deepEqual(S.state.classes.map(c => c.name),['Тест']);
  assert.equal(S.state.marks[0].value,'5');
  assert.deepEqual(S.state.participation,[]);
  assert.equal(S.state.lastBackupAt,null);
});

test('Создание файла и перенос напоминания не меняют дату подтверждённой копии',async () => {
  await seed();
  const last = '2026-11-01T00:00:00Z';
  await S.saveSettings({lastBackupAt:last});
  await S.makeBackup();
  await S.saveSettings({backupReminderAfter:'2026-11-25T00:00:00Z'});
  await S.load();
  assert.equal(S.state.lastBackupAt,last);
});

test('Полная копия демонстрационного журнала проходит восстановление',async () => {
  await db.clearAll(); await S.load();
  await seedDemo({});
  const backup = await S.makeBackup();
  await S.restoreBackup(backup);
  assert.deepEqual(await db.dumpAll(),backup.data);
});


test('КТП: диагностика и точечное исправление без удаления тем, уроков и оценок',async()=>{
 await seed();const cls=S.state.classes[0],ktp=await S.addKtp({name:'Синтетический план',classIds:[cls.id]});
 const topic=await S.addTopic('Синтетическая тема',1,ktp.id);
 await db.put('ktp',{...ktp,classIds:[cls.id,'missing']});
 const damaged=await db.dumpAll(),row=damaged.ktp[0];
 const {ktpLinkIssues,validateBackup,BACKUP_VERSION}=await import('../js/backup.js');
 assert.equal(ktpLinkIssues(damaged)[0].invalidCount,1);
 assert.throws(()=>validateBackup({app:'teachapp',version:BACKUP_VERSION,data:damaged}),/разделе ktp/);
 await assert.rejects(S.repairKtpPlan(row,ktp.name,[cls.id]),/Подтвердите/);
 await assert.rejects(S.repairKtpPlan(row,ktp.name,['missing'],true),/существующие/);
 assert.deepEqual(await db.dumpAll(),damaged);
 await S.repairKtpPlan(row,ktp.name,[cls.id],true);
 const repaired=await db.dumpAll();assert.equal(ktpLinkIssues(repaired).length,0);
 assert.equal(repaired.topics[0].id,topic.id);assert.deepEqual(repaired.lessons,damaged.lessons);assert.deepEqual(repaired.marks,damaged.marks);
 assert.doesNotThrow(()=>validateBackup({app:'teachapp',version:BACKUP_VERSION,data:repaired}));
 await assert.rejects(S.repairKtpPlan(row,ktp.name,[cls.id],true),/изменилось/);
});
