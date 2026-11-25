/* Local school work review. Read-only calculations; no inferred medical clearance. */
import * as M from './model.js';
import {attendanceDetails} from './assessment.js';
import {validPeriod} from './health.js';
import {assignmentOverview} from './school-tools.js';
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const key=(l,s)=>l.id+'|'+s.id;
function indexes(s){
 const pupils=new Map(),marks=new Map(),parts=new Map();
 for(const p of s.students){if(!pupils.has(p.classId))pupils.set(p.classId,[]);pupils.get(p.classId).push(p);}
 for(const m of s.marks)marks.set(m.lessonId+'|'+m.studentId,m);
 for(const p of s.participation)parts.set(p.lessonId+'|'+p.studentId,p);
 return {pupils,marks,parts};
}
function held(l,index,today){return attendanceDetails([l],index.pupils.get(l.classId)||[],index.marks,index.parts,today).held>0;}
export function workloadReview(s,{from,to,today=M.todayIso(),events=[]}){
 check(validPeriod(from,to)&&to&&to<=M.addDays(from,370),'Выберите период не длиннее 371 дня');
 const ids=new Set(s.classes.map(c=>c.id)),idx=indexes(s),lessonsByDate=new Map(),overridesByDate=new Map();
 for(const l of s.lessons)if(M.inRange(l.date,from,to)&&ids.has(l.classId)){if(!lessonsByDate.has(l.date))lessonsByDate.set(l.date,[]);lessonsByDate.get(l.date).push(l);}
 for(const o of s.scheduleOverrides||[])if(M.inRange(o.date,from,to)){if(!overridesByDate.has(o.date))overridesByDate.set(o.date,[]);overridesByDate.get(o.date).push(o);}
 const rows=[];
 for(let date=from;date<=to;date=M.addDays(date,1)){
  const records=lessonsByDate.get(date)||[],overrides=overridesByDate.get(date)||[],inYear=M.inRange(date,s.settings.year.from,s.settings.year.to);
  const holiday=M.isSchoolHoliday(date,s.settings.holidays||[]),base=inYear&&!holiday?M.scheduleForDate(s.schedule,[],date).filter(r=>ids.has(r.classId)):[],effective=inYear&&!holiday?M.scheduleForDate(s.schedule,overrides,date).filter(r=>ids.has(r.classId)):[];
  const map=M.matchScheduledLessons(effective,records),matched=new Set([...map.values()].map(l=>l.id)),effectiveIds=new Set(effective.map(r=>r.id));
  const planned=effective.length,confirmed=records.filter(l=>l.date<=today&&l.held).length,inferred=records.filter(l=>!l.held&&held(l,idx,today)).length;
  const missing=date<=today?effective.filter(r=>!map.has(r.id)).length:0;
  const unconfirmed=date<=today?records.filter(l=>!held(l,idx,today)).length:0;
  const row={date,template:base.length,planned,confirmed,inferred,missing,unconfirmed,cancelled:base.filter(r=>!effectiveIds.has(r.id)).length,added:effective.filter(r=>r.override?.action==='add').length,substitutions:effective.filter(r=>r.override?.action==='move'&&base.some(b=>b.id===r.id&&b.classId!==r.classId)).length,extra:records.filter(l=>!matched.has(l.id)&&held(l,idx,today)).length,holiday};
  if(row.template||row.planned||records.length||holiday)rows.push(row);
 }
 const total=Object.fromEntries(['template','planned','confirmed','inferred','missing','unconfirmed','cancelled','added','substitutions','extra'].map(k=>[k,rows.reduce((n,r)=>n+r[k],0)]));
 const additional=events.filter(e=>M.inRange(e.date,from,to)&&['competition','training','other'].includes(e.eventType)).map(e=>({date:e.date,name:e.name,kind:e.eventType,minutes:e.minutes,done:e.done}));
 return {from,to,rows,total,additional};
}
export function periodReview(s,{classId,period,assignments=[],today=M.todayIso()}){
 check(s.classes.some(c=>c.id===classId)&&validPeriod(period?.from,period?.to)&&period.to,'Выберите класс и период');
 return reviewClassPeriod(s,{classId,period,assignments,today},indexes(s));
}
function reviewClassPeriod(s,{classId,period,assignments,today},idx){
 const pupils=idx.pupils.get(classId)||[],lessons=M.sortLessons(s.lessons.filter(l=>l.classId===classId&&M.inRange(l.date,period.from,period.to))),confirmed=lessons.filter(l=>held(l,idx,today));
 // Once the class has evidence of a held lesson, every pupil's empty row is unknown,
 // even when the only evidence belongs to another pupil.
 const attendanceLessons=confirmed.map(l=>l.held?l:{...l,held:true});
 const lessonIssues=lessons.filter(l=>l.date<=today).map(l=>{
  const a=attendanceDetails([l],pupils,idx.marks,idx.parts,today);
  return {lesson:l,unconfirmed:!l.held,unknown:a.unknown,inferred:!l.held&&a.held>0};
 }).filter(r=>r.unconfirmed||r.unknown);
 const results=pupils.map(student=>{
  let numerator=0,denominator=0,count=0;
  for(const l of confirmed){const m=idx.marks.get(key(l,student));if(m?.flag==='Н'||M.hasOsv(m)||!['1','2','3','4','5'].includes(String(m?.value)))continue;const w=m.weight===2?2:1;numerator+=Number(m.value)*w;denominator+=w;count++;}
  const mean=denominator?numerator/denominator:null;
  const att=attendanceDetails(attendanceLessons,[student],idx.marks,idx.parts,today);
  const final=s.finalGrades.find(r=>r.studentId===student.id&&r.from===period.from&&r.to===period.to)?.value??null;
  return {student,count,weight:denominator,mean,suggested:mean===null?null:String(M.rawToMark(mean)),unknown:att.unknown,absent:att.absent,final};
 });
 const tasks=assignments.filter(a=>a.classId===classId&&a.from<=period.to&&a.to>=period.from).map(a=>({id:a.id,name:a.name,from:a.from,to:a.to,...assignmentOverview(s,a,today)}));
 return {ended:period.to<=today,lessons:lessons.length,held:confirmed.length,explicitlyHeld:confirmed.filter(l=>l.held).length,unconfirmed:lessonIssues.filter(x=>x.unconfirmed).length,inferred:lessonIssues.filter(x=>x.inferred).length,future:lessons.filter(l=>l.date>today).length,unknown:results.reduce((n,r)=>n+r.unknown,0),withoutGrades:results.filter(r=>!r.count).length,withoutFinal:results.filter(r=>r.final===null).length,results,tasks,lessonIssues};
}
/** Missing slots through today, respecting holidays, substitutions and legacy
 * lesson IDs. Schedule is evidence to review, not proof a lesson occurred. */
