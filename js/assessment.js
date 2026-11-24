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
export const normGroups={boys:'Мальчики',girls:'Девочки',all:'Общая шкала'};
export const validNormGroup=v=>v==null||v==='boys'||v==='girls';
export const validGradeLevel=v=>v==null||(Number.isInteger(v)&&v>=1&&v<=11);
export function gradeLevelOf(cls){
  if(!cls)return null;
  if(cls.gradeLevel!=null)return validGradeLevel(cls.gradeLevel)?cls.gradeLevel:null;
  const m=String(cls.name||'').trim().match(/^(1[01]|[1-9])(?:\s*(?:[-–]?\s*[а-яёa-z]|класс))?$/iu);
  return m?Number(m[1]):null;
}
export function validateScale(scale,direction){
  if(!Array.isArray(scale)||scale.length!==5||scale.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0)||
    scale.some((v,i)=>i>0&&(direction==='min'?v>=scale[i-1]:v<=scale[i-1])))throw Error('Пороги оценок 1–5 должны быть строго упорядочены');
  return scale;
}
function validScope(r){
  return r&&Object.hasOwn(normGroups,r.group)&&validGradeLevel(r.gradeLevel)&&
    (r.classId==null||(typeof r.classId==='string'&&r.classId.trim().length>0))&&
    !(r.classId!=null&&r.gradeLevel!=null);
}
export function validateNorm(n,activities){
  if(!n||typeof n.name!=='string'||!n.name.trim()||!activities.has(n.activityId)||!units.includes(n.unit)||!['min','max'].includes(n.direction))throw Error('Проверьте норматив');
  if(n.scales===undefined){validateScale(n.scale,n.direction);return n;}
  if(!Array.isArray(n.scales)||n.scales.length>300)throw Error('Проверьте список шкал');
  const seen=new Set();
  for(const r of n.scales){
    if(!validScope(r))throw Error('Выберите параллель или класс и категорию');
    validateScale(r.scale,n.direction);
    const key=JSON.stringify([r.classId??null,r.gradeLevel??null,r.group]);
    if(seen.has(key))throw Error('Для этой категории уже есть шкала');
    seen.add(key);
  }
  return n;
}
// Приоритет: конкретный класс → параллель → явно заданная общая область.
// Внутри области сначала категория ученика, затем общая шкала.
// Неизвестная категория не позволяет выбирать между разделёнными шкалами.
export function selectNormScale(n,cls,student){
  if(n.scales===undefined)return {scale:n.scale,group:'all',classId:null,gradeLevel:null,label:'Общая (прежняя шкала)'};
  const level=gradeLevelOf(cls),group=student?.normGroup;
  const buckets=[
    cls?.id?n.scales.filter(r=>r.classId===cls.id):[],
    level!=null?n.scales.filter(r=>r.classId==null&&r.gradeLevel===level):[],
    n.scales.filter(r=>r.classId==null&&r.gradeLevel==null)
  ];
  for(const rows of buckets){
    if(!rows.length)continue;
    if(!group&&rows.some(r=>r.group!=='all'))return null;
    const row=rows.find(r=>r.group===group)||rows.find(r=>r.group==='all');
    if(row)return {...row,label:(row.classId?cls.name:row.gradeLevel!=null?row.gradeLevel+' класс':'Все классы')+' · '+normGroups[row.group]};
  }
  return null;
}
export function normSnapshot(n,cls,student){
  const row=selectNormScale(n,cls,student);
  const snapshot={id:n.id,name:n.name,activityId:n.activityId,unit:n.unit,direction:n.direction,scale:row?[...row.scale]:null,
    scaleScope:row?{classId:row.classId??null,gradeLevel:row.gradeLevel??null,group:row.group,label:row.label}:null,
    className:cls?.name||'',gradeLevel:gradeLevelOf(cls),normGroup:student?.normGroup??null};
  return snapshot;
}
export function validateNormSnapshot(n,activities){
  if(n?.scale===null){
    if(n.scaleScope!==null||n.scales!==undefined)throw Error('Некорректный снимок шкалы');
    validateNorm({...n,scales:[]},activities);
  }else{
    validateNorm(n,activities);
    if(n.scales!==undefined)throw Error('Результат должен содержать одну шкалу');
    if(n.scaleScope!=null&&(!validScope(n.scaleScope)||typeof n.scaleScope.label!=='string'))throw Error('Некорректная область шкалы');
  }
  return n;
}
export function gradeNorm(n,value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Введите корректный результат');
  if(!Array.isArray(n.scale))return null;
  for(let i=4;i>=0;i--)if(n.direction==='min'?value<=n.scale[i]:value>=n.scale[i])return String(i+1);
  return null;
}
