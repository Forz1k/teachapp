/* Public portal: explicit, bounded projection. Never serialize private match objects. */
import {replayDetailed,reasons,defaultBoardColors,validBoardColors,validBoardLogos} from './match-protocol.js';
export const PORTAL_SCHEMA=1;
export const primaryPortal=Object.freeze({
 origin:'https://teachapp-96626-default-rtdb.europe-west1.firebasedatabase.app',
 apiKey:'AIzaSyCcATw9MlETq3SUM9idORH4Us4zMyqkyTs',
 owner:'nVMf7mGnsQgdjjAEjnuoJlbXhOY2',
 slug:'b7d0cf3a3e88b316d6766f5929f5696e'
});
export const MAX_SCHEDULE=20,MAX_ARCHIVE=20,MAX_EVENTS=30;
const sides=['ours','theirs'];
const clean=(v,max=100)=>typeof v==='string'?v.trim().slice(0,max):'';
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const int=(v,max=9999)=>Number.isInteger(v)&&v>=0&&v<=max;
const dateMs=v=>Number.isFinite(v)&&v>=0&&v<=8640000000000000;
const list=v=>Array.isArray(v)?v:v&&typeof v==='object'?Object.keys(v).filter(k=>/^(0|[1-9][0-9]?)$/.test(k)).sort((a,b)=>Number(a)-Number(b)).map(k=>v[k]):[];
const score=v=>v&&int(v.ours)&&int(v.theirs)?{ours:v.ours,theirs:v.theirs}:null;
const norm=v=>clean(v).replace(/\s+/g,' ').toLocaleLowerCase('ru');
export function firebaseOrigin(input){
 const u=new URL(String(input).trim());
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||!/^([a-z0-9-]+\.)+(firebaseio\.com|firebasedatabase\.app)$/.test(u.hostname))throw Error('Укажите точный HTTPS-адрес Firebase Realtime Database');
 return u.origin;
}
export function portalAddress(origin,owner,slug){
 if(!validId(owner)||!validId(slug))throw Error('Некорректный адрес страницы');
 return firebaseOrigin(origin)+'/publicTeams/'+owner+'/'+slug+'.json';
}
export function isPrimaryPortal(origin,owner,slug){return firebaseOrigin(origin)===primaryPortal.origin&&owner===primaryPortal.owner&&slug===primaryPortal.slug;}
export function viewerTarget(input){
 const u=new URL(input),q=u.searchParams,keys=['db','owner','team'],explicit=keys.some(k=>q.has(k));
 const origin=explicit?q.get('db'):primaryPortal.origin,owner=explicit?q.get('owner'):primaryPortal.owner,slug=explicit?q.get('team'):primaryPortal.slug;
 const address=portalAddress(origin,owner,slug),primary=isPrimaryPortal(origin,owner,slug);
 if(primary){const match=q.get('match'),archive=q.get('archive');u.search='';if(match&&validId(match))u.searchParams.set('match',match);if(archive&&/^\d{16}_[A-Za-z0-9_-]{1,100}$/.test(archive))u.searchParams.set('archive',archive);u.hash='';if(u.pathname.endsWith('/index.html'))u.pathname=u.pathname.slice(0,-'index.html'.length);}
 return {address,primary,share:u.href};
}
export function shareUrl(base,origin,owner,slug){
 portalAddress(origin,owner,slug);
 const u=new URL('live/',base);if(isPrimaryPortal(origin,owner,slug))return u.href;u.searchParams.set('db',firebaseOrigin(origin));u.searchParams.set('owner',owner);u.searchParams.set('team',slug);return u.href;
}
export function scheduleItem(x){
 if(!x||!validId(x.id)||!clean(x.opponent)||!dateMs(x.startAt)||x.startAt===0)throw Error('Проверьте соперника и дату матча');
 const logos={ours:x.logos?.ours??null,theirs:x.logos?.theirs??null};
 return {id:x.id,opponent:clean(x.opponent),startAt:x.startAt,...((logos.ours||logos.theirs)&&validBoardLogos(logos)?{logos}:{})};
}
export function sortedSchedule(items){return items.map(scheduleItem).sort((a,b)=>a.startAt-b.startAt||a.id.localeCompare(b.id)).slice(0,MAX_SCHEDULE);}
export function localDay(t){const d=new Date(t);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
export function matchingSchedule(schedule,d){const candidates=schedule.filter(x=>norm(x.opponent)===norm(d.opponent)&&localDay(x.startAt)===d.date);return candidates.length===1?candidates[0]:null;}
export function projectMatch(d,{events=true,numbers=false,stats=true,scheduledId=null}={}){
 const s=replayDetailed(d),wins=s.sets.filter(x=>x.ours>x.theirs).length;
 const players={ours:d.ourPlayers,theirs:d.awayPlayers};
 const recent=events?s.timeline.filter(x=>x.type==='rally').slice(-MAX_EVENTS).map(x=>{
  const p=players[x.actor].find(p=>p.id===x.player);
  return {set:x.set,score:clean(x.score,20),side:x.side,kind:x.kind,actor:x.actor,...(numbers&&p&&int(p.number,99)?{number:p.number}:{})};
 }):[];
 // Publish positive contributions only. Never expose a player's defensive scouting or health data.
 const rows=stats&&numbers?sides.flatMap(side=>players[side].filter(p=>int(p.number,99)).map(p=>{
  const a=s.sides[side].stats[p.id]||{};return {side,number:p.number,points:a.points||0,attack:a.attackKills||0,tip:a.tipKills||0,ace:a.aces||0,block:a.blocks||0};
 }).filter(p=>p.points>0)).slice(0,100):[];
 const logos=validBoardLogos(d.boardLogos)?d.boardLogos:null;
 return {...(logos?{logos}:{}),id:'match_'+Date.parse(d.startedAt),opponent:clean(d.opponent),startedAt:Date.parse(d.startedAt),status:s.finished?'finished':s.setEnded?'break':'live',set:s.setEnded?s.sets.length:s.sets.length+1,score:{...s.score},setsWon:{ours:wins,theirs:s.sets.length-wins},sets:s.sets.map(x=>({...x})),serve:s.serve,colors:{...(d.boardColors||defaultBoardColors)},events:recent,stats:rows,...(scheduledId&&validId(scheduledId)?{scheduledId}:{})};
}
export function archiveMatch(m){return {id:m.id,opponent:m.opponent,startedAt:m.startedAt,setsWon:{...m.setsWon},sets:m.sets.map(x=>({...x}))};}
export async function savedResult(m){
 if(!m||!validId(m.id)||!clean(m.opponent)||!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||!Array.isArray(m.sets)||!m.sets.length||m.sets.length>5||m.sets.some(x=>!score(x)||x.ours===x.theirs))throw Error('Проверьте дату, соперника и счёт партий');
 const day=Date.parse(m.date+'T12:00:00Z');
 if(!dateMs(day)||new Date(day).toISOString().slice(0,10)!==m.date||m.date>localDay(Date.now()))throw Error('Дата результата некорректна');
 if(m.detail){const d=projectMatch(m.detail,{events:false,numbers:false,stats:false});if(d.status!=='finished')throw Error('Матч ещё не завершён');return archiveMatch(d);}
 // Stable opaque public ID; no internal record ID or player information is published.
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('teachapp-public-result:'+m.id));
 const id='result_'+Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
 const sets=m.sets.map(score),ours=sets.filter(x=>x.ours>x.theirs).length;
 return {id,opponent:clean(m.opponent),startedAt:day,setsWon:{ours,theirs:sets.length-ours},sets};
}
export function sortedArchive(rows){return rows.slice().sort((a,b)=>b.startedAt-a.startedAt||a.id.localeCompare(b.id)).slice(0,MAX_ARCHIVE);}
export function resultFixtures(schedule,m,activeId){return schedule.filter(x=>x.id!==activeId&&norm(x.opponent)===norm(m.opponent)&&localDay(x.startAt)===m.date);}
export function buildPortal(team,schedule,match,archive,now=Date.now()){
 const {logos,...scoreboard}=match||{};
 return {...(logos?{logos}:{}),schema:PORTAL_SCHEMA,team:clean(team)||'Команда',updatedAt:now,schedule:sortedSchedule(schedule),...(match?{match:scoreboard}:{}),archive:sortedArchive(archive)};
}
export function portalState(data,now=Date.now()){
 if(!data)return {mode:'empty'};
 const m=data.match;
 if(m&&['live','break'].includes(m.status))return {mode:m.status,match:m};
 const next=data.schedule.find(x=>x.id!==m?.scheduledId);
 if(next)return {mode:next.startAt>now?'upcoming':'waiting',next,remaining:Math.max(0,next.startAt-now),last:m?.status==='finished'?m:null};
 return m?.status==='finished'?{mode:'finished',match:m}:{mode:'empty'};
}
export function countdown(ms){const s=Math.max(0,Math.ceil(ms/1000));return [Math.floor(s/86400),Math.floor(s/3600)%24,Math.floor(s/60)%60,s%60];}
/** Reader validates untrusted Firebase data; no arbitrary HTML, images or URLs. Empty arrays are omitted by RTDB. */
export function readPortal(raw){
 if(!raw||raw.schema!==PORTAL_SCHEMA||!clean(raw.team)||!dateMs(raw.updatedAt))return null;
 const validSets=v=>list(v).map(score).filter(Boolean).slice(0,5);
 const archived=v=>v&&validId(v.id)&&clean(v.opponent)&&dateMs(v.startedAt)&&score(v.setsWon)?{id:v.id,opponent:clean(v.opponent),startedAt:v.startedAt,setsWon:score(v.setsWon),sets:validSets(v.sets)}:null;
 let match=null;
 const m=raw.match,common=archived(m);
 if(common&&['live','break','finished'].includes(m.status)&&int(m.set,5)&&m.set>0&&score(m.score)&&sides.includes(m.serve)){
  const logos={ours:raw.logos?.ours??null,theirs:raw.logos?.theirs??null};
  match={...common,...(validBoardLogos(logos)?{logos}:{}),status:m.status,set:m.set,score:score(m.score),serve:m.serve,colors:validBoardColors(m.colors)?m.colors:defaultBoardColors,
   ...(validId(m.scheduledId)?{scheduledId:m.scheduledId}:{}),
   events:list(m.events).filter(x=>x&&int(x.set,5)&&typeof x.score==='string'&&/^\d{1,4}:\d{1,4}$/.test(x.score)&&sides.includes(x.side)&&sides.includes(x.actor)&&Object.hasOwn(reasons,x.kind)).slice(-MAX_EVENTS).map(x=>({set:x.set,score:x.score,side:x.side,actor:x.actor,kind:x.kind,...(int(x.number,99)?{number:x.number}:{})})),
   stats:list(m.stats).filter(x=>x&&sides.includes(x.side)&&int(x.number,99)&&['points','attack','tip','ace','block'].every(k=>int(x[k]))).slice(0,100).map(x=>({side:x.side,number:x.number,points:x.points,attack:x.attack,tip:x.tip,ace:x.ace,block:x.block}))};
 }
 const schedule=[];for(const x of list(raw.schedule).slice(0,MAX_SCHEDULE)){try{schedule.push(scheduleItem(x));}catch{}}
 return {schema:PORTAL_SCHEMA,team:clean(raw.team),updatedAt:raw.updatedAt,schedule:sortedSchedule(schedule),match,archive:list(raw.archive).map(archived).filter(Boolean).slice(0,MAX_ARCHIVE)};
}

