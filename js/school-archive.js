import * as db from './db.js';
import * as M from './model.js';
import * as A from './assessment.js';
import {validPeriod} from './health.js';
import {require,txt,only} from './workbench.js';
import {validateBackup} from './backup.js';
import * as S from './store.js';
import {buildAttendanceIndex} from './attendance-index.js';
export const schoolStores=['meta','classes','students','lessons','topics','ktp','schedule','scheduleOverrides','marks','exemptions','studentHealthProfiles','activityRestrictions','activityCategories','participation','norms','normResults','finalGrades','monthly'];
const settingsOf=data=>({...M.defaultSettings(),...data.meta.find(x=>x.id==='settings')});
const payload=data=>({app:'teachapp',version:10,data:{...data,...Object.fromEntries(Object.keys(db.SCHEMA).filter(n=>n.startsWith('coach')).map(n=>[n,[]]))}});
export function validateArchive(record){
 require(only(record,['id','kind','year','createdAt','snapshot'])&&txt(record.id)&&record.kind==='archive'&&only(record.year,['from','to'])&&validPeriod(record.year.from,record.year.to)&&!!record.year.to&&txt(record.createdAt)&&Number.isFinite(Date.parse(record.createdAt))&&only(record.snapshot,schoolStores)&&schoolStores.every(n=>Array.isArray(record.snapshot[n])),'Повреждён архив учебного года');
 require(JSON.stringify(settingsOf(record.snapshot).year)===JSON.stringify(record.year),'Границы архива не совпадают с настройками');
 validateBackup(payload(record.snapshot));return record;
}
export function suggestClassName(cls){const level=A.gradeLevelOf(cls);if(level===11)return '';if(level==null)return cls.name;return String(cls.name).replace(/^\s*(?:1[01]|[1-9])/,String(level+1));}
export function archivePreview(data){const settings=settingsOf(data);return {year:settings.year,classes:data.classes.length,students:data.students.length,lessons:data.lessons.length,marks:data.marks.length,token:JSON.stringify(data)};}
export async function readSchool(){return db.transaction(schoolStores,'readonly',async s=>Object.fromEntries(await Promise.all(schoolStores.map(async n=>[n,await s[n].getAll()]))));}
export function buildNextYear(data,year,transfers,kind='trimester',today=M.todayIso()){
 const old=settingsOf(data);
 require(only(year,['from','to'])&&!!year.to&&validPeriod(year.from,year.to)&&old.year.to<year.from&&old.year.to<today,'Новый год должен начинаться после завершённого учебного года');
 require(!data.lessons.some(l=>l.date>old.year.to),'Есть уроки после конца текущего года: проверьте границы перед архивированием');
 require(Array.isArray(transfers)&&transfers.length===data.classes.length&&new Set(transfers.map(t=>t.id)).size===transfers.length,'Проверьте перевод всех классов');
 const next=Object.fromEntries(schoolStores.map(n=>[n,[]])),classIds=new Map(),studentIds=new Map(),names=new Set();
 for(const t of transfers){
  const cls=data.classes.find(c=>c.id===t.id);require(cls&&only(t,['id','name','gradeLevel'])&&typeof t.name==='string'&&A.validGradeLevel(t.gradeLevel),'Проверьте класс и параллель');
  const name=t.name.trim();if(!name)continue;
  require(txt(name)&&!names.has(name.toLowerCase()),'Названия новых классов должны быть уникальны');names.add(name.toLowerCase());
  const id=M.uid('cls');classIds.set(cls.id,id);next.classes.push({id,name,gradeLevel:t.gradeLevel??null});
 }
 for(const st of data.students){const classId=classIds.get(st.classId);if(!classId)continue;const id=M.uid('stu');studentIds.set(st.id,id);next.students.push({id,classId,fullName:st.fullName,number:st.number,normGroup:st.normGroup??null,lineageId:st.lineageId||st.id});}
 next.activityCategories=structuredClone(data.activityCategories);
 // Шкалы конкретного прежнего класса не подходят новому возрасту.
 next.norms=data.norms.map(n=>n.scales?{...n,scales:n.scales.filter(s=>s.classId==null)}:{...n});
 const overlap=r=>r.dateFrom<=year.to&&(!r.dateTo||r.dateTo>=year.from);
 for(const r of data.studentHealthProfiles){const id=studentIds.get(r.id);if(id&&overlap(r))next.studentHealthProfiles.push({...r,id});}
 for(const r of data.activityRestrictions){const studentId=studentIds.get(r.studentId);if(studentId&&overlap(r))next.activityRestrictions.push({...r,id:M.uid('rest'),studentId});}
 for(const r of data.exemptions){const studentId=studentIds.get(r.studentId);if(studentId&&overlap(r))next.exemptions.push({...r,id:M.uid('exm'),studentId});}
 next.meta=data.meta.filter(x=>x.id!=='settings').concat({...old,id:'settings',year:{...year},trimesters:A.periodDraft(kind,year),holidays:[],lastBackupAt:null});
 validateBackup(payload(next));return next;
}
/** Shared, side-effect-free preparation; persistence belongs to the caller.
 * Archive and new year must be committed in the same transaction. */
