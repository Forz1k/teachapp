/* Reproducible calculation-only benchmark; synthetic school, same results. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {attendanceDetails} from '../js/assessment.js';
import {buildAttendanceIndex} from '../js/attendance-index.js';
import {addDays} from '../js/model.js';
const today='2026-11-25',classes=24,pupilsPerClass=30,lessonCount=36,allMarks=[],allParts=[],allLessons=[],allPupils=[];
for(let c=0;c<classes;c++){for(let p=0;p<pupilsPerClass;p++)allPupils.push({id:'p'+c+'_'+p,classId:'c'+c});for(let l=0;l<lessonCount;l++){const lesson={id:'l'+c+'_'+l,classId:'c'+c,date:addDays('2026-09-01',l*2),held:l%4===0};allLessons.push(lesson);for(let p=0;p<pupilsPerClass;p++){const studentId='p'+c+'_'+p;if((l+p)%7===0)allParts.push({lessonId:lesson.id,studentId});else if((l+p)%5!==0)allMarks.push({lessonId:lesson.id,studentId,source:l%4===0?'manual':'auto-osv',...(p%9===0?{flag:'Н'}:{value:'4'})});}}}
const classId='c'+(classes-1),lessons=allLessons.filter(l=>l.classId===classId),students=allPupils.filter(p=>p.classId===classId);
function before(){return students.map(st=>{const classLessons=new Set(allLessons.filter(l=>l.classId===classId).map(l=>l.id)),marks=new Map();for(const m of allMarks)if(classLessons.has(m.lessonId))marks.set(m.lessonId+'|'+m.studentId,m);const parts=new Map(allParts.map(p=>[p.lessonId+'|'+p.studentId,p]));const prepared=lessons.map(l=>({...l,held:l.date<=today&&(l.held||allParts.some(p=>p.lessonId===l.id)||allMarks.some(m=>m.lessonId===l.id&&(m.source==='manual'||m.baseMark?.source==='manual')))}));return attendanceDetails(prepared,[st],marks,parts,today);});}
function after(){const ctx=buildAttendanceIndex(lessons,lessons,allMarks,allParts,today);return students.map(st=>ctx.forStudents([st]));}
assert.deepEqual(after(),before());function median(fn){const times=[];for(let i=0;i<5;i++){const start=performance.now();fn();times.push(performance.now()-start);}return times.sort((a,b)=>a-b)[2];}const old=median(before),next=median(after);console.log('ATTENDANCE BENCHMARK '+JSON.stringify({classes,pupilsPerClass,lessonCount,marks:allMarks.length,participation:allParts.length,beforeMs:+old.toFixed(2),afterMs:+next.toFixed(2),speedup:+(old/next).toFixed(2),identical:true}));