export function periodMissingLessons(s,period,today=M.todayIso()){
 check(validPeriod(period?.from,period?.to)&&period.to&&period.to<=M.addDays(period.from,370),'Выберите учебный период не длиннее 371 дня');
 const classes=new Set(s.classes.map(c=>c.id)),byDate=new Map(),overrides=new Map(),result=[];
 const from=period.from>s.settings.year.from?period.from:s.settings.year.from;
 const to=[period.to,today,s.settings.year.to].sort()[0];
 for(const l of s.lessons)if(M.inRange(l.date,from,to)){if(!byDate.has(l.date))byDate.set(l.date,[]);byDate.get(l.date).push(l);}
 for(const o of s.scheduleOverrides||[])if(M.inRange(o.date,from,to)){if(!overrides.has(o.date))overrides.set(o.date,[]);overrides.get(o.date).push(o);}
 for(let date=from;date<=to;date=M.addDays(date,1)){
  if(M.isSchoolHoliday(date,s.settings.holidays||[]))continue;
  const rows=M.scheduleForDate(s.schedule||[],overrides.get(date)||[],date).filter(r=>classes.has(r.classId));
  const matched=M.matchScheduledLessons(rows,byDate.get(date)||[]);
  for(const r of rows)if(!matched.has(r.id))result.push({id:r.id,classId:r.classId,date,slot:r.slot,time:r.time||''});
 }
 return result;
}
export const periodIssueLabels={missing:'Слоты без записи',unconfirmed:'Уроки без явного подтверждения',unknown:'Неизвестная явка (ученик × урок)',withoutGrades:'Ученики без оценок',withoutFinal:'Ученики без итогов',normPending:'Нормативы к сроку (ученик × назначение)',normReview:'Нормативы: проверить основания / шкалы',normUnavailable:'Недоступные назначения'};
export function schoolPeriodOverview(s,{period,assignments=[],today=M.todayIso()}){
 const missing=periodMissingLessons(s,period,today),idx=indexes(s),ended=period.to<=today,started=period.from<=today;
 const rows=s.classes.map(cls=>{
  const review=reviewClassPeriod(s,{classId:cls.id,period,assignments,today},idx);
  const slots=missing.filter(r=>r.classId===cls.id);
  // Only assignments whose deadline lies in this period and is reached are
  // counted as due. Review candidates remain distinct from overdue work.
  const due=review.tasks.filter(t=>t.to<=period.to&&t.to<=today&&!['archive','upcoming'].includes(t.state));
  const stats={missing:slots.length,unconfirmed:review.unconfirmed,unknown:review.unknown,withoutGrades:review.withoutGrades,withoutFinal:review.withoutFinal,
   normPending:due.reduce((n,t)=>n+t.pending,0),normReview:due.reduce((n,t)=>n+t.review,0),normUnavailable:due.filter(t=>t.state==='unavailable').length};
  const issues=Object.keys(stats).filter(k=>stats[k]>0&&(ended||!['withoutGrades','withoutFinal'].includes(k)));
  const status=!started?'future':!review.results.length?'empty':issues.length?'review':!ended?'progress':!review.held?'noLessons':'ready';
  return {classId:cls.id,name:cls.name,pupils:review.results.length,held:review.held,explicitlyHeld:review.explicitlyHeld,stats,issues,status};
 }).sort((a,b)=>Number(b.status==='review')-Number(a.status==='review')||a.name.localeCompare(b.name,'ru',{numeric:true}));
 const total=Object.fromEntries(Object.keys(periodIssueLabels).map(k=>[k,rows.reduce((n,r)=>n+r.stats[k],0)]));
 return {period,ended,started,rows,total,ready:rows.filter(r=>r.status==='ready').length,needsReview:rows.filter(r=>r.status==='review').length,withoutData:rows.filter(r=>['empty','noLessons'].includes(r.status)).length};
}
export function ktpForecast(s,classId,topics,today=M.todayIso()){
 const idx=indexes(s),lessons=s.lessons.filter(l=>l.classId===classId),done=new Set(lessons.filter(l=>held(l,idx,today)).map(l=>l.topicId).filter(Boolean)),remaining=topics.filter(t=>!done.has(t.id)),from=today>s.settings.year.from?today:s.settings.year.from,to=s.settings.year.to;
 const planned=from<=to?M.planLessonEntries({classId,from,to,rules:s.schedule,overrides:s.scheduleOverrides,holidays:s.settings.holidays||[],days:new Set()}):[];
 const missing=M.missingLessonEntries(planned,lessons);
 const scheduled=planned.length,available=missing.length+lessons.filter(l=>M.inRange(l.date,from,to)&&!held(l,idx,today)).length;
 return {total:topics.length,completed:topics.filter(t=>done.has(t.id)).length,remaining:remaining.length,scheduled,available,shortfall:Math.max(0,remaining.length-available),unassigned:remaining.filter(t=>!lessons.some(l=>l.date>=from&&l.topicId===t.id&&!held(l,idx,today))).map(t=>t.name)};
}