export function prepareSchoolYearRollover(data,existing,{year,transfers,kind,expected,confirmed=false}){
 require(confirmed&&typeof expected==='string','Подтвердите перевод после предварительного просмотра');
 require(archivePreview(data).token===expected,'Данные изменились. Откройте предварительный просмотр заново');
 const old=settingsOf(data).year;
 require(!existing.some(a=>a.year.from===old.from&&a.year.to===old.to),'Этот учебный год уже в архиве');
 const next=buildNextYear(data,year,transfers,kind);
 const record={id:M.uid('archive'),kind:'archive',year:{...old},createdAt:new Date().toISOString(),snapshot:structuredClone(data)};validateArchive(record);
 return {next,record};
}
export async function rollSchoolYear(input){
 require(input?.confirmed&&typeof input.expected==='string','Подтвердите перевод после предварительного просмотра');
 const result=await db.transaction([...schoolStores,'workRecords'],'readwrite',async s=>{
  const data=Object.fromEntries(await Promise.all(schoolStores.map(async n=>[n,await s[n].getAll()])));
  const {next,record}=prepareSchoolYearRollover(data,await s.workRecords.index('kind').getAll('archive'),input);
  await s.workRecords.add(record);
  for(const n of schoolStores){await s[n].clear();for(const row of next[n])await s[n].add(row);}
  return {record,classes:next.classes.length,students:next.students.length};
 });
 await S.load();return result;
}
export function archiveClass(record,classId){
 const d=record.snapshot,students=d.students.filter(s=>s.classId===classId),lessons=d.lessons.filter(l=>l.classId===classId).sort((a,b)=>a.date.localeCompare(b.date));
 const ids=new Set(students.map(s=>s.id)),byStudent=new Map(students.map(s=>[s.id,{student:s,marks:[],norms:[],finals:[],participation:[]}]));
 const dates=new Map(lessons.map(l=>[l.id,l.date]));
 for(const r of d.marks)if(ids.has(r.studentId)&&dates.has(r.lessonId))byStudent.get(r.studentId).marks.push({...r,date:dates.get(r.lessonId)});
 for(const r of d.normResults)if(ids.has(r.studentId))byStudent.get(r.studentId).norms.push(r);
 for(const r of d.finalGrades)if(ids.has(r.studentId))byStudent.get(r.studentId).finals.push(r);
 for(const r of d.participation)if(ids.has(r.studentId))byStudent.get(r.studentId).participation.push(r);
 return {students:[...byStudent.values()],lessons};
}

/** Read archived and current school records in one consistent read transaction. */
export async function readSchoolHistory(){
 return db.transaction([...schoolStores,'workRecords'],'readonly',async s=>{
  const [data,archives]=await Promise.all([Promise.all(schoolStores.map(async n=>[n,await s[n].getAll()])),s.workRecords.index('kind').getAll('archive')]);
  return {current:Object.fromEntries(data),archives};
 });
}
/** Cohort-level comparison, not a claim about individual progress.
 * Grade mean is weighted by the actual mark weights, attendance by known opportunities.
 * Every school year retains its own denominator and cutoff. */