/** Results are derived solely from the published archive and completed current match. */
export function fanResults(data){
 const rows=new Map((data?.archive||[]).map(x=>[x.id,x]));
 if(data?.match?.status==='finished')rows.set(data.match.id,archiveMatch(data.match));
 return [...rows.values()].sort((a,b)=>b.startedAt-a.startedAt||a.id.localeCompare(b.id));
}
export function resultOutcome(x){return x.setsWon.ours>x.setsWon.theirs?'win':x.setsWon.ours<x.setsWon.theirs?'loss':'draw';}
export function resultSummary(rows){
 const counts={win:0,loss:0,draw:0};for(const x of rows)counts[resultOutcome(x)]++;
 let streak=0;
 // Manual results only have a date. On a mixed-outcome day with unknown order,
 // do not invent a streak; exact live timestamps can be ordered.
 const day=x=>x.id.startsWith('result_')?new Date(x.startedAt).toISOString().slice(0,10):localDay(x.startedAt);
 const groups=new Map();for(const x of rows){const k=day(x);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x);}
 outer:for(const k of [...groups.keys()].sort().reverse()){
  const group=groups.get(k).slice().sort((a,b)=>b.startedAt-a.startedAt);
  if(group.some(x=>x.id.startsWith('result_'))&&group.some(x=>resultOutcome(x)!=='win'))break;
  for(const x of group){if(resultOutcome(x)!=='win')break outer;streak++;}
 }
 return {...counts,total:rows.length,streak};
}

