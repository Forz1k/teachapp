/* Учебные периоды, фактическая посещаемость, шкалы учителя. */
import * as M from './model.js';
import {validPeriod} from './health.js';
export const periodKinds={trimester:'Триместры',quarter:'Четверти',half:'Полугодия',custom:'Пользовательские'};
export function periodName(p){return p.name||p.index+'-й триместр';}
export function periodDraft(kind,year){
  if(!Object.hasOwn(periodKinds,kind)||!year.to||!validPeriod(year.from,year.to))throw Error('Проверьте учебный год');
  const count={trimester:3,quarter:4,half:2,custom:1}[kind];
  const days=Math.round((Date.parse(year.to)-Date.parse(year.from))/86400000)+1;
  if(days<count)throw Error('Слишком короткий год');
  return Array.from({length:count},(_,i)=>({id:M.uid('period'),kind,index:i+1,
    name:kind==='quarter'?(i+1)+'-я четверть':kind==='half'?(i+1)+'-е полугодие':kind==='custom'?'Период 1':(i+1)+'-й триместр',
    from:M.addDays(year.from,Math.floor(days*i/count)),to:M.addDays(year.from,Math.floor(days*(i+1)/count)-1)}));
}
export function validatePeriods(periods,year){
  if(!Array.isArray(periods)||!periods.length||periods.length>24)throw Error('Добавьте от 1 до 24 периодов');
  if(periods.some(p=>!p||typeof p.from!=='string'))throw Error('Проверьте даты');
  const sorted=[...periods].sort((a,b)=>a.from.localeCompare(b.from)),ids=new Set();
  for(const [i,p] of sorted.entries()){
    if(!p.id||ids.has(p.id)||!Object.hasOwn(periodKinds,p.kind)||!p.name?.trim()||!p.to||!validPeriod(p.from,p.to)||p.from<year.from||p.to>year.to||(i&&sorted[i-1].to>=p.from))throw Error('Проверьте названия, даты и пересечения периодов');
    ids.add(p.id);
  }
  return sorted.map((p,i)=>({...p,index:i+1}));
}
export function attendanceDetails(lessons,students,marks,parts,today=M.todayIso()){
  const s={held:0,future:0,unconfirmed:0,unknown:0,present:0,absent:0,exempt:0,pct:null};
  for(const l of lessons){
    if(l.date>today){s.future++;continue;}
    const rows=students.map(p=>({m:marks.get(l.id+'|'+p.id),p:parts.get(l.id+'|'+p.id)}));
    if(!l.held&&!rows.some(({m,p})=>p||m?.flag==='Н'||m?.value||m?.source==='manual'||m?.baseMark?.source==='manual')){s.unconfirmed++;continue;}
    s.held++;
    for(const {m,p} of rows){
      if(M.hasOsv(m))s.exempt++;
      if(m?.flag==='Н')s.absent++;
      else if(p||m?.value||m?.source==='manual'||m?.baseMark?.source==='manual')s.present++;
      else s.unknown++;
    }
  }
  if(s.present+s.absent)s.pct=Math.round(s.present/(s.present+s.absent)*1000)/10;
  return s;
}
export const units=['с','мин','м','см','раз','баллы'];
export function validateNorm(n,activities){
  if(!n||typeof n.name!=='string'||!n.name.trim()||!activities.has(n.activityId)||!units.includes(n.unit)||!['min','max'].includes(n.direction)||!Array.isArray(n.scale)||n.scale.length!==5)throw Error('Проверьте норматив и шкалу');
  if(n.scale.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0)||n.scale.some((v,i)=>i>0&&(n.direction==='min'?v>=n.scale[i-1]:v<=n.scale[i-1])))throw Error('Пороги 1–5 должны быть строго упорядочены');
  return n;
}
export function gradeNorm(n,value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Введите корректный результат');
  for(let i=4;i>=0;i--)if(n.direction==='min'?value<=n.scale[i]:value>=n.scale[i])return String(i+1);
  return null;
}
