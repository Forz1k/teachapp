// Private team-scoped scouting; only recorded outcomes, no estimated ratings.
import {matchScore,playerAttendance,playerTrainingLoad} from './coach.js';
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
