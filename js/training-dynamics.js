/* Calendar weeks of documented training and match exposure. No imputation,
 * no medical interpretation or automatic workload recommendations. */
import {todayIso,weekdayOf,addDays} from './model.js';
import {replayDetailed,courtTime} from './match-protocol.js';
import {volleyPlayerTime} from './volleypoint-time.js';
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const weekOf=d=>addDays(d,1-weekdayOf(d));
const keys=['scheduled','held','cardMinutes','present','limited','absent','unknown','effortKnown','actualMinutes','loadSum','matches','measuredMatches','partialMeasuredMatches','measuredMs','pdfMatches','partialPdfMatches','pdfMinMs','pdfMaxMs','unknownMatchTime'];
const blank=()=>Object.fromEntries(keys.map(k=>[k,0]));
const pct=(a,b)=>b?100*a/b:null;
const finish=r=>{const attended=r.present+r.limited,attendanceKnown=attended+r.absent;return {...r,attended,attendanceKnown,attendanceCoverage:pct(attendanceKnown,attendanceKnown+r.unknown),attendanceRate:pct(attended,attendanceKnown),effortCoverage:pct(r.effortKnown,attended),effortUnknown:attended-r.effortKnown,load:r.effortKnown?r.loadSum:null,avgRpe:r.actualMinutes?r.loadSum/r.actualMinutes:null,avgLoad:r.effortKnown?r.loadSum/r.effortKnown:null};};
export function trainingDynamics(view,{from=addDays(todayIso(),-55),to=todayIso(),today=todayIso(),playerId=''}={}){
 if(![from,to,today].every(validDate)||from>to||to>addDays(from,730)||playerId&&!view.players.some(p=>p.id===playerId))throw Error('Выберите период до 731 дня и игрока из команды');
 const end=to<today?to:today;
 if(from>end)return {weeks:[],total:finish(blank()),from,to,end,playerId};
 const weeks=new Map();
 for(let d=weekOf(from);d<=end;d=addDays(d,7)){
  const last=addDays(d,6),a=d<from?from:d,b=last>end?end:last;
  weeks.set(d,{...blank(),week:d,from:a,to:b,partial:a!==d||b!==last});
 }
 const inPeriod=d=>d>=from&&d<=end;
 for(const t of view.trainings){
  if(!inPeriod(t.date)||playerId&&!t.roster.includes(playerId))continue;
  const w=weeks.get(weekOf(t.date));w.scheduled++;
  if(!t.held)continue;
  w.held++;w.cardMinutes+=t.minutes;
  for(const id of playerId?[playerId]:t.roster){
   const a=t.attendance[id];if(a==='present'||a==='limited'||a==='absent')w[a]++;else w.unknown++;
   if(!['present','limited'].includes(a))continue;const e=t.effort?.[id];if(!e)continue;
   w.effortKnown++;w.actualMinutes+=e.minutes;w.loadSum+=e.minutes*e.rpe;
  }
 }
 for(const m of view.matches){
  if(!inPeriod(m.date)||playerId&&!m.roster.includes(playerId))continue;
  const w=weeks.get(weekOf(m.date));w.matches++;
  if(m.detail){
   const a=courtTime(replayDetailed(m.detail));if(a.measured){w.measuredMatches++;w.partialMeasuredMatches+=Number(a.partial);w.measuredMs+=playerId?(a.players.ours[playerId]||0):a.elapsedMs;continue;}
  }else if(m.imported?.timing){
   if(playerId){const a=volleyPlayerTime(m,playerId);if(a){w.pdfMatches++;w.partialPdfMatches+=Number(a.partial);w.pdfMinMs+=a.minMs;w.pdfMaxMs+=a.maxMs;continue;}}
   else {const a=m.imported.timing.sets.reduce((n,s)=>n+s.seconds*1000,0);if(a>0){w.pdfMatches++;w.pdfMinMs+=a;w.pdfMaxMs+=a;continue;}}
  }
  w.unknownMatchTime++;
 }
 const total=blank();for(const w of weeks.values())for(const k of keys)total[k]+=w[k];
 const rows=[...weeks.values()].map(finish);
 // Compare only full consecutive weeks of one player with complete attendance
 // and effort records. No automatic danger labels or invented zeroes.
 for(let i=1;i<rows.length;i++){
  const a=rows[i-1],b=rows[i],complete=r=>!r.partial&&r.held>0&&r.unknown===0&&r.attended>0&&r.effortUnknown===0;
  if(playerId&&complete(a)&&complete(b)&&a.load>0)b.delta={load:b.load-a.load,pct:100*(b.load-a.load)/a.load,previous:a.week};
 }
 return {weeks:rows,total:finish(total),from,to,end,playerId};
}
export function trainingDynamicsCsv(report){
 const cell=v=>{let s=String(v??'');if(/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const head=['Неделя с','Неделя по','Неполная неделя','Тренировок в расписании','Проведено','Минуты карточек','Явка','Ограниченная','Отсутствие','Неизвестно','Замеры RPE','Без замера среди присутствовавших','Фактические записанные минуты','sRPE','Средняя взвешенная RPE','Матчи','LIVE измерено матчей','LIVE секунд','LIVE частично','PDF матчей','PDF минимум секунд','PDF максимум секунд','PDF частично','Матчи без времени'];
 const rows=report.weeks.map(w=>[w.from,w.to,w.partial?'Да':'Нет',w.scheduled,w.held,w.cardMinutes,w.present,w.limited,w.absent,w.unknown,w.effortKnown,w.effortUnknown,w.effortKnown?w.actualMinutes:null,w.load,w.avgRpe===null?null:Math.round(w.avgRpe*100)/100,w.matches,w.measuredMatches,w.measuredMatches?w.measuredMs/1000:null,w.partialMeasuredMatches,w.pdfMatches,w.pdfMatches?w.pdfMinMs/1000:null,w.pdfMatches?w.pdfMaxMs/1000:null,w.partialPdfMatches,w.unknownMatchTime]);
 return '\uFEFF'+[head,...rows].map(r=>r.map(cell).join(';')).join('\r\n');
}
