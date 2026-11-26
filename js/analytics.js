/* Только вычисления и минимальные отчёты, без автоматического изменения оценок. */
import * as S from './store.js';
import * as M from './model.js';
import * as H from './health.js';
import {periodName} from './assessment.js';
const avg=a=>a.length?Math.round(a.reduce((s,v)=>s+v,0)/a.length*100)/100:null;
const grade=m=>m?.flag!=='Н'&&['1','2','3','4','5'].includes(String(m?.value))?Number(m.value):null;
export function schoolAnalytics(classId,from,to,studentId=null,today=M.todayIso()){
  const students=S.studentsOfClass(classId).filter(s=>!studentId||s.id===studentId);
  const ids=new Set(students.map(s=>s.id));
  const lessons=S.lessonsInRange(classId,from,to),allLessons=S.lessonsOfClass(classId);
  const attendance=S.attendanceContext(lessons,classId),allAttendance=S.attendanceContext(allLessons,classId);
  const held=lessons.filter(l=>l.date<=today&&attendance.held(l)),marks=attendance.marks;
  const finalByStudent=new Map(),names=new Map(students.map(s=>[s.id,s.fullName]));
  for(const r of S.state.finalGrades)if(r.from===from&&r.to===to&&!finalByStudent.has(r.studentId))finalByStudent.set(r.studentId,r);
  const valuesFor=(s,ls)=>ls.map(l=>grade(marks.get(l.id+'|'+s.id))).filter(x=>x!==null);
  const rows=students.map(s=>{
    const values=valuesFor(s,held),mean=avg(values),att=attendance.forStudents([s]);
    const final=finalByStudent.get(s.id);
    return {student:s,mean,count:values.length,suggested:mean===null?null:String(M.rawToMark(mean)),final:final?.value||null,att};
  });
  const trend=M.monthsInRange(from,to).map(({year,month})=>{
    const ls=held.filter(l=>M.yearOf(l.date)===year&&M.monthOf(l.date)===month);
    const v=students.flatMap(s=>valuesFor(s,ls));return {month:year+'-'+String(month).padStart(2,'0'),mean:avg(v),count:v.length};
  });
  const topics=S.topicsForClass(classId),done=new Set(allLessons.filter(l=>l.date<=today&&allAttendance.held(l)).map(l=>l.topicId));
  const counts=ls=>{const map=new Map();for(const l of ls)map.set(l.topicId,(map.get(l.topicId)||0)+1);return map;};
  const heldCounts=counts(held),plannedCounts=counts(lessons);
  const ktp=topics.map(t=>({name:t.name,done:done.has(t.id),inPeriod:heldCounts.get(t.id)||0,planned:plannedCounts.get(t.id)||0}));
  const participation={normal:0,adapted:0,paused:0,unrecorded:0};
  const heldIds=new Set(held.map(l=>l.id));
  for(const r of S.state.participation)if(ids.has(r.studentId)&&heldIds.has(r.lessonId))participation[r.mode]++;
  participation.unrecorded=held.length*students.length-participation.normal-participation.adapted-participation.paused;
  const norms=S.state.normResults.filter(r=>ids.has(r.studentId)&&r.status==='done'&&M.inRange(r.date,from,to)&&r.date<=today)
    .map(r=>({date:r.date,student:names.get(r.studentId)||'',name:r.definition.name,value:r.value,unit:r.definition.unit,grade:r.grade}));
  return {rows,trend,ktp,norms,participation,att:attendance.forStudents(students),held:held.length,lessons:lessons.length};
}
export function healthOverview(classId,today=M.todayIso()){
  const students=S.studentsOfClass(classId),ids=new Set(students.map(s=>s.id));
  const profiles=new Map(S.state.studentHealthProfiles.filter(p=>ids.has(p.id)).map(p=>[p.id,p]));
  const groups=Object.create(null),review=new Set(),activeIds=new Set();
  for(const s of students){
    const p=profiles.get(s.id);
    if(H.active(p,today)&&p.group)groups[p.group]=(groups[p.group]||0)+1;else review.add(s.id);
  }
  for(const r of S.state.activityRestrictions.filter(r=>ids.has(r.studentId)&&r.enabled!==false)){
    if(H.active(r,today))activeIds.add(r.studentId);
    if(r.dateTo&&r.dateTo<today)review.add(r.studentId);
  }
  return {groups:{...groups},withGroup:Object.values(groups).reduce((a,b)=>a+b,0),active:activeIds.size,review:review.size,total:students.length};
}
export function upcomingLessons(classId,start=M.todayIso(),days=14){
  const out=[],end=M.addDays(start,Math.min(60,Math.max(1,days))-1);
  for(let date=start;date<=end;date=M.addDays(date,1)){
    if((S.state.settings.holidays||[]).some(h=>M.inRange(date,h.from,h.to)))continue;
    const rows=S.scheduleForDate(date).filter(r=>r.classId===classId),existing=S.lessonsOfClass(classId).filter(l=>l.date===date&&!S.lessonHeld(l));
    if(!rows.length&&!existing.length)continue;
    // Отменённый шаблон не выдаём за будущий урок; внеплановая запись допустима.
    if(!rows.length&&S.state.schedule.some(r=>r.classId===classId&&r.weekday===M.weekdayOf(date)))continue;
    const l=existing[0]||{classId,date};const check=S.lessonCheck(l);
    out.push({date,time:rows.map(r=>r.time).filter(Boolean).join(', '),topic:S.state.topics.find(t=>t.id===l.topicId)?.name||'Не указана',
      matches:new Set(check.matches.map(m=>m.studentId)).size,needsReview:check.needsReview});
  }
  return out;
}
export function reportMatrix(kind,a,options={}){
  const name=r=>r.student.fullName, v=x=>x??'';
  if(kind==='class'||kind==='student')return [['ФИО','Оценок','Средний балл','Посещаемость, %','Отсутствия','Не отмечено','Итоговая оценка'],...a.rows.map(r=>[name(r),r.count,v(r.mean),v(r.att.pct),r.att.absent,r.att.unknown,v(r.final)])];
  if(kind==='ktp')return [['Тема','Проведено за весь план','Проведено за период','Уроков в периоде'],...a.ktp.map(r=>[r.name,r.done?'Да':'Нет',r.inPeriod,r.planned])];
  if(kind==='norms')return [['Дата','ФИО','Норматив','Результат','Единица','Оценка'],...a.norms.map(r=>[r.date,r.student,r.name,r.value,r.unit,v(r.grade)])];
  if(kind==='participation')return [['Режим','Записей'],['Обычная',a.participation.normal],['Облегчённая',a.participation.adapted],['Не выполнял упражнения',a.participation.paused],['Не отмечено',a.participation.unrecorded]];
  if(kind==='plan')return [['Дата','Время','Тема','Проверка нагрузки'],...(options.upcoming||[]).map(r=>[r.date,r.time,r.topic,options.includeWarnings?(r.matches?'Совпадений: '+r.matches:r.needsReview?'Требует проверки':'Нет внесённых совпадений'):''])];
  throw Error('Неизвестный отчёт');
}
