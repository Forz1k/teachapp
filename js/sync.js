/* TeachApp 4.0 beta: explicit scoped revision synchronization. No implicit network traffic. */
import * as db from './db.js';
import {validateBackup,BACKUP_VERSION} from './backup.js';
import {defaultSettings,exemptionCovers,hasOsv} from './model.js';
import {gradeState,finalState} from './grade-history.js';
import {encryptBackup,decryptBackup,isEncryptedBackup,encryptedEnvelopeBytes} from './privacy.js';

export const syncAreas={school:'Школа',coach:'Тренер'};
const names=Object.keys(db.SCHEMA);
const school=names.filter(n=>n!=='meta'&&n!=='workRecords'&&!n.startsWith('coach'));
const coach=names.filter(n=>n.startsWith('coach'));
const settingsKeys=['year','trimesters','rules','holidays','healthGroups'];
const check=(ok,message)=>{if(!ok)throw Error(message);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const copy=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':plain(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const same=(a,b)=>canonical(a)===canonical(b);
const sorted=rows=>copy(rows).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
const keyOf=area=>'sync-checkpoint-'+area;
// Small local-only metadata: excluded from backups and scoped cloud snapshots.
const statusKey=area=>'sync-checkpoint-status-'+area;
const successRecord=(area,cp)=>({id:statusKey(area),workspaceId:cp.workspaceId,revision:cp.revision,endpoint:cp.endpoint,successfulAt:new Date().toISOString()});
export const isSyncCheckpoint=r=>typeof r?.id==='string'&&r.id.startsWith('sync-checkpoint-');
const validArea=a=>Object.hasOwn(syncAreas,a);
const keysFor=area=>area==='school'?[...school,'workRecords','meta']:[...coach,'workRecords'];
function recordArea(r){
 if(['archive','gradeHistory','rubric','normAssignment','briefing','gymBoard','ktpMaterial','documentMaterial','studentGoal','schoolCompetition','teacherPortfolio','normRetake'].includes(r.kind))return 'school';
 if(['coachGoal','tacticBoard','seasonPlan','videoReview','opponentNote','tacticMaterial','publicNewsDraft','matchRegulation'].includes(r.kind))return 'coach';
 if(r.kind==='plan')return r.context;
 if(r.kind==='achievement')return ['class','student'].includes(r.subjectType)?'school':['team','player'].includes(r.subjectType)?'coach':null;
 return null;
}
function sharedSettings(data){
 const s={...defaultSettings(),...data.meta.find(r=>r.id==='settings')};
 return {id:'settings',...Object.fromEntries(settingsKeys.filter(k=>s[k]!==undefined).map(k=>[k,s[k]]))};
}
function validateScope(snapshot,area){
 check(validArea(area)&&plain(snapshot),'Некорректная область синхронизации');
 const keys=keysFor(area);
 check(Object.keys(snapshot).length===keys.length&&keys.every(n=>Array.isArray(snapshot[n])),'Неподдерживаемый состав пакета');
 for(const n of keys){
  const ids=new Set();
  for(const r of snapshot[n]){
   check(plain(r)&&typeof r.id==='string'&&r.id.trim()&&!ids.has(r.id),'Повтор или неверный идентификатор записи');
   ids.add(r.id);
   if(n==='workRecords')check(recordArea(r)===area,'Пакет содержит чужую рабочую область');
  }
 }
 if(area==='school'){
  const rows=snapshot.meta;
  check(rows.length===1&&rows[0].id==='settings'&&Object.keys(rows[0]).every(k=>k==='id'||settingsKeys.includes(k))&&plain(rows[0].year)&&Array.isArray(rows[0].trimesters)&&plain(rows[0].rules),'Некорректные общие настройки школы');
 }
 if(area==='coach')check(!snapshot.coachLive.length,'Завершите или удалите черновики матчей на обоих устройствах перед синхронизацией');
 return snapshot;
}
export function projectScope(data,area){
 check(validArea(area),'Выберите рабочую область');
 const out={};
 for(const n of keysFor(area)){
  if(n==='meta')out[n]=[sharedSettings(data)];
  else if(n==='workRecords')out[n]=sorted(data[n].filter(r=>recordArea(r)===area));
  else out[n]=sorted(data[n]);
 }
 return validateScope(out,area);
}
export function combineScope(current,snapshot,area){
 validateScope(snapshot,area);
 const out=Object.fromEntries(names.map(n=>[n,structuredClone(current[n])]));
 for(const n of keysFor(area)){
  if(n==='meta'){
   const old=out.meta.find(r=>r.id==='settings')||defaultSettings(),local={...old};
   for(const k of settingsKeys)delete local[k];
   out.meta=out.meta.filter(r=>r.id!=='settings').concat({...local,...copy(snapshot.meta[0])});
  }else if(n==='workRecords'){
   const untouched=out[n].filter(r=>recordArea(r)!==area),ids=new Set(untouched.map(r=>r.id));
   check(!snapshot[n].some(r=>ids.has(r.id)),'Идентификатор совпадает с записью другой области');
   out[n]=untouched.concat(copy(snapshot[n]));
  }else out[n]=copy(snapshot[n]);
 }
 validateBackup({app:'teachapp',version:BACKUP_VERSION,data:out});
 return out;
}
const byId=rows=>new Map(rows.map(r=>[r.id,r]));
export function mergeScopes(base,local,remote,area,choices={}){
 for(const s of [base,local,remote])validateScope(s,area);
 if(area==='school'&&!same(local,remote)){
  const year=s=>s.meta[0].year,other=s=>Object.fromEntries(Object.entries(s).filter(([n])=>n!=='meta'));
  check(same(year(base),year(local))||same(other(base),other(remote)),'Учебный год изменён на одном устройстве, школьные записи — на другом. Согласуйте перенос года вручную.');
  check(same(year(base),year(remote))||same(other(base),other(local)),'Учебный год изменён на одном устройстве, школьные записи — на другом. Согласуйте перенос года вручную.');
 }
 const result={},conflicts=[];
 for(const store of keysFor(area)){
  const [b,l,r]=[base,local,remote].map(s=>byId(s[store]));
  const rows=[];
  for(const id of [...new Set([...b.keys(),...l.keys(),...r.keys()])].sort()){
   const before=b.get(id)??null,left=l.get(id)??null,right=r.get(id)??null;
   let value;
   if(same(left,right))value=left;
   else if(same(left,before))value=right;
   else if(same(right,before))value=left;
   else{
    const key=JSON.stringify([store,id]),choice=Object.hasOwn(choices,key)?choices[key]:null;
    if(choice==='local')value=left;
    else if(choice==='remote')value=right;
    else{conflicts.push({key,store,id,base:before,local:left,remote:right});continue;}
   }
   if(value!==null)rows.push(copy(value));
  }
  result[store]=rows;
 }
 if(area==='school'&&!conflicts.length){assertGradePairs(result,local,remote);assertCoveragePairs(result,local,remote);}
 return {snapshot:result,conflicts};
}
// Explain the existing whole-record conflict without changing merge semantics.
export function describeSyncConflict({base,local,remote}){
 const kind=base===null?'created':local===null||remote===null?'deleted':'changed';
 const keys=[...new Set([base,local,remote].flatMap(x=>Object.keys(x||{})))].filter(k=>k!=='id').sort();
 const fields=keys.filter(k=>!same(local?.[k],remote?.[k])).map(key=>({
  key,local:local?.[key],remote:remote?.[key],
  localChanged:!same(base?.[key],local?.[key]),remoteChanged:!same(base?.[key],remote?.[key])
 }));
 return {kind,fields};
}
function gradePairs(snapshot){
 const history=byId(snapshot.workRecords.filter(r=>r.kind==='gradeHistory'));
 const marks=new Map(snapshot.marks.map(r=>[JSON.stringify([r.studentId,r.lessonId]),r]));
 const finals=new Map(snapshot.finalGrades.map(r=>[JSON.stringify([r.studentId,r.from,r.to]),r]));
 const students=new Set(snapshot.students.map(r=>r.id));
 const lessons=new Set(snapshot.lessons.map(r=>r.id));
 return {history,grade:r=>{
  if(!students.has(r.studentId)||r.scope==='lesson'&&!lessons.has(r.lessonId))return null; // archived
  if(r.scope==='final')return finalState(finals.get(JSON.stringify([r.studentId,r.from,r.to])));
  const mark=marks.get(JSON.stringify([r.studentId,r.lessonId]));
  return gradeState(mark&&Object.hasOwn(mark,'baseMark')?mark.baseMark:mark);
 }};
}
function assertGradePairs(merged,local,remote){
 const m=gradePairs(merged),sources=[gradePairs(local),gradePairs(remote)];
 for(const [id,row] of m.history){
  const grade=m.grade(row);if(grade===null)continue;
  check(sources.some(src=>same(src.history.get(id),row)&&same(src.grade(row),grade)),'Оценка и история выбраны из разных несовместимых версий. Согласуйте связанные записи.');
 }
}
function coverageView(snapshot){
 const pupils=byId(snapshot.students),lessons=byId(snapshot.lessons),byClass=new Map(),exemptions=new Map(),parts=new Map(),marks=new Map();
 const key=(studentId,lessonId)=>JSON.stringify([studentId,lessonId]);
 for(const l of snapshot.lessons){if(!byClass.has(l.classId))byClass.set(l.classId,[]);byClass.get(l.classId).push(l);}
 for(const e of snapshot.exemptions){if(!exemptions.has(e.studentId))exemptions.set(e.studentId,[]);exemptions.get(e.studentId).push(e);}
 for(const p of snapshot.participation)if(p.full)parts.set(key(p.studentId,p.lessonId),p);
 for(const m of snapshot.marks)marks.set(key(m.studentId,m.lessonId),m);
 const state=k=>{
  const [studentId,lessonId]=JSON.parse(k),pupil=pupils.get(studentId),lesson=lessons.get(lessonId);
  if(!pupil||!lesson||pupil.classId!==lesson.classId)return null;
  return {covered:(exemptions.get(studentId)||[]).some(e=>exemptionCovers(e,lesson.date)),partId:parts.get(k)?.id??null,mark:marks.get(k)??null};
 };
 const affected=new Set(parts.keys());
 for(const [studentId,list] of exemptions){
  for(const l of byClass.get(pupils.get(studentId)?.classId)||[])if(list.some(e=>exemptionCovers(e,l.date)))affected.add(key(studentId,l.id));
 }
 for(const [k,m] of marks)if(['auto-osv','participation'].includes(m.source)||m.participationId)affected.add(k);
 return {state,affected};
}
function assertCoveragePairs(merged,local,remote){
 const m=coverageView(merged),sources=[coverageView(local),coverageView(remote)];
 for(const k of m.affected){
  const x=m.state(k);if(!x)continue;
  const required=x.covered||x.partId!==null,mark=x.mark;
  const invalid=required&&!hasOsv(mark)||x.partId!==null&&(mark?.participationId!==x.partId||mark?.source!=='participation')||
   x.partId===null&&(mark?.source==='participation'||!!mark?.participationId)||!required&&mark?.source==='auto-osv';
  // Historical inconsistencies may already exist; do not introduce a new one by combining devices.
  check(!invalid||sources.some(src=>same(src.state(k),x)),'Объединение создаёт несогласованное освобождение или участие. Проверьте ученика и урок в обычном журнале до синхронизации.');
 }
}
function counts(before,after){
 const result={added:0,changed:0,deleted:0};
 for(const n of Object.keys(before)){
  const b=byId(before[n]),a=byId(after[n]);
  for(const [id,r] of a)if(!b.has(id))result.added++;else if(!same(b.get(id),r))result.changed++;
  for(const id of b.keys())if(!a.has(id))result.deleted++;
 }
 return result;
}
const emptyScope=s=>Object.entries(s).every(([n,rows])=>n==='meta'||rows.length===0);
export function normalizeEndpoint(value){
 let u;try{u=new URL(String(value).trim());}catch{throw Error('Введите полный адрес HTTPS сервера');}
 check(!u.username&&!u.password&&!u.search&&!u.hash&&(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)),'Разрешён HTTPS; HTTP — только локальный тест');
 return u.href.replace(/\/+$/,'');
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const revision=n=>Number.isSafeInteger(n)&&n>=1;
async function readPacket(envelope,password,area,rev){
 check(isEncryptedBackup(envelope),'Сервер не вернул зашифрованный пакет');
 const p=await decryptBackup(envelope,password);
 check(p?.app==='teachapp-sync'&&p.version===1&&[19,20,BACKUP_VERSION].includes(p.backupVersion)&&p.area===area&&uuid.test(p.workspaceId)&&p.revision===rev,'Несовместимый пакет синхронизации или подмена ревизии');
 validateScope(p.snapshot,area);
 return p;
}
/** Read-only verification for recovery: never merges, uploads, or accepts a checkpoint. */
export async function verifySyncSnapshot(remote,password,area){
 check(validArea(area)&&Number.isSafeInteger(remote?.revision)&&remote.revision>=0,'Некорректная ревизия');
 if(!remote.revision){check(remote.envelope===null,'Некорректный пустой снимок');return {revision:0,empty:true};}
 await readPacket(remote.envelope,password,area,remote.revision);return {revision:remote.revision,empty:false};
}
const snapshotLimit=90*1024*1024;
export function relayClient(endpoint,area,token,{fetcher=globalThis.fetch,timeoutMs=45000,protocolVersion=1}={}){
 endpoint=normalizeEndpoint(endpoint);
 check(validArea(area)&&typeof token==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(token),'Проверьте индивидуальный ключ доступа сервера');
 check(protocolVersion===1||protocolVersion===2,'Неподдерживаемая версия синхронизации');
 const url=endpoint+'/v'+protocolVersion+'/snapshot/'+area;
 async function request(method,body){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   let res;
   try{res=await fetcher(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});}
   catch(error){
    if(error?.name==='AbortError'||error?.name==='TypeError')throw Object.assign(Error('Временная ошибка соединения с сервером синхронизации'),{retryable:true});
    throw error;
   }
   if([408,502,503,504].includes(res.status))throw Object.assign(Error('Временная недоступность сервера синхронизации (HTTP '+res.status+')'),{retryable:true});
   if(res.status===413)throw Object.assign(Error('Пакет превышает лимит выбранного сервера. Локальные данные сохранены. Откройте диагностику размера пакетов.'),{code:'packet-too-large'});
   if(res.status===409)throw Error('На сервере появилась новая ревизия. Повторите предварительный просмотр.');
   if(res.status===401||res.status===403)throw Error('Сервер отказал в доступе. Проверьте ключ и область.');
   check(res.ok,'Сервер синхронизации недоступен (HTTP '+res.status+')');
   const length=Number(res.headers.get('content-length')||0);
   check(length<=snapshotLimit,'Слишком большой ответ сервера');
   let text='';
   if(res.body?.getReader){
    const reader=res.body.getReader(),decoder=new TextDecoder();let size=0;
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>snapshotLimit){await reader.cancel();throw Error('Слишком большой ответ сервера');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
    finally{reader.releaseLock();}
   }else{text=await res.text();check(text.length<=snapshotLimit,'Слишком большой ответ сервера');}
   const result=JSON.parse(text);
   check(plain(result)&&Number.isSafeInteger(result.revision)&&result.revision>=0&&(result.revision===0?result.envelope===null:isEncryptedBackup(result.envelope)),'Некорректный ответ сервера');
   return result;
  }finally{clearTimeout(timeout);}
 }
 return {get:()=>request('GET'),put:(expectedRevision,envelope)=>request('PUT',{expectedRevision,envelope})};
}
const getCheckpoint=(data,area)=>data.meta.find(r=>r.id===keyOf(area))??null;
const packetPayload=(snapshot,area,workspaceId,revision)=>({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area,workspaceId,revision,snapshot});
export const defaultCloudflarePacketLimit=1024*1024;
// The current relay receives a JSON PUT wrapper as well as the encrypted envelope.
export function syncUploadBytes(snapshot,{area,workspaceId,expectedRevision}){
 check(validArea(area)&&uuid.test(workspaceId)&&Number.isSafeInteger(expectedRevision)&&expectedRevision>=0&&expectedRevision<Number.MAX_SAFE_INTEGER,'Некорректные параметры оценки размера');
 return encryptedEnvelopeBytes(packetPayload(snapshot,area,workspaceId,expectedRevision+1))+
  JSON.stringify({expectedRevision,envelope:null}).length-4;
}
// Read-only size estimate for the local scope, before contact with a relay.
// A remote merge may change the size; use syncUploadBytes on its final preview.
export function localScopeUploadSize(data,area){
 const snapshot=projectScope(data,area),cp=getCheckpoint(data,area);
 return {area,bytes:syncUploadBytes(snapshot,{area,workspaceId:cp?.workspaceId||'00000000-0000-4000-8000-000000000000',expectedRevision:cp?.revision??0}),records:Object.values(snapshot).reduce((n,rows)=>n+rows.length,0)};
}