/** Describe only the published, consecutive suffix of rallies. No rules or
 * complete-history assumptions; scores are checked against each point. */
export function publicMatchMoments(match){
 const result=[];let prev=null,run=0,runSide=null,leader=null;
 for(const e of match.events||[]){
  if(!/^\d{1,4}:\d{1,4}$/.test(e.score)||!sides.includes(e.side)||!Number.isInteger(e.set))continue;
  const [ours,theirs]=e.score.split(':').map(Number);
  const consecutive=prev&&prev.set===e.set&&ours-prev.ours===(e.side==='ours'?1:0)&&theirs-prev.theirs===(e.side==='theirs'?1:0);
  if(!consecutive){run=0;runSide=null;leader=null;}
  const notes=[];
  if(consecutive&&ours===theirs)notes.push('Счёт сравнялся');
  const ahead=ours===theirs?null:ours>theirs?'ours':'theirs';
  if(ahead&&leader&&ahead!==leader)notes.push('Смена лидера');
  if(ahead)leader=ahead;
  run=runSide===e.side?run+1:1;runSide=e.side;
  if(run>=3)notes.push('Серия: '+run+' очка'+(run>=5?' подряд':' подряд')+' (видимая история)');
  const final=match.sets?.[e.set-1];
  if(final&&final.ours===ours&&final.theirs===theirs)notes.push('Партия завершена');
  result.push({...e,notes});
  prev={set:e.set,ours,theirs};
 }
 return result;
}

