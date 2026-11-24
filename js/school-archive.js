import * as db from './db.js';
import * as M from './model.js';
import * as A from './assessment.js';
import {validPeriod} from './health.js';
import {require,txt,only} from './workbench.js';
import {validateBackup} from './backup.js';
import * as S from './store.js';
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
 for(const st of data.students){const classId=classIds.get(st.classId);if(!classId)continue;const id=M.uid('stu');studentIds.set(st.id,id);next.students.push({id,classId,fullName:st.fullName,number:st.number,normGroup:st.normGroup??null});}
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
export async function rollSchoolYear({year,transfers,kind,expected,confirmed=false}){
 require(confirmed&&typeof expected==='string','Подтвердите перевод после предварительного просмотра');
 const result=await db.transaction([...schoolStores,'workRecords'],'readwrite',async s=>{
  const data=Object.fromEntries(await Promise.all(schoolStores.map(async n=>[n,await s[n].getAll()])));
  require(archivePreview(data).token===expected,'Данные изменились. Откройте предварительный просмотр заново');
  const old=settingsOf(data).year,existing=await s.workRecords.index('kind').getAll('archive');
  require(!existing.some(a=>a.year.from===old.from&&a.year.to===old.to),'Этот учебный год уже в архиве');
  const next=buildNextYear(data,year,transfers,kind);
  const record={id:M.uid('archive'),kind:'archive',year:{...old},createdAt:new Date().toISOString(),snapshot:data};validateArchive(record);
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
