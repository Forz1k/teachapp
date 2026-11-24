import {matchScore} from './coach.js';
import {matchTactics} from './match-tactics.js';
const normalize=s=>String(s??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru').replaceAll('ё','е');
export const historySource=m=>m.imported?'imported':m.detail?'live':'manual';
export function historyOutcome(m){const s=matchScore(m);return s.ours>s.theirs?'win':s.ours<s.theirs?'loss':'draw';}
export function filterHistory(matches,{query='',from='',to='',outcome='',source=''}={}){
 const terms=normalize(query).split(' ').filter(Boolean);
 if(from&&to&&from>to)return [];
 return matches.filter(m=>(!from||m.date>=from)&&(!to||m.date<=to)&&(!outcome||historyOutcome(m)===outcome)&&(!source||historySource(m)===source)&&terms.every(t=>normalize(m.opponent+' '+(m.competition||'')).includes(t))).slice().sort((a,b)=>b.date.localeCompare(a.date)||String(b.detail?.startedAt||'').localeCompare(String(a.detail?.startedAt||''))||String(a.id).localeCompare(String(b.id)));
}
export function historySummary(matches){
 const out={matches:matches.length,wins:0,losses:0,draws:0,setsWon:0,setsLost:0,pointsWon:0,pointsLost:0,detailed:0};
 for(const m of matches){const s=matchScore(m),o=historyOutcome(m);out[o==='win'?'wins':o==='loss'?'losses':'draws']++;out.setsWon+=s.ours;out.setsLost+=s.theirs;out.detailed+=Number(!!m.detail);for(const r of m.sets){out.pointsWon+=r.ours;out.pointsLost+=r.theirs;}}
 return out;
}
export function compareHistory(a,b){
 if(!a||!b||a.id===b.id)return null;
 const one=m=>{const h=historySummary([m]);let t=null;if(m.detail)try{t=matchTactics(m.detail).overall;}catch{}return {id:m.id,opponent:m.opponent,date:m.date,source:historySource(m),sets:h.setsWon+':'+h.setsLost,points:h.pointsWon+':'+h.pointsLost,serve:t?.serveRate??null,receive:t?.receiveRate??null,serveSample:t?.serve??0,receiveSample:t?.receive??0,rallies:t?.rallies??null};};
 return [one(a),one(b)];
}
