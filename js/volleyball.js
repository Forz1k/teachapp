import {replayDetailed,detailEvent} from './match-protocol.js';
/* Pure match engine. Zones array is ordered 1..6. Recorded actions are partial statistics. */
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const unique=a=>new Set(a).size===a.length;
const sides=['ours','theirs'];
export const schemes={'5-1':'5–1','4-2':'4–2',free:'Свободная'};
export const rallyKinds={point:'Очко без детализации',ace:'Эйс',serveError:'Ошибка подачи',kill:'Результативная атака',block:'Результативный блок'};
export const actionKinds={serve:'Подача в игре',receive:'Приём',receiveGood:'Положительный приём',attack:'Атака без очка'};
export function validLineup(lineup,roster){
  return Array.isArray(lineup)&&lineup.length===6&&unique(lineup)&&lineup.every(id=>roster.includes(id));
}
export function rotate(lineup){return [...lineup.slice(1),lineup[0]];}
export function replay(d){
  if(d?.mode==='dual')return replayDetailed(d);
  assert(d&&Array.isArray(d.roster)&&unique(d.roster)&&d.roster.length>=6&&d.roster.length<=100&&validLineup(d.lineup,d.roster)&&
    [3,5].includes(d.bestOf)&&[15,21,25].includes(d.target)&&[15,21,25].includes(d.decider)&&sides.includes(d.firstServe)&&Object.hasOwn(schemes,d.scheme)&&
    (d.libero===null||d.roster.includes(d.libero)&&!d.lineup.includes(d.libero))&&Array.isArray(d.events)&&d.events.length<=5000,'Проверьте параметры матча');
  const s={lineup:[...d.lineup],liberoFor:null,serve:d.firstServe,ours:0,theirs:0,sets:[],timeouts:{ours:0,theirs:0},subs:0,stats:{},setEnded:false,finished:false};
  const onCourt=id=>s.lineup.includes(id)&&id!==s.liberoFor||id===d.libero&&s.liberoFor!==null;
  const stat=(id,keys)=>{assert(onCourt(id),'Игрок не на площадке');const r=s.stats[id]??={};for(const k of keys)r[k]=(r[k]||0)+1;};
  const clearLibero=()=>{if(s.liberoFor!==null&&([2,3,4].includes(s.lineup.indexOf(s.liberoFor)+1)||s.serve==='ours'&&s.lineup[0]===s.liberoFor))s.liberoFor=null;};
  for(const ev of d.events){
    assert(ev&&typeof ev==='object'&&!s.finished,'Матч завершён');
    if(ev.type==='next'){
      assert(s.setEnded&&validLineup(ev.lineup,d.roster)&&!ev.lineup.includes(d.libero)&&sides.includes(ev.serve),'Проверьте состав следующей партии');
      Object.assign(s,{lineup:[...ev.lineup],liberoFor:null,serve:ev.serve,ours:0,theirs:0,timeouts:{ours:0,theirs:0},subs:0,setEnded:false});continue;
    }
    assert(!s.setEnded,'Начните следующую партию');
    if(ev.type==='timeout'){
      assert(sides.includes(ev.side)&&s.timeouts[ev.side]<2,'Лимит тайм-аутов партии (2)');s.timeouts[ev.side]++;continue;
    }
    if(ev.type==='sub'){
      const i=s.lineup.indexOf(ev.out);
      assert(i>=0&&ev.out!==s.liberoFor&&d.roster.includes(ev.in)&&ev.in!==d.libero&&!s.lineup.includes(ev.in)&&s.subs<6,'Проверьте замену или лимит (6)');
      s.lineup[i]=ev.in;s.subs++;continue;
    }
    if(ev.type==='libero'){
      if(ev.for===null){assert(s.liberoFor!==null,'Либеро не на площадке');s.liberoFor=null;continue;}
      const z=s.lineup.indexOf(ev.for)+1;
      assert(d.libero!==null&&s.liberoFor===null&&[1,5,6].includes(z)&&!(z===1&&s.serve==='ours'),'Либеро заменяет игрока задней линии, кроме подачи');
      s.liberoFor=ev.for;continue;
    }
    if(ev.type==='action'){
      assert(Object.hasOwn(actionKinds,ev.kind),'Неизвестное действие');
      if(ev.kind==='serve')assert(s.serve==='ours'&&s.lineup[0]===ev.player,'Выберите подающего игрока');
      stat(ev.player,{serve:['serves'],receive:['receptions'],receiveGood:['receptions','receptionGood'],attack:['attacks']}[ev.kind]);continue;
    }
    assert(ev.type==='rally'&&sides.includes(ev.side)&&Object.hasOwn(rallyKinds,ev.kind),'Неизвестное действие матча');
    if(ev.kind==='point')assert(ev.player==null,'Очко без детализации');
    else{
      assert(ev.side===(ev.kind==='serveError'?'theirs':'ours'),'Проверьте сторону очка');
      if(['ace','serveError'].includes(ev.kind))assert(s.serve==='ours'&&s.lineup[0]===ev.player,'Выберите подающего игрока');
      if(['kill','block'].includes(ev.kind))assert(ev.player!==d.libero,'Либеро: укажите допустимое действие');
      if(ev.kind==='block')assert([2,3,4].includes(s.lineup.indexOf(ev.player)+1),'Блок фиксируется за игроком передней линии');
      stat(ev.player,{ace:['serves','aces','points'],serveError:['serves','serveErrors'],kill:['attacks','attackKills','points'],block:['blocks','points']}[ev.kind]);
    }
    s[ev.side]++;
    if(ev.side==='ours'&&s.serve==='theirs')s.lineup=rotate(s.lineup);
    s.serve=ev.side;clearLibero();
    const target=s.sets.length===d.bestOf-1?d.decider:d.target;
    if(Math.max(s.ours,s.theirs)>=target&&Math.abs(s.ours-s.theirs)>=2){
      s.sets.push({ours:s.ours,theirs:s.theirs});s.setEnded=true;
      const wins=s.sets.filter(x=>x.ours>x.theirs).length,losses=s.sets.length-wins;
      s.finished=Math.max(wins,losses)>=Math.ceil(d.bestOf/2);
    }
  }
  return s;
}
export function appendEvent(d,event){if(d.mode==='dual')return detailEvent(d,event);const next={...d,events:[...d.events,event]};replay(next);return next;}
export function undoEvent(d){if(d.mode==='dual')return detailEvent(d,null);return {...d,events:d.events.slice(0,-1)};}
export function validateLiveData(data){
 const players=new Map(data.coachPlayers.map(p=>[p.id,p])),teams=new Set(data.coachTeams.map(t=>t.id));
 const linked=r=>typeof r.id==='string'&&teams.has(r.teamId)&&Array.isArray(r.roster)&&r.roster.every(id=>players.get(id)?.teamId===r.teamId);
 for(const p of data.coachLineups){
   assert(linked(p)&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=200&&Object.hasOwn(schemes,p.scheme)&&validLineup(p.lineup,p.roster)&&unique(p.roster)&&
    (p.libero===null||p.roster.includes(p.libero)&&!p.lineup.includes(p.libero))&&(p.purpose===undefined||['any','serve','receive'].includes(p.purpose)),'Проверьте сохранённую расстановку');
 }
 for(const d of data.coachLive){
   assert(linked(d)&&typeof d.opponent==='string'&&d.opponent.trim()&&d.opponent.length<=200&&typeof d.competition==='string'&&d.competition.length<=200&&
    /^\d{4}-\d{2}-\d{2}$/.test(d.date)&&Number.isFinite(Date.parse(d.date))&&Number.isInteger(d.revision)&&d.revision>=0,'Проверьте черновик матча');
   replay(d);
 }
}

