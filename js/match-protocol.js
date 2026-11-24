/* TeachApp — detailed event-sourced indoor match. No external service. */
const fail=(ok,msg)=>{if(!ok)throw Error(msg);};
const sides=['ours','theirs'],other=s=>s==='ours'?'theirs':'ours';
const text=(x,max=200)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const integer=(x,min,max)=>Number.isInteger(x)&&x>=min&&x<=max;
const timestamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const uniq=a=>new Set(a).size===a.length;
export const reasons={point:'Без детализации',kill:'Атака',tip:'Скидка',block:'Блок',ace:'Эйс',serveError:'Ошибка подачи',attackError:'Ошибка атаки',receiveError:'Ошибка приёма',defenseError:'Ошибка защиты',setError:'Ошибка передачи',netError:'Касание сетки',otherError:'Другая ошибка'};
const errors=['serveError','attackError','receiveError','defenseError','setError','netError','otherError'];
export const canPlace=kind=>['ace','kill','tip'].includes(kind);
export const isError=k=>errors.includes(k);
export const rallyActor=(winner,kind)=>isError(kind)?other(winner):winner;
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
  if(actor==='ours'&&id===d.libero&&['kill','tip','block'].includes(kind))return [];
  const player=roster.find(p=>p.id===id);
  return player?[{...player,zone:i+1}]:[];
 });
}
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
export function legalSubstitutions(d,s,side,out){
 if(!sides.includes(side)||s.setEnded||s.finished||s.subCounts[side]>=6)return [];
 const line=side==='ours'?s.lineup:s.awayLineup,roster=side==='ours'?d.ourPlayers:d.awayPlayers;
 if(!line.includes(out)||side==='ours'&&out===s.liberoFor)return [];
 return roster.filter(p=>!line.includes(p.id)&&(side!=='ours'||p.id!==d.libero)&&(d.substitutionMode!=='paired'||allowedPair(s.substitutionState[side],out,p.id)));
}
export function replayDetailed(d){
 fail(d.mode==='dual'&&text(d.teamName)&&text(d.opponent)&&typeof d.competition==='string'&&d.competition.length<=200&&typeof d.venue==='string'&&d.venue.length<=200&&
   timestamp(d.startedAt)&&validRoster(d.ourPlayers)&&validRoster(d.awayPlayers)&&Array.isArray(d.roster)&&uniq(d.roster)&&
   d.roster.length===d.ourPlayers.length&&d.roster.every(id=>d.ourPlayers.some(p=>p.id===id))&&d.awayPlayers.every(p=>!d.roster.includes(p.id))&&
   validLine(d.lineup,d.ourPlayers)&&validLine(d.awayLineup,d.awayPlayers,true)&&(!d.awayPlayers.length||d.awayLineup.length===6)&&
   (d.libero===null||d.ourPlayers.some(p=>p.id===d.libero)&&!d.lineup.includes(d.libero))&&
   [3,5].includes(d.bestOf)&&[15,21,25].includes(d.target)&&[15,21,25].includes(d.decider)&&sides.includes(d.firstServe)&&
   ['5-1','4-2','free'].includes(d.scheme)&&(d.substitutionMode===undefined||['simple','paired'].includes(d.substitutionMode))&&Array.isArray(d.events)&&d.events.length<=5000,'Проверьте параметры матча');
 const rosters={ours:d.ourPlayers,theirs:d.awayPlayers};
 const s={lineup:[...d.lineup],awayLineup:[...d.awayLineup],liberoFor:null,serve:d.firstServe,score:{ours:0,theirs:0},sets:[],setDetails:[],timeouts:{ours:0,theirs:0},subCounts:{ours:0,theirs:0},substitutionState:substitutionState(d.lineup,d.awayLineup),rotations:{ours:0,theirs:0},sides:{ours:sideData(),theirs:sideData()},timeline:[],setEnded:false,finished:false};
 let setStarted=d.startedAt,lastAt=d.startedAt;
 const setNo=()=>s.sets.length+1;
 const lineupFor=side=>side==='ours'?s.lineup:s.awayLineup;
 const visible=side=>lineupFor(side).map(id=>side==='ours'&&id===s.liberoFor?d.libero:id);
 const server=side=>visible(side)[0]||null;
 const startLineups=()=>({ours:[...s.lineup],theirs:[...s.awayLineup]});
 let starting=startLineups();
 const flush=side=>{const a=s.sides[side];if(a.activeRun){a.runs.push(a.activeRun);a.activeRun=null;}};
 const clearLibero=()=>{if(s.liberoFor!==null&&([2,3,4].includes(s.lineup.indexOf(s.liberoFor)+1)||s.serve==='ours'&&s.lineup[0]===s.liberoFor))s.liberoFor=null;};
 function stat(side,id,keys){
  if(id==null)return;
  fail(visible(side).includes(id),'Игрок не на площадке до розыгрыша');
  const r=s.sides[side].stats[id]??={};
  for(const k of keys)r[k]=(r[k]||0)+1;
 }
 function timeline(ev,extra={}){s.timeline.push({set:setNo(),score:score(s),...ev,...extra});}
 for(const ev of d.events){
  fail(ev&&typeof ev==='object'&&!s.finished&&timestamp(ev.at)&&Date.parse(ev.at)>=Date.parse(lastAt),'Некорректная последовательность событий');lastAt=ev.at;
  if(ev.type==='next'){
   fail(s.setEnded&&validLine(ev.lineup,d.ourPlayers)&&!ev.lineup.includes(d.libero)&&validLine(ev.awayLineup,d.awayPlayers,true)&&(!d.awayPlayers.length||ev.awayLineup.length===6)&&sides.includes(ev.serve),'Проверьте расстановку следующей партии');
   Object.assign(s,{lineup:[...ev.lineup],awayLineup:[...ev.awayLineup],liberoFor:null,serve:ev.serve,score:{ours:0,theirs:0},timeouts:{ours:0,theirs:0},subCounts:{ours:0,theirs:0},substitutionState:substitutionState(ev.lineup,ev.awayLineup),rotations:{ours:0,theirs:0},setEnded:false});
   for(const side of sides){s.sides[side].run=0;flush(side);}
   setStarted=ev.at;starting=startLineups();continue;
  }
  fail(!s.setEnded,'Начните следующую партию');
  if(ev.type==='timeout'){
   fail(sides.includes(ev.side)&&s.timeouts[ev.side]<2,'Лимит тайм-аутов (2)');s.timeouts[ev.side]++;timeline(ev,{number:s.timeouts[ev.side]});continue;
  }
  if(ev.type==='sub'){
   fail(sides.includes(ev.side),'Выберите команду');
   const l=lineupFor(ev.side),i=l.indexOf(ev.out);
   fail(i>=0&&rosters[ev.side].some(p=>p.id===ev.in)&&!l.includes(ev.in)&&s.subCounts[ev.side]<6&&
    (ev.side!=='ours'||ev.out!==s.liberoFor&&ev.in!==d.libero),'Проверьте замену или лимит (6)');
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
   if(ev.for===null){fail(s.liberoFor!==null,'Либеро не на площадке');s.liberoFor=null;}
   else{const z=s.lineup.indexOf(ev.for)+1;fail(d.libero!==null&&s.liberoFor===null&&[1,5,6].includes(z)&&!(z===1&&s.serve==='ours'),'Либеро заменяет игрока задней линии, кроме подачи');s.liberoFor=ev.for;}
   timeline(ev,{side:'ours'});continue;
  }
  fail(ev.type==='rally'&&sides.includes(ev.side)&&Object.hasOwn(reasons,ev.kind),'Неизвестное действие');
  const winner=ev.side,actor=rallyActor(winner,ev.kind),player=ev.player??null,before={lineups:{ours:visible('ours'),theirs:visible('theirs')},serve:s.serve};
  fail(ev.kind!=='point'||player===null,'Для неуточнённого очка не указывайте игрока');
  fail(ev.placement==null||canPlace(ev.kind)&&integer(ev.placement,1,6),'Зона завершения — 1–6 только для эйса или результативной атаки');
  if(player!==null)fail(visible(actor).includes(player),'Выберите игрока до перехода');
  if(['ace','serveError'].includes(ev.kind))fail(s.serve===actor&&(player===null||server(actor)===player),'Эйс или ошибка подачи относится к подающей команде и игроку');
  if(ev.kind==='block'&&player!==null)fail([2,3,4].includes(lineupFor(actor).indexOf(player)+1)&&!(actor==='ours'&&player===d.libero),'Блок — игрок передней линии');
  if(['kill','tip'].includes(ev.kind)&&actor==='ours'&&player!==null)fail(player!==d.libero,'Проверьте действие либеро');
  const keys={ace:['serves','aces','points'],kill:['attacks','attackKills','points'],tip:['attacks','attackKills','tipKills','points'],block:['blocks','points'],serveError:['serves','serveErrors','errors'],attackError:['attacks','errors','attackErrors'],receiveError:['receptions','errors','receiveErrors'],defenseError:['errors','otherErrors','defenseErrors'],setError:['errors','otherErrors','setErrors'],netError:['errors','otherErrors','netErrors'],otherError:['errors','otherErrors']};
  if(keys[ev.kind])stat(actor,player,keys[ev.kind]);
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
  s.score[winner]++;
  timeline(ev,{actor,player,before,rotation:{...s.rotations}});
  if(winner!==s.serve){
   flush(s.serve);s.rotations[winner]=(s.rotations[winner]+1)%6;
   if(winner==='ours')s.lineup=rotate(s.lineup);else s.awayLineup=rotate(s.awayLineup);
  }
  s.serve=winner;clearLibero();
  const target=s.sets.length===d.bestOf-1?d.decider:d.target;
  if(Math.max(s.score.ours,s.score.theirs)>=target&&Math.abs(s.score.ours-s.score.theirs)>=2){
   for(const side of sides)flush(side);
   s.setDetails.push({set:setNo(),lineups:starting,startedAt:setStarted,endedAt:ev.at});
   s.sets.push({...s.score});s.setEnded=true;
   const wins=s.sets.filter(x=>x.ours>x.theirs).length;
   s.finished=Math.max(wins,s.sets.length-wins)>=Math.ceil(d.bestOf/2);
  }
 }
 const stats={};
 for(const [id,r] of Object.entries(s.sides.ours.stats)){
   const allowed=['serves','serveErrors','aces','receptions','receptionGood','attacks','attackKills','blocks','points'];
   stats[id]=Object.fromEntries(Object.entries(r).filter(([k])=>allowed.includes(k)));
 }
 return {...s,ours:s.score.ours,theirs:s.score.theirs,stats,subs:s.subCounts.ours};
}
export function detailEvent(d,event,now=new Date().toISOString()){
 if(event===null)return {...d,events:d.events.slice(0,-1)};
 let events=[...d.events];
 if(event.type==='attribute'){
  const last=events.at(-1);fail(last?.type==='rally','Можно уточнить только последнее очко');
  events[events.length-1]={...last,kind:event.kind,player:event.player??null};
  if(last.kind!==event.kind)delete events[events.length-1].placement;
 }else if(event.type==='placement'){
  const last=events.at(-1);fail(last?.type==='rally'&&canPlace(last.kind),'Укажите направление последнего эйса или результативной атаки');
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
export function reportData(d){
 const s=replayDetailed(d);
 const duration=(a,b)=>Math.max(0,Math.floor((Date.parse(b)-Date.parse(a))/1000));
 return {state:s,duration:d.events.length?duration(d.startedAt,d.events.at(-1).at):0,
  sets:s.setDetails.map((x,i)=>({...x,...s.sets[i],seconds:duration(x.startedAt,x.endedAt)}))};
}

/** Only explicitly located terminal actions; unknown locations stay unknown. */
export function placementSummary(timeline,side,kind){
 fail(sides.includes(side)&&canPlace(kind),'Выберите сторону и вид завершения');
 const zones=Array(6).fill(0);let total=0,known=0;
 for(const e of timeline)if(e.type==='rally'&&e.side===side&&(e.kind===kind||kind==='kill'&&e.kind==='tip')){total++;if(integer(e.placement,1,6)){zones[e.placement-1]++;known++;}}
 return {zones,total,known,unknown:total-known};
}
