/* Автономные данные тренера. Ни одного чтения школьных учеников, отметок или медпрофилей.
   Общий каталог видов нагрузки — только статический, без персональных данных. */
import * as nativeDb from './db.js';
import {uid,todayIso} from './model.js';
import {catalog,validPeriod} from './health.js';
import {replay,appendEvent,undoEvent,validateLiveData} from './volleyball.js';
import {replayDetailed,validBoardColors,validBoardLogos} from './match-protocol.js';
import {mergeVolleyTiming,sameVolleyEvidence} from './volleypoint-time.js';
import {validateVolleyImport,duplicateVolleyMatch} from './volleypoint-import.js';
import {validateCoachTests,guardTestWrite} from './coach-tests.js';
import {metrics,attendanceLabels} from './coach-analytics.js';
// Compatibility facade for existing screens and scoped callers.
export {metrics,attendanceLabels,indexPlayerRecords,trainingWarnings,matchScore,playerAttendance,matchAssistCounts,assistTotals,summarizeStats,timedMatchPlayers,timedRate,playerSeasonStats,teamView,coachCsv,attendanceCsv,playerTrainingLoad} from './coach-analytics.js';
export const coachStores=['coachTeams','coachPlayers','coachTrainings','coachMatches','coachLive','coachLineups','coachTests'];
export const positions={setter:'Связующая',outside:'Доигровщица',opposite:'Диагональная',middle:'Центральная блокирующая',libero:'Либеро',universal:'Универсальная'};
const activityMap=new Map(catalog.map(a=>[a.id,a]));
const str=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const date=v=>typeof v==='string'&&validPeriod(v,null);
const count=v=>Number.isInteger(v)&&v>=0&&v<=9999;
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
const uniq=a=>new Set(a).size===a.length;
const keys=Object.keys(metrics);
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
/** Local roster index preserves record order and original object references.
 * Built anew for each calculation, no stale global cache across edits. */
