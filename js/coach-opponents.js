// Private team-scoped scouting; only recorded outcomes, no estimated ratings.
import {matchScore,playerAttendance,playerTrainingLoad} from './coach.js';
import {todayIso,addDays} from './model.js';
import {validPeriod,active} from './health.js';
import {replayDetailed,scoutSummary,rallySummary} from './match-protocol.js';
import {goalProgress} from './coach-goals.js';
export const opponentKey=s=>String(s??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
export function validateOpponentNote(r){
 if(!r||Object.keys(r).some(k=>!['id','kind','teamId','opponent','notes','updatedAt'].includes(k))||r.kind!=='opponentNote'||!['id','teamId','opponent'].every(k=>typeof r[k]==='string'&&r[k].trim()&&r[k].length<=200)||typeof r.notes!=='string'||r.notes.length>8000||typeof r.updatedAt!=='string'||!Number.isFinite(Date.parse(r.updatedAt)))throw Error('Проверьте карточку соперника');
}
export function opponentProfiles(teamId,matches,notes=[]){
 const groups=new Map();
 const get=name=>{const key=opponentKey(name);if(!key)return null;if(!groups.has(key))groups.set(key,{key,name,matches:[],note:null,wins:0,losses:0,draws:0,setsFor:0,setsAgainst:0});return groups.get(key);};
 for(const m of matches.filter(m=>m.teamId===teamId).sort((a,b)=>b.date.localeCompare(a.date))){
  const g=get(m.opponent);if(!g)continue;const s=matchScore(m);g.matches.push(m);g.setsFor+=s.ours;g.setsAgainst+=s.theirs;
  if(s.ours>s.theirs)g.wins++;else if(s.ours<s.theirs)g.losses++;else g.draws++;
 }
 for(const n of notes.filter(n=>n.teamId===teamId)){const g=get(n.opponent);if(g&&(!g.note||n.updatedAt>g.note.updatedAt))g.note=n;}
 return [...groups.values()].sort((a,b)=>(b.matches[0]?.date||'').localeCompare(a.matches[0]?.date||'')||a.name.localeCompare(b.name,'ru'));
}
export function trainingOverview(view,{from='',to='',today}={}){
 const chosen=view.trainings.filter(t=>(!from||t.date>=from)&&(!to||t.date<=to));
 return {count:chosen.length,held:chosen.filter(t=>t.held&&(!today||t.date<=today)).length,players:view.players.map(p=>({player:p,attendance:playerAttendance(p.id,chosen,today),load:playerTrainingLoad(p.id,chosen,{from,to,today})}))};
}

/** Private pre-match evidence. Restrict by exact opponent and team, and never
 * combine match-local opponent player IDs across matches. All counts are observed. */
export function preMatchDossier(teamId,view,{opponent,date=todayIso(),today=todayIso(),limit=5,notes=[],goals=[]}={}){
 if(!teamId||!opponentKey(opponent)||!validPeriod(date,null)||!validPeriod(today,null)||!Number.isInteger(limit)||limit<1||limit>10)throw Error('Выберите соперника, дату и число матчей');
 const asOf=date<=today?addDays(date,-1):today,from=addDays(asOf,-13),key=opponentKey(opponent);
 const history=view.matches.filter(m=>m.teamId===teamId&&m.date<=asOf&&opponentKey(m.opponent)===key).sort((a,b)=>b.date.localeCompare(a.date)||String(b.id||'').localeCompare(String(a.id||''))).slice(0,limit);
 const totals={wins:0,losses:0,draws:0,setsFor:0,setsAgainst:0,detailed:0,rallies:0,serve:0,serveWon:0,receive:0,receiveWon:0,knownZones:0,zoneTotal:0,zones:Array(6).fill(0)};
 for(const m of history){
  const score=matchScore(m);totals.wins+=Number(score.ours>score.theirs);totals.losses+=Number(score.ours<score.theirs);totals.draws+=Number(score.ours===score.theirs);totals.setsFor+=score.ours;totals.setsAgainst+=score.theirs;
  if(!m.detail)continue;
  const t=replayDetailed(m.detail).timeline,r=rallySummary(t).ours,z=scoutSummary(t,'theirs');
  totals.detailed++;totals.rallies+=r.serve+r.receive;totals.serve+=r.serve;totals.serveWon+=r.onServe;totals.receive+=r.receive;totals.receiveWon+=r.receiveWon;totals.knownZones+=z.knownZones;totals.zoneTotal+=z.total;z.zones.forEach((n,i)=>totals.zones[i]+=n);
 }
 const players=view.players.filter(p=>p.teamId===teamId&&!p.archived),trainings=view.trainings.filter(t=>t.teamId===teamId&&t.date>=from&&t.date<=asOf&&t.held),tests=(view.tests||[]).filter(t=>t.teamId===teamId);
 const roster=players.map(player=>({player,restrictions:(player.restrictions||[]).filter(r=>active(r,date)),attendance:playerAttendance(player.id,trainings,asOf),load:playerTrainingLoad(player.id,trainings,{from,to:asOf,today:asOf}),
  goals:goals.filter(g=>g.teamId===teamId&&g.playerId===player.id&&g.status==='active'&&g.from<=date).map(goal=>({goal,progress:goalProgress(goal,tests,asOf)}))}));
 const note=notes.filter(n=>n.teamId===teamId&&opponentKey(n.opponent)===key).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]||null;
 return {date,asOf,from,history,totals,roster,note,latestRoster:history.find(m=>m.detail?.awayPlayers?.length)?.detail.awayPlayers||[]};
}
