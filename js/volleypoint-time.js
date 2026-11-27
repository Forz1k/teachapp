/* Historical court occupancy is reconstructed from reported set duration and complete
 * lineup/substitution sections. No timestamps or fabricated average rally durations. */
import {courtTimeLabel} from './court-time.js';
const check=(ok,msg)=>{if(!ok)throw Error('VolleyPoint: '+msg);};
const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&Object.keys(o).every(k=>keys.includes(k));
const norm=s=>String(s??'').toLowerCase().replace(/ё/g,'е').trim().replace(/\s+/g,' ');
const words=s=>norm(s).split(' ').filter(Boolean);
const nameFits=(short,full)=>words(short).length>0&&words(short).every(w=>words(full).includes(w));
const duration=x=>{const m=/^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(x||'');return m?+m[1]*3600+ +m[2]*60+ +m[3]:null;};
const timeoutDuration=x=>duration(x)??duration('0:'+x);
const validSeconds=(n,max=86400)=>Number.isInteger(n)&&n>=0&&n<=max;
const sideKeys=['ours','theirs'];
const validId=(id,roster)=>typeof id==='string'&&roster.includes(id);
const kinds={'Обычная замена':'regular','Замена либеро':'libero','Выход либеро':'libero','Возвращение либеро':'libero','Либеро':'libero'};
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
export const sameVolleyEvidence=(a,b)=>canonical(a)===canonical(b);
const noSubs=/^(?:нет замен|замены не (?:зафиксированы|проводились)|замен не было)$/i;
const noTimeouts=/^(?:нет тайм-аутов|тайм-ауты не (?:зафиксированы|проводились)|тайм-аутов не было)$/i;
function stripCaptain(x){return x.replace(/\s*\([CС]\)\s*/gi,' ').trim();}
function rosterPlayer(team,number,name){return team.players.find(p=>p.number===number&&nameFits(name,p.name));}
function participants(lineup,changes){
 const on=new Set(lineup),ever=new Set(lineup),changed=new Set();
 for(const e of changes){
  if(!on.has(e.out)||on.has(e.in)||e.out===e.in)return null;
  on.delete(e.out);on.add(e.in);ever.add(e.in);changed.add(e.out);changed.add(e.in);
 }
 return {ever,changed};
}
// The PDF uses abbreviated team names in lineups and full names in the statistics.
// Resolve aliases only when six numbers and surnames uniquely identify one side.
export function parseVolleyTiming(lines,teams,setSeconds){
 const sets=setSeconds.map(seconds=>({seconds,lineups:[null,null],changes:[[],[]],timeouts:[]}));
 const aliases=new Map(teams.map((t,i)=>[norm(t.name),i])),badAliases=new Set(),badLineups=new Set();
 const header=lines.find(x=>x.includes('Время матча:'))||'';
 const rawMatch=/Время матча:\s*(\d{1,3}:\d{2}:\d{2})\b/.exec(header);
 const match=rawMatch?duration(rawMatch[1]):null;
 const matchSeconds=validSeconds(match,432000)?match:null;
 let mode='',set=0,sawSubs=false,sawTimeouts=false,subsOk=true,timeoutsOk=true,subRows=0,timeoutRows=0,explicitNoSubs=false,explicitNoTimeouts=false,previousIncoming=null;
 const alias=(label,i)=>{const k=norm(label);if(badAliases.has(k))return;if(aliases.has(k)&&aliases.get(k)!==i){badAliases.add(k);aliases.delete(k);}else aliases.set(k,i);};
 for(const line of lines){
  let m;
  if((m=/^Расстановки на сет (\d)$/.exec(line))){mode='lineup';set=+m[1];continue;}
  if(line==='Расстановки'){mode='';continue;}
  if(line==='Замены'){mode='subs';sawSubs=true;previousIncoming=null;continue;}
  if(line==='Тайм-ауты'){mode='timeouts';sawTimeouts=true;previousIncoming=null;continue;}
  if(line==='Статистика'||line==='Детали очка'||line==='Подписи'||line==='Расстановки P1–P6'||line==='Серии подач'||/ Выиграно очков:\s*\d+$/.test(line)){mode='';continue;}
  if(mode==='lineup'){
   if(/^Команда P1 P2 P3 P4 P5 P6$/.test(line))continue;
   const entries=[...line.matchAll(/#(\d{1,3})\s*([^#]+)/g)];
   if(entries.length!==6||!sets[set-1])continue;
   const label=stripCaptain(line.slice(0,entries[0].index)),nums=entries.map(x=>+x[1]),names=entries.map(x=>stripCaptain(x[2]));
   if(new Set(nums).size!==6)continue;
   const candidates=teams.flatMap((t,i)=>nums.every((n,j)=>rosterPlayer(t,n,names[j]))?[i]:[]);
   const known=aliases.get(norm(label));
   const i=candidates.length===1?candidates[0]:candidates.includes(known)?known:null;
   if(i===null||i===undefined||known!==undefined&&known!==i){if(known!==undefined&&sets[set-1])badLineups.add(set+':'+known);continue;}
   alias(label,i);
   const target=sets[set-1].lineups;
   if(target[i]!==null||badLineups.has(set+':'+i)){badLineups.add(set+':'+i);target[i]=null;}else target[i]=nums;
   continue;
  }
  if(mode==='subs'){
   if(/^Сет Команда Тип Игрок Позиция$/.test(line))continue;
   if(noSubs.test(line)){explicitNoSubs=true;previousIncoming=null;continue;}
   m=/^(\d) (.+?) #(\d{1,3}) (.+?)\s*(?:->|→)\s*(?:\([CС]\) )?#(\d{1,3}) (.+?) P([1-6])$/.exec(line);
   if(!m){
    // Dart PDF wraps the final given name to the next text row.
    if(previousIncoming&&!/[\d#]/.test(line)&&nameFits(line,previousIncoming)){previousIncoming=null;continue;}
    subsOk=false;previousIncoming=null;continue;
   }
   previousIncoming=null;
   const n=+m[1],prefix=stripCaptain(m[2]),out=+m[3],incoming=+m[5],zone=+m[7];
   const type=Object.keys(kinds).find(t=>prefix.endsWith(' '+t)),label=type?prefix.slice(0,-type.length-1):'';
   const i=aliases.get(norm(label)),t=teams[i],outPlayer=t&&rosterPlayer(t,out,stripCaptain(m[4])),inPlayer=t&&rosterPlayer(t,incoming,stripCaptain(m[6]));
   if(!sets[n-1]||!type||!outPlayer||!inPlayer||out===incoming||explicitNoSubs){subsOk=false;continue;}
   sets[n-1].changes[i].push({out,in:incoming,zone,kind:kinds[type]});subRows++;previousIncoming=inPlayer.name;continue;
  }
  if(mode==='timeouts'){
   if(/^Сет Команда # Длительность$/.test(line))continue;
   if(noTimeouts.test(line)){explicitNoTimeouts=true;continue;}
   m=/^(\d) (.+?) (\d+) (\d{1,3}:\d{2}(?::\d{2})?)$/.exec(line);
   if(!m){timeoutsOk=false;continue;}
   const n=+m[1],i=aliases.get(norm(m[2])),number=+m[3],seconds=timeoutDuration(m[4]),target=sets[n-1];
   if(!target||i===undefined||!validSeconds(seconds,3600)||number<1||number>20||target.timeouts.some(t=>t.side===i&&t.number===number)||explicitNoTimeouts){timeoutsOk=false;continue;}
   target.timeouts.push({side:i,number,seconds});timeoutRows++;
  }
 }
 for(const [n,s] of sets.entries()){
  for(const i of [0,1]){
   if(badLineups.has((n+1)+':'+i))s.lineups[i]=null;
   if(!sawSubs||!subsOk||!(subRows||explicitNoSubs)||explicitNoSubs&&subRows||s.changes[i].length>100||s.lineups[i]&&!participants(s.lineups[i],s.changes[i]))s.changes[i]=null;
  }
  if(!sawTimeouts||!timeoutsOk||!(timeoutRows||explicitNoTimeouts)||explicitNoTimeouts&&timeoutRows)s.timeouts=null;
 }
 return {matchSeconds,sets};
}
export function mapVolleyTiming(report,side,mapping,rallies){
 if(!report.timing)return undefined;
 const sets=report.timing.sets.map((s,i)=>{
  const lineup=s.lineups[side]?.map(n=>mapping[n])??null;
  let changes=s.changes[side]?.map(e=>({...e,out:mapping[e.out],in:mapping[e.in]}))??null;
  if(lineup&&changes){const played=participants(lineup,changes);if(!played||rallies.some(r=>r.set===i+1&&r.playerId!==null&&!played.ever.has(r.playerId)))changes=null;}
  return {seconds:s.seconds,lineup,changes,timeouts:s.timeouts?.map(t=>({...t,side:t.side===side?'ours':'theirs'}))??null};
 });
 return {matchSeconds:report.timing.matchSeconds,sets};
}
export function validateVolleyTiming(m){
 const v=m.imported.timing;if(v===undefined)return;
 check(only(v,['matchSeconds','sets'])&&(v.matchSeconds===null||validSeconds(v.matchSeconds,432000))&&Array.isArray(v.sets)&&v.sets.length===m.sets.length,'некорректное время матча');
 for(const [i,s] of v.sets.entries()){
  check(only(s,['seconds','lineup','changes','timeouts'])&&validSeconds(s.seconds)&&
   (s.lineup===null||Array.isArray(s.lineup)&&s.lineup.length===6&&new Set(s.lineup).size===6&&s.lineup.every(id=>validId(id,m.roster)))&&
   (s.changes===null||Array.isArray(s.changes)&&s.changes.length<=100&&s.changes.every(e=>only(e,['out','in','zone','kind'])&&validId(e.out,m.roster)&&validId(e.in,m.roster)&&e.out!==e.in&&Number.isInteger(e.zone)&&e.zone>=1&&e.zone<=6&&['regular','libero'].includes(e.kind)))&&
   (s.timeouts===null||Array.isArray(s.timeouts)&&s.timeouts.length<=40&&s.timeouts.every(t=>only(t,['side','number','seconds'])&&sideKeys.includes(t.side)&&Number.isInteger(t.number)&&t.number>=1&&t.number<=20&&validSeconds(t.seconds,3600))&&new Set(s.timeouts.map(t=>t.side+':'+t.number)).size===s.timeouts.length),'некорректные данные партии '+(i+1));
  if(s.lineup&&s.changes){const p=participants(s.lineup,s.changes);check(p&&!m.imported.rallies.some(r=>r.set===i+1&&r.playerId!==null&&!p.ever.has(r.playerId)),'замены или авторы не согласуются с составом партии');}
 }
}
// For unchanged starters the nominal duration is the reported full-set duration.
// For changed participants only an inclusive interval is defensible without timestamps.
// Unknown or omitted substitution sections never imply zero substitutions.
function preparePlayerTime(v){
 return v.sets.map((s,i)=>({set:i+1,teamMs:s.seconds*1000,timeoutMs:s.timeouts===null?null:s.timeouts.reduce((n,t)=>n+t.seconds*1000,0),p:s.lineup&&s.changes?participants(s.lineup,s.changes):null}));
}
function playerTimeFromSets(prepared,id){
 const sets=prepared.map(({set,teamMs,timeoutMs,p})=>{
  const kind=!p||!teamMs?'unknown':p.changed.has(id)?'changed':p.ever.has(id)?'full':'bench';
  const minMs=kind==='unknown'?null:kind==='full'?teamMs:0,maxMs=kind==='unknown'?null:kind==='bench'?0:teamMs;
  return {set,kind,minMs,maxMs,teamMs,timeoutMs};
 });
 const known=sets.filter(s=>s.minMs!==null);
 if(!known.length)return null;
 return {sets,knownSets:known.length,unknownSets:sets.length-known.length,minMs:known.reduce((n,s)=>n+s.minMs,0),maxMs:known.reduce((n,s)=>n+s.maxMs,0),teamMs:known.reduce((n,s)=>n+s.teamMs,0),partial:known.length!==sets.length||known.some(s=>s.kind==='changed')};
}
export function volleyPlayerTime(m,id){
 const v=m.imported?.timing;if(!v||!m.roster.includes(id))return null;
 return playerTimeFromSets(preparePlayerTime(v),id);
}
// One transient snapshot per imported match: no persisted cache or changed evidence.
export function volleyPlayerTimes(m){
 const v=m.imported?.timing;if(!v||!m.roster.length)return new Map();
 const prepared=preparePlayerTime(v);
 return new Map([...new Set(m.roster)].map(id=>[id,playerTimeFromSets(prepared,id)]));
}
export function volleyTimeLabel(t){
 if(!t||t.minMs===null)return '—';
 return t.minMs===t.maxMs?courtTimeLabel(t.minMs):courtTimeLabel(t.minMs)+'–'+courtTimeLabel(t.maxMs);
}
// Null means unavailable. On re-import we can fill missing evidence but never overwrite
// previously imported non-null evidence with a conflicting or poorer PDF.
export function mergeVolleyTiming(old,next){
 check(next,'в PDF нет данных времени');if(!old)return structuredClone(next);
 check(old.sets.length===next.sets.length,'число партий изменилось');
 const merge=(a,b)=>{if(a===null)return structuredClone(b);if(b===null||sameVolleyEvidence(a,b))return structuredClone(a);throw Error('VolleyPoint: данные времени противоречат предыдущему импорту');};
 return {matchSeconds:merge(old.matchSeconds,next.matchSeconds),sets:old.sets.map((s,i)=>{const t=next.sets[i];return {seconds:merge(s.seconds,t.seconds),lineup:merge(s.lineup,t.lineup),changes:merge(s.changes,t.changes),timeouts:merge(s.timeouts,t.timeouts)};})};
}
