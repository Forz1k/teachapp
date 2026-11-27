/* Pure, per-call school analytics. No storage, session, or DOM dependency. */
import * as M from './model.js';
import {attendanceDetails} from './assessment.js';
import {buildAttendanceIndex} from './attendance-index.js';
const grade=m=>m?.flag!=='Н'&&['1','2','3','4','5'].includes(String(m?.value))?Number(m.value):null;
const avg=(sum,count)=>count?Math.round(sum/count*100)/100:null;
const monthKey=(year,month)=>year+'-'+String(month).padStart(2,'0');

export function calculateSchoolAnalytics({students:classStudents,allLessons,topics,marks:allMarks,parts,finalGrades,normResults,from,to,studentId=null,today=M.todayIso()}){
  const students=classStudents.filter(s=>!studentId||s.id===studentId),ids=new Set(students.map(s=>s.id));
  const lessons=allLessons.filter(l=>M.inRange(l.date,from,to));
  // One full-class evidence snapshot supports the period and whole-plan KTP.
  // The period attendance still uses only the selected lessons and students.
  const attendance=buildAttendanceIndex(allLessons,allLessons,allMarks,parts,today),marks=attendance.marks;
  const prepared=lessons.map(l=>({...l,held:attendance.held(l)}));
  const forStudents=selected=>attendanceDetails(prepared,selected,marks,attendance.parts,today);
  const held=lessons.filter(l=>attendance.held(l));
  const finalByStudent=new Map(),names=new Map(students.map(s=>[s.id,s.fullName]));
  for(const r of finalGrades)if(r.from===from&&r.to===to&&!finalByStudent.has(r.studentId))finalByStudent.set(r.studentId,r);
  const months=M.monthsInRange(from,to).map(({year,month})=>monthKey(year,month));
  const monthStats=new Map(months.map(key=>[key,{sum:0,count:0}]));
  const dated=held.map(l=>({id:l.id,month:monthStats.get(monthKey(M.yearOf(l.date),M.monthOf(l.date)))}));
  // Grade cells are decoded once for both individual averages and monthly trends.
  const rows=students.map(s=>{
    let sum=0,count=0;
    for(const l of dated){
      const value=grade(marks.get(l.id+'|'+s.id));
      if(value===null)continue;
      sum+=value;count++;
      if(l.month){l.month.sum+=value;l.month.count++;}
    }
    const mean=avg(sum,count),final=finalByStudent.get(s.id);
    return {student:s,mean,count,suggested:mean===null?null:String(M.rawToMark(mean)),final:final?.value||null,att:forStudents([s])};
  });
  const trend=months.map(month=>{const {sum,count}=monthStats.get(month);return {month,mean:avg(sum,count),count};});
  const done=new Set(allLessons.filter(l=>attendance.held(l)).map(l=>l.topicId));
  const counts=ls=>{const map=new Map();for(const l of ls)map.set(l.topicId,(map.get(l.topicId)||0)+1);return map;};
  const heldCounts=counts(held),plannedCounts=counts(lessons);
  const ktp=topics.map(t=>({name:t.name,done:done.has(t.id),inPeriod:heldCounts.get(t.id)||0,planned:plannedCounts.get(t.id)||0}));
  const participation={normal:0,adapted:0,paused:0,unrecorded:0},heldIds=new Set(held.map(l=>l.id));
  for(const r of parts)if(ids.has(r.studentId)&&heldIds.has(r.lessonId))participation[r.mode]++;
  participation.unrecorded=held.length*students.length-participation.normal-participation.adapted-participation.paused;
  const norms=normResults.filter(r=>ids.has(r.studentId)&&r.status==='done'&&M.inRange(r.date,from,to)&&r.date<=today)
    .map(r=>({date:r.date,student:names.get(r.studentId)||'',name:r.definition.name,value:r.value,unit:r.definition.unit,grade:r.grade}));
  return {rows,trend,ktp,norms,participation,att:forStudents(students),held:held.length,lessons:lessons.length};
}
