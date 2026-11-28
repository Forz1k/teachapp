import * as db from './db.js';
import {uid,todayIso} from './model.js';
import {coachCandidates} from './team-generator.js';
import {testComparison} from './coach-season.js';
import {teamTactics} from './match-tactics.js';
import {validPeriod} from './health.js';
const check=(v,m)=>{if(!v)throw Error(m);};
const text=(s,max=200)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
const only=(r,keys)=>r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>keys.includes(k));
export const lineupRoles={'5-1':['setter','outside','middle','opposite','outside','middle'],'4-2':['setter','outside','middle','setter','outside','middle']};
export const roleNames={setter:'Связующая',outside:'Доигровщица',middle:'Центральная',opposite:'Диагональная',libero:'Либеро',universal:'Универсальная'};
export function initialMarkers(){
 const points=[[250,510],[250,355],[150,355],[50,355],[50,510],[150,510]];
 return points.map(([x,y],i)=>({id:'p'+(i+1),label:String(i+1),side:'ours',x,y}));
}
const point=p=>Number.isInteger(p?.x)&&p.x>=15&&p.x<=285&&Number.isInteger(p?.y)&&p.y>=15&&p.y<=585;
export function validateBoard(b){
 check(only(b,['id','kind','teamId','name','note','markers','arrows','revision'])&&b.kind==='tacticBoard'&&text(b.id)&&text(b.teamId)&&text(b.name)&&typeof b.note==='string'&&b.note.length<=2000&&Number.isInteger(b.revision)&&b.revision>=0&&b.revision<=1000000,'Проверьте тактическую схему');
 check(Array.isArray(b.markers)&&b.markers.length<=24&&b.markers.every(m=>only(m,['id','label','side','x','y'])&&text(m.id)&&text(m.label,12)&&['ours','theirs'].includes(m.side)&&point(m))&&new Set(b.markers.map(m=>m.id)).size===b.markers.length,'Проверьте фишки');
 check(Array.isArray(b.arrows)&&b.arrows.length<=100&&b.arrows.every(a=>only(a,['id','style','from','to'])&&text(a.id)&&['move','ball'].includes(a.style)&&only(a.from,['x','y'])&&only(a.to,['x','y'])&&point(a.from)&&point(a.to)&&(a.from.x!==a.to.x||a.from.y!==a.to.y))&&new Set(b.arrows.map(a=>a.id)).size===b.arrows.length,'Проверьте стрелки');
 return b;
}
export async function saveBoard(input){return writeBoard(db,input);}
export async function writeBoard(access,input){
 return access.transaction(['workRecords','coachTeams'],'readwrite',async s=>{
  const old=input.id?await s.workRecords.get(input.id):null,team=await s.coachTeams.get(input.teamId);
  check(team&&(!team.archived||old),'Команда недоступна');
  check(!input.id||old?.kind==='tacticBoard'&&old.teamId===input.teamId&&old.revision===input.revision,'Схема изменена. Откройте её заново');
  const record=structuredClone({...input,id:input.id||uid('board'),kind:'tacticBoard',revision:old?old.revision+1:0});validateBoard(record);await s.workRecords.put(record);return record;
 });
}
export function lineupOptions(view,{scheme='5-1',date=todayIso(),methods={},from='',to='',opponent='',selected=null,count=3}={}){
 check(Object.hasOwn(lineupRoles,scheme)&&validPeriod(date,null)&&(!from||validPeriod(from,null))&&(!to||validPeriod(to,null))&&(!from||!to||from<=to)&&Number.isInteger(count)&&count>=1&&count<=5,'Проверьте параметры состава');
 const active=view.players.filter(p=>!p.archived&&(!selected||selected.includes(p.id))),excluded=new Set();
 for(const activity of ['volley','jump','run','competition','intense'])for(const p of coachCandidates(active,activity,date))if(p.reason)excluded.add(p.id);
 const available=active.filter(p=>!excluded.has(p.id)&&p.position!=='libero'),scores=new Map();
 for(const role of new Set(lineupRoles[scheme])){
  if(!methods[role])continue;
  for(const r of testComparison(view,methods[role],'success',{from,to,archived:false}))if(r.eligible)scores.set(role+'|'+r.player.id,r);
 }
 const tactics=teamTactics(view.matches,{from,to,opponent,min:30}),pairs=new Map(tactics.pairs.filter(r=>r.eligible&&r.matches>=2).map(r=>[r.key,r]));
 const pairKey=(a,b)=>JSON.stringify([a,b].sort());
 const score=(ids,roles)=>{
  let exact=0,known=0,total=0,synergy=0,paired=0;
  ids.forEach((id,i)=>{const p=available.find(p=>p.id===id);exact+=Number(p.position===roles[i]);const r=scores.get(roles[i]+'|'+id);if(r){known++;total+=r.value;}for(let j=0;j<i;j++){const pair=pairs.get(pairKey(id,ids[j]));if(pair){synergy+=pair.rate;paired++;}}});
  return {exact,known,mean:known?total/known:null,pairRate:paired?synergy/paired:null,paired};
 };
 const sort=(a,b)=>b.exact-a.exact||b.known-a.known||(b.mean??-1)-(a.mean??-1)||b.paired-a.paired||(b.pairRate??-1)-(a.pairRate??-1)||a.ids.join('|').localeCompare(b.ids.join('|'));
 const roles=lineupRoles[scheme],slots=roles.map(role=>available.filter(p=>p.position===role||p.position==='universal'));
 // Bounded beam, deterministic. No exhaustive or guaranteed optimal claim.
 let beam=[{ids:[],exact:0,known:0,mean:null,pairRate:null,paired:0}];
 for(let i=0;i<6;i++){
  const next=[];
  for(const b of beam)for(const p of slots[i])if(!b.ids.includes(p.id)){const ids=b.ids.concat(p.id);next.push({ids,...score(ids,roles)});}
  next.sort(sort);beam=next.slice(0,96);
 }
 const seen=new Set(),options=[];
 for(const b of beam){const k=JSON.stringify([...b.ids].sort());if(seen.has(k))continue;seen.add(k);options.push({...b,roles:[...roles],evidence:b.ids.map((id,i)=>{const r=scores.get(roles[i]+'|'+id);return r?{value:r.value,attempts:r.attempts,recorded:r.recorded}:null;})});if(options.length>=count)break;}
 return {options,excluded:[...excluded],available:available.length,matchEvidence:{total:tactics.total,detailed:tactics.detailed},slots:slots.map(s=>s.length),liberos:active.filter(p=>p.position==='libero'&&!excluded.has(p.id)).map(p=>p.id)};
}
