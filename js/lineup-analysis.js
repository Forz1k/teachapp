/* Distinct evidence: starting six = set outcome; actual on-court membership =
 * rally outcome; clock intervals = measured time; VolleyPoint = nominal duration.
 * Never infer rotations or service phases from historical terminal scores. */
import {replayDetailed,courtTime} from './match-protocol.js';
const norm=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const pct=(a,b)=>b?100*a/b:null;
const key=ids=>JSON.stringify(ids);
const validLine=ids=>Array.isArray(ids)&&ids.length===6&&new Set(ids).size===6;
function groups(ids){
 const a=[...ids].sort(),pairs=[];
 for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)pairs.push([a[i],a[j]]);
 return {six:a,pairs};
}
const blank=ids=>({key:key(ids),players:ids,rallies:0,won:0,liveRallies:0,pdfRallies:0,serve:0,serveWon:0,receive:0,receiveWon:0,timedRallies:0,timedWon:0,measuredMs:0,pdfMs:0,pdfSets:0,matchIds:new Set(),timedMatchIds:new Set()});
const get=(map,ids)=>{const k=key(ids);if(!map.has(k))map.set(k,blank(ids));return map.get(k);};
const finish=(r,min,phaseMin)=>{const {matchIds,timedMatchIds,...rest}=r;return {...rest,matches:matchIds.size,timedMatches:timedMatchIds.size,rate:pct(r.won,r.rallies),plusMinus:2*r.won-r.rallies,serveRate:pct(r.serveWon,r.serve),receiveRate:pct(r.receiveWon,r.receive),eligible:r.rallies>=min,serveEligible:r.serve>=phaseMin,receiveEligible:r.receive>=phaseMin,coverage:pct(r.timedRallies,r.liveRallies)};};
const startBlank=ids=>({key:key(ids),players:ids,sets:0,wins:0,pointsFor:0,pointsAgainst:0,liveSets:0,pdfSets:0,stableSets:0,stabilityKnown:0,matchIds:new Set()});
function startAdd(map,ids,matchId,score,source,stable){
 const k=key(ids);if(!map.has(k))map.set(k,startBlank(ids));const r=map.get(k);
 r.sets++;r.wins+=Number(score.ours>score.theirs);r.pointsFor+=score.ours;r.pointsAgainst+=score.theirs;r[source+'Sets']++;r.matchIds.add(matchId);
 if(stable!==null){r.stabilityKnown++;r.stableSets+=Number(stable);}
}
export function lineupAnalysis(matches,{from='',to='',opponent='',source='all',min=30,phaseMin=10,set=0}={}){
 check(['all','live','imported'].includes(source)&&Number.isInteger(min)&&min>=1&&min<=500&&Number.isInteger(phaseMin)&&phaseMin>=1&&phaseMin<=500&&Number.isInteger(set)&&set>=0&&set<=5,'Проверьте фильтры составов');
 const selected=matches.filter(m=>(!from||m.date>=from)&&(!to||m.date<=to)&&(!opponent||norm(m.opponent)===opponent)&&(source==='all'||(source==='live'?m.detail:m.imported)));
 const pairs=new Map(),six=new Map(),starts=new Map(),orderedStarts=new Map();
 // Same actual six appears across many rallies/rotations. Resolve the 16
 // accumulator references once per ordered lineup, scoped to this calculation.
 const groupCache=new Map();
 const liveRows=ids=>{
  const ordered=key(ids);let rows=groupCache.get(ordered);
  if(!rows){const g=groups(ids);rows=[get(six,g.six),...g.pairs.map(p=>get(pairs,p))];groupCache.set(ordered,rows);}
  return rows;
 };
 let liveMatches=0,pdfMatches=0,pdfWithoutStarts=0,unknownMatches=0,liveRallies=0,pdfRallies=0,pdfSixRallies=0,pdfPairRallies=0,measuredMs=0,pdfSetCount=0,pdfKnownStarts=0,completedSets=0,knownStarts=0;
 for(const [i,m] of selected.entries()){
  // Internal unique index; no dependence on untrusted IDs as object properties.
  const mid=i;
  if(m.detail){
   liveMatches++;const s=replayDetailed(m.detail),t=courtTime(s);
   const events=s.timeline.filter(e=>e.type==='rally'&&(!set||e.set===set));
   const changes=new Set(s.timeline.filter(e=>e.type==='sub'&&e.side==='ours'||e.type==='libero').map(e=>e.set));
   liveRallies+=events.length;
   for(const [j,v] of s.setDetails.entries()){
    if(set&&v.set!==set)continue;completedSets++;knownStarts++;
    const ids=v.lineups.ours,stable=!changes.has(v.set);
    startAdd(starts,[...ids].sort(),mid,s.sets[j],'live',stable);startAdd(orderedStarts,ids,mid,s.sets[j],'live',stable);
   }
   for(const e of events){
    const won=Number(e.side==='ours'),phase=e.before.serve==='ours'?'serve':'receive';
    for(const r of liveRows(e.before.lineups.ours)){
     r.rallies++;r.won+=won;r.liveRallies++;r[phase]++;r[phase+'Won']+=won;r.matchIds.add(mid);
     if(e.clockRunning){r.timedRallies++;r.timedWon+=won;}
    }
   }
   for(const [j,v] of t.sets.entries()){
    if(set&&j+1!==set)continue;measuredMs+=v.elapsedMs;
    for(const [k,ms] of Object.entries(v.six)){
     for(const r of liveRows(JSON.parse(k))){r.measuredMs+=ms;r.matchIds.add(mid);r.timedMatchIds.add(mid);}
    }
   }
  }else if(m.imported){
   pdfMatches++;const v=m.imported.timing;
   if(!v?.sets.some((s,j)=>(!set||j+1===set)&&validLine(s.lineup)))pdfWithoutStarts++;
   for(const [j,score] of m.sets.entries()){
    if(set&&j+1!==set)continue;completedSets++;pdfSetCount++;
    const events=m.imported.rallies.filter(e=>e.set===j+1),won=events.filter(e=>e.winner==='ours').length;
    pdfRallies+=events.length;
    const timing=v?.sets[j];if(!validLine(timing?.lineup))continue;knownStarts++;pdfKnownStarts++;
    const ids=timing.lineup,changes=timing.changes;
    const stable=changes===null?null:changes.length===0;
    startAdd(starts,[...ids].sort(),mid,score,'pdf',stable);startAdd(orderedStarts,ids,mid,score,'pdf',stable);
    if(changes===null)continue;
    // For starters untouched by any recorded change, membership is known for
    // every rally. For changed players no per-rally membership is inferred.
    const changed=new Set(changes.flatMap(e=>[e.out,e.in])),full=[...ids].filter(id=>!changed.has(id)).sort(),g=groups(full);
    const rows=g.pairs.map(p=>get(pairs,p));
    if(g.pairs.length)pdfPairRallies+=events.length;
    if(full.length===6){rows.push(get(six,g.six));pdfSixRallies+=events.length;}
    for(const r of rows){r.rallies+=events.length;r.won+=won;r.pdfRallies+=events.length;r.matchIds.add(mid);if(timing.seconds>0){r.pdfMs+=timing.seconds*1000;r.pdfSets++;}}
   }
  }else{unknownMatches++;completedSets+=m.sets.filter((_,j)=>!set||j+1===set).length;}
 }
 const sorted=map=>[...map.values()].map(r=>finish(r,min,phaseMin)).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.rallies-a.rallies||b.measuredMs-a.measuredMs||a.key.localeCompare(b.key));
 const startRows=map=>[...map.values()].map(r=>{const {matchIds,...rest}=r;return {...rest,matches:matchIds.size,winRate:pct(r.wins,r.sets),plusMinus:r.pointsFor-r.pointsAgainst,eligible:r.sets>=3&&matchIds.size>=2};}).sort((a,b)=>b.sets-a.sets||a.key.localeCompare(b.key));
 return {total:selected.length,liveMatches,pdfMatches,pdfWithoutStarts,unknownMatches,liveRallies,pdfRallies,pdfSixRallies,pdfPairRallies,measuredMs,pdfSetCount,pdfKnownStarts,completedSets,knownStarts,pairs:sorted(pairs),six:sorted(six),starts:startRows(starts),orderedStarts:startRows(orderedStarts)};
}
