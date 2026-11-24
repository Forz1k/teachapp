import {catalog,active,ancestorIds,validPeriod} from './health.js';
import {todayIso} from './model.js';
const activities=new Map(catalog.map(x=>[x.id,x]));
const text=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const only=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const count=v=>Number.isInteger(v)&&v>=0&&v<=10000;
const ensure=(v,msg)=>{if(!v)throw Error(msg);};
export const testPresets={
 serve:{name:'Подача',kind:'skill',activityId:'volley',protocol:'Подача через сетку в площадку',unit:'',direction:''},
 receive:{name:'Приём',kind:'skill',activityId:'volley',protocol:'Положительный приём по критерию тренера',unit:'',direction:''},
 attack:{name:'Атака',kind:'skill',activityId:'volley',protocol:'Результативная атака по критерию тренера',unit:'',direction:''},
 pass:{name:'Передача',kind:'skill',activityId:'pass',protocol:'Точная передача по критерию тренера',unit:'',direction:''},
 jump:{name:'Вертикальный прыжок',kind:'measure',activityId:'high',protocol:'Разница высоты касания и высоты стоя',unit:'см',direction:'higher'},
 reach:{name:'Высота съёма',kind:'measure',activityId:'jump',protocol:'Максимальная высота касания в прыжке',unit:'см',direction:'higher'},
 broad:{name:'Прыжок в длину с места',kind:'measure',activityId:'standing',protocol:'Лучший результат по одинаковой методике',unit:'см',direction:'higher'},
 sprint:{name:'Бег 30 м',kind:'measure',activityId:'30m',protocol:'Время на 30 м',unit:'с',direction:'lower'},
 strength:{name:'Отжимания',kind:'measure',activityId:'push',protocol:'Количество технически правильных повторений',unit:'раз',direction:'higher'}
};
export function validateTestDefinition(d){
 ensure(only(d,['name','kind','activityId','protocol','unit','direction'])&&text(d.name)&&text(d.protocol,500)&&activities.has(d.activityId),'Укажите название, методику и вид нагрузки');
 ensure(d.kind==='skill'&&d.unit===''&&d.direction===''||d.kind==='measure'&&text(d.unit,20)&&['higher','lower'].includes(d.direction),'Проверьте тип теста, единицы и направление прогресса');
}
export function validateTestResult(r,d){
 ensure(only(r,['status','attempts','success','errors','target','value','adapted','note'])&&['done','restricted','skipped'].includes(r.status)&&typeof r.adapted==='boolean'&&typeof r.note==='string'&&r.note.length<=500,'Проверьте запись результата');
 if(r.status!=='done'){ensure(!r.adapted&&['attempts','success','errors','target','value'].every(k=>r[k]===null),'У пропуска не может быть числового результата');return;}
 if(d.kind==='skill'){
  ensure(count(r.attempts)&&r.attempts>0&&count(r.success)&&count(r.errors)&&r.success+r.errors===r.attempts&&(r.target===null||count(r.target)&&r.target<=r.success)&&r.value===null,'Успехи + ошибки должны равняться попыткам; попаданий в цель не больше успехов');
 }else ensure(typeof r.value==='number'&&Number.isFinite(r.value)&&r.value>=0&&r.value<=1000000&&['attempts','success','errors','target'].every(k=>r[k]===null),'Проверьте числовой замер');
}
export function testRestrictions(player,definition,date){
 const ancestors=ancestorIds(definition.activityId,activities).ancestors;
 return (player.restrictions||[]).filter(r=>active(r,date)&&ancestors.has(r.activityId));
}
export function validateCoachTests(data){
 const teams=new Set(data.coachTeams.map(t=>t.id)),players=new Map(data.coachPlayers.map(p=>[p.id,p])),ids=new Set();
 for(const s of data.coachTests||[]){
  ensure(only(s,['id','teamId','date','definition','results'])&&text(s.id)&&!ids.has(s.id)&&teams.has(s.teamId)&&validPeriod(s.date,null)&&s.date<=todayIso()&&s.results&&typeof s.results==='object'&&!Array.isArray(s.results)&&Object.keys(s.results).length>0,'Проверьте дату, команду и результаты тестирования');
  ids.add(s.id);validateTestDefinition(s.definition);
  for(const [id,r] of Object.entries(s.results)){ensure(players.get(id)?.teamId===s.teamId,'Игрок не принадлежит команде');validateTestResult(r,s.definition);}
 }
}
export function guardTestWrite(data,old,record){
 const team=data.coachTeams.find(t=>t.id===record.teamId);
 ensure(team&&!team.archived&&(!old||old.teamId===record.teamId),'Команда недоступна');
 for(const [id,r] of Object.entries(record.results)){
  const player=data.coachPlayers.find(p=>p.id===id&&p.teamId===record.teamId);
  ensure(player,'Игрок не принадлежит команде');
  if(old&&old.date===record.date&&JSON.stringify(old.definition)===JSON.stringify(record.definition)&&JSON.stringify(old.results[id])===JSON.stringify(r))continue;
  ensure(!player.archived||old?.results[id],'Игрок в архиве');
  if(r.status!=='done')continue;
  const limits=testRestrictions(player,record.definition,record.date);
  ensure(!limits.some(x=>x.type==='avoid'),'Есть ограничение «не выполнять»: результат не записан');
  ensure(!limits.some(x=>x.type==='adapt')||r.adapted,'Подтвердите адаптированную нагрузку');
 }
}
export function definitionKey(d){return JSON.stringify([d.kind,d.name.trim().toLowerCase(),d.protocol.trim().toLowerCase(),d.activityId,d.unit.trim().toLowerCase(),d.direction]);}
export function testHistory(sessions,playerId,{from='',to=''}={}){
 const out=[];
 for(const s of sessions||[]){if(from&&s.date<from||to&&s.date>to||!Object.hasOwn(s.results,playerId))continue;out.push({id:s.id,date:s.date,definition:s.definition,result:s.results[playerId]});}
 return out.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
export function summarizeTests(history){
 const groups=new Map();
 for(const item of history){const k=definitionKey(item.definition);if(!groups.has(k))groups.set(k,{definition:item.definition,history:[],attempts:0,success:0,errors:0,target:0,targetAttempts:0,adapted:0,skipped:0,restricted:0,measurements:[]});const g=groups.get(k),r=item.result;g.history.push(item);
  if(r.status!=='done'){g[r.status]++;continue;}if(r.adapted){g.adapted++;continue;}
  if(item.definition.kind==='skill'){g.attempts+=r.attempts;g.success+=r.success;g.errors+=r.errors;if(r.target!==null){g.target+=r.target;g.targetAttempts+=r.attempts;}}else g.measurements.push({date:item.date,value:r.value});
 }
 return [...groups.values()].map(g=>({...g,pct:g.attempts?100*g.success/g.attempts:null,targetPct:g.targetAttempts?100*g.target/g.targetAttempts:null,first:g.measurements[0]?.value??null,last:g.measurements.at(-1)?.value??null,best:g.measurements.length?(g.definition.direction==='higher'?Math.max(...g.measurements.map(m=>m.value)):Math.min(...g.measurements.map(m=>m.value))):null}));
}
