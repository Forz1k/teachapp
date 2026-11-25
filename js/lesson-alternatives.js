import * as db from './db.js';
import {todayIso,exemptionCovers} from './model.js';
import {catalog,validPeriod,checkLessonRestrictions} from './health.js';
export const alternativeStatuses={planned:'Запланировано',completed:'Выполнено (подтверждено)',cancelled:'Отменено'};
export const alternativeTypes={theory:'Теоретическое / наблюдение',exercise:'Адаптированное упражнение'};
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const text=(x,n=200)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
const key=(lessonId,studentId)=>'alternative:'+JSON.stringify([lessonId,studentId]);
export function validateLessonAlternative(r){
 check(r&&Object.keys(r).sort().join(',')==='activityId,classId,date,id,kind,lessonId,revision,status,studentId,task,type'&&r.kind==='lessonAlternative'&&[r.id,r.lessonId,r.studentId,r.classId].every(x=>text(x))&&r.id===key(r.lessonId,r.studentId)&&validPeriod(r.date,null)&&Object.hasOwn(alternativeTypes,r.type)&&text(r.task,2000)&&Object.hasOwn(alternativeStatuses,r.status)&&Number.isSafeInteger(r.revision)&&r.revision>=0&&r.revision<=1000000&&(r.type==='theory'?r.activityId===null:text(r.activityId)),'Проверьте альтернативное задание');
 check(r.status!=='completed'||r.date<=todayIso(),'Нельзя подтвердить будущее выполнение');return r;
}
export async function saveLessonAlternative(input,confirmed=false){
 check(confirmed,'Подтвердите задание и проверку актуальных ограничений');
 return db.transaction(['workRecords','lessons','students','activityCategories','activityRestrictions','exemptions'],'readwrite',async s=>{
  const id=key(input.lessonId,input.studentId),old=await s.workRecords.get(id),lesson=await s.lessons.get(input.lessonId),student=await s.students.get(input.studentId);
  check(lesson&&student?.classId===lesson.classId&&lesson.date===input.date,'Урок или ученик изменились. Откройте заново');
  check(old?old.kind==='lessonAlternative'&&old.revision===input.revision:input.revision==null,'Задание изменилось. Откройте заново');
  check(input.status!=='cancelled'||old,'Сначала создайте задание');
  if(input.type==='exercise'&&input.status!=='cancelled'){
   const [custom,restrictions,exemptions]=await Promise.all([s.activityCategories.getAll(),s.activityRestrictions.index('studentId').getAll(student.id),s.exemptions.index('studentId').getAll(student.id)]);
   check(!exemptions.some(e=>exemptionCovers(e,lesson.date)),'Действует освобождение: физическое задание не сохраняется');
   const review=checkLessonRestrictions({lesson:{...lesson,activityIds:[input.activityId],activitiesConfirmed:true},students:[student],activities:[...catalog,...custom],restrictions});
   check(!review.needsReview&&!review.matches.length&&!review.potentialMatches.length,'Есть действующее или возможное ограничение / неизвестная нагрузка. Уточните задание');
  }
  const row=validateLessonAlternative({id,kind:'lessonAlternative',lessonId:lesson.id,studentId:student.id,classId:lesson.classId,date:lesson.date,type:input.type,activityId:input.type==='theory'?null:input.activityId,task:typeof input.task==='string'?input.task.trim():'',status:input.status,revision:old?old.revision+1:0});
  await s.workRecords.put(row);return row;
 });
}
export async function lessonAlternatives(lessonId){
 const rows=await db.transaction(['workRecords'],'readonly',s=>s.workRecords.index('kind').getAll('lessonAlternative'));
 return rows.filter(r=>r.lessonId===lessonId);
}
