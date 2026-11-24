import * as db from './db.js';
import {uid,todayIso,addDays,inRange} from './model.js';
import {validPeriod} from './health.js';
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const only=(r,keys)=>r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>keys.includes(k));
const text=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const bounded=(v,max)=>Number.isInteger(v)&&v>=0&&v<=max;
export const phaseKinds={general:'Общая подготовка',technical:'Техническая подготовка',tactical:'Тактическая подготовка',competition:'Соревновательный период',recovery:'Восстановительный период',other:'Другой этап'};
export function validateSeasonPlan(r){
 check(only(r,['id','kind','teamId','name','from','to','phases','revision'])&&r.kind==='seasonPlan'&&text(r.id)&&text(r.teamId)&&text(r.name)&&validPeriod(r.from,r.to)&&!!r.to&&r.to<=addDays(r.from,730)&&bounded(r.revision,1000000),'Проверьте название и сроки сезона (до 731 дня)');
 check(Array.isArray(r.phases)&&r.phases.length>=1&&r.phases.length<=24,'Добавьте 1–24 этапа');
 let end='';
 for(const p of r.phases){
  check(only(p,['name','kind','from','to','goal','sessions','minutes'])&&text(p.name)&&Object.hasOwn(phaseKinds,p.kind)&&validPeriod(p.from,p.to)&&!!p.to&&p.from>=r.from&&p.to<=r.to&&p.from>end&&typeof p.goal==='string'&&p.goal.length<=2000&&bounded(p.sessions,2000)&&bounded(p.minutes,1200000),'Проверьте даты, цели и объём этапов: порядок, отсутствие пересечений, границы сезона');
  end=p.to;
 }
 return r;
}
export async function saveSeasonPlan(input){
 return db.transaction(['workRecords','coachTeams'],'readwrite',async s=>{
  const old=input.id?await s.workRecords.get(input.id):null,team=await s.coachTeams.get(input.teamId);
  check(team&&(!team.archived||old),'Команда недоступна');
  check(!input.id||old?.kind==='seasonPlan'&&old.teamId===input.teamId&&old.revision===input.revision,'План изменился. Откройте его заново');
  const record=structuredClone({...input,id:input.id||uid('season'),kind:'seasonPlan',revision:old?old.revision+1:0});
  validateSeasonPlan(record);await s.workRecords.put(record);return record;
 });
}
export function seasonPlanProgress(plan,trainings,matches,today=todayIso()){
 validateSeasonPlan(plan);
 const sessions=trainings.filter(t=>t.teamId===plan.teamId&&inRange(t.date,plan.from,plan.to));
 const games=matches.filter(m=>m.teamId===plan.teamId&&m.date<=today&&inRange(m.date,plan.from,plan.to));
 const range=(from,to)=>{
  const rows=sessions.filter(t=>inRange(t.date,from,to)),held=rows.filter(t=>t.held&&t.date<=today);
  return {scheduled:rows.length,held:held.length,unconfirmed:rows.filter(t=>!t.held&&t.date<today).length,future:rows.filter(t=>!t.held&&t.date>=today).length,recordedMinutes:held.reduce((n,t)=>n+t.minutes,0),matches:games.filter(m=>inRange(m.date,from,to)).length};
 };
 const phases=plan.phases.map(p=>({...p,...range(p.from,p.to)}));
 const weeks=[];for(let from=plan.from;from<=plan.to;from=addDays(from,7)){
  const to=addDays(from,6)>plan.to?plan.to:addDays(from,6);
  weeks.push({from,to,...range(from,to)});
 }
 return {total:range(plan.from,plan.to),phases,weeks};
}