/** Backend-bound commands; pure analytics and validation stay shared. */
function buildCoachCommands(db){
async function readLiveMatch(id){return db.transaction(['coachLive'],'readonly',async s=>{const d=await s.coachLive.get(id);if(d)replay(d);return d||null;});}
async function listLiveMatches(teamId){return db.transaction(['coachLive'],'readonly',s=>teamId===undefined?s.coachLive.getAll():s.coachLive.index('teamId').getAll(teamId));}
async function listLineups(teamId){return db.transaction(['coachLineups'],'readonly',s=>s.coachLineups.index('teamId').getAll(teamId));}
// The probe is an atomic write/delete; no committed dummy or native backend escape.
async function probeLiveStorage(){const id=uid('live-probe');await db.transaction(['coachLive'],'readwrite',async s=>{await s.coachLive.add({id});await s.coachLive.delete(id);});return true;}
async function loadCoach(){
  return db.readSnapshot(coachStores);
}
/** Team picker and selected-team records from one consistent readonly snapshot.
 * Do not use this partial view for backups, validation, or global search. */
async function loadCoachForView(teamId,{archived=false}={}){
 return db.transaction(coachStores,'readonly',async s=>{
  const coachTeams=await s.coachTeams.getAll(),visible=coachTeams.filter(t=>archived||!t.archived);
  const selected=visible.find(t=>t.id===teamId)||visible[0]||null;
  const rows=await Promise.all(coachStores.filter(n=>n!=='coachTeams').map(async n=>[n,selected?await s[n].index('teamId').getAll(selected.id):[]]));
  return {selectedTeamId:selected?.id??null,data:{coachTeams,...Object.fromEntries(rows)}};
 });
}

// Explicit team and purpose; no fallback to a different team, no full archive scan.
async function loadCoachTeamScope(teamId,scope){
 const scopes={center:['coachPlayers','coachLive','coachLineups'],setup:['coachPlayers','coachMatches','coachLineups'],dossier:['coachPlayers','coachTrainings','coachMatches','coachTests'],season:['coachTrainings','coachMatches']};
 if(!str(teamId)||!Object.hasOwn(scopes,scope))throw Error('Выберите команду и область чтения');
 const names=scopes[scope];
 return db.transaction(['coachTeams',...names],'readonly',async s=>{
  const team=await s.coachTeams.get(teamId);if(!team)throw Error('Команда не найдена');
  const rows=await Promise.all(names.map(async n=>[n,await s[n].index('teamId').getAll(teamId)]));
  return {selectedTeamId:team.id,data:{...Object.fromEntries(coachStores.map(n=>[n,[]])),coachTeams:[team],...Object.fromEntries(rows)}};
 });
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
async function saveTeam(input){
  return write('coachTeams',{id:input.id||uid('team'),name:String(input.name||'').trim(),archived:input.archived===true});
}
async function savePlayer(input){
  const r={id:input.id||uid('player'),teamId:input.teamId,name:String(input.name||'').trim(),number:input.number??null,position:input.position,archived:input.archived===true,
    restrictions:(input.restrictions||[]).map(x=>({activityId:x.activityId,dateFrom:x.dateFrom,dateTo:x.dateTo||null,type:x.type}))};
  return write('coachPlayers',r,(d,old)=>teamGuard(d,old,r));
}
async function saveCoachTest(input){
 const r={id:input.id||uid('coachtest'),teamId:input.teamId,date:input.date,definition:structuredClone(input.definition),results:structuredClone(input.results)};
 return write('coachTests',r,(d,old)=>{if(input.id&&!old)throw Error('Тестирование уже удалено');guardTestWrite(d,old,r);});
}
async function deleteCoachTest(id){await db.del('coachTests',id);}
async function saveTraining(input){
  const r={id:input.id||uid('training'),teamId:input.teamId,date:input.date,time:input.time,title:String(input.title||'').trim(),minutes:input.minutes,
    exercises:(input.exercises||[]).map(x=>({name:String(x.name||'').trim(),activityId:x.activityId,minutes:x.minutes})),roster:[...input.roster],held:input.held===true,attendance:{...input.attendance}};
  if(input.effort!==undefined){assert(input.effort&&typeof input.effort==='object'&&!Array.isArray(input.effort),'Проверьте нагрузку');r.effort=structuredClone(input.effort);}
  assert(!r.held||r.date<=todayIso(),'Будущая тренировка не может быть проведённой');
  return write('coachTrainings',r,(d,old)=>teamGuard(d,old,r));
}
async function saveMatch(input){
  const r={id:input.id||uid('match'),teamId:input.teamId,date:input.date,opponent:String(input.opponent||'').trim(),competition:String(input.competition||'').trim(),
    sets:input.sets.map(x=>({ours:x.ours,theirs:x.theirs})),roster:[...input.roster],stats:Object.fromEntries(Object.entries(input.stats||{}).map(([id,s])=>[id,{...s}]))};
  assert(r.date<=todayIso(),'Результат будущего матча недоступен');
  return write('coachMatches',r,(d,old)=>{teamGuard(d,old,r);assert(!old?.detail&&!old?.imported,'Матч с протоколом нельзя редактировать вручную');});
}
async function saveVolleyImport(input){
 const r={id:uid('match'),teamId:input.teamId,date:input.date,opponent:String(input.opponent||'').trim(),competition:String(input.competition||'').trim(),sets:structuredClone(input.sets),roster:[...input.roster],stats:structuredClone(input.stats),imported:structuredClone(input.imported)};
 assert(r.date<=todayIso(),'Результат будущего матча недоступен');
 return write('coachMatches',r,(d,old)=>{teamGuard(d,old,r);validateVolleyImport(r);assert(!duplicateVolleyMatch(d.coachMatches,r),'Такой матч уже есть в истории');});
}
// Enrich exactly the already imported source; do not replace its identity, user labels,
 // roster mapping, scores or historical statistics. Re-read inside the write transaction.
async function enrichVolleyImport(input,{confirmed=false}={}){
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
async function removeEvent(name,id){
  assert(['coachTrainings','coachMatches'].includes(name),'Нельзя удалить состав этой командой');
  await db.del(name,id);
}

async function saveLineup(input){
 const r={id:input.id||uid('lineup'),teamId:input.teamId,name:String(input.name||'').trim(),scheme:input.scheme,roster:[...input.roster],lineup:[...input.lineup],libero:input.libero||null,...(input.libero2?{libero2:input.libero2}:{}),...(input.purpose!==undefined?{purpose:input.purpose}:{})};
 return write('coachLineups',r,(d,old)=>teamGuard(d,old,r));
}
async function deleteLineup(id){await db.del('coachLineups',id);}
async function startLiveMatch(input){
 const d={id:uid('live'),teamId:input.teamId,date:input.date,opponent:String(input.opponent||'').trim(),competition:String(input.competition||'').trim(),
   scheme:input.scheme,roster:[...input.roster],lineup:[...input.lineup],libero:input.libero||null,bestOf:input.bestOf,target:input.target,decider:input.decider,firstServe:input.firstServe,events:[],revision:0};
 assert(date(d.date)&&d.date<=todayIso(),'Проверьте дату матча');
 return write('coachLive',d,(data,old)=>{teamGuard(data,old,d);assert(d.roster.every(id=>data.coachPlayers.some(p=>p.id===id&&!p.archived)),'Состав изменился');});
}
async function startDetailedMatch(input){
 const d={id:uid('live'),mode:'dual',teamId:input.teamId,date:input.date,opponent:String(input.opponent||'').trim(),competition:String(input.competition||'').trim(),venue:String(input.venue||'').trim(),
   teamName:String(input.teamName||'').trim(),roster:[...input.roster],ourPlayers:input.ourPlayers.map(p=>({id:p.id,name:p.name,number:p.number??null})),awayPlayers:input.awayPlayers.map(p=>({id:p.id,name:p.name,number:p.number??null})),
   lineup:[...input.lineup],awayLineup:[...input.awayLineup],libero:input.libero||null,...(input.libero2?{libero2:input.libero2}:{}),...(input.substitutionMode!==undefined?{substitutionMode:input.substitutionMode}:{}),...(input.limits!==undefined?{limits:{...input.limits}}:{}),...(input.regulation!==undefined?{regulation:structuredClone(input.regulation)}:{}),...(input.boardColors!==undefined?{boardColors:{...input.boardColors}}:{}),...(input.boardLogos!==undefined?{boardLogos:{...input.boardLogos}}:{}),scheme:input.scheme,bestOf:input.bestOf,target:input.target,decider:input.decider,firstServe:input.firstServe,...(input.ourSide!==undefined?{ourSide:input.ourSide}:{}),...(input.liveTiming!==undefined?{liveTiming:input.liveTiming}:{}),startedAt:new Date().toISOString(),events:[],revision:0};
 assert(date(d.date)&&d.date<=todayIso(),'Проверьте дату матча');
 return write('coachLive',d,(data,old)=>{teamGuard(data,old,d);assert(d.roster.every(id=>data.coachPlayers.some(p=>p.id===id&&p.teamId===d.teamId&&!p.archived)),'Состав изменился');});
}
async function changeLiveMatch(id,revision,event){
 return db.transaction(['coachLive'],'readwrite',async s=>{
  const d=await s.coachLive.get(id);assert(d&&d.revision===revision,'Матч изменился. Откройте его заново');
  const next=event===null?undoEvent(d):appendEvent(d,event);
  next.revision++;await s.coachLive.put(next);return next;
 });
}
async function changeLiveColors(id,revision,colors,logos=undefined){
 assert(validBoardColors(colors),'Выберите два разных цвета команд');
 assert(logos===undefined||validBoardLogos(logos),'Проверьте изображения эмблем');
 return db.transaction(['coachLive'],'readwrite',async s=>{
  const d=await s.coachLive.get(id);assert(d?.mode==='dual'&&d.revision===revision,'Матч изменился. Откройте его заново');
  const next={...d,boardColors:{...colors},...(logos!==undefined?{boardLogos:{...logos}}:{}),revision:d.revision+1};replayDetailed(next);
  await s.coachLive.put(next);return next;
 });
}
async function discardLiveMatch(id,revision){
 return db.transaction(['coachLive'],'readwrite',async s=>{
  const d=await s.coachLive.get(id);assert(d&&d.revision===revision,'Матч изменился. Откройте его заново');await s.coachLive.delete(id);
 });
}
async function finishLiveMatch(id,revision){
 return db.transaction(coachStores,'readwrite',async s=>{
  const data=Object.fromEntries(await Promise.all(coachStores.map(async n=>[n,await s[n].getAll()])));
  const d=data.coachLive.find(x=>x.id===id);assert(d&&d.revision===revision,'Матч изменился. Откройте его заново');
  const state=replay(d);assert(state.finished,'Сначала завершите матч по партиям');
  const m={id:uid('match'),teamId:d.teamId,date:d.date,opponent:d.opponent,competition:d.competition,sets:state.sets,roster:d.roster,stats:state.stats,...(d.mode==='dual'?{detail:d}:{})};
  data.coachMatches.push(m);data.coachLive=data.coachLive.filter(x=>x.id!==id);validateCoachData(data);
  await s.coachMatches.add(m);await s.coachLive.delete(id);return m;
 });
}
 return Object.freeze({loadCoach,loadCoachForView,loadCoachTeamScope,readLiveMatch,listLiveMatches,listLineups,probeLiveStorage,saveTeam,savePlayer,saveCoachTest,deleteCoachTest,saveTraining,saveMatch,saveVolleyImport,enrichVolleyImport,removeEvent,saveLineup,deleteLineup,startLiveMatch,startDetailedMatch,changeLiveMatch,changeLiveColors,discardLiveMatch,finishLiveMatch});
}

// Native API stays permanently bound to the existing IndexedDB backend.
export const {loadCoach,loadCoachForView,loadCoachTeamScope,readLiveMatch,listLiveMatches,listLineups,probeLiveStorage,saveTeam,savePlayer,saveCoachTest,deleteCoachTest,saveTraining,saveMatch,saveVolleyImport,enrichVolleyImport,removeEvent,saveLineup,deleteLineup,startLiveMatch,startDetailedMatch,changeLiveMatch,changeLiveColors,discardLiveMatch,finishLiveMatch}=buildCoachCommands(nativeDb);

const coachSessionStores=new Set(coachStores);
const emptyCoachView=()=>({selectedTeamId:null,data:Object.fromEntries([...coachSessionStores].map(n=>[n,[]]))});
/** Explicit coach access owns its handle; never opens native DB or school tables.
 * Call close on lifecycle lock and clear the UI, including any detached data. */
export function createCoachSession(access){
 if(!access||['close','readSnapshot','transaction','del'].some(k=>typeof access[k]!=='function'))throw TypeError('Требуется явный интерфейс тренерского сеанса');
 let closed=false,tail=Promise.resolve(),view=null;
 const guard=()=>{if(closed)throw Error('Тренерский сеанс заблокирован');};
 function invalidateView(){
  if(!view)return;
  const previous=view;view=null;previous.snapshot=emptyCoachView();
 }
 function close(){if(closed)return;closed=true;try{invalidateView();}finally{access.close();}}
 const scoped=Object.freeze(Object.fromEntries(['readSnapshot','transaction','del'].map(method=>[method,async(names,...args)=>{
  guard();const tables=Array.isArray(names)?names:[names];
  if(!tables.length||tables.some(n=>!coachSessionStores.has(n)))throw Error('Хранилище недоступно в тренерском сеансе');
  const result=await access[method](names,...args);guard();return result;
 }])));
 const core=buildCoachCommands(scoped);
 const api={close,isClosed:()=>closed,get view(){guard();return view?.facade??null;}};
 for(const [name,fn] of Object.entries(core)){
  api[name]=async(...args)=>{
   guard();const input=structuredClone(args);
   const job=tail.then(async()=>{
    guard();
    try{
     const result=await fn(...input);guard();
     if(name==='loadCoachForView'||name==='loadCoachTeamScope'){
      invalidateView();const cell={snapshot:result};
      cell.facade=Object.freeze({get selectedTeamId(){return cell.snapshot.selectedTeamId;},get data(){return cell.snapshot.data;}});
      view=cell;return cell.facade;
     }
     if(!['loadCoach','readLiveMatch','listLiveMatches','listLineups','probeLiveStorage'].includes(name))invalidateView();
     return result;
    }catch(e){close();throw e;}
   });
   tail=job.then(()=>undefined,()=>undefined);return job;
  };
 }
 return Object.freeze(api);
}
