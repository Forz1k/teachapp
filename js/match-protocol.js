import {createCourtClock,clockAdvance,clockEvent,clockPause,clockRally,clockNext,clockSummary} from './court-time.js';
import {validateCapture} from './match-capture.js';
import {validMatchFormat,regulationOf,isSetWon} from './match-rules.js';
/* TeachApp — detailed event-sourced indoor match. No external service. */
const fail=(ok,msg)=>{if(!ok)throw Error(msg);};
const sides=['ours','theirs'],other=s=>s==='ours'?'theirs':'ours';
const text=(x,max=200)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const integer=(x,min,max)=>Number.isInteger(x)&&x>=min&&x<=max;
const timestamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const uniq=a=>new Set(a).size===a.length;
export const liberoIds=d=>[d.libero,d.libero2].filter(Boolean);
export const sanctionTypes={warning:'Предупреждение (жёлтая)',penalty:'Замечание / штраф (красная)',expulsion:'Удаление',disqualification:'Дисквалификация',other:'Другая судейская санкция'};
export const reasons={point:'Без детализации',kill:'Атака',tip:'Скидка',block:'Блок',ace:'Эйс',serveError:'Ошибка подачи',attackError:'Ошибка атаки',receiveError:'Ошибка приёма',defenseError:'Ошибка защиты',setError:'Ошибка передачи',netError:'Касание сетки',otherError:'Другая ошибка'};
export const boardPalette={blue:{label:'Синий',start:'#2265B8',end:'#123C79'},red:{label:'Красный',start:'#C33E50',end:'#812238'},green:{label:'Зелёный',start:'#19754D',end:'#105137'},purple:{label:'Фиолетовый',start:'#7546AB',end:'#482775'},orange:{label:'Оранжевый',start:'#A94C13',end:'#783009'},graphite:{label:'Графитовый',start:'#4C596C',end:'#293445'}};
export const defaultBoardColors={ours:'blue',theirs:'red'};
export function validBoardColors(colors){return !!colors&&typeof colors==='object'&&!Array.isArray(colors)&&Object.keys(colors).length===2&&sides.every(side=>Object.hasOwn(boardPalette,colors[side]))&&colors.ours!==colors.theirs;}
export function validBoardLogos(logos){return !!logos&&typeof logos==='object'&&!Array.isArray(logos)&&Object.keys(logos).length===2&&sides.every(side=>logos[side]===null||typeof logos[side]==='string'&&logos[side].length<=120000&&/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(logos[side]));}
// Most recent detailed encounter per opponent; never copy into a new match without explicit selection.
export function opponentHistory(matches,teamId){
 const seen=new Set();return matches.filter(m=>m.teamId===teamId&&m.detail?.mode==='dual'&&m.detail.awayPlayers.length>=6&&m.detail.awayPlayers.length<=30&&m.detail.awayPlayers.every(p=>Number.isInteger(p.number))&&uniq(m.detail.awayPlayers.map(p=>p.number))).sort((a,b)=>b.date.localeCompare(a.date)||b.detail.startedAt.localeCompare(a.detail.startedAt)).filter(m=>{const k=m.opponent.trim().toLocaleLowerCase('ru');if(seen.has(k))return false;seen.add(k);return true;});
}
const errors=['serveError','attackError','receiveError','defenseError','setError','netError','otherError'];
export const canPlace=kind=>['ace','kill','tip','receiveError','defenseError'].includes(kind);
export const isError=k=>errors.includes(k);
export const rallyActor=(winner,kind)=>isError(kind)?other(winner):winner;
export const secondaryKind=kind=>kind==='ace'?'receiveError':['kill','tip'].includes(kind)?'defenseError':null;
// Filter the choices for new entry; legacy receiveError events remain replayable.
export function rallyReasonOptions(winner,serve){
 fail(sides.includes(winner)&&sides.includes(serve),'Выберите команду');
 return Object.keys(reasons).filter(k=>k==='ace'?serve===winner:k==='serveError'?serve!==winner:k==='receiveError'?serve===winner:true);
}
export function rallyCandidates(d,lineups,serve,winner,kind){
 if(kind==='point'||!Object.hasOwn(reasons,kind))return [];
 const actor=rallyActor(winner,kind),ids=lineups[actor];
 const roster=actor==='ours'?d.ourPlayers:d.awayPlayers;
 return ids.flatMap((id,i)=>{
  if(['ace','serveError'].includes(kind)&&(actor!==serve||i!==0))return [];
  if(kind==='block'&&![1,2,3].includes(i))return [];
  if(actor==='ours'&&liberoIds(d).includes(id)&&['kill','tip','block'].includes(kind))return [];
  const player=roster.find(p=>p.id===id);
  return player?[{...player,zone:i+1}]:[];
 });
}
const rallyStatKeys={ace:['serves','aces','points'],kill:['attacks','attackKills','points'],tip:['attacks','attackKills','tipKills','points'],block:['blocks','points'],serveError:['serves','serveErrors','errors'],attackError:['attacks','errors','attackErrors'],receiveError:['receptions','errors','receiveErrors'],defenseError:['errors','otherErrors','defenseErrors'],setError:['errors','otherErrors','setErrors'],netError:['errors','otherErrors','netErrors'],otherError:['errors','otherErrors']};
const emptyRotations=()=>Array.from({length:6},(_,i)=>({position:i+1,rallies:0,won:0,lost:0}));
const sideData=()=>({stats:{},points:0,opponentErrors:0,onServe:0,maxRun:0,run:0,rotations:emptyRotations(),runs:[],activeRun:null,unknown:0});
const validRoster=arr=>Array.isArray(arr)&&arr.length<=100&&arr.every(p=>text(p.id)&&text(p.name)&&integer(p.number??0,0,99))&&uniq(arr.map(p=>p.id));
const validLine=(l,roster,optional=false)=>Array.isArray(l)&&(optional&&l.length===0||l.length===6&&uniq(l)&&l.every(id=>roster.some(p=>p.id===id)));
const copy=x=>structuredClone(x);
const rotate=l=>l.length?[...l.slice(1),l[0]]:[];
const score=s=>s.score.ours+':'+s.score.theirs;
// Optional paired substitutions: one reserve per starter in a set, then the starter may return once.
const substitutionState=(ours,theirs)=>({ours:{starters:[...ours],pairs:[]},theirs:{starters:[...theirs],pairs:[]}});
function allowedPair(state,out,incoming){
 const pair=state.pairs.find(p=>p.starter===out||p.reserve===out);
 if(state.starters.includes(out))return !pair&&!state.starters.includes(incoming)&&!state.pairs.some(p=>p.reserve===incoming);
 return !!pair&&!pair.returned&&pair.reserve===out&&pair.starter===incoming;
}
export const matchLimits=d=>d.limits??{substitutions:6,timeouts:2};
export function validMatchLimits(v){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===2&&integer(v.substitutions,0,20)&&integer(v.timeouts,0,5);}
export function legalSubstitutions(d,s,side,out){
 if(!sides.includes(side)||s.setEnded||s.finished||s.subCounts[side]>=matchLimits(d).substitutions)return [];
 const line=side==='ours'?s.lineup:s.awayLineup,roster=side==='ours'?d.ourPlayers:d.awayPlayers;
 if(!line.includes(out)||side==='ours'&&out===s.liberoFor)return [];
 return roster.filter(p=>!line.includes(p.id)&&(side!=='ours'||!liberoIds(d).includes(p.id))&&(d.substitutionMode!=='paired'||allowedPair(s.substitutionState[side],out,p.id)));
}
export function liberoIntervalPending(d,s){return regulationOf(d).liberoInterval==='oneRally'&&s.lastLiberoRally===s.rallyCount;}
export function replayDetailed(d){
 fail(d.mode==='dual'&&text(d.teamName)&&text(d.opponent)&&typeof d.competition==='string'&&d.competition.length<=200&&typeof d.venue==='string'&&d.venue.length<=200&&
   timestamp(d.startedAt)&&validRoster(d.ourPlayers)&&validRoster(d.awayPlayers)&&Array.isArray(d.roster)&&uniq(d.roster)&&
   d.roster.length===d.ourPlayers.length&&d.roster.every(id=>d.ourPlayers.some(p=>p.id===id))&&d.awayPlayers.every(p=>!d.roster.includes(p.id))&&
   validLine(d.lineup,d.ourPlayers)&&validLine(d.awayLineup,d.awayPlayers,true)&&(!d.awayPlayers.length||d.awayLineup.length===6)&&
   (d.libero===null||d.ourPlayers.some(p=>p.id===d.libero)&&!d.lineup.includes(d.libero))&&
   (d.libero2==null||d.libero&&d.libero2!==d.libero&&d.ourPlayers.some(p=>p.id===d.libero2)&&!d.lineup.includes(d.libero2))&&
   validMatchFormat(d)&&sides.includes(d.firstServe)&&
   (d.limits===undefined||validMatchLimits(d.limits))&&(d.boardColors===undefined||validBoardColors(d.boardColors))&&(d.boardLogos===undefined||validBoardLogos(d.boardLogos))&&['5-1','4-2','free'].includes(d.scheme)&&(d.substitutionMode===undefined||['simple','paired'].includes(d.substitutionMode))&&Array.isArray(d.events)&&d.events.length<=5000,'Проверьте параметры матча');
 const rosters={ours:d.ourPlayers,theirs:d.awayPlayers};
 const s={lineup:[...d.lineup],awayLineup:[...d.awayLineup],liberoFor:null,liberoId:null,serve:d.firstServe,score:{ours:0,theirs:0},sets:[],setDetails:[],timeouts:{ours:0,theirs:0},subCounts:{ours:0,theirs:0},substitutionState:substitutionState(d.lineup,d.awayLineup),rotations:{ours:0,theirs:0},sides:{ours:sideData(),theirs:sideData()},timeline:[],setEnded:false,finished:false,endsSwapped:false,endsAtBreak:false,deciderEndsChanged:false,rallyCount:0,lastLiberoRally:null,changeDue:false};
 let setStarted=d.startedAt,lastAt=d.startedAt;
 const clock=createCourtClock(d.startedAt);
 const setNo=()=>s.sets.length+1;
 const lineupFor=side=>side==='ours'?s.lineup:s.awayLineup;
 const visible=side=>lineupFor(side).map(id=>side==='ours'&&id===s.liberoFor?s.liberoId:id);
 const server=side=>visible(side)[0]||null;
 const clockLineups=()=>({ours:visible('ours'),theirs:visible('theirs')});
 const startLineups=()=>({ours:[...s.lineup],theirs:[...s.awayLineup]});
 let starting=startLineups();
 const flush=side=>{const a=s.sides[side];if(a.activeRun){a.runs.push(a.activeRun);a.activeRun=null;}};
 const clearLibero=()=>{if(s.liberoFor!==null&&([2,3,4].includes(s.lineup.indexOf(s.liberoFor)+1)||s.serve==='ours'&&s.lineup[0]===s.liberoFor)){s.liberoFor=null;s.liberoId=null;}};
 function stat(side,id,keys){
  if(id==null)return;
  fail(visible(side).includes(id),'Игрок не на площадке до розыгрыша');
  const r=s.sides[side].stats[id]??={};
  for(const k of keys)r[k]=(r[k]||0)+1;
 }
 function timeline(ev,extra={}){s.timeline.push({set:setNo(),score:score(s),...ev,...extra});}
 for(const ev of d.events){
  fail(ev&&typeof ev==='object'&&!s.finished&&timestamp(ev.at)&&Date.parse(ev.at)>=Date.parse(lastAt),'Некорректная последовательность событий');lastAt=ev.at;
  clockAdvance(clock,ev.at,clockLineups());
  if(ev.type==='clock'){
   fail(!s.setEnded,'Нельзя запускать время между партиями');clockEvent(clock,ev);timeline(ev);continue;
  }
  if(ev.type==='next'){
   fail(s.setEnded&&validLine(ev.lineup,d.ourPlayers)&&!liberoIds(d).some(id=>ev.lineup.includes(id))&&validLine(ev.awayLineup,d.awayPlayers,true)&&(!d.awayPlayers.length||ev.awayLineup.length===6)&&sides.includes(ev.serve),'Проверьте расстановку следующей партии');
   Object.assign(s,{lineup:[...ev.lineup],awayLineup:[...ev.awayLineup],liberoFor:null,liberoId:null,serve:ev.serve,score:{ours:0,theirs:0},timeouts:{ours:0,theirs:0},subCounts:{ours:0,theirs:0},substitutionState:substitutionState(ev.lineup,ev.awayLineup),rotations:{ours:0,theirs:0},setEnded:false,endsAtBreak:false,deciderEndsChanged:false,lastLiberoRally:null});
   for(const side of sides){s.sides[side].run=0;flush(side);}
   clockNext(clock);setStarted=ev.at;starting=startLineups();continue;
  }
  if(ev.type==='changeEnds'){
   clockPause(clock);s.endsSwapped=!s.endsSwapped;if(s.setEnded)s.endsAtBreak=true;
   if(!s.setEnded&&d.bestOf>1&&s.sets.length===d.bestOf-1&&Math.max(s.score.ours,s.score.theirs)>=regulationOf(d).deciderSwitchAt)s.deciderEndsChanged=true;
   s.timeline.push({...ev,set:s.setEnded?s.sets.length:setNo(),score:score(s),endsSwapped:s.endsSwapped});continue;
  }
  fail(!s.setEnded,'Начните следующую партию');
  if(ev.type==='timeout'){
   fail(sides.includes(ev.side)&&s.timeouts[ev.side]<matchLimits(d).timeouts,'Лимит тайм-аутов ('+matchLimits(d).timeouts+')');s.timeouts[ev.side]++;clockPause(clock);timeline(ev,{number:s.timeouts[ev.side]});continue;
  }
  if(ev.type==='sub'){
   fail(sides.includes(ev.side),'Выберите команду');
   const l=lineupFor(ev.side),i=l.indexOf(ev.out);
   fail(i>=0&&rosters[ev.side].some(p=>p.id===ev.in)&&!l.includes(ev.in)&&s.subCounts[ev.side]<matchLimits(d).substitutions&&
    (ev.side!=='ours'||ev.out!==s.liberoFor&&!liberoIds(d).includes(ev.in)),'Проверьте замену или лимит ('+matchLimits(d).substitutions+')');
   if(d.substitutionMode==='paired'){
    const state=s.substitutionState[ev.side];
    fail(allowedPair(state,ev.out,ev.in),'Парная замена: стартовый игрок возвращается только вместо своего запасного, один раз за партию');
    if(state.starters.includes(ev.out))state.pairs.push({starter:ev.out,reserve:ev.in,returned:false});
    else state.pairs.find(p=>p.reserve===ev.out).returned=true;
   }
   if(s.serve===ev.side&&i===0)flush(ev.side);
   l[i]=ev.in;s.subCounts[ev.side]++;timeline(ev,{zone:i+1});continue;
  }
  if(ev.type==='libero'){
   const previous=s.liberoId,blocked=liberoIntervalPending(d,s);
   fail(!blocked||text(ev.exception,200),'Между записанными сменами либеро нужен завершённый розыгрыш или подтверждённое судейское исключение');
   fail(ev.exception===undefined||blocked&&text(ev.exception,200),'Укажите причину исключения только при действующем интервале');
   if(ev.for===null){fail(s.liberoFor!==null,'Либеро не на площадке');s.liberoFor=null;s.liberoId=null;}
   else{
    const z=s.lineup.indexOf(ev.for)+1,player=ev.player??d.libero;
    fail(liberoIds(d).includes(player)&&[1,5,6].includes(z)&&!(z===1&&s.serve==='ours'),'Либеро заменяет игрока задней линии, кроме подачи');
    fail(s.liberoFor===null||s.liberoFor===ev.for&&s.liberoId!==player,'На площадке может быть только один либеро');
    s.liberoFor=ev.for;s.liberoId=player;
   }
   s.lastLiberoRally=s.rallyCount;timeline(ev,{side:'ours',player:s.liberoId,previousLibero:previous});continue;
  }
  if(ev.type==='sanction'){
   fail(sides.includes(ev.side)&&Object.hasOwn(sanctionTypes,ev.category)&&(ev.player===null||rosters[ev.side].some(p=>p.id===ev.player))&&typeof ev.note==='string'&&ev.note.length<=500,'Проверьте санкцию и участника');
   // Recording the referee's decision is separate from scoring and roster decisions.
   timeline(ev);continue;
  }
  fail(ev.type==='rally'&&sides.includes(ev.side)&&Object.hasOwn(reasons,ev.kind),'Неизвестное действие');
  clockRally(clock);
  const winner=ev.side,actor=rallyActor(winner,ev.kind),player=ev.player??null,before={lineups:{ours:visible('ours'),theirs:visible('theirs')},serve:s.serve};
  fail(ev.kind!=='point'||player===null,'Для неуточнённого очка не указывайте игрока');
  fail(ev.placement==null||canPlace(ev.kind)&&integer(ev.placement,1,6),'Зона завершения — 1–6 для эйса, атаки, скидки, ошибки приёма или защиты');
  if(player!==null)fail(visible(actor).includes(player),'Выберите игрока до перехода');
  if(['ace','serveError'].includes(ev.kind))fail(s.serve===actor&&(player===null||server(actor)===player),'Эйс или ошибка подачи относится к подающей команде и игроку');
  if(ev.kind==='block'&&player!==null)fail([2,3,4].includes(lineupFor(actor).indexOf(player)+1)&&!(actor==='ours'&&liberoIds(d).includes(player)),'Блок — игрок передней линии');
  if(['kill','tip'].includes(ev.kind)&&actor==='ours'&&player!==null)fail(!liberoIds(d).includes(player),'Проверьте действие либеро');
  const observations=ev.observations??[];
  fail(Array.isArray(observations)&&observations.length<=30,'Не более 30 наблюдений за розыгрыш');
  let receptions=0;
  for(const o of observations){
   fail(o&&sides.includes(o.side)&&['serve','attack','tip','defense'].includes(o.kind)&&typeof o.player==='string'&&visible(o.side).includes(o.player),'Наблюдение: выберите игрока на площадке до розыгрыша');
   if(o.kind==='serve'){receptions++;fail(receptions<=1&&o.side!==s.serve&&!['ace','receiveError','serveError'].includes(ev.kind),'Успешный приём возможен только один раз после подачи, продолжившей розыгрыш');}
  }
  validateCapture(ev,before,actor);
  const keys=rallyStatKeys;
  if(keys[ev.kind])stat(actor,player,keys[ev.kind]);
  if(ev.secondary!=null){
   fail(ev.secondary&&typeof ev.secondary==='object'&&secondaryKind(ev.kind)!==null&&ev.secondary.kind===secondaryKind(ev.kind)&&typeof ev.secondary.player==='string','Дополнительная ошибка: приём для эйса, защита для атаки или скидки');
   stat(other(winner),ev.secondary.player,keys[ev.secondary.kind]);
  }
  if(ev.kind==='point')s.sides[winner].unknown++;
  if(isError(ev.kind))s.sides[winner].opponentErrors++;
  for(const side of sides){
   const a=s.sides[side],r=a.rotations[s.rotations[side]];
   r.rallies++;r[side===winner?'won':'lost']++;
   if(side===winner){a.points++;a.run++;a.maxRun=Math.max(a.maxRun,a.run);}else a.run=0;
  }
  const serving=s.sides[s.serve],serverId=server(s.serve);
  if(!serving.activeRun)serving.activeRun={set:setNo(),player:serverId,won:0,aces:0,errors:0};
  if(winner===s.serve){serving.onServe++;serving.activeRun.won++;}
  if(ev.kind==='ace')serving.activeRun.aces++;
  if(ev.kind==='serveError')serving.activeRun.errors++;
  s.score[winner]++;s.rallyCount++;
  timeline(ev,{actor,player,before,rotation:{...s.rotations},clockRunning:clock.running});
  if(winner!==s.serve){
   flush(s.serve);s.rotations[winner]=(s.rotations[winner]+1)%6;
   if(winner==='ours')s.lineup=rotate(s.lineup);else s.awayLineup=rotate(s.awayLineup);
  }
  s.serve=winner;clearLibero();
  if(isSetWon(d,s.sets.length,s.score)){
   for(const side of sides)flush(side);
   s.setDetails.push({set:setNo(),lineups:starting,startedAt:setStarted,endedAt:ev.at});
   s.sets.push({...s.score});s.setEnded=true;clockPause(clock);
   const wins=s.sets.filter(x=>x.ours>x.theirs).length;
   s.finished=Math.max(wins,s.sets.length-wins)>=Math.ceil(d.bestOf/2);
  }
 }
 const rule=regulationOf(d);s.changeDue=!s.finished&&(rule.ends!=='manual'&&s.setEnded&&!s.endsAtBreak||rule.ends==='betweenSetsDecider'&&!s.setEnded&&d.bestOf>1&&s.sets.length===d.bestOf-1&&!s.deciderEndsChanged&&Math.max(s.score.ours,s.score.theirs)>=rule.deciderSwitchAt);
 const stats={};
 for(const [id,r] of Object.entries(s.sides.ours.stats)){
   const allowed=['serves','serveErrors','aces','receptions','receptionGood','attacks','attackKills','blocks','points'];
   stats[id]=Object.fromEntries(Object.entries(r).filter(([k])=>allowed.includes(k)));
 }
 return {...s,ours:s.score.ours,theirs:s.score.theirs,stats,subs:s.subCounts.ours,courtClock:clock};
}
export function detailEvent(d,event,now=new Date().toISOString()){
 if(event===null)return {...d,events:d.events.slice(0,-1)};
 let events=[...d.events];
 if(event.type==='editRally'){
  const i=event.index,last=events[i];fail(integer(i,0,events.length-1)&&last?.type==='rally','Выберите розыгрыш в журнале');
  const patch=event.patch;fail(patch&&typeof patch==='object'&&!Array.isArray(patch)&&Object.keys(patch).every(k=>['kind','player','placement','secondary','observations','touches','captureComplete','captureMode'].includes(k)),'Редактирование не меняет команду, счёт и порядок событий');
  const updated={...last};if(Object.hasOwn(patch,'kind')&&patch.kind!==last.kind){delete updated.placement;delete updated.secondary;updated.captureComplete=false;}
  for(const [k,v] of Object.entries(patch)){if(v===null&&['placement','secondary','observations'].includes(k))delete updated[k];else updated[k]=v;}
  events[i]=updated;
 }else if(event.type==='attribute'){
  const last=events.at(-1);fail(last?.type==='rally','Можно уточнить только последнее очко');
  events[events.length-1]={...last,kind:event.kind,player:event.player??null};
  if(last.kind!==event.kind){delete events[events.length-1].placement;delete events[events.length-1].secondary;events[events.length-1].captureComplete=false;}
 }else if(event.type==='observations'){
  const last=events.at(-1);fail(last?.type==='rally','Выберите завершённый розыгрыш');
  events[events.length-1]={...last,observations:event.observations};
 }else if(event.type==='secondary'){
  const last=events.at(-1);fail(last?.type==='rally'&&secondaryKind(last.kind),'Уточните последнее результативное действие');
  events[events.length-1]={...last};
  if(event.player===null)delete events[events.length-1].secondary;
  else events[events.length-1].secondary={kind:secondaryKind(last.kind),player:event.player};
 }else if(event.type==='placement'){
  const last=events.at(-1);fail(last?.type==='rally'&&canPlace(last.kind),'Укажите направление последнего завершения в приёме или защите');
  fail(event.zone===null||integer(event.zone,1,6),'Выберите зону 1–6');
  events[events.length-1]={...last};
  if(event.zone===null)delete events[events.length-1].placement;else events[events.length-1].placement=event.zone;
 }else{
  const last=events.at(-1)?.at||d.startedAt;
  const at=Date.parse(now)<Date.parse(last)?last:now;
  events.push({...event,at});
 }
 const next={...d,events};replayDetailed(next);return next;
}
export function courtTime(state,asOf=state.courtClock.lastAt){
 const lineups={ours:state.lineup.map(id=>id===state.liberoFor?state.liberoId:id),theirs:state.awayLineup};
 return clockSummary(state.courtClock,{lineups,asOf});
}
export function reportData(d){
 const s=replayDetailed(d);
 const duration=(a,b)=>Math.max(0,Math.floor((Date.parse(b)-Date.parse(a))/1000));
 return {state:s,courtTime:courtTime(s),duration:d.events.length?duration(d.startedAt,d.events.at(-1).at):0,
  sets:s.setDetails.map((x,i)=>({...x,...s.sets[i],seconds:duration(x.startedAt,x.endedAt)}))};
}