/** Read-only proposal. Preserve every existing assigned topic and every lesson
 * with any mark, attendance, test result, or explicit confirmation. */
export function ktpRedistribution(s,classId,topics,today=M.todayIso()){
 const lessons=s.lessons.filter(l=>l.classId===classId),idx=indexes(s),year=s.settings.year,from=today>year.from?today:year.from;
 const locked=new Set([...s.marks,...s.participation,...(s.normResults||[])].map(r=>r.lessonId));
 const covered=new Set(lessons.filter(l=>l.topicId&&(held(l,idx,today)||l.held||locked.has(l.id)||l.date>=from)).map(l=>l.topicId));
 const missing=topics.filter(t=>!covered.has(t.id));
 const eligible=from<=year.to?M.planLessonEntries({classId,from,to:year.to,rules:s.schedule,overrides:s.scheduleOverrides,holidays:s.settings.holidays||[],days:new Set()}):[];
 const free=M.missingLessonEntries(eligible,lessons).map(r=>({...r,lessonId:null}));
 const existing=M.sortLessons(lessons.filter(l=>l.date>=from&&l.date<=year.to&&!l.topicId&&!l.held&&!locked.has(l.id)&&!M.isSchoolHoliday(l.date,s.settings.holidays||[]))).map(l=>({...l,lessonId:l.id}));
 const slots=[...free,...existing].sort((a,b)=>a.date.localeCompare(b.date)||(a.slot??0)-(b.slot??0));
 return {rows:missing.slice(0,slots.length).map((topic,i)=>({topicId:topic.id,topic:topic.name,date:slots[i].date,slot:slots[i].slot??null,time:slots[i].time||'',lessonId:slots[i].lessonId})),unplaced:missing.slice(slots.length).map(t=>({id:t.id,name:t.name})),covered:topics.filter(t=>covered.has(t.id)).length};
}