/** Synthetic rehearsal: device-local, never enters coach stores, sync or public publishing. */
export const rehearsalKey='teachapp.live.rehearsal.v1';
export function makeRehearsal({short=false,now=new Date(),id=globalThis.crypto.randomUUID(),liveTiming=false,ourSide,firstServe='ours',winBy=2,bestOf=3}={}){
 const players=(side,label)=>Array.from({length:10},(_,i)=>({id:'test-'+side+'-'+(i+1),name:label+' '+(i+1),number:i+1}));
 const ourPlayers=players('a','Игрок А'),awayPlayers=players('b','Игрок Б');
 const d={id:'test-'+id,teamId:'test-rehearsal',mode:'dual',teamName:'ТЕСТ · Синие',opponent:'ТЕСТ · Красные',competition:'Учебный матч — неофициальный',venue:'Тестовая площадка',
 date:[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-'),startedAt:now.toISOString(),ourPlayers,awayPlayers,roster:ourPlayers.map(p=>p.id),lineup:ourPlayers.slice(0,6).map(p=>p.id),awayLineup:awayPlayers.slice(0,6).map(p=>p.id),libero:ourPlayers[8].id,libero2:ourPlayers[9].id,scheme:'5-1',substitutionMode:'paired',bestOf,target:short?5:25,decider:short?5:15,firstServe,...(liveTiming?{liveTiming:true}:{}),...(ourSide!==undefined?{ourSide}:{}),events:[],revision:0,
 regulation:{name:short?'Ускоренный тест':'Тестовый регламент',winBy,pointCap:null,liberoInterval:'oneRally',ends:'manual',deciderSwitchAt:short?3:8},boardColors:{ours:'blue',theirs:'red'}};
 replayDetailed(d);return d;
}
export function rehearsalStore(storage=globalThis.localStorage,locks=globalThis.navigator?.locks){
 const read=()=>{const raw=storage.getItem(rehearsalKey);if(raw===null)return null;const d=JSON.parse(raw);
  assert(d?.teamId==='test-rehearsal'&&typeof d.id==='string'&&d.id.startsWith('test-')&&Number.isSafeInteger(d.revision)&&d.revision>=0,'Некорректный тестовый черновик');replayDetailed(d);return d;};
 const write=d=>{replayDetailed(d);storage.setItem(rehearsalKey,JSON.stringify(d));return d;};
 const current=(id,revision)=>{const d=read();assert(d&&d.id===id&&d.revision===revision,'Тестовый матч изменился. Откройте его заново');return d;};
 const locked=fn=>locks?.request?locks.request(rehearsalKey,fn):Promise.resolve().then(fn);
 return {read,
  start:options=>locked(()=>{assert(!read(),'Сначала удалите или продолжите тестовый матч');return write(makeRehearsal(options));}),
  change:(id,revision,event)=>locked(()=>{const d=current(id,revision),next=event===null?undoEvent(d):appendEvent(d,event);return write({...next,revision:d.revision+1});}),
  colors:(id,revision,colors,logos)=>locked(()=>{const d=current(id,revision);return write({...d,boardColors:{...colors},boardLogos:{...logos},revision:d.revision+1});}),
  discard:(id,revision)=>locked(()=>{current(id,revision);storage.removeItem(rehearsalKey);}),
  finish:(id,revision)=>locked(()=>{const d=current(id,revision),state=replayDetailed(d);assert(state.finished,'Сначала завершите матч по партиям');return {id:d.id,teamId:d.teamId,date:d.date,opponent:d.opponent,competition:d.competition,sets:state.sets,roster:d.roster,stats:state.stats,detail:d};})
 };
}

// Only the current tab's navigation hint; the event log remains authoritative.
export const liveResumeKey='teachapp.live.resume.v1';
export function readLiveResume(storage){try{const v=JSON.parse((storage??globalThis.sessionStorage).getItem(liveResumeKey)||'null');return v&&typeof v.id==='string'&&v.id.length>0&&v.id.length<=200&&typeof v.teamId==='string'&&v.teamId.length>0&&v.teamId.length<=200&&typeof v.token==='string'&&v.token.length<=200&&typeof v.rehearsal==='boolean'&&v.rehearsal===(v.teamId==='test-rehearsal')?v:null;}catch{return null;}}
export function rememberLive(d,rehearsal,storage){try{const v={id:d.id,teamId:d.teamId,rehearsal:!!rehearsal,token:globalThis.crypto.randomUUID()};(storage??globalThis.sessionStorage).setItem(liveResumeKey,JSON.stringify(v));return v;}catch{return null;}}
export function clearLiveResume(marker,storage){if(!marker)return;try{const s=storage??globalThis.sessionStorage;if(readLiveResume(s)?.token===marker.token)s.removeItem(liveResumeKey);}catch{}}