/** Only explicitly located terminal actions; unknown locations stay unknown. */
export function placementSummary(timeline,side,kind,{set=0,player=null,includeTips=true}={}){
 fail(sides.includes(side)&&canPlace(kind),'Выберите сторону и вид завершения');
 const zones=Array(6).fill(0);let total=0,known=0;
 for(const e of timeline)if(e.type==='rally'&&e.side===side&&(!set||e.set===set)&&(!player||e.player===player)&&(e.kind===kind||includeTips&&kind==='kill'&&e.kind==='tip')){total++;if(integer(e.placement,1,6)){zones[e.placement-1]++;known++;}}
 return {zones,total,known,unknown:total-known};
}

/** Set-level progression, based exclusively on recorded rally winners. */
export function setMomentum(timeline,set){
 const points=[{ours:0,theirs:0}],maxRun={ours:0,theirs:0},maxLead={ours:0,theirs:0};
 let runSide=null,run=0,changes=0,lastLeader=null,ties=0;
 for(const e of timeline){
  if(e.type!=='rally'||e.set!==set)continue;
  const prev=points.at(-1),curr={...prev,[e.side]:prev[e.side]+1};points.push(curr);
  if(runSide===e.side)run++;else{runSide=e.side;run=1;}
  maxRun[e.side]=Math.max(maxRun[e.side],run);
  const diff=curr.ours-curr.theirs;
  maxLead.ours=Math.max(maxLead.ours,diff);maxLead.theirs=Math.max(maxLead.theirs,-diff);
  if(!diff){ties++;continue;}
  const leader=diff>0?'ours':'theirs';
  if(lastLeader&&lastLeader!==leader)changes++;
  lastLeader=leader;
 }
 return {points,maxRun,maxLead,changes,ties,runSide,run};
}

