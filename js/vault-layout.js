/* Pure, shared three-scope layout. No storage, crypto, activation or routing.
 * Used by native read-only diagnostics and the isolated migration rehearsal. */
import {SCHEMA} from './db.js';
import {BACKUP_VERSION,validateBackup} from './backup.js';
import {schoolSettingsFields,schoolSettingsProjection} from './model.js';
import {workRecordScope,workRecordScope as workScope} from './work-scope.js';
const scopes=['school','coach','workspace'],names=Object.keys(SCHEMA),check=(ok,msg)=>{if(!ok)throw Error(msg);};
const tableScope=n=>n==='meta'?'workspace':n.startsWith('coach')?'coach':'school';
const keysFor=scope=>[...names.filter(n=>n!=='workRecords'&&tableScope(n)===scope),'workRecords'];
const full=data=>{
 check(data&&Object.keys(data).length===names.length&&names.every(n=>Array.isArray(data[n])),'Требуется полная схема');
 check(data.meta.every(r=>typeof r.id==='string'&&!r.id.startsWith('sync-checkpoint-')),'Контрольные точки sync не переносятся в');
 return validateBackup({app:'teachapp',version:BACKUP_VERSION,data});
};
export function splitVaultScopes(data){
 const checked=full(structuredClone(data)),out=Object.fromEntries(scopes.map(s=>[s,Object.fromEntries(keysFor(s).map(n=>[n,[]]))]));
 for(const n of names){
  if(n==='workRecords'){for(const r of checked[n])out[workScope(r)][n].push(r);}
  else out[tableScope(n)][n]=checked[n];
 }
 return out;
}
function checkPart(data,scope){
 check(scopes.includes(scope)&&data&&Object.keys(data).length===keysFor(scope).length&&keysFor(scope).every(n=>Array.isArray(data[n])),'Неверный состав области');
 check(data.workRecords.every(r=>workScope(r)===scope),'Запись другой области');
 if(scope==='workspace')check(data.meta.every(r=>typeof r.id==='string'&&!r.id.startsWith('sync-checkpoint-')),'Контрольные точки sync не переносятся в');
 return data;
}
export function joinVaultScopes(parts){
 check(parts&&Object.keys(parts).length===scopes.length&&scopes.every(s=>Object.hasOwn(parts,s)),'Требуются все области');
 const data=Object.fromEntries(names.map(n=>[n,[]]));
 for(const s of scopes){const part=checkPart(parts[s],s);for(const n of keysFor(s))data[n].push(...part[n]);}
 // Cross-scope duplicated IDs, broken relationships and unknown types fail.
 return full(data);
}

const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const empty=()=>Object.fromEntries(names.map(n=>[n,[]]));
const schoolField=k=>schoolSettingsFields.includes(k);
function scopeOf(data){
 const students=new Map(data.students.map(r=>[r.id,r])),lessons=new Map(data.lessons.map(r=>[r.id,r]));
 return r=>{
  if(r.kind==='gradeHistory'){
   const p=students.get(r.studentId),lesson=lessons.get(r.lessonId);
   if(!p||(r.scope==='lesson'&&lesson?.classId!==p.classId))return 'workspace';
  }
  return workRecordScope(r);
 };
}
function blank(){
 const parts=splitVaultScopes(empty());parts.school.meta=[];return parts;
}
export function splitSchoolVaultLayout(data){
 const parts=splitVaultScopes(data),classify=scopeOf(data);
 parts.school.meta=[];
 const settings=parts.workspace.meta.find(r=>r.id==='settings');
 if(settings){
  const school=schoolSettingsProjection(settings),owner=Object.fromEntries(Object.entries(settings).filter(([k])=>!schoolField(k)));
  if(Object.keys(school).length>1)parts.school.meta.push(school);
  parts.workspace.meta=parts.workspace.meta.flatMap(r=>r.id!=='settings'?[r]:Object.keys(owner).length>1||!parts.school.meta.length?[owner]:[]);
 }
 const historical=parts.school.workRecords.filter(r=>classify(r)==='workspace');
 parts.school.workRecords=parts.school.workRecords.filter(r=>classify(r)==='school');
 parts.workspace.workRecords.push(...historical);
 return parts;
}
export function joinSchoolVaultLayout(parts){
 const shape=blank(),data=empty();
 check(exact(parts,scopes),'Требуются все области');
 for(const scope of scopes){
  const part=parts[scope];check(exact(part,Object.keys(shape[scope]))&&Object.values(part).every(Array.isArray),'Неверный состав области');
  for(const [n,rows] of Object.entries(part))if(n!=='meta')data[n].push(...rows);
 }
 const school=parts.school.meta,owner=parts.workspace.meta;
 check(school.length<=1&&school.every(r=>r&&r.id==='settings'&&Object.keys(r).every(k=>k==='id'||schoolField(k))),'Школьные настройки содержат чужие поля');
 check(owner.every(r=>r&&typeof r.id==='string'&&!r.id.startsWith('sync-checkpoint-')&&(r.id!=='settings'||Object.keys(r).every(k=>!schoolField(k))))&&new Set(owner.map(r=>r.id)).size===owner.length,'Настройки владельца содержат школьные поля или контрольные точки');
 data.meta=owner.map(r=>r.id==='settings'&&school.length?{...r,...school[0]}:r);
 if(school.length&&!owner.some(r=>r.id==='settings'))data.meta.push(school[0]);
 const checked=validateBackup({app:'teachapp',version:BACKUP_VERSION,data}),classify=scopeOf(checked);
 for(const scope of scopes)check(parts[scope].workRecords.every(r=>classify(r)===scope),'Запись другой области');
 return checked;
}

/* Compare by primary key and recursively by value, independent of insertion
 * order. Only call with validated, JSON-safe source records. */
function equal(a,b){
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const keys=Object.keys(a);
 return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
}
export function verifyVaultLayoutRoundtrip(data){
 const parts=splitSchoolVaultLayout(data),restored=joinSchoolVaultLayout(parts);
 for(const n of names){
  const rows=new Map(restored[n].map(r=>[r.id,r]));
  check(rows.size===data[n].length&&data[n].every(r=>rows.has(r.id)&&equal(r,rows.get(r.id))),'Неполный обратный перенос области');
 }
 return true;
}