/* Experimental incremental protocol: pure scoped delta and encrypted replay.
   Deliberately not accepted by the existing v1/v2 endpoints or auto-sync.
   The future relay must retain an authenticated full anchor plus ordered deltas. */
const deltaApp='teachapp-sync-delta';
const digestPattern=/^[0-9a-f]{64}$/;
const exactFields=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function deltaContext(area,workspaceId,baseRevision){
 check(validArea(area)&&typeof workspaceId==='string'&&uuid.test(workspaceId)&&revision(baseRevision)&&baseRevision<Number.MAX_SAFE_INTEGER,'Некорректная базовая ревизия изменений');
 return {area,workspaceId,baseRevision,revision:baseRevision+1};
}
function deltaOps(base,next,area){
 validateScope(base,area);validateScope(next,area);
 const changes={};
 for(const store of keysFor(area)){
  const b=byId(base[store]),n=byId(next[store]);
  const upserts=sorted([...n.values()].filter(r=>!b.has(r.id)||!same(r,b.get(r.id))));
  const deletes=[...b.keys()].filter(id=>!n.has(id)).sort();
  if(upserts.length||deletes.length)changes[store]={upserts,deletes};
 }
 return changes;
}
async function scopeDigest(snapshot,area){
 validateScope(snapshot,area);
 const ordered=Object.fromEntries(keysFor(area).map(n=>[n,sorted(snapshot[n])]));
 const bytes=new TextEncoder().encode(canonical(ordered));
 return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
function deltaPacket(context,changes,baseHash,resultHash){
 return {app:deltaApp,version:1,backupVersion:BACKUP_VERSION,...context,baseHash,resultHash,changes};
}
export function syncDeltaEstimate(base,next,{area,workspaceId,baseRevision}){
 const ctx=deltaContext(area,workspaceId,baseRevision),changes=deltaOps(base,next,area);
 const changedRecords=Object.values(changes).reduce((n,c)=>n+c.upserts.length+c.deletes.length,0);
 const bytes=encryptedEnvelopeBytes(deltaPacket(ctx,changes,'0'.repeat(64),'0'.repeat(64)))+
  JSON.stringify({expectedRevision:baseRevision,envelope:null}).length-4;
 return {bytes,changedRecords,fullBytes:syncUploadBytes(next,{area,workspaceId,expectedRevision:baseRevision})};
}
export async function buildSyncDelta(base,next,{area,workspaceId,baseRevision}){
 const ctx=deltaContext(area,workspaceId,baseRevision),changes=deltaOps(base,next,area);
 check(Object.keys(changes).length,'Нет изменений для инкрементальной передачи');
 const [baseHash,resultHash]=await Promise.all([scopeDigest(base,area),scopeDigest(next,area)]);
 return deltaPacket(ctx,changes,baseHash,resultHash);
}
function checkDeltaHeader(packet,{area,workspaceId,baseRevision}){
 const ctx=deltaContext(area,workspaceId,baseRevision);
 check(exactFields(packet,['app','version','backupVersion','area','workspaceId','baseRevision','revision','baseHash','resultHash','changes'])&&
  packet.app===deltaApp&&packet.version===1&&packet.backupVersion===BACKUP_VERSION&&
  Object.entries(ctx).every(([k,v])=>packet[k]===v)&&typeof packet.baseHash==='string'&&digestPattern.test(packet.baseHash)&&
  typeof packet.resultHash==='string'&&digestPattern.test(packet.resultHash),'Несовместимый пакет изменений или неверная ревизия');
}
export async function applySyncDelta(base,packet,{area,workspaceId,baseRevision,current}){
 checkDeltaHeader(packet,{area,workspaceId,baseRevision});
 check(await scopeDigest(base,area)===packet.baseHash,'Базовый снимок изменений не совпадает');
 const keys=keysFor(area);
 check(plain(packet.changes)&&Object.keys(packet.changes).length>0&&Object.keys(packet.changes).every(n=>keys.includes(n)),'Некорректная область пакета изменений');
 const result={};
 for(const store of keys){
  const rows=byId(base[store]);
  if(Object.hasOwn(packet.changes,store)){
   const c=packet.changes[store],seen=new Set();
   check(exactFields(c,['upserts','deletes'])&&Array.isArray(c.upserts)&&Array.isArray(c.deletes)&&(c.upserts.length||c.deletes.length),'Некорректный список изменений');
   for(const id of c.deletes){
    check(typeof id==='string'&&rows.has(id)&&!seen.has(id),'Неизвестное или повторное удаление');
    seen.add(id);rows.delete(id);
   }
   for(const row of c.upserts){
    check(plain(row)&&typeof row.id==='string'&&row.id.trim()&&!seen.has(row.id)&&!same(rows.get(row.id),row),'Повторная или некорректная запись изменений');
    seen.add(row.id);rows.set(row.id,row);
   }
  }
  result[store]=sorted([...rows.values()]);
 }
 check(await scopeDigest(result,area)===packet.resultHash,'Итоговый снимок изменений не совпадает');
 // Reuse the ordinary backup/relationship validation, including scope isolation.
 // Never write to IndexedDB from this prototype.
 combineScope(current,result,area);
 return result;
}
export async function replaySyncDeltas({base,baseRevision,area,workspaceId,entries,password,current}){
 deltaContext(area,workspaceId,baseRevision);
 check(Array.isArray(entries)&&entries.length<=128,'Слишком длинная цепочка изменений; требуется новый проверенный снимок');
 let snapshot=copy(base),rev=baseRevision;
 combineScope(current,snapshot,area);
 for(const entry of entries){
  check(exactFields(entry,['revision','envelope'])&&entry.revision===rev+1&&isEncryptedBackup(entry.envelope),'Пропущена или подменена ревизия изменений');
  const packet=await decryptBackup(entry.envelope,password);
  snapshot=await applySyncDelta(snapshot,packet,{area,workspaceId,baseRevision:rev,current});
  rev=entry.revision;
 }
 return {snapshot,revision:rev};
}

/* Local synthetic relay only. No change to the production v1/v2 client.
   Keep credential roles separate; never persist tokens or plaintext snapshots. */
export function deltaLabClient(endpoint,area,token,{compactToken,fetcher=globalThis.fetch,timeoutMs=15000}={}){
 endpoint=normalizeEndpoint(endpoint);
 check(validArea(area)&&['localhost','127.0.0.1','[::1]'].includes(new URL(endpoint).hostname)&&new URL(endpoint).protocol==='http:','Delta LAB доступен только на localhost');
 const validToken=t=>typeof t==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(t);
 check(validToken(token)&&(compactToken===undefined||validToken(compactToken)&&compactToken!==token),'Проверьте отдельные тестовые ключи');
 const url=endpoint+'/v1/delta/'+area+'/';
 async function request(path,body,secret=token){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
   const res=await fetcher(url+path,{method:body?'PUT':'GET',headers:{Authorization:'Bearer '+secret,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:ctl.signal});
   if(!res.ok)throw Object.assign(Error(res.status===410?'История уплотнена, повторите чтение':'Delta LAB: HTTP '+res.status),{status:res.status});
   const limit=defaultCloudflarePacketLimit+4096;
   check(Number(res.headers.get('content-length')||0)<=limit,'Слишком большой ответ Delta LAB');
   check(res.body?.getReader,'Пустой ответ Delta LAB');
   const reader=res.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw Error('Слишком большой ответ Delta LAB');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
   finally{reader.releaseLock();}
   return JSON.parse(text);
  }finally{clearTimeout(timer);}
 }
 return {head:()=>request('head'),getRevision:rev=>{check(revision(rev),'Некорректная ревизия');return request('revision/'+rev);},
  anchor:envelope=>request('anchor',{expectedRevision:0,envelope}),
  append:(expectedRevision,envelope)=>request('append',{expectedRevision,envelope}),
  compact:(expectedRevision,envelope)=>{check(validToken(compactToken),'Нужен отдельный ключ компактизации');return request('compact',{expectedRevision,envelope},compactToken);}
 };
}
function validDeltaHead(h){
 return plain(h)&&Number.isSafeInteger(h.revision)&&h.revision>=0&&Number.isSafeInteger(h.anchorRevision)&&Number.isInteger(h.count)&&h.count>=0&&h.count<=129&&
  (h.revision===0?h.anchorRevision===0&&h.count===0:revision(h.anchorRevision)&&h.anchorRevision<=h.revision&&h.count===h.revision-h.anchorRevision+1);
}
// Read an immutable prefix. If compaction removed a requested revision, restart
// from the new anchor at most twice. No silent fallback after an integrity error.
export async function readDeltaLab({client,area,password,current,checkpoint=null}){
 check(validArea(area)&&typeof password==='string'&&password.length>=12,'Проверьте параметры Delta LAB');
 if(checkpoint){check(revision(checkpoint.revision)&&uuid.test(checkpoint.workspaceId),'Некорректная локальная ревизия');combineScope(current,checkpoint.snapshot,area);}
 for(let attempt=0;attempt<3;attempt++){
  try{
   const head=await client.head();check(validDeltaHead(head),'Некорректная цепочка Delta LAB');
   check(!checkpoint||head.revision>=checkpoint.revision,'Сервер вернул устаревшую ревизию');
   if(!head.revision)return {revision:0,anchorRevision:0,workspaceId:null,snapshot:null,compactedPastCheckpoint:false};
   // With an authenticated local checkpoint, validate the corresponding remote
   // entry, then fetch only its tail. A new or very stale device needs the anchor.
   const start=checkpoint&&checkpoint.revision>=head.anchorRevision?checkpoint.revision:head.anchorRevision;
   const first=await client.getRevision(start);
   check(first?.revision===start,'Отсутствует базовый снимок Delta LAB');
   let workspaceId,snapshot;
   if(start===head.anchorRevision){
    check(first.kind==='anchor','Отсутствует базовый снимок Delta LAB');
    const initial=await readPacket(first.envelope,password,area,start);
    workspaceId=initial.workspaceId;snapshot=initial.snapshot;
    check(!checkpoint||workspaceId===checkpoint.workspaceId,'Сервер заменил рабочее пространство');
    if(checkpoint?.revision===start)check(await scopeDigest(snapshot,area)===await scopeDigest(checkpoint.snapshot,area),'Содержимое ранее принятой ревизии изменилось');
   }else{
    check(checkpoint&&first.kind==='delta','Некорректная контрольная точка Delta LAB');
    workspaceId=checkpoint.workspaceId;snapshot=copy(checkpoint.snapshot);
    const packet=await decryptBackup(first.envelope,password);
    checkDeltaHeader(packet,{area,workspaceId,baseRevision:start-1});
    check(await scopeDigest(snapshot,area)===packet.resultHash,'Содержимое ранее принятой ревизии изменилось');
   }
   combineScope(current,snapshot,area);
   for(let rev=start+1;rev<=head.revision;rev++){
    const row=await client.getRevision(rev);
    check(row?.kind==='delta'&&row.revision===rev,'Пропущена или подменена ревизия изменений');
    snapshot=await applySyncDelta(snapshot,await decryptBackup(row.envelope,password),{area,workspaceId,baseRevision:rev-1,current});
   }
   return {revision:head.revision,anchorRevision:head.anchorRevision,workspaceId,snapshot,compactedPastCheckpoint:!!checkpoint&&checkpoint.revision<head.anchorRevision};
  }catch(e){if(e.status!==410||attempt===2)throw e;}
 }
}
// Compaction never takes its snapshot from local edits. Reconstruct the remote
// chain first, then submit a full anchor at the next revision under an explicit CAS.
export async function compactDeltaLab({client,area,password,current,checkpoint=null,expectedRevision,confirmed=false}){
 check(confirmed&&revision(expectedRevision),'Подтвердите компактизацию проверенной ревизии');
 const remote=await readDeltaLab({client,area,password,current,checkpoint});
 check(remote.revision===expectedRevision&&remote.anchorRevision<remote.revision,'История изменилась или уже уплотнена');
 check(!remote.compactedPastCheckpoint,'Локальная контрольная точка старше базового снимка; сначала согласуйте данные');
 check(syncUploadBytes(remote.snapshot,{area,workspaceId:remote.workspaceId,expectedRevision})<=defaultCloudflarePacketLimit,'Полный снимок превышает лимит компактизации; история сохранена');
 const envelope=await encryptBackup(packetPayload(remote.snapshot,area,remote.workspaceId,expectedRevision+1),password);
 const result=await client.compact(expectedRevision,envelope);
 check(result?.revision===expectedRevision+1,'Сервер не подтвердил компактизацию');
 return {revision:result.revision,workspaceId:remote.workspaceId,snapshot:remote.snapshot,envelope};
}

/* Explicit laboratory adapter for the existing prepare/preview/execute pipeline.
   The full envelopes returned to that pipeline are generated locally; only
   an initial anchor or encrypted delta travels across the network.
   No normal app callers: data access is injected by the synthetic test harness. */
export function deltaLabSyncAdapter({endpoint,area,token,password,readData,synthetic=false,acceptCompactedHistory=false,fetcher,timeoutMs}){
 check(synthetic===true&&typeof readData==='function','Интеграция Delta LAB только для синтетических данных');
 check(typeof password==='string'&&password.length>=12,'Проверьте пароль Delta LAB');
 endpoint=normalizeEndpoint(endpoint);
 const client=deltaLabClient(endpoint,area,token,{fetcher,timeoutMs});
 let baseline=null,pending=null,busy=false;
 async function exclusive(task){
  check(!busy,'Дождитесь завершения обмена Delta LAB');busy=true;
  try{return await task();}finally{busy=false;}
 }
 return {
  get:()=>exclusive(async()=>{
   baseline=null;pending=null;
   const current=await readData(),cp=getCheckpoint(current,area);
   let checkpoint=null;
   if(cp){
    check(cp.endpoint===endpoint&&revision(cp.revision)&&uuid.test(cp.workspaceId),'Этот контур связан с другим сервером или повреждён');
    const packet=await readPacket(cp.envelope,password,area,cp.revision);
    check(packet.workspaceId===cp.workspaceId,'Неверная общая ревизия');
    checkpoint={revision:cp.revision,workspaceId:cp.workspaceId,snapshot:packet.snapshot};
   }
   const remote=await readDeltaLab({client,area,password,current,checkpoint});
   check(!remote.compactedPastCheckpoint||acceptCompactedHistory,'История уплотнена после локальной ревизии. Нужно явное согласование с проверенным снимком.');
   const envelope=!remote.revision?null:checkpoint?.revision===remote.revision?cp.envelope:
    await encryptBackup(packetPayload(remote.snapshot,area,remote.workspaceId,remote.revision),password);
   baseline=remote;
   return {revision:remote.revision,envelope};
  }),
  put:(expectedRevision,envelope)=>exclusive(async()=>{
   check(baseline&&baseline.revision===expectedRevision,'Сначала прочитайте актуальную ревизию Delta LAB');
   const next=await readPacket(envelope,password,area,expectedRevision+1),current=await readData();
   combineScope(current,next.snapshot,area);
   check(!expectedRevision||baseline.workspaceId===next.workspaceId,'Неверное рабочее пространство Delta LAB');
   // A retry of the exact local envelope must reuse the same encrypted delta.
   if(pending){check(pending.expectedRevision===expectedRevision&&same(pending.envelope,envelope),'Предыдущая запись не согласована. Повторите чтение ревизии.');}
   else{
    let payload=envelope;
    if(expectedRevision){
     const estimate=syncDeltaEstimate(baseline.snapshot,next.snapshot,{area,workspaceId:next.workspaceId,baseRevision:expectedRevision});
     check(estimate.changedRecords>0,'Нет изменений; используйте получение без повторной записи');
     check(estimate.bytes<=defaultCloudflarePacketLimit,'Пакет изменений превышает лимит; данные не отправлены');
     const delta=await buildSyncDelta(baseline.snapshot,next.snapshot,{area,workspaceId:next.workspaceId,baseRevision:expectedRevision});
     await applySyncDelta(baseline.snapshot,delta,{area,workspaceId:next.workspaceId,baseRevision:expectedRevision,current});
     payload=await encryptBackup(delta,password);
    }else check(new TextEncoder().encode(JSON.stringify({expectedRevision,envelope})).length<=defaultCloudflarePacketLimit,'Первичный снимок превышает лимит; данные не отправлены');
    pending={expectedRevision,envelope:copy(envelope),payload,ack:null};
   }
   if(!pending.ack){
    const accepted=await (expectedRevision?client.append(expectedRevision,pending.payload):client.anchor(pending.payload));
    check(accepted?.revision===expectedRevision+1&&typeof accepted.replayed==='boolean','Сервер не подтвердил ожидаемую ревизию');
    pending.ack={revision:accepted.revision,envelope:copy(pending.envelope)};
   }
   return copy(pending.ack);
  })
 };
}

export async function prepareSync({area,endpoint,password,client,data}){
 endpoint=normalizeEndpoint(endpoint);
 check(validArea(area),'Выберите рабочую область');
 check(typeof password==='string'&&password.length>=12,'Пароль шифрования должен быть не короче 12 символов');
 const current=data||await db.dumpAll(),local=projectScope(current,area),checkpoint=getCheckpoint(current,area);
 if(checkpoint)check(checkpoint.endpoint===endpoint&&revision(checkpoint.revision)&&uuid.test(checkpoint.workspaceId),'Этот контур уже связан с другим сервером или повреждён');
 const remote=await client.get();
 check(Number.isSafeInteger(remote.revision)&&remote.revision>=0,'Некорректная ревизия');
 let base,remoteSnapshot,workspaceId;
 if(!remote.revision){
  check(!checkpoint&&remote.envelope===null,'Сервер потерял историю. Синхронизация остановлена.');
  workspaceId=globalThis.crypto.randomUUID();base=local;remoteSnapshot=local;
 }else{
  const p=await readPacket(remote.envelope,password,area,remote.revision);
  workspaceId=p.workspaceId;remoteSnapshot=p.snapshot;
  // Validate remote relationships before presenting it or accepting a checkpoint.
  combineScope(current,remoteSnapshot,area);
  if(checkpoint){
   check(checkpoint.workspaceId===workspaceId&&remote.revision>=checkpoint.revision,'Сервер заменён или вернул устаревшую ревизию');
   // The already authenticated remote packet is the checkpoint only when
   // revision AND exact encrypted envelope agree. Otherwise decrypt separately
   // to preserve rollback and same-revision tamper detection.
   const ancestor=remote.revision===checkpoint.revision&&same(checkpoint.envelope,remote.envelope)?p:await readPacket(checkpoint.envelope,password,area,checkpoint.revision);
   check(ancestor.workspaceId===workspaceId,'Неверная общая ревизия');
   if(remote.revision===checkpoint.revision)check(same(ancestor.snapshot,remoteSnapshot),'Содержимое ранее принятой ревизии изменилось');
   base=ancestor.snapshot;
  }else{
   check(emptyScope(local)||same(local,remoteSnapshot),'На устройстве уже есть отличающиеся данные. Первичное подключение разрешено только для пустого или совпадающего контура.');
   base=local;
  }
 }
 const draft=mergeScopes(base,local,remoteSnapshot,area);
 return {area,endpoint,workspaceId,revision:remote.revision,checkpoint,base,local,remote:remoteSnapshot,remoteEnvelope:remote.envelope,conflicts:draft.conflicts};
}
export function previewSync(current,plan,choices={}){
 check(same(projectScope(current,plan.area),plan.local)&&same(getCheckpoint(current,plan.area),plan.checkpoint),'Локальные данные изменились. Повторите предпросмотр.');
 const result=mergeScopes(plan.base,plan.local,plan.remote,plan.area,choices);
 if(result.conflicts.length)return {...result,counts:null};
 combineScope(current,result.snapshot,plan.area);
 return {...result,counts:counts(plan.local,result.snapshot)};
}
// Cooperative guard, not server-side revocation. An already transmitted PUT
// may commit even if the user locks the app or forgets the local credentials.
function guardSync(stillAllowed,remoteMayHaveCommitted=false){
 if(!stillAllowed())throw Object.assign(Error(remoteMayHaveCommitted?'Обмен остановлен. Сервер мог принять пакет; локальные изменения не применены. При повторном подключении сравните ревизии.':'Обмен остановлен до записи.'),{code:'sync-paused',remoteMayHaveCommitted});
}
export async function executeSync({plan,choices,password,client,confirmed=false,reuseRemote=false,stillAllowed=()=>true}){
 check(confirmed,'Подтвердите синхронизацию');
 guardSync(stillAllowed);
 const preview=previewSync(await db.dumpAll(),plan,choices);
 guardSync(stillAllowed);
 check(!preview.conflicts.length,'Сначала разрешите все конфликты');
 const pullOnly=reuseRemote&&plan.revision>0&&same(preview.snapshot,plan.remote)&&isEncryptedBackup(plan.remoteEnvelope);
 if(pullOnly&&plan.checkpoint?.revision===plan.revision&&same(plan.local,plan.remote)){
  // No network write and no rewrite of the potentially large encrypted checkpoint.
  const stores=[...new Set([...keysFor(plan.area),'meta'])];
  await db.transaction(stores,'readwrite',async s=>{
   guardSync(stillAllowed);
   const current=Object.fromEntries(await Promise.all(stores.map(async n=>[n,await s[n].getAll()])));
   const cp=getCheckpoint(current,plan.area);
   check(same(cp,plan.checkpoint)&&same(projectScope(current,plan.area),plan.local),'Локальные данные изменились. Повторите проверку.');
   guardSync(stillAllowed);await s.meta.put(successRecord(plan.area,cp));guardSync(stillAllowed);
  });
  return {revision:plan.revision,counts:preview.counts};
 }
 const nextRevision=pullOnly?plan.revision:plan.revision+1;
 check(revision(nextRevision),'Лимит ревизий');
 const envelope=pullOnly?plan.remoteEnvelope:await encryptBackup(packetPayload(preview.snapshot,plan.area,plan.workspaceId,nextRevision),password);
 // Recheck after expensive encryption; the transaction below checks again after CAS.
 guardSync(stillAllowed);
 previewSync(await db.dumpAll(),plan,choices);
 guardSync(stillAllowed);
 if(!pullOnly){
  let committed;
  try{committed=await client.put(plan.revision,envelope);}catch(e){guardSync(stillAllowed,true);throw e;}
  guardSync(stillAllowed,true);
  check(committed.revision===nextRevision&&same(committed.envelope,envelope),'Сервер не подтвердил запись ожидаемой ревизии');
 }
 try{
  return await db.transaction(names,'readwrite',async s=>{
   guardSync(stillAllowed,!pullOnly);
   const current=Object.fromEntries(await Promise.all(names.map(async n=>[n,await s[n].getAll()])));
   guardSync(stillAllowed,!pullOnly);
   const final=previewSync(current,plan,choices);
   check(!final.conflicts.length&&same(final.snapshot,preview.snapshot),'Изменился результат слияния');
   const data=combineScope(current,final.snapshot,plan.area);
   const cp={id:keyOf(plan.area),endpoint:plan.endpoint,workspaceId:plan.workspaceId,revision:nextRevision,envelope};
   data.meta=data.meta.filter(r=>r.id!==cp.id&&r.id!==statusKey(plan.area)).concat(cp,successRecord(plan.area,cp));
   // Delete changed keys first to avoid transient unique-index collisions. One atomic transaction.
   for(const n of [...new Set([...keysFor(plan.area),'meta'])]){
    guardSync(stillAllowed,!pullOnly);
    const a=byId(current[n]),b=byId(data[n]);
    for(const [id,row] of a)if(!b.has(id)||!same(row,b.get(id)))await s[n].delete(id);
    for(const [id,row] of b)if(!a.has(id)||!same(row,a.get(id)))await s[n].put(row);
   }
   guardSync(stillAllowed,!pullOnly);
   return {revision:nextRevision,counts:final.counts};
  });
 }catch(e){if(e?.code==='sync-paused')throw e;throw Error((pullOnly?'Локальная запись не завершилась.':'Сервер принял пакет, но локальная запись не завершилась.')+' Ваши данные не заменены этой операцией. Повторите синхронизацию; при конфликте проверьте обе версии.');}
}
// Automatic sync only for an already confirmed workspace; never auto-propagate deletions.
export async function syncPersonalArea({area,endpoint,password,client,stillAllowed=()=>true,initialize=false}){
 if(!initialize&&!await syncStatus(area))return {area,status:'setup'};
 if(!stillAllowed())return {area,status:'paused'};
 const plan=await prepareSync({area,endpoint,password,client});
 if(!stillAllowed())return {area,status:'paused'};
 if(!initialize&&!plan.checkpoint)return {area,status:'setup'};
 if(plan.conflicts.length)return {area,status:'conflict'};
 const current=await db.dumpAll(),preview=previewSync(current,plan,{});
 if(preview.conflicts.length||counts(plan.base,preview.snapshot).deleted||preview.counts.deleted)return {area,status:'review'};
 if(!stillAllowed())return {area,status:'paused'};
 try{
  const result=await executeSync({plan,choices:{},password,client,confirmed:true,reuseRemote:true,stillAllowed});
  return {area,status:'synced',revision:result.revision,changed:result.counts.added+result.counts.changed>0};
 }catch(e){if(e?.code==='sync-paused')return {area,status:'paused',...(e.remoteMayHaveCommitted?{reason:'remote-unconfirmed'}:{})};throw e;}
}
export async function syncStatus(area){
 check(validArea(area),'Выберите рабочую область');
 const cp=await db.get('meta',keyOf(area));
 return cp?{endpoint:cp.endpoint,revision:cp.revision}:null;
}
// Local read-only comparison, no relay calls and no upload of personal data.
export async function localSyncState({area,endpoint,password,data}){
 check(validArea(area),'Выберите рабочую область');
 const current=data||await db.dumpAll(),cp=getCheckpoint(current,area);
 if(!cp)return {area,status:'setup',revision:null,successfulAt:null};
 const record=current.meta.find(r=>r.id===statusKey(area));
 const successfulAt=record&&record.workspaceId===cp.workspaceId&&record.revision===cp.revision&&record.endpoint===cp.endpoint&&typeof record.successfulAt==='string'&&Number.isFinite(Date.parse(record.successfulAt))?record.successfulAt:null;
 const info={area,revision:cp.revision,successfulAt};
 try{
  check(cp.endpoint===normalizeEndpoint(endpoint),'Другой сервер');
  const packet=await readPacket(cp.envelope,password,area,cp.revision);
  check(packet.workspaceId===cp.workspaceId,'Неверная общая ревизия');
  return {...info,status:same(projectScope(current,area),packet.snapshot)?'clean':'pending'};
 }catch{return {...info,status:'review'};}
}
export async function disconnectSync(area,confirmed=false){
 check(validArea(area)&&confirmed,'Подтвердите отключение');
 await db.transaction(['meta'],'readwrite',async s=>{
  await s.meta.delete(keyOf(area));
  await s.meta.delete(statusKey(area));
 });
}