/** Filtered analysis derives from the same terminal action definitions as replay. */
export function rallySummary(timeline,set=0){
 const result={ours:{points:0,stats:Object.create(null),reasons:{},onServe:0,serve:0,receive:0,receiveWon:0,unknown:0},theirs:{points:0,stats:Object.create(null),reasons:{},onServe:0,serve:0,receive:0,receiveWon:0,unknown:0}};
 function stat(side,id,kind){if(id==null||!rallyStatKeys[kind])return;const r=result[side].stats[id]??={};for(const k of rallyStatKeys[kind])r[k]=(r[k]||0)+1;}
 for(const e of timeline){
  if(e.type!=='rally'||(set&&e.set!==set))continue;
  const a=result[e.side];a.points++;a.reasons[e.kind]=(a.reasons[e.kind]||0)+1;if(e.kind==='point')a.unknown++;
  stat(e.actor,e.player,e.kind);if(e.secondary)stat(other(e.side),e.secondary.player,e.secondary.kind);
  for(const side of sides){const row=result[side],serving=e.before.serve===side;if(serving){row.serve++;if(e.side===side)row.onServe++;}else{row.receive++;if(e.side===side)row.receiveWon++;}}
 }
 return result;
}

/** Observed terminal concessions only. Zones are independent of attributed defenders.
 * No inferred target attempts; a zero count is not proof of strong reception/defense. */
