/* Pure coach calculations and CSV serialization; no storage, sessions or DOM. */
import {todayIso} from './model.js';
import {catalog,active,ancestorIds} from './health.js';
import {courtTimeLabel} from './court-time.js';
import {captureSummary,combineCaptureSummaries,captureComparison} from './match-capture.js';
import {replayDetailed,courtTime} from './match-protocol.js';
import {volleyPlayerTime,volleyTimeLabel} from './volleypoint-time.js';
export const attendanceLabels={present:'Присутствовала',absent:'Отсутствовала',limited:'Присутствовала, нагрузка ограничена'};
export const metrics={serves:'Подачи (всего)',serveErrors:'Ошибки на подаче',aces:'Эйсы',receptions:'Приёмы (всего)',receptionGood:'Положительные приёмы',attacks:'Атаки (всего)',attackKills:'Результативные атаки',blocks:'Результативные блоки',points:'Очки (всего)'};
const activityMap=new Map(catalog.map(a=>[a.id,a]));
const keys=Object.keys(metrics);
const dateOrder=(a,b)=>b.date.localeCompare(a.date);

export function indexPlayerRecords(records){
 const index=new Map();
 for(const record of records)for(const id of new Set(record.roster)){
  let rows=index.get(id);if(!rows)index.set(id,rows=[]);rows.push(record);
 }
 return index;
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
// Explicit assists are stored in the event log, not the legacy result stats payload.
export function matchAssistCounts(match){
 const counts=new Map();
 for(const e of match.detail?.events||[])if(e.type==='rally'&&e.side==='ours'&&['kill','tip'].includes(e.kind)&&e.player&&e.assist&&e.assist!==e.player)counts.set(e.assist,(counts.get(e.assist)||0)+1);
 return counts;
}
export function assistTotals(matches,playerId=null){let assists=null,points=null,recorded=0;for(const m of matches){const counts=matchAssistCounts(m);const n=playerId?counts.get(playerId):[...counts.values()].reduce((a,b)=>a+b,0);if(n){assists=(assists??0)+n;recorded++;}const ps=playerId?[m.stats[playerId]]:Object.values(m.stats);for(const st of ps)if(st?.points!=null)points=(points??0)+st.points;}return {assists,points,recorded,contribution:points!=null||assists!=null?(points||0)+(assists||0):null};}
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
export function timedMatchPlayers(state){return timedMatchPlayersWithTime(state,courtTime(state));}
// Reuse the same measured snapshot when a player card already calculated it.
function timedMatchPlayersWithTime(state,t){
 const rows=new Map();
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
 const errors={serve:0,attack:0,receive:0,other:0},captures=[],captureMatches=[];
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
   const state=replayDetailed(m.detail);detailedMatches++;const captured=captureSummary(state.timeline,{player:playerId});captures.push(captured);
   captureMatches.push({matchId:m.id,date:m.date,opponent:m.opponent,...captureComparison(captured)});
   const t=courtTime(state);
   if(t.measured){const ms=t.players.ours[playerId]||0;playingTime.measuredMatches++;if(t.partial)playingTime.partialMatches++;playingTime.totalMs+=ms;playingTime.teamMs+=t.elapsedMs;playingTime.rows.push({matchId:m.id,date:m.date,opponent:m.opponent,ms,teamMs:t.elapsedMs,partial:t.partial,sets:t.sets.map(s=>({measured:s.started,ms:s.started?(s.players.ours[playerId]||0):null,teamMs:s.elapsedMs,partial:s.untrackedRallies>0}))});}else playingTime.unknownMatches++;
   const tm=timedMatchPlayersWithTime(state,t).get(playerId);
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
 return {summary,assists:assistTotals(chosen,playerId),rosterMatches:chosen.length,detailedMatches,rallies,errors,unknownOnCourt,serviceRallies,serviceWins,serviceAces,serviceErrors,unclassifiedServiceLosses,importedMatches,importedErrors,importedBreakdown,importedServiceWins,importedLongestSeries,rates,chosen,playingTime,capture:combineCaptureSummaries(captures),captureMatches};
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
  const rows=[['Дата','Соревнование','Соперник','Счёт','Партии','Игрок',...Object.values(metrics),'Время на площадке (измерено)','Полнота времени','VolleyPoint: время по длительности партий','VolleyPoint: партии с данными','Ассисты (отмечено)','Баллы: очки + ассисты (отмечено)']];
  const names=new Map();for(const p of view.players)if(!names.has(p.id))names.set(p.id,p.name);
  for(const m of view.matches){
    const score=matchScore(m),base=[m.date,m.competition,m.opponent,score.ours+':'+score.theirs,m.sets.map(x=>x.ours+':'+x.theirs).join(' / ')];
    const timing=m.detail?courtTime(replayDetailed(m.detail)):null,assists=matchAssistCounts(m);
    for(const id of m.roster){const historic=volleyPlayerTime(m,id);rows.push([...base,names.get(id)||'',...keys.map(k=>m.stats[id]?.[k]??''),timing?.measured?courtTimeLabel(timing.players.ours[id]||0):'',timing?.measured?(timing.partial?'Частично':'Измерено'):historic?'Восстановлено по PDF':'Нет данных',historic?volleyTimeLabel(historic):'',historic?historic.knownSets+'/'+historic.sets.length:'',assists.get(id)??'',m.stats[id]?.points!=null||assists.has(id)?(m.stats[id]?.points||0)+(assists.get(id)||0):'']);}
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

