/* Immutable plan versions. No pupils, grades, lessons or class assignments. */
import * as db from './db.js';
import {uid} from './model.js';
import {catalog} from './health.js';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const text=(x,max=500)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export const versionReasons={manual:'Сохранено вручную',replace:'Перед заменой тем',deleteTopic:'Перед удалением темы',deletePlan:'Перед удалением плана'};
export const orderKtpTopics=rows=>rows.slice().sort((a,b)=>(a.ktpOrder||0)-(b.ktpOrder||0)||a.id.localeCompare(b.id));
export function validateKtpVersion(r){
 check(exact(r,['id','kind','version','sourcePlanId','name','label','createdAt','reason','topics'])&&r.kind==='ktpVersion'&&r.version===1&&text(r.id,200)&&text(r.sourcePlanId,200)&&text(r.name,2000)&&text(r.label,200)&&typeof r.createdAt==='string'&&Number.isFinite(Date.parse(r.createdAt))&&new Date(r.createdAt).toISOString()===r.createdAt&&Object.hasOwn(versionReasons,r.reason)&&Array.isArray(r.topics)&&r.topics.length<=10000,'Некорректная версия КТП');
 const ids=new Set();
 for(const t of r.topics){
  check(exact(t,['id','name','order','activityIds','activitiesConfirmed'])&&text(t.id,200)&&!ids.has(t.id)&&text(t.name,5000)&&Number.isSafeInteger(t.order)&&t.order>=0&&(t.activityIds===null||Array.isArray(t.activityIds)&&t.activityIds.length<=500&&t.activityIds.every(id=>text(id,200))&&new Set(t.activityIds).size===t.activityIds.length)&&[null,true,false].includes(t.activitiesConfirmed),'Некорректная тема версии КТП');
  ids.add(t.id);
 }
 return r;
}
function snapshot(plan,topics,{label='До изменения',reason='manual'}={}){
 check(plan&&topics.every(t=>t.ktpId===plan.id),'КТП изменилось');
 return validateKtpVersion({id:uid('ktpVersion'),kind:'ktpVersion',version:1,sourcePlanId:plan.id,name:plan.name,label:label.trim(),createdAt:new Date().toISOString(),reason,topics:orderKtpTopics(topics).map(t=>({id:t.id,name:t.name,order:Number.isSafeInteger(t.ktpOrder)&&t.ktpOrder>=0?t.ktpOrder:0,activityIds:Array.isArray(t.activityIds)?[...new Set(t.activityIds)]:null,activitiesConfirmed:typeof t.activitiesConfirmed==='boolean'?t.activitiesConfirmed:null}))});
}
// Called only inside the same transaction as a destructive mutation.
export async function recordKtpVersion(stores,plan,topics,options){
 const version=snapshot(plan,topics,options);
 await stores.workRecords.add(version);
 return version;
}
export async function saveKtpVersion(planId,label){
 check(text(label,200),'Укажите название версии (до 200 символов)');
 return db.transaction(['ktp','topics','workRecords'],'readwrite',async s=>{
  const plan=await s.ktp.get(planId);check(plan,'КТП недоступно');
  return recordKtpVersion(s,plan,await s.topics.index('ktpId').getAll(planId),{label,reason:'manual'});
 });
}
export async function listKtpVersions(planId=null){
 const rows=await db.transaction(['workRecords'],'readonly',s=>s.workRecords.index('kind').getAll('ktpVersion'));
 return rows.filter(r=>planId===null||r.sourcePlanId===planId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
}
export function compareKtpVersion(r,plan,topics){
 validateKtpVersion(r);check(plan?.id===r.sourcePlanId,'Выберите исходный план');
 const current=snapshot(plan,topics),a=new Map(r.topics.map(t=>[t.id,t])),b=new Map(current.topics.map(t=>[t.id,t]));
 const added=[],removed=[],changed=[];
 for(const [id,t] of b){const old=a.get(id);if(!old)added.push(t);else if(JSON.stringify(old)!==JSON.stringify(t))changed.push({before:old,after:t});}
 for(const [id,t] of a)if(!b.has(id))removed.push(t);
 return {renamed:r.name!==plan.name,added,removed,changed};
}
export async function restoreKtpVersionCopy(id,{name,confirmed=false}={}){
 check(confirmed&&text(name,200),'Подтвердите создание копии и укажите название (до 200 символов)');
 return db.transaction(['ktp','topics','workRecords','activityCategories'],'readwrite',async s=>{
  const r=validateKtpVersion(await s.workRecords.get(id)),valid=new Set([...catalog,...await s.activityCategories.getAll()].map(a=>a.id));
  const k={id:uid('ktp'),name:name.trim(),classIds:[],createdAt:new Date().toISOString()};
  let missingTags=0;
  await s.ktp.add(k);
  for(const [i,t] of r.topics.entries()){
   const tags=t.activityIds?.filter(a=>valid.has(a))??null;
   missingTags+=(t.activityIds?.length??0)-(tags?.length??0);
   await s.topics.add({id:uid('top'),name:t.name,ktpId:k.id,ktpOrder:i+1,activityIds:tags,activitiesConfirmed:false});
  }
  return {plan:k,topics:r.topics.length,missingTags};
 });
}
export async function deleteKtpVersion(id,confirmed=false){
 check(confirmed,'Подтвердите удаление сохранённой версии');
 return db.transaction(['workRecords'],'readwrite',async s=>{const row=await s.workRecords.get(id);validateKtpVersion(row);await s.workRecords.delete(id);return true;});
}
