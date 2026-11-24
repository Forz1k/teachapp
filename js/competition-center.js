/* Pure local competition overview, no external requests. */
import {localDay} from './public-portal.js';
import {replay} from './volleyball.js';
const norm=x=>String(x??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
export function competitionOverview(teamId,live,info,now=Date.now()){
 const d=info.data,today=localDay(now);
 const drafts=live.filter(x=>x.teamId===teamId).map(x=>{
  try{const s=replay(x);return {id:x.id,opponent:x.opponent,date:x.date,score:s.score||{ours:s.ours,theirs:s.theirs},finished:!!s.finished,valid:true};}
  catch{return {id:x.id,opponent:x.opponent,date:x.date,valid:false};}
 }).sort((a,b)=>b.date.localeCompare(a.date));
 const fixtures=d.schedule.filter(x=>x.id!==d.match?.scheduledId||!['live','break','finished'].includes(d.match?.status)).slice().sort((a,b)=>a.startAt-b.startAt);
 const rows=fixtures.map(x=>({...x,day:localDay(x.startAt),overdue:localDay(x.startAt)<today,hasDraft:drafts.some(y=>y.date===localDay(x.startAt)&&norm(y.opponent)===norm(x.opponent))}));
 const next=rows.find(x=>!x.overdue)||null;
 const mode=d.pendingDelete?'withdrawal':!d.enabled?'disabled':!info.connected?'login':info.dirty?'pending':'connected';
 return {drafts,fixtures:rows,next,overdue:rows.filter(x=>x.overdue),mode};
}
export function fixtureCalendar(teams,portalByTeam,from,to){
 return teams.filter(t=>!t.archived).flatMap(t=>{
  const d=portalByTeam[t.id];if(!d)return [];
  return d.schedule.filter(x=>x.id!==d.match?.scheduledId||!['live','break','finished'].includes(d.match?.status)).flatMap(x=>{
   const date=localDay(x.startAt);if(date<from||date>to)return [];
   const dt=new Date(x.startAt),time=String(dt.getHours()).padStart(2,'0')+':'+String(dt.getMinutes()).padStart(2,'0');
   return [{id:'fixture-'+t.id+'-'+x.id,source:'coach',date,time,minutes:0,title:'Матч · '+t.name+' — '+x.opponent,exportTitle:'Волейбольный матч',done:false,remind:30}];
  });
 });
}
