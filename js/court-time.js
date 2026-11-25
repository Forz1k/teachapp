/* Court occupancy during measured intervals. Not rally-only ball-in-play time.
 * State is derived from the event log; no periodic writes or wall-clock guesses for old matches. */
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const sideKeys=['ours','theirs'];
const empty=()=>({elapsedMs:0,started:false,untrackedRallies:0,players:{ours:Object.create(null),theirs:Object.create(null)},six:Object.create(null)});
const time=x=>typeof x==='number'?x:Date.parse(x);
export function createCourtClock(startedAt){
 return {running:false,lastAt:time(startedAt),set:1,sets:[empty()]};
}
export function clockAdvance(c,at,lineups){
 const now=time(at);check(Number.isFinite(now)&&now>=c.lastAt,'Некорректное время события');
 const delta=now-c.lastAt;const set=c.sets[c.set-1];
 if(c.running&&delta){
  set.elapsedMs+=delta;
  const ids=[...new Set(lineups.ours)].filter(id=>id!=null).sort();
  if(ids.length===6){const key=JSON.stringify(ids);set.six[key]=(set.six[key]||0)+delta;}
  for(const side of sideKeys)for(const id of new Set(lineups[side]))if(id!=null)set.players[side][id]=(set.players[side][id]||0)+delta;
 }
 c.lastAt=now;
}
export function clockEvent(c,e){
 check(e&&Object.keys(e).every(k=>['type','at','running'].includes(k))&&typeof e.running==='boolean'&&e.running!==c.running,'Некорректный запуск или пауза времени');
 c.running=e.running;if(c.running)c.sets[c.set-1].started=true;
}
export function clockRally(c){if(!c.running)c.sets[c.set-1].untrackedRallies++;}
export function clockPause(c){c.running=false;}
export function clockNext(c){c.running=false;c.set++;c.sets.push(empty());}
export function clockSummary(c,{lineups,asOf=c.lastAt}={}){
 const copy={...c,sets:c.sets.map(s=>({...s,six:Object.assign(Object.create(null),s.six),players:{ours:Object.assign(Object.create(null),s.players.ours),theirs:Object.assign(Object.create(null),s.players.theirs)}}))},now=time(asOf);
 if(copy.running&&lineups&&Number.isFinite(now)&&now>copy.lastAt)clockAdvance(copy,now,lineups);
 const players={ours:Object.create(null),theirs:Object.create(null)};
 for(const set of copy.sets)for(const side of sideKeys)for(const [id,ms] of Object.entries(set.players[side]))players[side][id]=(players[side][id]||0)+ms;
 const measured=copy.sets.some(s=>s.started),untrackedRallies=copy.sets.reduce((n,s)=>n+s.untrackedRallies,0);
 return {running:copy.running,measured,untrackedRallies,partial:measured&&untrackedRallies>0,elapsedMs:copy.sets.reduce((n,s)=>n+s.elapsedMs,0),players,sets:copy.sets};
}
export function courtTimeLabel(ms){
 if(ms===null||ms===undefined)return '—';
 const sec=Math.floor(Math.max(0,ms)/1000),h=Math.floor(sec/3600),m=Math.floor(sec/60)%60,s=sec%60;
 return h? h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'):m+':'+String(s).padStart(2,'0');
}
