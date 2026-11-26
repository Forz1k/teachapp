/* Автономные данные тренера. Ни одного чтения школьных учеников, отметок или медпрофилей.
   Общий каталог видов нагрузки — только статический, без персональных данных. */
import * as db from './db.js';
import {uid,todayIso} from './model.js';
import {catalog,validPeriod,active,ancestorIds} from './health.js';
import {replay,appendEvent,undoEvent,validateLiveData} from './volleyball.js';
import {courtTimeLabel} from './court-time.js';
import {captureSummary,combineCaptureSummaries} from './match-capture.js';
import {replayDetailed,courtTime,validBoardColors,validBoardLogos} from './match-protocol.js';
import {volleyPlayerTime,volleyTimeLabel,mergeVolleyTiming,sameVolleyEvidence} from './volleypoint-time.js';
import {validateVolleyImport,duplicateVolleyMatch} from './volleypoint-import.js';
import {validateCoachTests,guardTestWrite} from './coach-tests.js';
export const coachStores=['coachTeams','coachPlayers','coachTrainings','coachMatches','coachLive','coachLineups','coachTests'];
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
    assert(only(t,['id','teamId','date','time','title','minutes','exercises','roster','attendance','held','effort'])&&str(t.id)&&teamIds.has(t.teamId)&&date(t.date)&&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)&&str(t.title)&&Number.isInteger(t.minutes)&&t.minutes>=1&&t.minutes<=600&&typeof t.held==='boolean'&&
      Array.isArray(t.exercises)&&t.exercises.every(x=>only(x,['name','activityId','minutes'])&&str(x.name)&&activityMap.has(x.activityId)&&Number.isInteger(x.minutes)&&x.minutes>=1&&x.minutes<=600)&&
      t.exercises.reduce((sum,x)=>sum+x.minutes,0)<=t.minutes&&roster(t,t.roster)&&only(t.attendance,t.roster)&&Object.values(t.attendance).every(x=>Object.hasOwn(attendanceLabels,x))&&
      (t.held||!Object.keys(t.attendance).length),'Проверьте тренировку, план и посещаемость');
    assert(t.effort===undefined||only(t.effort,t.roster)&&Object.entries(t.effort).every(([id,r])=>t.held&&['present','limited'].includes(t.attendance[id])&&only(r,['minutes','rpe'])&&Number.isInteger(r.minutes)&&r.minutes>=1&&r.minutes<=600&&Number.isInteger(r.rpe)&&r.rpe>=1&&r.rpe<=10),'Нагрузка: у присутствовавших укажите фактические минуты 1–600 и субъективную сложность 1–10');
  }
  for(const m of matches){
    assert(only(m,['id','teamId','date','opponent','competition','sets','roster','stats','detail','imported'])&&str(m.id)&&teamIds.has(m.teamId)&&date(m.date)&&str(m.opponent)&&typeof m.competition==='string'&&m.competition.length<=200&&
      Array.isArray(m.sets)&&m.sets.length>=1&&m.sets.length<=5&&m.sets.every(s=>only(s,['ours','theirs'])&&count(s.ours)&&count(s.theirs)&&s.ours!==s.theirs)&&
      roster(m,m.roster)&&only(m.stats,m.roster),'Проверьте матч, партии и состав');
    for(const s of Object.values(m.stats))validateStats(s);
    if(m.imported!==undefined)validateVolleyImport(m);
    if(m.detail){
      const d=m.detail,st=replay(d);
      assert(d.mode==='dual'&&d.teamId===m.teamId&&d.date===m.date&&d.opponent===m.opponent&&d.competition===m.competition&&JSON.stringify(d.roster)===JSON.stringify(m.roster)&&st.finished&&JSON.stringify(st.sets)===JSON.stringify(m.sets)&&JSON.stringify(st.stats)===JSON.stringify(m.stats),'Протокол не соответствует результату матча');
    }
  }
  validateLiveData(data);
  validateCoachTests(data);
  return data;
}
export async function loadCoach(){
  return db.readSnapshot(coachStores);
}
/** Team picker and selected-team records from one consistent readonly snapshot.
 * Do not use this partial view for backups, validation, or global search. */
export async function loadCoachForView(teamId,{archived=false}={}){
 return db.transaction(coachStores,'readonly',async s=>{
  const coachTeams=await s.coachTeams.getAll(),visible=coachTeams.filter(t=>archived||!t.archived);
  const selected=visible.find(t=>t.id===teamId)||visible[0]||null;
  const rows=await Promise.all(coachStores.filter(n=>n!=='coachTeams').map(async n=>[n,selected?await s[n].index('teamId').getAll(selected.id):[]]));
  return {selectedTeamId:selected?.id??null,data:{coachTeams,...Object.fromEntries(rows)}};
 });
}
/** Local roster index preserves record order and original object references.
 * Built anew for each calculation, no stale global cache across edits. */
