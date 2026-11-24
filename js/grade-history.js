/* Local grade history. Only value/weight, never reasons or health data. */
import {uid} from './model.js';
import {validPeriod} from './health.js';
const check=(ok,m)=>{if(!ok)throw Error(m);};
const text=s=>typeof s==='string'&&s.length>0&&s.length<=200;
const only=(r,keys)=>r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>keys.includes(k));
const sources=['manual','weight','norm','batch','final','undo'];
export const historyLimit=200;
export const lessonHistoryKey=(studentId,lessonId)=>'history:'+JSON.stringify(['lesson',studentId,lessonId]);
export const finalHistoryKey=(studentId,from,to)=>'history:'+JSON.stringify(['final',studentId,from,to]);
export const gradeState=mark=>{const value=['1','2','3','4','5'].includes(mark?.value)?mark.value:null;return {value,weight:value?mark.weight===2?2:1:null};};
export const finalState=mark=>({value:['1','2','3','4','5'].includes(mark?.value)?mark.value:null,weight:null});
const same=(a,b)=>a.value===b.value&&a.weight===b.weight;
const validState=(s,scope)=>only(s,['value','weight'])&&(s.value===null||['1','2','3','4','5'].includes(s.value))&&(scope==='final'||s.value===null?s.weight===null:[1,2].includes(s.weight));
export function validateGradeHistory(r){
 check(only(r,['id','kind','scope','studentId','lessonId','from','to','periodName','events'])&&r.kind==='gradeHistory'&&text(r.id)&&text(r.studentId)&&['lesson','final'].includes(r.scope),'Повреждена история оценки');
 if(r.scope==='lesson')check(text(r.lessonId)&&r.id===lessonHistoryKey(r.studentId,r.lessonId)&&r.from===undefined&&r.to===undefined&&r.periodName===undefined,'Некорректная ссылка истории урока');
 else check(validPeriod(r.from,r.to)&&!!r.to&&text(r.periodName)&&r.lessonId===undefined&&r.id===finalHistoryKey(r.studentId,r.from,r.to),'Некорректный период истории');
 check(Array.isArray(r.events)&&r.events.length>0&&r.events.length<=historyLimit&&new Set(r.events.map(e=>e.id)).size===r.events.length,'Повреждена последовательность истории');
 for(const e of r.events)check(only(e,['id','at','before','after','source','undoOf'])&&text(e.id)&&typeof e.at==='string'&&Number.isFinite(Date.parse(e.at))&&validState(e.before,r.scope)&&validState(e.after,r.scope)&&!same(e.before,e.after)&&sources.includes(e.source)&&(e.undoOf===undefined||text(e.undoOf)),'Повреждена запись истории');
 return r;
}
export async function appendGradeHistory(store,target,before,after,source='manual',undoOf){
 if(same(before,after))return null;
 const scope=target.scope,id=scope==='lesson'?lessonHistoryKey(target.studentId,target.lessonId):finalHistoryKey(target.studentId,target.from,target.to);
 const old=await store.get(id),event={id:uid('gradechange'),at:new Date().toISOString(),before,after,source,...(undoOf?{undoOf}:{})};
 if(old)validateGradeHistory(old);
 const record={id,kind:'gradeHistory',...target,events:[...(old?.events||[]).slice(-(historyLimit-1)),event]};validateGradeHistory(record);await store.put(record);return event;
}
export function checkUndo(history,eventId,current){
 check(history?.kind==='gradeHistory','История недоступна');
 const event=history.events.at(-1);
 check(event?.id===eventId&&same(event.after,current),'Оценка уже изменена. Откройте историю заново');
 return event;
}