export function schoolYearComparison(current,archives,{gradeLevel=null,today=M.todayIso(),mode='full'}={}){
 require(gradeLevel===null||A.validGradeLevel(gradeLevel),'Выберите параллель');
 require(['full','elapsed'].includes(mode),'Выберите режим сравнения');
 // UTC calendar arithmetic avoids DST-dependent day counts. Keep the existing
 // whole-year report as default; matched windows exclude later archived lessons.
 const days=(from,to)=>Math.max(0,Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000)+1);
 const currentYear=settingsOf(current).year;
 const elapsed=mode==='elapsed'?days(currentYear.from,currentYear.to<today?currentYear.to:today):null;
 require(mode==='full'||Number.isSafeInteger(elapsed)&&elapsed>0,'Текущий учебный год ещё не начался или даты некорректны');
 const sources=[{year:settingsOf(current).year,data:current,archived:false},...(archives||[]).map(a=>({year:a.year,data:a.snapshot,archived:true}))],years=new Map();
 for(const source of sources){const key=source.year.from+'|'+source.year.to;if(!years.has(key))years.set(key,[]);years.get(key).push(source);}
 const out=[];
 for(const [key,group] of years){
  const {year,data,archived}=group[0];
  if(group.length!==1){out.push({year,conflict:true,archived});continue;}
  const availableEnd=year.to<today?year.to:today,windowEnd=mode==='elapsed'?M.addDays(year.from,elapsed-1):year.to;
  const cutoff=availableEnd<windowEnd?availableEnd:windowEnd,lessonEnd=mode==='elapsed'?cutoff:year.to,windowDays=days(year.from,cutoff);
  const classes=data.classes.filter(c=>gradeLevel===null||A.gradeLevelOf(c)===gradeLevel),ids=new Set(classes.map(c=>c.id)),byClass=new Map(classes.map(c=>[c.id,{students:[],lessons:[]}]));
  for(const p of data.students)if(ids.has(p.classId))byClass.get(p.classId).students.push(p);
  for(const l of data.lessons)if(ids.has(l.classId)&&M.inRange(l.date,year.from,lessonEnd))byClass.get(l.classId).lessons.push(l);
  const marks=data.marks||[],parts=data.participation||[],total={students:0,classes:classes.length,lessons:0,held:0,unknown:0,present:0,absent:0,unconfirmed:0,gradeCount:0,gradeWeight:0,gradeSum:0};
  const rows=[];
  for(const c of classes){const {students,lessons}=byClass.get(c.id),index=buildAttendanceIndex(lessons,lessons,marks,parts,cutoff),att=index.forStudents(students),pids=new Set(students.map(p=>p.id)),lids=new Set(lessons.filter(l=>l.date<=cutoff).map(l=>l.id));let gradeCount=0,gradeWeight=0,gradeSum=0;
   for(const m of index.marks.values())if(pids.has(m.studentId)&&lids.has(m.lessonId)&&['1','2','3','4','5'].includes(m.value)){const w=m.weight===2?2:1;gradeCount++;gradeWeight+=w;gradeSum+=Number(m.value)*w;}
   const row={className:c.name,students:students.length,lessons:lessons.length,held:att.held,unknown:att.unknown,present:att.present,absent:att.absent,unconfirmed:att.unconfirmed,gradeCount,gradeWeight,gradeSum,mean:gradeWeight?gradeSum/gradeWeight:null,pct:att.pct};rows.push(row);
   for(const k of ['students','lessons','held','unknown','present','absent','unconfirmed','gradeCount','gradeWeight','gradeSum'])total[k]+=row[k];
  }
  out.push({year,archived,conflict:false,cutoff,mode,windowDays,truncated:mode==='elapsed'&&windowDays<elapsed,...total,mean:total.gradeWeight?total.gradeSum/total.gradeWeight:null,pct:total.present+total.absent?Math.round(1000*total.present/(total.present+total.absent))/10:null,rows});
 }
 return out.sort((a,b)=>a.year.from.localeCompare(b.year.from));
}
