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
 const idx=indexes(s),pupils=idx.pupils.get(classId)||[],lessons=M.sortLessons(s.lessons.filter(l=>l.classId===classId&&M.inRange(l.date,period.from,period.to))),confirmed=lessons.filter(l=>held(l,idx,today));
 const results=pupils.map(student=>{
  let numerator=0,denominator=0,count=0;
  for(const l of confirmed){const m=idx.marks.get(key(l,student));if(m?.flag==='Н'||M.hasOsv(m)||!['1','2','3','4','5'].includes(String(m?.value)))continue;const w=m.weight===2?2:1;numerator+=Number(m.value)*w;denominator+=w;count++;}
  const mean=denominator?numerator/denominator:null;
  const att=attendanceDetails(lessons,[student],idx.marks,idx.parts,today);
  const final=s.finalGrades.find(r=>r.studentId===student.id&&r.from===period.from&&r.to===period.to)?.value??null;
  return {student,count,weight:denominator,mean,suggested:mean===null?null:String(M.rawToMark(mean)),unknown:att.unknown,absent:att.absent,final};
 });
 const tasks=assignments.filter(a=>a.classId===classId&&a.from<=period.to&&a.to>=period.from).map(a=>({name:a.name,...assignmentOverview(s,a,today)}));
 return {ended:period.to<=today,lessons:lessons.length,held:confirmed.length,unconfirmed:lessons.filter(l=>l.date<=today&&!held(l,idx,today)).length,future:lessons.filter(l=>l.date>today).length,unknown:results.reduce((n,r)=>n+r.unknown,0),withoutGrades:results.filter(r=>!r.count).length,withoutFinal:results.filter(r=>r.final===null).length,results,tasks};
}
export function ktpForecast(s,classId,topics,today=M.todayIso()){
 const idx=indexes(s),lessons=s.lessons.filter(l=>l.classId===classId),done=new Set(lessons.filter(l=>held(l,idx,today)).map(l=>l.topicId).filter(Boolean)),remaining=topics.filter(t=>!done.has(t.id)),from=today>s.settings.year.from?today:s.settings.year.from,to=s.settings.year.to;
 const planned=from<=to?M.planLessonEntries({classId,from,to,rules:s.schedule,overrides:s.scheduleOverrides,holidays:s.settings.holidays||[],days:new Set()}):[];
 const missing=M.missingLessonEntries(planned,lessons);
 const scheduled=planned.length,available=missing.length+lessons.filter(l=>M.inRange(l.date,from,to)&&!held(l,idx,today)).length;
 return {total:topics.length,completed:topics.filter(t=>done.has(t.id)).length,remaining:remaining.length,scheduled,available,shortfall:Math.max(0,remaining.length-available),unassigned:remaining.filter(t=>!lessons.some(l=>l.date>=from&&l.topicId===t.id&&!held(l,idx,today))).map(t=>t.name)};
}