export function indexPlayerRecords(records){
 const index=new Map();
 for(const record of records)for(const id of new Set(record.roster)){
  let rows=index.get(id);if(!rows)index.set(id,rows=[]);rows.push(record);
 }
 return index;
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
export async function saveCoachTest(input){
 const r={id:input.id||uid('coachtest'),teamId:input.teamId,date:input.date,definition:structuredClone(input.definition),results:structuredClone(input.results)};
 return write('coachTests',r,(d,old)=>{if(input.id&&!old)throw Error('Тестирование уже удалено');guardTestWrite(d,old,r);});
}
export async function deleteCoachTest(id){await db.del('coachTests',id);}
export async function saveTraining(input){
  const r={id:input.id||uid('training'),teamId:input.teamId,date:input.date,time:input.time,title:String(input.title||'').trim(),minutes:input.minutes,
    exercises:(input.exercises||[]).map(x=>({name:String(x.name||'').trim(),activityId:x.activityId,minutes:x.minutes})),roster:[...input.roster],held:input.held===true,attendance:{...input.attendance}};
  if(input.effort!==undefined){assert(input.effort&&typeof input.effort==='object'&&!Array.isArray(input.effort),'Проверьте нагрузку');r.effort=structuredClone(input.effort);}
  assert(!r.held||r.date<=todayIso(),'Будущая тренировка не может быть проведённой');
  return write('coachTrainings',r,(d,old)=>teamGuard(d,old,r));
}
export async function saveMatch(input){
  const r={id:input.id||uid('match'),teamId:input.teamId,date:input.date,opponent:String(input.opponent||'').trim(),competition:String(input.competition||'').trim(),
    sets:input.sets.map(x=>({ours:x.ours,theirs:x.theirs})),roster:[...input.roster],stats:Object.fromEntries(Object.entries(input.stats||{}).map(([id,s])=>[id,{...s}]))};
  assert(r.date<=todayIso(),'Результат будущего матча недоступен');
  return write('coachMatches',r,(d,old)=>{teamGuard(d,old,r);assert(!old?.detail&&!old?.imported,'Матч с протоколом нельзя редактировать вручную');});
}
export async function saveVolleyImport(input){
 const r={id:uid('match'),teamId:input.teamId,date:input.date,opponent:String(input.opponent||'').trim(),competition:String(input.competition||'').trim(),sets:structuredClone(input.sets),roster:[...input.roster],stats:structuredClone(input.stats),imported:structuredClone(input.imported)};
 assert(r.date<=todayIso(),'Результат будущего матча недоступен');
 return write('coachMatches',r,(d,old)=>{teamGuard(d,old,r);validateVolleyImport(r);assert(!duplicateVolleyMatch(d.coachMatches,r),'Такой матч уже есть в истории');});
}
// Enrich exactly the already imported source; do not replace its identity, user labels,
 // roster mapping, scores or historical statistics. Re-read inside the write transaction.
export async function enrichVolleyImport(input,{confirmed=false}={}){
 assert(confirmed,'Подтвердите дополнение существующего матча');validateVolleyImport(input);
 return db.transaction(coachStores,'readwrite',async s=>{
  const data=Object.fromEntries(await Promise.all(coachStores.map(async n=>[n,await s[n].getAll()])));
  const matches=data.coachMatches.filter(m=>m.teamId===input.teamId&&m.imported?.hash===input.imported.hash);
  assert(matches.length===1,'Исходный импорт не найден или неоднозначен');const old=matches[0];
  const evidence=m=>{const {timing,...imported}=m.imported;return {roster:m.roster,sets:m.sets,stats:m.stats,imported};};
  assert(sameVolleyEvidence(evidence(old),evidence(input)),'PDF или сопоставление игроков отличается от сохранённого матча');
  const timing=mergeVolleyTiming(old.imported.timing,input.imported.timing);
  const r={...old,imported:{...old.imported,timing}};
  if(sameVolleyEvidence(old,r))return old;
  data.coachMatches=data.coachMatches.map(m=>m.id===r.id?r:m);validateCoachData(data);await s.coachMatches.put(r);return r;
 });
}
export async function removeEvent(name,id){
  assert(['coachTrainings','coachMatches'].includes(name),'Нельзя удалить состав этой командой');
  await db.del(name,id);
}
export function trainingWarnings(training,players){
  const out=[];
  for(const p of players.filter(p=>training.roster.includes(p.id))){
    for(const r of p.restrictions.filter(r=>active(r,training.date))){
      const applicable=x=>r.type!=='no_test'||ancestorIds(x.activityId,activityMap).ancestors.has('test');
      const exercises=training.exercises.filter(x=>applicable(x)&&ancestorIds(x.activityId,activityMap).ancestors.has(r.activityId));
      const possible=training.exercises.filter(x=>applicable(x)&&!exercises.includes(x)&&ancestorIds(r.activityId,activityMap).ancestors.has(x.activityId));
      if(exercises.length)out.push({player:p,restriction:r,exercises});
      if(possible.length)out.push({player:p,restriction:r,exercises:possible,potential:true});
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
// Aggregate only comparable observations. A terminal-action protocol does not
// provide the denominator of all attacks or receptions.
export function timedMatchPlayers(state){
 const t=courtTime(state),rows=new Map();
 for(const [id,ms] of Object.entries(t.players.ours))rows.set(id,{ms,rallies:0,won:0,lost:0,points:0,unattributedWins:0});
 for(const e of state.timeline){
  if(e.type!=='rally'||!e.clockRunning)continue;
  for(const id of e.before.lineups.ours){
   if(!rows.has(id))rows.set(id,{ms:0,rallies:0,won:0,lost:0,points:0,unattributedWins:0});
   const r=rows.get(id);r.rallies++;if(e.side==='ours'){r.won++;if(e.kind==='point'||e.player==null)r.unattributedWins++;if(e.actor==='ours'&&e.player===id&&['ace','kill','tip','block'].includes(e.kind))r.points++;}else r.lost++;
  }
 }
 return rows;
}
export function timedRate(r){return r.ms>=600000&&r.rallies>=10?r.points*600000/r.ms:null;}
export function playerSeasonStats(matches,playerId,{from='',to=''}={}){
 const chosen=matches.filter(m=>m.roster.includes(playerId)&&(!from||m.date>=from)&&(!to||m.date<=to));
 const summary=summarizeStats(chosen,[playerId]);
 const errors={serve:0,attack:0,receive:0,other:0},captures=[];
 let detailedMatches=0,rallies=0,serviceRallies=0,serviceWins=0,serviceAces=0,serviceErrors=0,unclassifiedServiceLosses=0,unknownOnCourt=0;
 const playingTime={measuredMatches:0,partialMatches:0,unknownMatches:0,totalMs:0,teamMs:0,timedRallies:0,timedPoints:0,timedWon:0,timedLost:0,unattributedTimedWins:0,rateMatches:0,rateMs:0,ratePoints:0,rateRallies:0,rows:[],historicalMatches:0,historicalPartialMatches:0,historicalMinMs:0,historicalMaxMs:0,historicalRows:[]};
 let importedMatches=0,importedServiceWins=0,importedLongestSeries=0,importedErrors=0;
 const importedBreakdown={serve:0,attack:0,receive:0,other:0};
 const rates={serve:{total:0,success:0},receive:{total:0,success:0},attack:{total:0,success:0}};
 for(const m of chosen){
  if(!m.detail&&!m.imported)playingTime.unknownMatches++;
  if(m.imported){
   const t=volleyPlayerTime(m,playerId);if(t){playingTime.historicalMatches++;playingTime.historicalPartialMatches+=Number(t.partial);playingTime.historicalMinMs+=t.minMs;playingTime.historicalMaxMs+=t.maxMs;playingTime.historicalRows.push({matchId:m.id,date:m.date,opponent:m.opponent,...t});}else playingTime.unknownMatches++;
   const p=m.imported.players[playerId];if(p){importedMatches++;importedErrors+=p.errors;importedBreakdown.serve+=p.serveErrors;importedBreakdown.attack+=p.attackErrors;importedBreakdown.receive+=p.receiveErrors;importedBreakdown.other+=p.otherErrors;for(const s of p.serviceSeries){importedServiceWins+=s.wins;importedLongestSeries=Math.max(importedLongestSeries,s.wins);}}
   continue;
  }
  if(m.detail){
   const state=replayDetailed(m.detail);detailedMatches++;captures.push(captureSummary(state.timeline,{player:playerId}));
   const t=courtTime(state);
   if(t.measured){const ms=t.players.ours[playerId]||0;playingTime.measuredMatches++;if(t.partial)playingTime.partialMatches++;playingTime.totalMs+=ms;playingTime.teamMs+=t.elapsedMs;playingTime.rows.push({matchId:m.id,date:m.date,opponent:m.opponent,ms,teamMs:t.elapsedMs,partial:t.partial,sets:t.sets.map(s=>({measured:s.started,ms:s.started?(s.players.ours[playerId]||0):null,teamMs:s.elapsedMs,partial:s.untrackedRallies>0}))});}else playingTime.unknownMatches++;
   const tm=timedMatchPlayers(state).get(playerId);
   if(tm){playingTime.timedRallies+=tm.rallies;playingTime.timedPoints+=tm.points;playingTime.timedWon+=tm.won;playingTime.timedLost+=tm.lost;playingTime.unattributedTimedWins+=tm.unattributedWins;
    if(tm.ms>0){playingTime.rateMs+=tm.ms;playingTime.rateRallies+=tm.rallies;playingTime.ratePoints+=tm.points;playingTime.rateMatches+=Number(tm.rallies>0);}}
   const stat=state.sides.ours.stats[playerId]||{};
   errors.serve+=stat.serveErrors||0;errors.attack+=stat.attackErrors||0;errors.receive+=stat.receiveErrors||0;errors.other+=stat.otherErrors||0;
   for(const e of state.timeline){
    if(e.type!=='rally'||!e.before?.lineups.ours.includes(playerId))continue;
    rallies++;
    if(e.kind==='point'||e.player==null)unknownOnCourt++;
    if(e.before.serve!=='ours'||e.before.lineups.ours[0]!==playerId)continue;
    serviceRallies++;if(e.side==='ours')serviceWins++;
    if(e.kind==='ace')serviceAces++;
    if(e.kind==='serveError')serviceErrors++;
    if(e.side==='theirs'&&e.kind==='point')unclassifiedServiceLosses++;
   }
   continue;
  }
  const x=m.stats[playerId]||{};
  for(const [key,total,success,complement] of [['serve','serves','serveErrors',true],['receive','receptions','receptionGood',false],['attack','attacks','attackKills',false]]){
   if(x[total]==null||x[success]==null||x[total]<=0)continue;
   rates[key].total+=x[total];rates[key].success+=complement?x[total]-x[success]:x[success];
  }
 }
 playingTime.pointsPer10=timedRate({ms:playingTime.rateMs,rallies:playingTime.rateRallies,points:playingTime.ratePoints});
 return {summary,rosterMatches:chosen.length,detailedMatches,rallies,errors,unknownOnCourt,serviceRallies,serviceWins,serviceAces,serviceErrors,unclassifiedServiceLosses,importedMatches,importedErrors,importedBreakdown,importedServiceWins,importedLongestSeries,rates,chosen,playingTime,capture:combineCaptureSummaries(captures)};
}
export function teamView(data,teamId){
  return {players:data.coachPlayers.filter(p=>p.teamId===teamId),trainings:data.coachTrainings.filter(t=>t.teamId===teamId).sort(dateOrder),
    matches:data.coachMatches.filter(m=>m.teamId===teamId).sort(dateOrder),tests:(data.coachTests||[]).filter(s=>s.teamId===teamId).sort(dateOrder)};
}
function csvCell(value){
  let s=String(value??'');
  if(/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function coachCsv(view){
  const rows=[['Дата','Соревнование','Соперник','Счёт','Партии','Игрок',...Object.values(metrics),'Время на площадке (измерено)','Полнота времени','VolleyPoint: время по длительности партий','VolleyPoint: партии с данными']];
  const names=new Map();for(const p of view.players)if(!names.has(p.id))names.set(p.id,p.name);
  for(const m of view.matches){
    const score=matchScore(m),base=[m.date,m.competition,m.opponent,score.ours+':'+score.theirs,m.sets.map(x=>x.ours+':'+x.theirs).join(' / ')];
    const timing=m.detail?courtTime(replayDetailed(m.detail)):null;
    for(const id of m.roster){const historic=volleyPlayerTime(m,id);rows.push([...base,names.get(id)||'',...keys.map(k=>m.stats[id]?.[k]??''),timing?.measured?courtTimeLabel(timing.players.ours[id]||0):'',timing?.measured?(timing.partial?'Частично':'Измерено'):historic?'Восстановлено по PDF':'Нет данных',historic?volleyTimeLabel(historic):'',historic?historic.knownSets+'/'+historic.sets.length:'']);}
    if(!m.roster.length)rows.push([...base,'',...keys.map(()=> ''),'','','','']);
  }
  return '\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
}
export function attendanceCsv(view){
  const rows=[['Дата','Время','Тренировка','Проведена','Игрок','Посещаемость']];
  const names=new Map();for(const p of view.players)if(!names.has(p.id))names.set(p.id,p.name);
  for(const t of view.trainings)for(const id of t.roster)rows.push([t.date,t.time,t.title,t.held?'Да':'Нет',names.get(id)||'',attendanceLabels[t.attendance[id]]||'Не отмечено']);
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
export async function startDetailedMatch(input){
 const d={id:uid('live'),mode:'dual',teamId:input.teamId,date:input.date,opponent:String(input.opponent||'').trim(),competition:String(input.competition||'').trim(),venue:String(input.venue||'').trim(),
   teamName:String(input.teamName||'').trim(),roster:[...input.roster],ourPlayers:input.ourPlayers.map(p=>({id:p.id,name:p.name,number:p.number??null})),awayPlayers:input.awayPlayers.map(p=>({id:p.id,name:p.name,number:p.number??null})),
   lineup:[...input.lineup],awayLineup:[...input.awayLineup],libero:input.libero||null,...(input.libero2?{libero2:input.libero2}:{}),...(input.substitutionMode!==undefined?{substitutionMode:input.substitutionMode}:{}),...(input.limits!==undefined?{limits:{...input.limits}}:{}),...(input.regulation!==undefined?{regulation:structuredClone(input.regulation)}:{}),...(input.boardColors!==undefined?{boardColors:{...input.boardColors}}:{}),...(input.boardLogos!==undefined?{boardLogos:{...input.boardLogos}}:{}),scheme:input.scheme,bestOf:input.bestOf,target:input.target,decider:input.decider,firstServe:input.firstServe,startedAt:new Date().toISOString(),events:[],revision:0};
 assert(date(d.date)&&d.date<=todayIso(),'Проверьте дату матча');
 return write('coachLive',d,(data,old)=>{teamGuard(data,old,d);assert(d.roster.every(id=>data.coachPlayers.some(p=>p.id===id&&p.teamId===d.teamId&&!p.archived)),'Состав изменился');});
}
export async function changeLiveMatch(id,revision,event){
 return db.transaction(['coachLive'],'readwrite',async s=>{
  const d=await s.coachLive.get(id);assert(d&&d.revision===revision,'Матч изменился. Откройте его заново');
  const next=event===null?undoEvent(d):appendEvent(d,event);
  next.revision++;await s.coachLive.put(next);return next;
 });
}
export async function changeLiveColors(id,revision,colors,logos=undefined){
 assert(validBoardColors(colors),'Выберите два разных цвета команд');
 assert(logos===undefined||validBoardLogos(logos),'Проверьте изображения эмблем');
 return db.transaction(['coachLive'],'readwrite',async s=>{
  const d=await s.coachLive.get(id);assert(d?.mode==='dual'&&d.revision===revision,'Матч изменился. Откройте его заново');
  const next={...d,boardColors:{...colors},...(logos!==undefined?{boardLogos:{...logos}}:{}),revision:d.revision+1};replayDetailed(next);
  await s.coachLive.put(next);return next;
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
  const m={id:uid('match'),teamId:d.teamId,date:d.date,opponent:d.opponent,competition:d.competition,sets:state.sets,roster:d.roster,stats:state.stats,...(d.mode==='dual'?{detail:d}:{})};
  data.coachMatches.push(m);data.coachLive=data.coachLive.filter(x=>x.id!==id);validateCoachData(data);
  await s.coachMatches.add(m);await s.coachLive.delete(id);return m;
 });
}

/** sRPE load = explicitly recorded actual minutes × perceived effort, not planned duration. */
export function playerTrainingLoad(playerId,trainings,{from='',to='',today=todayIso()}={}){
 const rows=[];let attended=0;
 for(const t of trainings){
  if(!t.held||t.date>today||from&&t.date<from||to&&t.date>to||!['present','limited'].includes(t.attendance[playerId]))continue;
  attended++;const r=t.effort?.[playerId];
  if(!r)continue;
  rows.push({date:t.date,title:t.title,minutes:r.minutes,rpe:r.rpe,value:r.minutes*r.rpe});
 }
 rows.sort((a,b)=>a.date.localeCompare(b.date));
 return {rows,attended,known:rows.length,unknown:attended-rows.length,total:rows.length?rows.reduce((n,r)=>n+r.value,0):null};
}
