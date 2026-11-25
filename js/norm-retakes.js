import * as db from './db.js';
import {uid,todayIso,inRange} from './model.js';
import {validPeriod} from './health.js';
export const retakeStatuses={planned:'Запланировано',held:'Проведено — результат отдельно',cancelled:'Отменено'};
const str=(x,max=200)=>typeof x==='string'&&x.length>0&&x.length<=max;
const require=(ok,msg)=>{if(!ok)throw Error(msg);};
export function validateNormRetake(r){
 require(r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).sort().join(',')==='assignmentId,date,id,kind,revision,status,studentId,time'&&r.kind==='normRetake'&&str(r.id)&&str(r.assignmentId)&&str(r.studentId)&&validPeriod(r.date,null)&&typeof r.time==='string'&&(r.time===''||/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time))&&Object.hasOwn(retakeStatuses,r.status)&&Number.isInteger(r.revision)&&r.revision>=0&&r.revision<=1000000,'Проверьте дату, время и статус пересдачи');
 require(r.status!=='held'||r.date<=todayIso(),'Нельзя подтвердить проведение в будущем');return r;
}
export async function saveNormRetake(input){
 return db.transaction(['workRecords','students','meta'],'readwrite',async s=>{
  const old=input.id?await s.workRecords.get(input.id):null;
  require(!input.id||old?.kind==='normRetake'&&old.revision===input.revision&&old.assignmentId===input.assignmentId&&old.studentId===input.studentId,'Запись изменилась. Откройте заново');
  const a=await s.workRecords.get(input.assignmentId),student=await s.students.get(input.studentId),settings=await s.meta.get('settings');
  require(a?.kind==='normAssignment'&&student?.classId===a.classId&&(!a.studentIds||a.studentIds.includes(student.id)),'Назначение или ученик недоступны');
  require(!settings?.year||settings.year.from===a.yearFrom&&settings.year.to===a.yearTo,'Назначение относится к архивному году');
  require(inRange(input.date,a.from,a.yearTo),'Дата должна быть в учебном году, не раньше назначения');
  const row={...input,id:input.id||uid('retake'),kind:'normRetake',revision:old?old.revision+1:0};validateNormRetake(row);
  const rows=await s.workRecords.index('kind').getAll('normRetake');
  require(row.status!=='planned'||!rows.some(r=>r.id!==row.id&&r.assignmentId===row.assignmentId&&r.studentId===row.studentId&&r.status==='planned'),'У этого ученика уже запланирована пересдача');
  await s.workRecords.put(row);return row;
 });
}
export function normRetakeCalendar(rows,from,to){
 return rows.filter(r=>r.status!=='cancelled'&&inRange(r.date,from,to)).map(r=>({id:'retake-'+r.id,source:'normRetake',date:r.date,time:r.time,minutes:0,title:'Повторная сдача норматива · проверить нагрузку',exportTitle:'Проверка учебного задания',done:r.status==='held',remind:1440,retakeId:r.id}));
}
