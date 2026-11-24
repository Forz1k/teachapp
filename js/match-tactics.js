import {replayDetailed} from './match-protocol.js';
const pct=(won,n)=>n?100*won/n:null;
const blank=()=>({rallies:0,won:0,lost:0,serve:0,serveWon:0,receive:0,receiveWon:0});
const record=(r,e)=>{r.rallies++;r.won+=Number(e.side==='ours');r.lost+=Number(e.side==='theirs');const k=e.before.serve==='ours'?'serve':'receive';r[k]++;r[k+'Won']+=Number(e.side==='ours');};
const finish=r=>({...r,rate:pct(r.won,r.rallies),serveRate:pct(r.serveWon,r.serve),receiveRate:pct(r.receiveWon,r.receive),plusMinus:r.won-r.lost});
const add=(a,b)=>{for(const k of Object.keys(blank()))a[k]+=b[k];};
const pairKey=(a,b)=>JSON.stringify([a,b].sort());
const sortedRows=(map,min)=>[...map.values()].map(r=>({...finish(r),eligible:r.rallies>=min})).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(b.rate??-1)-(a.rate??-1)||b.rallies-a.rallies);
const nameKey=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
export function matchTactics(d,windowSize=5){
 if(!Number.isInteger(windowSize)||windowSize<1||windowSize>10)throw Error('Проверьте окно анализа');
 const s=replayDetailed(d),bySet=new Map(),rotations=Array.from({length:6},(_,i)=>({...blank(),position:i+1})),pairs=new Map(),six=new Map(),all=blank(),timeouts=[];
 for(const e of s.timeline){
  if(!bySet.has(e.set))bySet.set(e.set,{set:e.set,events:[],rallyEvents:[],score:[{rally:0,ours:0,theirs:0}],...blank(),maxLead:0,maxDeficit:0,maxRun:0,run:0});
  const set=bySet.get(e.set);set.events.push(e);
  if(e.type!=='rally')continue;
  record(all,e);record(set,e);record(rotations[e.rotation.ours],e);
  const ids=[...new Set(e.before.lineups.ours.filter(Boolean))].sort();
  if(ids.length===6){
   const key=JSON.stringify(ids);if(!six.has(key))six.set(key,{key,players:ids,...blank()});record(six.get(key),e);
   for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
    const key=pairKey(ids[i],ids[j]);if(!pairs.has(key))pairs.set(key,{key,players:[ids[i],ids[j]],...blank()});record(pairs.get(key),e);
   }
  }
  const prev=set.score.at(-1),ours=prev.ours+Number(e.side==='ours'),theirs=prev.theirs+Number(e.side==='theirs');
  set.rallyEvents.push(e);set.score.push({rally:set.rallyEvents.length,ours,theirs});
  set.maxLead=Math.max(set.maxLead,ours-theirs);set.maxDeficit=Math.max(set.maxDeficit,theirs-ours);set.run=e.side==='ours'?set.run+1:0;set.maxRun=Math.max(set.maxRun,set.run);
 }
 const sets=[...bySet.values()].map(set=>{
  let index=0;
  for(const e of set.events){
   if(e.type==='rally'){index++;continue;}
   if(e.type!=='timeout')continue;
   const before=set.rallyEvents.slice(Math.max(0,index-windowSize),index),after=set.rallyEvents.slice(index,index+windowSize);
   const result=a=>({won:a.filter(x=>x.side==='ours').length,total:a.length,rate:pct(a.filter(x=>x.side==='ours').length,a.length)});
   const a=result(before),b=result(after);
   timeouts.push({set:set.set,side:e.side,score:e.score,before:a,after:b,delta:a.total===windowSize&&b.total===windowSize?b.rate-a.rate:null});
  }
  const {events,rallyEvents,run,...summary}=set;
  return finish(summary);
 });
 return {sets,overall:finish(all),rotations:rotations.map(finish),pairs:sortedRows(pairs,30),six:sortedRows(six,30),timeouts};
}
export function opponentHistory(matches){
 const groups=new Map();
 for(const m of matches){const key=nameKey(m.opponent);if(!key)continue;
  if(!groups.has(key))groups.set(key,{key,name:m.opponent,matches:0,wins:0,losses:0,draws:0,setsWon:0,setsLost:0,details:0});
  const g=groups.get(key),a=m.sets.filter(s=>s.ours>s.theirs).length,b=m.sets.filter(s=>s.ours<s.theirs).length;
  g.matches++;g.setsWon+=a;g.setsLost+=b;g.wins+=Number(a>b);g.losses+=Number(a<b);g.draws+=Number(a===b);g.details+=Number(!!m.detail);
 }
 return [...groups.values()].sort((a,b)=>b.matches-a.matches||a.name.localeCompare(b.name,'ru'));
}
export function teamTactics(matches,{from='',to='',opponent='',min=30}={}){
 if(!Number.isInteger(min)||min<1||min>500)throw Error('Проверьте минимальную выборку');
 const chosen=matches.filter(m=>(!from||m.date>=from)&&(!to||m.date<=to)&&(!opponent||nameKey(m.opponent)===opponent));
 const all=blank(),rotations=Array.from({length:6},(_,i)=>({...blank(),position:i+1})),pairs=new Map(),six=new Map(),timeouts=[];let detailed=0;
 for(const m of chosen){if(!m.detail)continue;
  const a=matchTactics(m.detail);detailed++;add(all,a.overall);for(const r of a.rotations)add(rotations[r.position-1],r);
  for(const [target,rows] of [[pairs,a.pairs],[six,a.six]])for(const r of rows){if(!target.has(r.key))target.set(r.key,{key:r.key,players:r.players,...blank(),matches:0});const g=target.get(r.key);add(g,r);g.matches++;}
  timeouts.push(...a.timeouts.map(t=>({...t,date:m.date,opponent:m.opponent})));
 }
 return {total:chosen.length,detailed,overall:finish(all),rotations:rotations.map(r=>({...finish(r),eligible:r.rallies>=min})),pairs:sortedRows(pairs,min),six:sortedRows(six,min),timeouts,opponents:opponentHistory(chosen)};
}
