/* Public portal: explicit, bounded projection. Never serialize private match objects. */
import {replayDetailed,reasons,defaultBoardColors,validBoardColors} from './match-protocol.js';
export const PORTAL_SCHEMA=1;
export const MAX_SCHEDULE=20,MAX_ARCHIVE=20,MAX_EVENTS=30;
const sides=['ours','theirs'];
const clean=(v,max=100)=>typeof v==='string'?v.trim().slice(0,max):'';
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const int=(v,max=9999)=>Number.isInteger(v)&&v>=0&&v<=max;
const dateMs=v=>Number.isFinite(v)&&v>=0&&v<=8640000000000000;
const list=v=>Array.isArray(v)?v:Object.values(v&&typeof v==='object'?v:{});
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
export function shareUrl(base,origin,owner,slug){
 portalAddress(origin,owner,slug);
 const u=new URL('live/',base);u.searchParams.set('db',firebaseOrigin(origin));u.searchParams.set('owner',owner);u.searchParams.set('team',slug);return u.href;
}
export function scheduleItem(x){
 if(!x||!validId(x.id)||!clean(x.opponent)||!dateMs(x.startAt)||x.startAt===0)throw Error('Проверьте соперника и дату матча');
 return {id:x.id,opponent:clean(x.opponent),startAt:x.startAt};
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
 return {id:d.id,opponent:clean(d.opponent),startedAt:Date.parse(d.startedAt),status:s.finished?'finished':s.setEnded?'break':'live',set:s.setEnded?s.sets.length:s.sets.length+1,score:{...s.score},setsWon:{ours:wins,theirs:s.sets.length-wins},sets:s.sets.map(x=>({...x})),serve:s.serve,colors:{...(d.boardColors||defaultBoardColors)},events:recent,stats:rows,...(scheduledId&&validId(scheduledId)?{scheduledId}:{})};
}
export function archiveMatch(m){return {id:m.id,opponent:m.opponent,startedAt:m.startedAt,setsWon:{...m.setsWon},sets:m.sets.map(x=>({...x}))};}
export function buildPortal(team,schedule,match,archive,now=Date.now()){
 return {schema:PORTAL_SCHEMA,team:clean(team)||'Команда',updatedAt:now,schedule:sortedSchedule(schedule),...(match?{match}:{}),archive:archive.slice(0,MAX_ARCHIVE)};
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
  match={...common,status:m.status,set:m.set,score:score(m.score),serve:m.serve,colors:validBoardColors(m.colors)?m.colors:defaultBoardColors,
   ...(validId(m.scheduledId)?{scheduledId:m.scheduledId}:{}),
   events:list(m.events).filter(x=>x&&int(x.set,5)&&typeof x.score==='string'&&/^\d{1,4}:\d{1,4}$/.test(x.score)&&sides.includes(x.side)&&sides.includes(x.actor)&&Object.hasOwn(reasons,x.kind)).slice(-MAX_EVENTS).map(x=>({set:x.set,score:x.score,side:x.side,actor:x.actor,kind:x.kind,...(int(x.number,99)?{number:x.number}:{})})),
   stats:list(m.stats).filter(x=>x&&sides.includes(x.side)&&int(x.number,99)&&['points','attack','tip','ace','block'].every(k=>int(x[k]))).slice(0,100).map(x=>({side:x.side,number:x.number,points:x.points,attack:x.attack,tip:x.tip,ace:x.ace,block:x.block}))};
 }
 const schedule=[];for(const x of list(raw.schedule).slice(0,MAX_SCHEDULE)){try{schedule.push(scheduleItem(x));}catch{}}
 return {schema:PORTAL_SCHEMA,team:clean(raw.team),updatedAt:raw.updatedAt,schedule:sortedSchedule(schedule),match,archive:list(raw.archive).map(archived).filter(Boolean).slice(0,MAX_ARCHIVE)};
}
