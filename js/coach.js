/* Автономные данные тренера. Ни одного чтения школьных учеников, отметок или медпрофилей.
   Общий каталог видов нагрузки — только статический, без персональных данных. */
import * as db from './db.js';
import {uid,todayIso} from './model.js';
import {catalog,validPeriod,active,ancestorIds} from './health.js';
import {replay,appendEvent,undoEvent,validateLiveData} from './volleyball.js';
export const coachStores=['coachTeams','coachPlayers','coachTrainings','coachMatches','coachLive','coachLineups'];
export const positions={setter:'Связующая',outside:'Доигровщица',opposite:'Диагональная',middle:'Центральная блокирующая',libero:'Либеро',universal:'Универсальная'};
export const attendanceLabels={present:'Присутствовала',absent:'Отсутствовала',limited:'Присутствовала, нагрузка ограничена'};
export const metrics={serves:'Подачи (всего)',serveErrors:'Ошибки на подаче',aces:'Эйсы',receptions:'Приёмы (всего)',receptionGood:'Положительные приёмы',attacks:'Атаки (всего)',attackKills:'Результативные атаки',blocks:'Результативные блоки',points:'Очки (всего)'};
const activityMap=new Map(catalog.map(a=>[a.id,a]));
const str=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const date=v=>typeof v==='string'&&validPeriod(v,null);
const count=v=>Number.isInteger(v)&&v>=0&&v<=9999;
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
const uniq=a=>new Set(a).size===a.length;
const keys=Object.keys(metrics);
const dateOrder=(a,b)=>b.date.localeCompare(a.date);
export function validateStats(s){
  assert(only(s,keys)&&Object.values(s).every(v=>v===null||count(v)),'Проверьте статистику: целые неотрицательные значения');
  for(const [a,b] of [['serveErrors','serves'],['aces','serves'],['receptionGood','receptions'],['attackKills','attacks']])
    assert(s[a]==null||s[b]==null||s[a]<=s[b],'Успешные действия и ошибки не могут превышать число попыток');
  assert(s.serves==null||s.serveErrors==null||s.aces==null||s.serveErrors+s.aces<=s.serves,'Эйсы и ошибки превышают число подач');
  assert(s.points==null||['aces','attackKills','blocks'].reduce((sum,k)=>sum+(s[k]||0),0)<=s.points,'Очки меньше суммы результативных действий');
}
export function validateCoachData(data){
  const teams=data.coachTeams,players=data.coachPlayers,trainings=data.coachTrainings,matches=data.coachMatches;
  const teamIds=new Set(teams.map(t=>t.id)),byPlayer=new Map(players.map(p=>[p.id,p]));
  assert(teams.every(t=>only(t,['id','name','archived'])&&str(t.id)&&str(t.name)&&typeof t.archived==='boolean'),'Проверьте команды');
  assert(players.every(p=>only(p,['id','teamId','name','number','position','archived','restrictions'])&&str(p.id)&&teamIds.has(p.teamId)&&str(p.name)&&
    (p.number===null||(Number.isInteger(p.number)&&p.number>=0&&p.number<=99))&&Object.hasOwn(positions,p.position)&&typeof p.archived==='boolean'&&Array.isArray(p.restrictions)&&p.restrictions.every(r=>
      only(r,['activityId','dateFrom','dateTo','type'])&&activityMap.has(r.activityId)&&date(r.dateFrom)&&(r.dateTo===null||date(r.dateTo))&&validPeriod(r.dateFrom,r.dateTo)&&['avoid','adapt'].includes(r.type))), 'Проверьте карточки игроков и ограничения');
  for(const t of teams){
    const nums=players.filter(p=>p.teamId===t.id&&!p.archived&&p.number!==null).map(p=>p.number);
    assert(uniq(nums),'Игровые номера действующего состава должны быть уникальны');
  }
  const roster=(r,ids)=>Array.isArray(ids)&&uniq(ids)&&ids.every(id=>byPlayer.get(id)?.teamId===r.teamId);
  for(const t of trainings){
    assert(only(t,['id','teamId','date','time','title','minutes','exercises','roster','attendance','held'])&&str(t.id)&&teamIds.has(t.teamId)&&date(t.date)&&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)&&str(t.title)&&Number.isInteger(t.minutes)&&t.minutes>=1&&t.minutes<=600&&typeof t.held==='boolean'&&
      Array.isArray(t.exercises)&&t.exercises.every(x=>only(x,['name','activityId','minutes'])&&str(x.name)&&activityMap.has(x.activityId)&&Number.isInteger(x.minutes)&&x.minutes>=1&&x.minutes<=600)&&
      t.exercises.reduce((sum,x)=>sum+x.minutes,0)<=t.minutes&&roster(t,t.roster)&&only(t.attendance,t.roster)&&Object.values(t.attendance).every(x=>Object.hasOwn(attendanceLabels,x))&&
      (t.held||!Object.keys(t.attendance).length),'Проверьте тренировку, план и посещаемость');
  }
  for(const m of matches){
    assert(only(m,['id','teamId','date','opponent','competition','sets','roster','stats'])&&str(m.id)&&teamIds.has(m.teamId)&&date(m.date)&&str(m.opponent)&&typeof m.competition==='string'&&m.competition.length<=200&&
      Array.isArray(m.sets)&&m.sets.length>=1&&m.sets.length<=5&&m.sets.every(s=>only(s,['ours','theirs'])&&count(s.ours)&&count(s.theirs)&&s.ours!==s.theirs)&&
      roster(m,m.roster)&&only(m.stats,m.roster),'Проверьте матч, партии и состав');
    for(const s of Object.values(m.stats))validateStats(s);
  }
  validateLiveData(data);
  return data;
}
export async function loadCoach(){
  return db.transaction(coachStores,'readonly',async s=>Object.fromEntries(await Promise.all(coachStores.map(async n=>[n,await s[n].getAll()]))));
}
async function write(name,record,guard){
  return db.transaction(coachStores,'readwrite',async s=>{
    const data=Object.fromEntries(await Promise.all(coachStores.map(async n=>[n,await s[n].getAll()])));
    const old=data[name].find(x=>x.id===record.id);
    if(guard)guard(data,old);
    data[name]=data[name].filter(x=>x.id!==record.id).concat(record);
    validateCoachData(data);
    await s[name].put(record);return record;
  });
}
const teamGuard=(d,old,r)=>assert(d.coachTeams.some(t=>t.id===r.teamId&&(!t.archived||old))&&(!old||old.teamId===r.teamId),'Команда недоступна');
export async function saveTeam(input){
  return write('coachTeams',{id:input.id||uid('team'),name:String(input.name||'').trim(),archived:input.archived===true});
}
export async function savePlayer(input){
  const r={id:input.id||uid('player'),teamId:input.teamId,name:String(input.name||'').trim(),number:input.number??null,position:input.position,archived:input.archived===true,
    restrictions:(input.restrictions||[]).map(x=>({activityId:x.activityId,dateFrom:x.dateFrom,dateTo:x.dateTo||null,type:x.type}))};
  return write('coachPlayers',r,(d,old)=>teamGuard(d,old,r));
}
export async function saveTraining(input){
  const r={id:input.id||uid('training'),teamId:input.teamId,date:input.date,time:input.time,title:String(input.title||'').trim(),minutes:input.minutes,
    exercises:(input.exercises||[]).map(x=>({name:String(x.name||'').trim(),activityId:x.activityId,minutes:x.minutes})),roster:[...input.roster],held:input.held===true,attendance:{...input.attendance}};
  assert(!r.held||r.date<=todayIso(),'Будущая тренировка не может быть проведённой');
  return write('coachTrainings',r,(d,old)=>teamGuard(d,old,r));
}
export async function saveMatch(input){
  const r={id:input.id||uid('match'),teamId:input.teamId,date:input.date,opponent:String(input.opponent||'').trim(),competition:String(input.competition||'').trim(),
    sets:input.sets.map(x=>({ours:x.ours,theirs:x.theirs})),roster:[...input.roster],stats:Object.fromEntries(Object.entries(input.stats||{}).map(([id,s])=>[id,{...s}]))};
  assert(r.date<=todayIso(),'Результат будущего матча недоступен');
  return write('coachMatches',r,(d,old)=>teamGuard(d,old,r));
}
export async function removeEvent(name,id){
  assert(['coachTrainings','coachMatches'].includes(name),'Нельзя удалить состав этой командой');
  await db.del(name,id);
}
export function trainingWarnings(training,players){
  const out=[];
  for(const p of players.filter(p=>training.roster.includes(p.id))){
    for(const r of p.restrictions.filter(r=>active(r,training.date))){
      const exercises=training.exercises.filter(x=>ancestorIds(x.activityId,activityMap).ancestors.has(r.activityId));
      if(exercises.length)out.push({player:p,restriction:r,exercises});
    }
  }
  return out;
}
export function matchScore(m){
  return m.sets.reduce((s,p)=>({ours:s.ours+Number(p.ours>p.theirs),theirs:s.theirs+Number(p.theirs>p.ours)}),{ours:0,theirs:0});
}
export function playerAttendance(playerId,trainings,today=todayIso()){
  const s={present:0,limited:0,absent:0,unknown:0,planned:0,pct:null};
  for(const t of trainings.filter(t=>t.roster.includes(playerId))){
    if(!t.held||t.date>today){s.planned++;continue;}
    const v=t.attendance[playerId];
    if(v)s[v]++;else s.unknown++;
  }
  const total=s.present+s.limited+s.absent;
  if(total)s.pct=Math.round((s.present+s.limited)/total*1000)/10;
  return s;
}
export function summarizeStats(matches,playerIds=null){
  const sums=Object.fromEntries(keys.map(k=>[k,null])),recorded=Object.fromEntries(keys.map(k=>[k,0]));
  const selected=playerIds?new Set(playerIds):null;
  for(const m of matches)for(const [id,s] of Object.entries(m.stats)){
    if(selected&&!selected.has(id))continue;
    for(const k of keys)if(s[k]!=null){sums[k]=(sums[k]??0)+s[k];recorded[k]++;}
  }
  return {sums,recorded};
}
export function teamView(data,teamId){
  return {players:data.coachPlayers.filter(p=>p.teamId===teamId),trainings:data.coachTrainings.filter(t=>t.teamId===teamId).sort(dateOrder),
    matches:data.coachMatches.filter(m=>m.teamId===teamId).sort(dateOrder)};
}
function csvCell(value){
  let s=String(value??'');
  if(/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function coachCsv(view){
  const rows=[['Дата','Соревнование','Соперник','Счёт','Партии','Игрок',...Object.values(metrics)]];
  for(const m of view.matches){
    const score=matchScore(m),base=[m.date,m.competition,m.opponent,score.ours+':'+score.theirs,m.sets.map(x=>x.ours+':'+x.theirs).join(' / ')];
    for(const id of m.roster)rows.push([...base,view.players.find(p=>p.id===id)?.name||'',...keys.map(k=>m.stats[id]?.[k]??'')]);
    if(!m.roster.length)rows.push([...base,'',...keys.map(()=> '')]);
  }
  return '\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
}
export function attendanceCsv(view){
  const rows=[['Дата','Время','Тренировка','Проведена','Игрок','Посещаемость']];
  for(const t of view.trainings)for(const id of t.roster)rows.push([t.date,t.time,t.title,t.held?'Да':'Нет',view.players.find(p=>p.id===id)?.name||'',attendanceLabels[t.attendance[id]]||'Не отмечено']);
  return '\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
}

export async function saveLineup(input){
 const r={id:input.id||uid('lineup'),teamId:input.teamId,name:String(input.name||'').trim(),scheme:input.scheme,roster:[...input.roster],lineup:[...input.lineup],libero:input.libero||null};
 return write('coachLineups',r,(d,old)=>teamGuard(d,old,r));
}
export async function deleteLineup(id){await db.del('coachLineups',id);}
export async function startLiveMatch(input){
 const d={id:uid('live'),teamId:input.teamId,date:input.date,opponent:String(input.opponent||'').trim(),competition:String(input.competition||'').trim(),
   scheme:input.scheme,roster:[...input.roster],lineup:[...input.lineup],libero:input.libero||null,bestOf:input.bestOf,target:input.target,decider:input.decider,firstServe:input.firstServe,events:[],revision:0};
 assert(date(d.date)&&d.date<=todayIso(),'Проверьте дату матча');
 return write('coachLive',d,(data,old)=>{teamGuard(data,old,d);assert(d.roster.every(id=>data.coachPlayers.some(p=>p.id===id&&!p.archived)),'Состав изменился');});
}
export async function changeLiveMatch(id,revision,event){
 return db.transaction(['coachLive'],'readwrite',async s=>{
  const d=await s.coachLive.get(id);assert(d&&d.revision===revision,'Матч изменился. Откройте его заново');
  const next=event===null?undoEvent(d):appendEvent(d,event);
  next.revision++;await s.coachLive.put(next);return next;
 });
}
export async function discardLiveMatch(id,revision){
 return db.transaction(['coachLive'],'readwrite',async s=>{
  const d=await s.coachLive.get(id);assert(d&&d.revision===revision,'Матч изменился. Откройте его заново');await s.coachLive.delete(id);
 });
}
export async function finishLiveMatch(id,revision){
 return db.transaction(coachStores,'readwrite',async s=>{
  const data=Object.fromEntries(await Promise.all(coachStores.map(async n=>[n,await s[n].getAll()])));
  const d=data.coachLive.find(x=>x.id===id);assert(d&&d.revision===revision,'Матч изменился. Откройте его заново');
  const state=replay(d);assert(state.finished,'Сначала завершите матч по партиям');
  const m={id:uid('match'),teamId:d.teamId,date:d.date,opponent:d.opponent,competition:d.competition,sets:state.sets,roster:d.roster,stats:state.stats};
  data.coachMatches.push(m);data.coachLive=data.coachLive.filter(x=>x.id!==id);validateCoachData(data);
  await s.coachMatches.add(m);await s.coachLive.delete(id);return m;
 });
}