/** Only the public scoreboard and published suffix can be compared. This is
 * not proof of identical private drafts. No unpublished data is returned. */
export function checkHandoffMatch(local,remote){
 if(!local||local.mode!=='dual'||!remote||!['live','break'].includes(remote.status))throw Error('Нужен локальный черновик текущего подробного матча');
 const numbered=remote.events.some(e=>e.number!=null)||remote.stats.length>0;
 const projected=projectMatch(local,{events:remote.events.length>0,numbers:numbered,stats:remote.stats.length>0,scheduledId:remote.scheduledId});
 const keys=['id','opponent','startedAt','status','set','score','setsWon','sets','serve'];
 const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
 const equal=(a,b)=>canonical(a)===canonical(b);
 if(keys.some(k=>!equal(projected[k],remote[k])))throw Error('Локальный черновик и опубликованный счёт различаются. Передача остановлена.');
 const suffix=projected.events.slice(-remote.events.length);
 if(remote.events.length&&(!equal(suffix.map(e=>{const {number,...rest}=e;return rest;}),remote.events.map(e=>{const {number,...rest}=e;return rest;}))||remote.events.some((e,i)=>e.number!=null&&e.number!==suffix[i]?.number)))throw Error('Опубликованная история розыгрышей отличается от локального черновика.');
 if(remote.stats.length&&!equal(projected.stats,remote.stats))throw Error('Опубликованная статистика отличается от локального черновика.');
 return {id:remote.id,opponent:remote.opponent,set:remote.set,score:{...remote.score},setsWon:{...remote.setsWon},events:remote.events.length,stats:remote.stats.length};
}