export const scoutTypes={all:'Все завершения',serve:'Подачи и приём',attack:'Атаки без скидок',tip:'Скидки',defense:'Защита без уточнения'};
const scoutCategory={ace:'serve',receiveError:'serve',kill:'attack',tip:'tip',defenseError:'defense'};
export function scoutSummary(timeline,side,{kind='all',set=0,active=[]}={}){
 fail(sides.includes(side)&&Object.hasOwn(scoutTypes,kind),'Выберите сторону и вид разведки');
 const players=new Map(),zones=Array(6).fill(0);let total=0,knownPlayers=0,knownZones=0,rallies=0;
 const player=id=>{if(!players.has(id))players.set(id,{id,onCourt:0,misses:0,success:0,serve:0,attack:0,tip:0,defense:0});return players.get(id);};
 for(const e of timeline){
  if(e.type!=='rally'||(set&&e.set!==set))continue;
  rallies++;
  for(const id of new Set(e.before.lineups[side].filter(Boolean)))player(id).onCourt++;
  for(const o of e.observations??[])if(o.side===side&&(kind==='all'||o.kind===kind))player(o.player).success++;
  if(e.side===side)continue;
  const category=scoutCategory[e.kind];if(!category||(kind!=='all'&&category!==kind))continue;
  total++;
  if(integer(e.placement,1,6)){zones[e.placement-1]++;knownZones++;}
  const id=['receiveError','defenseError'].includes(e.kind)?e.player:e.secondary?.player;
  if(id&&e.before.lineups[side].includes(id)){const r=player(id);r.misses++;r[category]++;knownPlayers++;}
 }
 const measured=r=>({...r,attempts:r.misses+r.success,errorRate:r.misses+r.success?r.misses/(r.misses+r.success):null});
 const rows=active.flatMap((id,i)=>id?[{...measured(player(id)),zone:i+1}]:[]);
 const byCount=(a,b)=>b.misses-a.misses||b.onCourt-a.onCourt||a.zone-b.zone;
 const ranked=rows.filter(x=>x.misses>0).sort(byCount);
 const topZones=zones.map((count,i)=>({zone:i+1,count})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count||a.zone-b.zone);
 return {rallies,total,knownPlayers,knownZones,unknownPlayers:total-knownPlayers,unknownZones:total-knownZones,zones,rows,ranked,topZones,
  former:[...players.values()].filter(x=>!active.includes(x.id)&&(x.misses>0||x.success>0)).map(measured).sort(byCount)};
}

