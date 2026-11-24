import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';
import * as S from '../js/store.js';
import * as A from '../js/analytics.js';
import * as P from '../js/privacy.js';
import * as R from '../js/retention.js';
async function seed(){
 await db.clearAll();await S.load();
 const c=await S.addClass('9А'),s=await S.addStudent(c.id,'Тест',1);
 await S.saveSettings({year:{from:'2025-09-01',to:'2026-05-31'},trimesters:[{id:'old',name:'Период',kind:'custom',from:'2025-09-01',to:'2025-12-31'}]});
 const l=await S.addLesson(c.id,'2025-11-01');await S.setMark(s.id,l.id,{value:'5'});return {c,s,l};
}
test('Итоговая оценка независима от уроков, сохраняется в копии и удаляется с учеником',async()=>{
 const {c,s}=await seed();await assert.rejects(S.saveFinalGrade(s.id,'old','4'),/Подтвердите/);
 await S.saveFinalGrade(s.id,'old','4',true);
 const a=A.schoolAnalytics(c.id,'2025-09-01','2025-12-31');assert.equal(a.rows[0].mean,5);assert.equal(a.rows[0].final,'4');
 assert.equal(S.state.marks[0].value,'5');
 const backup=await S.makeBackup();assert.equal(backup.version,12);await S.restoreBackup(backup);assert.equal(S.state.finalGrades.length,1);
 await S.deleteStudent(s.id);assert.equal(S.state.finalGrades.length,0);
 await S.restoreBackup(backup);await S.deleteClass(c.id);assert.equal(S.state.finalGrades.length,0);
 const old=structuredClone(backup);old.version=4;delete old.data.finalGrades;await S.restoreBackup(old);assert.equal(S.state.finalGrades.length,0);
});
test('Шифрование AES-GCM: восстановление, неверный пароль и изменение файла',async()=>{
 const {s}=await seed();const backup=await S.makeBackup(),password='test-password-12345';
 const sealed=await P.encryptBackup(backup,password);assert.ok(P.isEncryptedBackup(sealed));assert.equal(JSON.stringify(sealed).includes(s.fullName),false);
 assert.deepEqual(await P.decryptBackup(sealed,password),backup);
 await assert.rejects(P.decryptBackup(sealed,'wrong-password'),/неверный пароль/);
 const corrupt={...sealed,data:(sealed.data[0]==='A'?'B':'A')+sealed.data.slice(1)};
 await assert.rejects(P.decryptBackup(corrupt,password),/повреждён/);
 await S.restoreBackup(await P.decryptBackup(sealed,password));assert.equal(S.state.students.length,1);
});
test('Сводка и отчёты не включают медицинскую группу; истёкшие сведения удаляются только явно',async()=>{
 const {c,s}=await seed();
 await S.saveProfiles([s.id],'Основная','2020-01-01','2020-02-01');
 await S.saveRestriction({studentId:s.id,activityId:'run',type:'avoid',dateFrom:'2020-01-01',dateTo:'2020-02-01'});
 await S.saveRestriction({studentId:s.id,activityId:'jump',type:'avoid',dateFrom:'2020-01-01',dateTo:null});
 const health=A.healthOverview(c.id);assert.equal(health.active,1);assert.equal(health.review,1);
 const a=A.schoolAnalytics(c.id,'2025-09-01','2025-12-31');assert.equal(JSON.stringify(A.reportMatrix('class',a)).includes('Основная'),false);
 const preview=await R.retentionPreview(365);assert.equal(preview.profiles,1);assert.equal(preview.restrictions,1);
 await assert.rejects(R.purgeExpired(365),/Подтвердите/);await R.purgeExpired(365,true,preview);
 assert.equal(S.state.studentHealthProfiles.length,0);assert.equal(S.state.activityRestrictions.length,1);assert.equal(S.state.marks.length,1);
});
