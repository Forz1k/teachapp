import * as db from './db.js';
import {BACKUP_VERSION,validateBackup} from './backup.js';
import {lineageOf} from './school-tools.js';
const check=(ok,m)=>{if(!ok)throw Error(m);};
const names=Object.keys(db.SCHEMA);
const empty=()=>Object.fromEntries(names.map(n=>[n,[]]));
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const same=(a,b)=>canonical(a)===canonical(b);
const payload=data=>({app:'teachapp',version:BACKUP_VERSION,data});
const yearOf=d=>d.meta.find(r=>r.id==='settings')?.year;
const inYear=(date,year)=>!year||date>=year.from&&date<=year.to;
export const scopeLabels={class:'Класс',team:'Команда',archive:'Учебный год (архив)'};
export function availableScopes(data){
 return [...data.classes.map(r=>({kind:'class',id:r.id,label:r.name})),...data.coachTeams.map(r=>({kind:'team',id:r.id,label:r.name+(r.archived?' · архив':'')})),...data.workRecords.filter(r=>r.kind==='archive').map(r=>({kind:'archive',id:r.id,label:r.year.from+' — '+r.year.to}))];
}
export function makeScopedBackup(source,scope){
 const data=validateBackup(source),out=empty();let omitted=0;
 check(Object.hasOwn(scopeLabels,scope?.kind)&&typeof scope.id==='string','Выберите область копии');
 if(source.scope)check(source.scope.kind===scope.kind&&source.scope.id===scope.id,'Выборочный файл содержит только указанную область');
 const id=scope.id;
 if(scope.kind==='class'){
  const cls=data.classes.find(c=>c.id===id);check(cls,'Класс отсутствует в копии');out.classes=[cls];
  const year=yearOf(data);check(year?.from&&year?.to,'Копия не содержит границы учебного года');
  out.meta=data.meta.filter(r=>r.id==='settings');
  out.students=data.students.filter(r=>r.classId===id);out.lessons=data.lessons.filter(r=>r.classId===id);
  const pupils=new Set(out.students.map(r=>r.id)),lineages=new Set(out.students.map(lineageOf)),lessons=new Set(out.lessons.map(r=>r.id)),topicIds=new Set(out.lessons.map(r=>r.topicId));
  const plans=new Set(data.ktp.filter(r=>r.classIds.includes(id)).map(r=>r.id));
  for(const t of data.topics)if(topicIds.has(t.id)&&t.ktpId)plans.add(t.ktpId);
  out.ktp=data.ktp.filter(r=>plans.has(r.id)).map(r=>({...r,classIds:r.classIds.filter(c=>c===id)}));
  out.topics=data.topics.filter(r=>plans.has(r.ktpId)||topicIds.has(r.id));
  for(const n of ['marks','participation','normResults'])out[n]=data[n].filter(r=>pupils.has(r.studentId)&&lessons.has(r.lessonId));
  for(const n of ['exemptions','activityRestrictions','monthly','finalGrades'])out[n]=data[n].filter(r=>pupils.has(r.studentId));
  out.studentHealthProfiles=data.studentHealthProfiles.filter(r=>pupils.has(r.id));
  out.activityCategories=data.activityCategories;
  const norms=new Set(out.normResults.map(r=>r.normId));
  out.norms=data.norms.filter(n=>norms.has(n.id)||n.scales?.some(s=>s.classId===id)).map(n=>n.scales?{...n,scales:n.scales.filter(s=>s.classId==null||s.classId===id)}:n);
  out.schedule=data.schedule.filter(r=>r.classId===id);const rules=new Set(out.schedule.map(r=>r.id));
  out.scheduleOverrides=data.scheduleOverrides.filter(r=>{
   const related=r.classId===id||rules.has(r.ruleId);if(!related)return false;
   const supported=r.action==='add'?r.classId===id:rules.has(r.ruleId)&&(!r.classId||r.classId===id||r.classId==='window');
   if(!supported)omitted++;return supported;
  });
  out.workRecords=data.workRecords.filter(r=>r.kind==='gradeHistory'&&pupils.has(r.studentId)&&(r.scope==='final'||lessons.has(r.lessonId))||r.kind==='achievement'&&inYear(r.date,year)&&(r.subjectType==='class'&&r.subjectId===id||r.subjectType==='student'&&lineages.has(r.subjectId)));
 }else if(scope.kind==='team'){
  const team=data.coachTeams.find(t=>t.id===id);check(team,'Команда отсутствует в копии');out.coachTeams=[team];
  for(const n of ['coachPlayers','coachTrainings','coachMatches','coachLineups','coachLive','coachTests'])out[n]=data[n].filter(r=>r.teamId===id);
  const players=new Set(out.coachPlayers.map(p=>p.id));
  out.workRecords=data.workRecords.filter(r=>['coachGoal','tacticBoard'].includes(r.kind)&&r.teamId===id||r.kind==='achievement'&&(r.subjectType==='team'&&r.subjectId===id||r.subjectType==='player'&&players.has(r.subjectId)));
 }else{
  const a=data.workRecords.find(r=>r.kind==='archive'&&r.id===id);check(a,'Архив отсутствует в копии');
  const pupils=new Set(a.snapshot.students.map(p=>p.id)),lineages=new Set(a.snapshot.students.map(lineageOf)),classes=new Set(a.snapshot.classes.map(c=>c.id)),lessons=new Set(a.snapshot.lessons.map(l=>l.id));
  out.workRecords=[a,...data.workRecords.filter(r=>r.kind==='gradeHistory'&&pupils.has(r.studentId)&&(r.scope==='final'||lessons.has(r.lessonId))||r.kind==='achievement'&&inYear(r.date,a.year)&&(r.subjectType==='class'&&classes.has(r.subjectId)||r.subjectType==='student'&&lineages.has(r.subjectId)))];
 }
 omitted+=source.scope?.omitted||0;
 const result={...payload(out),scope:{kind:scope.kind,id,omitted},createdAt:new Date().toISOString()};
 validateBackup(result);
 return {payload:result,omitted,counts:Object.fromEntries(names.filter(n=>out[n].length&&n!=='meta').map(n=>[n,out[n].length]))};
}
function mergeShared(name,old,incoming){
 if(name==='ktp'){
  const {classIds:a,...x}=old,{classIds:b,...y}=incoming;if(!same(x,y))return null;
  return {...old,classIds:[...new Set([...a,...b])]};
 }
 if(name==='norms'&&Array.isArray(old.scales)&&Array.isArray(incoming.scales)){
  const {scales:a,...x}=old,{scales:b,...y}=incoming;if(!same(x,y))return null;
  const key=r=>JSON.stringify([r.classId??null,r.gradeLevel??null,r.group]),map=new Map(a.map(r=>[key(r),r]));
  for(const r of b){const v=map.get(key(r));if(v&&!same(v,r))return null;if(!v)map.set(key(r),r);}
  return {...old,scales:[...map.values()]};
 }
 return null;
}
export function planSelective(current,source,scope){
 const base=validateBackup(payload(current)),part=makeScopedBackup(source,scope),incoming=part.payload.data;
 const conflicts=[],changes=[],counts={added:0,merged:0,identical:0},data=Object.fromEntries(names.map(n=>[n,[...base[n]]]));
 if(scope.kind==='class'&&!same(yearOf(base),yearOf(incoming)))conflicts.push({store:'meta',reason:'Учебные годы различаются. Перенос текущего класса возможен только в совпадающий учебный год.'});
 if(scope.kind==='archive'){
  const a=incoming.workRecords.find(r=>r.kind==='archive');
  if(base.workRecords.some(r=>r.kind==='archive'&&r.id!==a.id&&same(r.year,a.year)))conflicts.push({store:'workRecords',reason:'Архив такого учебного года уже существует.'});
  if(same(yearOf(base),a.year))conflicts.push({store:'workRecords',reason:'Этот учебный год сейчас является текущим. Сначала завершите его штатным способом.'});
 }
 for(const name of names){
  if(name==='meta')continue;
  const byId=new Map(data[name].map(r=>[r.id,r]));
  for(const row of incoming[name]){
   const old=byId.get(row.id);
   if(!old){data[name].push(row);byId.set(row.id,row);changes.push({store:name,row});counts.added++;continue;}
   if(same(old,row)){counts.identical++;continue;}
   const merged=mergeShared(name,old,row);
   if(merged){if(same(merged,old)){counts.identical++;continue;}data[name][data[name].findIndex(r=>r.id===row.id)]=merged;byId.set(row.id,merged);changes.push({store:name,row:merged});counts.merged++;}
   else conflicts.push({store:name,reason:'Запись с таким идентификатором отличается. Перезапись не выполняется.'});
  }
 }
 if(!conflicts.length)try{validateBackup(payload(data));}catch(e){conflicts.push({store:'validation',reason:e.message});}
 const token=canonical({changes,counts,conflicts,omitted:part.omitted});
 return {counts,changes,conflicts,omitted:part.omitted,token};
}
export async function restoreSelective(source,scope,expected,confirmed=false){
 check(confirmed&&typeof expected==='string','Подтвердите предварительный просмотр');
 return db.transaction(names,'readwrite',async s=>{
  const current=Object.fromEntries(await Promise.all(names.map(async n=>[n,await s[n].getAll()])));
  const p=planSelective(current,source,scope);
  check(!p.conflicts.length,'Восстановление заблокировано: есть конфликт или повреждённая связь');
  check(p.token===expected,'Данные изменились. Повторите предварительный просмотр');
  for(const c of p.changes)await s[c.store].put(c.row);
  return p.counts;
 });
}
