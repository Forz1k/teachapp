/* Reproducible calculation-only benchmark; synthetic school, same results. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {attendanceDetails} from '../js/assessment.js';
import {buildAttendanceIndex} from '../js/attendance-index.js';
import {addDays,hasOsv,inRange,sortLessons} from '../js/model.js';
import {syncValuesEqual} from '../js/sync.js';
import {schoolPeriodOverview} from '../js/school-review.js';
const today='2026-11-25',classes=24,pupilsPerClass=30,lessonCount=36,allMarks=[],allParts=[],allLessons=[],allPupils=[];
for(let c=0;c<classes;c++){for(let p=0;p<pupilsPerClass;p++)allPupils.push({id:'p'+c+'_'+p,classId:'c'+c});for(let l=0;l<lessonCount;l++){const lesson={id:'l'+c+'_'+l,classId:'c'+c,date:addDays('2026-09-01',l*2),held:l%4===0};allLessons.push(lesson);for(let p=0;p<pupilsPerClass;p++){const studentId='p'+c+'_'+p;if((l+p)%7===0)allParts.push({lessonId:lesson.id,studentId});else if((l+p)%5!==0)allMarks.push({lessonId:lesson.id,studentId,source:l%4===0?'manual':'auto-osv',...(p%9===0?{flag:'Н'}:{value:'4'})});}}}
const classId='c'+(classes-1),lessons=allLessons.filter(l=>l.classId===classId),students=allPupils.filter(p=>p.classId===classId);
function before(){return students.map(st=>{const classLessons=new Set(allLessons.filter(l=>l.classId===classId).map(l=>l.id)),marks=new Map();for(const m of allMarks)if(classLessons.has(m.lessonId))marks.set(m.lessonId+'|'+m.studentId,m);const parts=new Map(allParts.map(p=>[p.lessonId+'|'+p.studentId,p]));const prepared=lessons.map(l=>({...l,held:l.date<=today&&(l.held||allParts.some(p=>p.lessonId===l.id)||allMarks.some(m=>m.lessonId===l.id&&(m.source==='manual'||m.baseMark?.source==='manual')))}));return attendanceDetails(prepared,[st],marks,parts,today);});}
function after(){const ctx=buildAttendanceIndex(lessons,lessons,allMarks,allParts,today);return students.map(st=>ctx.forStudents([st]));}
assert.deepEqual(after(),before());function median(fn){const times=[];for(let i=0;i<5;i++){const start=performance.now();fn();times.push(performance.now()-start);}return times.sort((a,b)=>a-b)[2];}const old=median(before),next=median(after);console.log('ATTENDANCE BENCHMARK '+JSON.stringify({classes,pupilsPerClass,lessonCount,marks:allMarks.length,participation:allParts.length,beforeMs:+old.toFixed(2),afterMs:+next.toFixed(2),speedup:+(old/next).toFixed(2),identical:true}));

const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const records={lessons:allLessons,students:allPupils,marks:allMarks,participation:allParts};
const equivalent=JSON.parse(JSON.stringify(records)),different=structuredClone(equivalent);different.marks.at(-1).value='1';
const comparisons=[[records,equivalent],[records,different]];
const compareOld=()=>comparisons.map(([a,b])=>canonical(a)===canonical(b)),compareNew=()=>comparisons.map(([a,b])=>syncValuesEqual(a,b));
assert.deepEqual(compareNew(),compareOld());assert.deepEqual(compareNew(),[true,false]);
const eqOld=median(compareOld),eqNew=median(compareNew);
console.log('SYNC EQUALITY BENCHMARK '+JSON.stringify({records:Object.values(records).reduce((n,a)=>n+a.length,0),beforeMs:+eqOld.toFixed(2),afterMs:+eqNew.toFixed(2),speedup:+(eqOld/eqNew).toFixed(2),identical:true}));
const period={from:'2026-09-01',to:'2026-11-25'};
const state={classes:Array.from({length:classes},(_,i)=>({id:'c'+i,name:String(i+1)+'А'})),students:allPupils,lessons:allLessons,marks:allMarks,participation:allParts,settings:{year:{from:period.from,to:'2027-05-31'},holidays:[]},schedule:[],scheduleOverrides:[],finalGrades:allPupils.flatMap((s,i)=>[{studentId:s.id,from:'2025-09-01',to:'2025-11-25',value:'4'},...(i%3?[{studentId:s.id,...period,value:'4'}]:[])])};
function oldPeriod(){
 const pupils=new Map(),marks=new Map(allMarks.map(m=>[m.lessonId+'|'+m.studentId,m])),parts=new Map(allParts.map(m=>[m.lessonId+'|'+m.studentId,m]));
 for(const p of state.students){if(!pupils.has(p.classId))pupils.set(p.classId,[]);pupils.get(p.classId).push(p);}
 return state.classes.map(cls=>{
  const students=pupils.get(cls.id)||[],lessons=sortLessons(state.lessons.filter(l=>l.classId===cls.id&&inRange(l.date,period.from,period.to))),confirmed=lessons.filter(l=>attendanceDetails([l],students,marks,parts,today).held>0);
  const attendanceLessons=confirmed.map(l=>l.held?l:{...l,held:true});
  const issues=lessons.filter(l=>l.date<=today).map(l=>({l,a:attendanceDetails([l],students,marks,parts,today)})).filter(({l,a})=>!l.held||a.unknown);
  const results=students.map(student=>{
   let count=0;for(const l of confirmed){const m=marks.get(l.id+'|'+student.id);if(m?.flag!=='Н'&&!hasOsv(m)&&['1','2','3','4','5'].includes(String(m?.value)))count++;}
   const att=attendanceDetails(attendanceLessons,[student],marks,parts,today),final=state.finalGrades.find(r=>r.studentId===student.id&&r.from===period.from&&r.to===period.to)?.value??null;
   return {count,unknown:att.unknown,final};
  });
  return {classId:cls.id,held:confirmed.length,explicitlyHeld:confirmed.filter(l=>l.held).length,unknown:results.reduce((n,r)=>n+r.unknown,0),unconfirmed:issues.filter(({l})=>!l.held).length,withoutGrades:results.filter(r=>!r.count).length,withoutFinal:results.filter(r=>r.final===null).length};
 }).sort((a,b)=>a.classId.localeCompare(b.classId));
}
function newPeriod(){return schoolPeriodOverview(state,{period,today}).rows.map(r=>({classId:r.classId,held:r.held,explicitlyHeld:r.explicitlyHeld,unknown:r.stats.unknown,unconfirmed:r.stats.unconfirmed,withoutGrades:r.stats.withoutGrades,withoutFinal:r.stats.withoutFinal})).sort((a,b)=>a.classId.localeCompare(b.classId));}
assert.deepEqual(newPeriod(),oldPeriod());
const periodOld=median(oldPeriod),periodNew=median(newPeriod);
console.log('PERIOD REVIEW BENCHMARK '+JSON.stringify({classes,pupils:allPupils.length,lessons:allLessons.length,finals:state.finalGrades.length,beforeMs:+periodOld.toFixed(2),afterMs:+periodNew.toFixed(2),speedup:+(periodOld/periodNew).toFixed(2),identical:true}));
