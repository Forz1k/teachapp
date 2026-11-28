import {matchScore} from './coach-analytics.js';
import {matchTactics} from './match-tactics.js';
const normalize=s=>String(s??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru').replaceAll('ё','е');
export const historySource=m=>m.imported?'imported':m.detail?'live':'manual';
export function historyOutcome(m){const s=matchScore(m);return s.ours>s.theirs?'win':s.ours<s.theirs?'loss':'draw';}
const resultOf=(ours,theirs)=>ours>theirs?'win':ours<theirs?'loss':'draw';
const emptySummary=()=>({matches:0,wins:0,losses:0,draws:0,setsWon:0,setsLost:0,pointsWon:0,pointsLost:0,detailed:0});
function historyEntry(match){
 let setsWon=0,setsLost=0,pointsWon=0,pointsLost=0;
 for(const r of match.sets){setsWon+=Number(r.ours>r.theirs);setsLost+=Number(r.theirs>r.ours);pointsWon+=r.ours;pointsLost+=r.theirs;}
 return {match,setsWon,setsLost,pointsWon,pointsLost,outcome:resultOf(setsWon,setsLost),source:historySource(match),detailed:Number(!!match.detail),search:normalize(match.opponent+' '+(match.competition||'')),date:match.date,startedAt:String(match.detail?.startedAt||''),id:String(match.id)};
}
function addSummary(out,e){
 out.matches++;out[e.outcome==='win'?'wins':e.outcome==='loss'?'losses':'draws']++;
 out.setsWon+=e.setsWon;out.setsLost+=e.setsLost;out.pointsWon+=e.pointsWon;out.pointsLost+=e.pointsLost;out.detailed+=e.detailed;
}
// A view-local snapshot only. Rebuild when the archive is loaded or edited.
export function prepareHistory(matches){
 return matches.map(historyEntry).sort((a,b)=>b.date.localeCompare(a.date)||b.startedAt.localeCompare(a.startedAt)||a.id.localeCompare(b.id));
}
export function selectHistory(index,{query='',from='',to='',outcome='',source=''}={}){
 const entries=[],summary=emptySummary(),terms=normalize(query).split(' ').filter(Boolean);
 if(from&&to&&from>to)return {entries,summary};
 for(const e of index){
  if(from&&e.date<from||to&&e.date>to||outcome&&e.outcome!==outcome||source&&e.source!==source||!terms.every(t=>e.search.includes(t)))continue;
  entries.push(e);addSummary(summary,e);
 }
 return {entries,summary};
}
export function filterHistory(matches,filter={}){
 if(filter.from&&filter.to&&filter.from>filter.to)return [];
 return selectHistory(prepareHistory(matches),filter).entries.map(e=>e.match);
}
export function historySummary(matches){
 const out=emptySummary();for(const m of matches)addSummary(out,historyEntry(m));return out;
}
export function compareHistory(a,b){
 if(!a||!b||a.id===b.id)return null;
 const one=m=>{const h=historySummary([m]);let t=null;if(m.detail)try{t=matchTactics(m.detail).overall;}catch{}return {id:m.id,opponent:m.opponent,date:m.date,source:historySource(m),sets:h.setsWon+':'+h.setsLost,points:h.pointsWon+':'+h.pointsLost,serve:t?.serveRate??null,receive:t?.receiveRate??null,serveSample:t?.serve??0,receiveSample:t?.receive??0,rallies:t?.rallies??null};};
 return [one(a),one(b)];
}
