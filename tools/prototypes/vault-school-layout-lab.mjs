/* Versioned layout for the writable partition LAB. The original immutable
 * layout stays unchanged. School receives only explicitly owned settings;
 * grade history that requires a retained archive stays with that archive. */
import {SCHEMA} from '../../js/db.js';
import {BACKUP_VERSION,validateBackup} from '../../js/backup.js';
import {schoolSettingsFields,schoolSettingsProjection} from '../../js/model.js';
import {workRecordScope} from '../../js/work-scope.js';
import {splitVaultScopesLab} from './vault-scope-bundle.mjs';
const scopes=['school','coach','workspace'],names=Object.keys(SCHEMA);
const check=(v,m)=>{if(!v)throw Error(m);};
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
 const parts=splitVaultScopesLab(empty());parts.school.meta=[];return parts;
}
export function splitSchoolVaultLayoutLab(data){
 const parts=splitVaultScopesLab(data),classify=scopeOf(data);
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
export function joinSchoolVaultLayoutLab(parts){
 const shape=blank(),data=empty();
 check(exact(parts,scopes),'Требуются все области LAB');
 for(const scope of scopes){
  const part=parts[scope];check(exact(part,Object.keys(shape[scope]))&&Object.values(part).every(Array.isArray),'Неверный состав области LAB');
  for(const [n,rows] of Object.entries(part))if(n!=='meta')data[n].push(...rows);
 }
 const school=parts.school.meta,owner=parts.workspace.meta;
 check(school.length<=1&&school.every(r=>r&&r.id==='settings'&&Object.keys(r).every(k=>k==='id'||schoolField(k))),'Школьные настройки содержат чужие поля LAB');
 check(owner.every(r=>r&&typeof r.id==='string'&&!r.id.startsWith('sync-checkpoint-')&&(r.id!=='settings'||Object.keys(r).every(k=>!schoolField(k))))&&new Set(owner.map(r=>r.id)).size===owner.length,'Настройки владельца содержат школьные поля или контрольные точки LAB');
 data.meta=owner.map(r=>r.id==='settings'&&school.length?{...r,...school[0]}:r);
 if(school.length&&!owner.some(r=>r.id==='settings'))data.meta.push(school[0]);
 const checked=validateBackup({app:'teachapp',version:BACKUP_VERSION,data}),classify=scopeOf(checked);
 for(const scope of scopes)check(parts[scope].workRecords.every(r=>classify(r)===scope),'Запись другой области LAB');
 return checked;
}
export function validateSchoolVaultLayoutResultLab(result,scope){
 check(scopes.includes(scope)&&result?.scope===scope,'Неизвестная область LAB');
 const {bundleMeta,...part}=result.data,meta=bundleMeta?.[0];
 check(Array.isArray(bundleMeta)&&bundleMeta.length===1&&exact(meta,['id','scope','bundleId'])&&meta.id==='bundle'&&meta.scope===scope&&typeof meta.bundleId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(meta.bundleId),'Повреждена связь областей LAB');
 joinSchoolVaultLayoutLab({...blank(),[scope]:part});
 return {bundleId:meta.bundleId,scope,revision:result.revision,data:part};
}
