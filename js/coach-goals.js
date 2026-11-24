import * as db from './db.js';
import {uid,todayIso} from './model.js';
import {validPeriod,catalog} from './health.js';
import {definitionKey,testHistory,validateTestDefinition} from './coach-tests.js';
const check=(v,m)=>{if(!v)throw Error(m);};
const text=(s,max=200)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
const opt=(s,max)=>typeof s==='string'&&s.length<=max;
const only=(r,keys)=>r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>keys.includes(k));
export const goalMetrics={success:'Успешность',target:'Попадание в цель',errors:'Доля ошибок',measure:'Физический замер'};
export const goalStatuses={active:'В работе',completed:'Подтверждено тренером',archived:'Архив'};
export const goalDirection=g=>g.metric==='errors'||g.metric==='measure'&&g.definition.direction==='lower'?'lower':'higher';
export function validateGoal(g){
 check(only(g,['id','kind','teamId','playerId','name','from','to','definition','metric','baseline','target','status','actions','exercises','observations','revision'])&&g.kind==='coachGoal'&&text(g.id)&&text(g.teamId)&&text(g.playerId)&&text(g.name)&&validPeriod(g.from,g.to)&&!!g.to&&Object.hasOwn(goalStatuses,g.status)&&Number.isInteger(g.revision)&&g.revision>=0&&g.revision<=1000000,'Проверьте цель, игрока и сроки');
 validateTestDefinition(g.definition);
 check(g.definition.kind==='skill'?['success','target','errors'].includes(g.metric):g.metric==='measure','Показатель не соответствует методике');
 const limit=g.metric==='measure'?1000000:100,valid=v=>Number.isFinite(v)&&v>=0&&v<=limit;
 check(valid(g.target)&&(g.baseline===null||valid(g.baseline)),'Проверьте начальное и целевое значение');
 check(g.baseline===null||goalDirection(g)==='lower'?g.baseline===null||g.target<=g.baseline:g.target>=g.baseline,'Цель должна соответствовать направлению улучшения');
 check(opt(g.actions,2000)&&Array.isArray(g.exercises)&&g.exercises.length<=30&&g.exercises.every(e=>only(e,['name','activityId','minutes'])&&text(e.name)&&catalog.some(a=>a.id===e.activityId)&&Number.isInteger(e.minutes)&&e.minutes>=1&&e.minutes<=600),'Проверьте упражнения плана');
 check(Array.isArray(g.observations)&&g.observations.length<=200&&g.observations.every(o=>only(o,['date','text'])&&validPeriod(o.date,null)&&o.date<=todayIso()&&text(o.text,1000)),'Проверьте даты и текст наблюдений');
 return g;
}
export async function saveGoal(input){
 return db.transaction(['workRecords','coachTeams','coachPlayers'],'readwrite',async s=>{
  const old=input.id?await s.workRecords.get(input.id):null;
  check(!input.id||old?.kind==='coachGoal'&&old.revision===input.revision&&old.playerId===input.playerId&&old.teamId===input.teamId,'Цель изменена. Откройте её заново');
  const [team,player]=await Promise.all([s.coachTeams.get(input.teamId),s.coachPlayers.get(input.playerId)]);
  check(team&&player?.teamId===team.id&&((!team.archived&&!player.archived)||old),'Команда или спортсменка в архиве');
  const next=structuredClone({...input,id:input.id||uid('goal'),kind:'coachGoal',revision:old?old.revision+1:0});
  validateGoal(next);await s.workRecords.put(next);return next;
 });
}
export function goalProgress(g,sessions,today=todayIso()){
 validateGoal(g);
 const key=definitionKey(g.definition),to=g.to<today?g.to:today;
 const history=testHistory(sessions.filter(s=>s.teamId===g.teamId),g.playerId,{from:g.from,to}).filter(x=>definitionKey(x.definition)===key&&x.result.status==='done'&&!x.result.adapted);
 const rows=history.flatMap(x=>{
  const r=x.result,n=g.metric==='measure'?null:r.attempts,k=g.metric==='success'?r.success:g.metric==='errors'?r.errors:g.metric==='target'?r.target:null;
  if(g.metric==='measure')return [{date:x.date,value:r.value,attempts:null,success:null}];
  return k===null?[]:[{date:x.date,value:k/n*100,attempts:n,success:k}];
 });
 let current=null,attempts=null,recorded=0;
 if(g.metric==='measure'){current=rows.at(-1)?.value??null;recorded=rows.length;}
 else{const latest=rows.slice(-2);attempts=latest.reduce((n,r)=>n+r.attempts,0);recorded=latest.length;if(attempts)current=100*latest.reduce((n,r)=>n+r.success,0)/attempts;}
 const enough=current!==null&&(g.metric==='measure'||attempts>=20&&recorded>=2);
 const lower=goalDirection(g)==='lower',met=enough&&(lower?current<=g.target:current>=g.target);
 const progress=current===null||g.baseline===null||g.baseline===g.target?null:100*(current-g.baseline)/(g.target-g.baseline);
 return {current,attempts,recorded,enough,met,progress,rows,overdue:g.status==='active'&&today>g.to,unit:g.metric==='measure'?g.definition.unit:'%'};
}

/** Group goals for a coach's review queue. Never automatically confirm a goal. */
export function teamGoalOverview(goals,sessions,players,teamId,today=todayIso()){
 const byId=new Map(players.filter(p=>p.teamId===teamId&&!p.archived).map(p=>[p.id,p]));
 const rows=[];
 for(const g of goals.filter(g=>g.teamId===teamId&&g.status==='active'&&byId.has(g.playerId))){
  const v=goalProgress(g,sessions,today),state=v.met?'review':v.overdue?'overdue':!v.enough?'sample':'active';
  rows.push({goal:g,player:byId.get(g.playerId),progress:v,state});
 }
 const order={overdue:0,review:1,sample:2,active:3};
 rows.sort((a,b)=>order[a.state]-order[b.state]||a.goal.to.localeCompare(b.goal.to)||a.player.name.localeCompare(b.player.name,'ru'));
 return {rows,overdue:rows.filter(r=>r.progress.overdue).length,review:rows.filter(r=>r.state==='review').length,sample:rows.filter(r=>r.state==='sample').length,withoutGoals:[...byId.values()].filter(p=>!rows.some(r=>r.player.id===p.id))};
}