/** Public-facing score only; no roster, individual stats or event data. */
export function spectatorSnapshot(d,s=replayDetailed(d)){
 const won=s.sets.filter(x=>x.ours>x.theirs).length;
 return {teamName:d.teamName,opponent:d.opponent,score:{...s.score},sets:s.sets.map(x=>({...x})),setsWon:{ours:won,theirs:s.sets.length-won},set:s.setEnded?s.sets.length:s.sets.length+1,serve:s.serve,status:s.finished?'finished':s.setEnded?'break':'live',colors:{...(d.boardColors||defaultBoardColors)},logos:{...(d.boardLogos||{ours:null,theirs:null})}};
}

export async function prepareLogo(file){
 if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5000000)throw Error('Выберите PNG, JPEG или WebP до 5 МБ');
 const url=URL.createObjectURL(file);
 try{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Изображение не удалось открыть'));image.src=url;});
 if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>32000000)throw Error('Изображение слишком большое');
 const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;const scale=96/Math.max(image.naturalWidth,image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
 canvas.getContext('2d').drawImage(image,(96-w)/2,(96-h)/2,w,h);const data=canvas.toDataURL('image/png');
 if(!validBoardLogos({ours:data,theirs:null}))throw Error('Не удалось подготовить эмблему');return data;
 }finally{URL.revokeObjectURL(url);}
}
