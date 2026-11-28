// Explicit school goals; never changes journal marks or medical restrictions.
import * as db from './db.js';
import {uid} from './model.js';
import {lineageOf} from './school-tools.js';
import {validPeriod} from './health.js';
const check=(v,m)=>{if(!v)throw Error(m);};
export function validateStudentGoal(r){
 check(r&&Object.keys(r).every(k=>['id','kind','studentId','name','from','to','target','status','note','updatedAt'].includes(k))&&r.kind==='studentGoal'&&['id','studentId','name','target'].every(k=>typeof r[k]==='string'&&r[k].trim()&&r[k].length<=500)&&validPeriod(r.from,r.to)&&r.to&&['planned','inProgress','achieved','cancelled'].includes(r.status)&&typeof r.note==='string'&&r.note.length<=2000&&typeof r.updatedAt==='string'&&Number.isFinite(Date.parse(r.updatedAt)),'Проверьте индивидуальную цель');return r;
}
export async function saveStudentGoal(input){return writeStudentGoal(db,input);}
export async function writeStudentGoal(access,input){
 const r={...input,kind:'studentGoal',id:input.id||uid('studentGoal'),updatedAt:new Date().toISOString()};validateStudentGoal(r);
 await access.transaction(['students','workRecords'],'readwrite',async s=>{check((await s.students.getAll()).some(p=>lineageOf(p)===r.studentId),'Ученик недоступен');const old=await s.workRecords.get(r.id);check(!old||old.kind===r.kind&&old.studentId===r.studentId,'Нельзя изменить владельца цели');if(input.id)check(old,'Цель уже удалена');await s.workRecords.put(r);});return r;
}
export function studentPortfolio(state,passport,goals,achievements,studentId){
 const pupil=state.students.find(s=>s.id===studentId);if(!pupil)return null;
 return {pupil,passport,goals:goals.filter(g=>g.studentId===lineageOf(pupil)).slice().sort((a,b)=>b.from.localeCompare(a.from)),achievements:achievements.filter(a=>a.subjectId===lineageOf(pupil)&&a.subjectType==='student')};
}
