/* TeachApp 4.0 beta: explicit scoped revision synchronization. No implicit network traffic. */
import * as db from './db.js';
import {validateBackup,BACKUP_VERSION} from './backup.js';
import {defaultSettings,exemptionCovers,hasOsv} from './model.js';
import {gradeState,finalState} from './grade-history.js';
import {encryptBackup,decryptBackup,isEncryptedBackup,encryptedEnvelopeBytes} from './privacy.js';
import {DELTA_MAX_DATA,splitDeltaAnchor,joinDeltaAnchor,normalizeAnchorManifest,normalizeRotationHashes,deltaPartHash,migrationAnchorCommitment} from './delta-anchor.js';

export const syncAreas={school:'Школа',coach:'Тренер'};
const names=Object.keys(db.SCHEMA);
const school=names.filter(n=>n!=='meta'&&n!=='workRecords'&&!n.startsWith('coach'));
const coach=names.filter(n=>n.startsWith('coach'));
const settingsKeys=['year','trimesters','rules','holidays','healthGroups'];
const check=(ok,message)=>{if(!ok)throw Error(message);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const copy=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':plain(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
// Equality of JSON records, not their serialized strings. Keep canonical()
// solely for cryptographic digests so the wire format/hash stays unchanged.
export function syncValuesEqual(a,b){
 if(a===b)return true;
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b)){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(Object.hasOwn(a,i)!==Object.hasOwn(b,i)||!syncValuesEqual(a[i],b[i]))return false;
  return true;
 }
 const ak=Object.keys(a),bk=Object.keys(b);
 if(ak.length!==bk.length)return false;
 for(const k of ak)if(!Object.hasOwn(b,k)||!syncValuesEqual(a[k],b[k]))return false;
 return true;
}
const same=syncValuesEqual;
const sorted=rows=>copy(rows).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
const keyOf=area=>'sync-checkpoint-'+area;
// Small local-only metadata: excluded from backups and scoped cloud snapshots.
const statusKey=area=>'sync-checkpoint-status-'+area;
const successRecord=(area,cp)=>({id:statusKey(area),workspaceId:cp.workspaceId,revision:cp.revision,endpoint:cp.endpoint,successfulAt:new Date().toISOString()});
export const isSyncCheckpoint=r=>typeof r?.id==='string'&&r.id.startsWith('sync-checkpoint-');
const validArea=a=>Object.hasOwn(syncAreas,a);
const keysFor=area=>area==='school'?[...school,'workRecords','meta']:[...coach,'workRecords'];
function recordArea(r){
 if(['archive','gradeHistory','rubric','normAssignment','briefing','gymBoard','ktpMaterial','documentMaterial','studentGoal','schoolCompetition','teacherPortfolio','normRetake','ktpVersion','lessonAlternative','stationTemplate'].includes(r.kind))return 'school';
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
 check(p?.app==='teachapp-sync'&&p.version===1&&p.area===area&&uuid.test(p.workspaceId)&&p.revision===rev,'Несовместимый пакет синхронизации или подмена ревизии');
 if(Number.isInteger(p.backupVersion)&&p.backupVersion>BACKUP_VERSION)throw Object.assign(Error('Обновите TeachApp на всех устройствах: сервер содержит более новый формат данных. Локальные записи сохранены.'),{code:'newer-backup-format'});
 check([19,20,21,BACKUP_VERSION].includes(p.backupVersion),'Несовместимый пакет синхронизации');
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
// Enforce the actual UTF-8 byte limit even when Content-Length is missing.
// Reject malformed UTF-8 rather than silently replacing bytes in JSON strings.
export async function readSyncResponse(res,limit,{requireStream=false,label='сервера'}={}){
 const length=res.headers.get('content-length');
 check(length===null||length===undefined||(/^\d+$/.test(length)&&Number(length)<=limit),'Слишком большой или некорректный ответ '+label);
 let text='';
 if(res.body?.getReader){
  const reader=res.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw Error('Слишком большой ответ '+label);text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
  catch(error){try{await reader.cancel();}catch{}throw error;}
  finally{reader.releaseLock();}
 }else{
  check(!requireStream,'Пустой ответ '+label);
  if(typeof res.arrayBuffer==='function'){const bytes=await res.arrayBuffer();check(bytes.byteLength<=limit,'Слишком большой ответ '+label);text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  else{text=await res.text();check(new TextEncoder().encode(text).length<=limit,'Слишком большой ответ '+label);}
 }
 return JSON.parse(text);
}
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
   if(res.status===423)throw Object.assign(Error('Исходный сервер закрыт для записи на время переноса. Локальные данные сохранены.'),{code:'migration-frozen'});
   if(res.status===409)throw Error('На сервере появилась новая ревизия. Повторите предварительный просмотр.');
   if(res.status===401||res.status===403)throw Error('Сервер отказал в доступе. Проверьте ключ и область.');
   check(res.ok,'Сервер синхронизации недоступен (HTTP '+res.status+')');
   let result;
   try{result=await readSyncResponse(res,snapshotLimit);}
   catch(error){if(error?.name==='AbortError')throw Object.assign(Error('Временная ошибка чтения ответа сервера синхронизации'),{retryable:true});throw error;}
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
  packet.app===deltaApp&&packet.version===1&&[21,BACKUP_VERSION].includes(packet.backupVersion)&&
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
export function deltaLabClient(endpoint,area,token,{compactToken,rotateToken,sealToken,fetcher=globalThis.fetch,timeoutMs=15000}={}){
 endpoint=normalizeEndpoint(endpoint);
 check(validArea(area)&&['localhost','127.0.0.1','[::1]'].includes(new URL(endpoint).hostname)&&new URL(endpoint).protocol==='http:','Delta LAB доступен только на localhost');
 const validToken=t=>typeof t==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(t);
 check(validToken(token)&&(compactToken===undefined||validToken(compactToken)&&compactToken!==token)&&(rotateToken===undefined||validToken(rotateToken)&&rotateToken!==token&&rotateToken!==compactToken)&&(sealToken===undefined||validToken(sealToken)&&![token,compactToken,rotateToken].includes(sealToken)),'Проверьте отдельные тестовые ключи');
 const url=endpoint+'/v1/delta/'+area+'/';
 async function request(path,body,secret=token){
  const encoded=body===undefined?undefined:JSON.stringify(body);
  check(encoded===undefined||new TextEncoder().encode(encoded).length<=defaultCloudflarePacketLimit,'Пакет Delta LAB превышает лимит запроса');
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
   const res=await fetcher(url+path,{method:body?'PUT':'GET',headers:{Authorization:'Bearer '+secret,...(body?{'Content-Type':'application/json'}:{})},body:encoded,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:ctl.signal});
   if(!res.ok)throw Object.assign(Error(res.status===410?'История уплотнена, повторите чтение':'Delta LAB: HTTP '+res.status),{status:res.status});
   return await readSyncResponse(res,defaultCloudflarePacketLimit+4096,{requireStream:true,label:'Delta LAB'});
  }finally{clearTimeout(timer);}
 }
 async function writeAnchor(kind,expectedRevision,envelope,secret,rotation){
  const body={expectedRevision,envelope};
  if(kind!=='rotate'&&new TextEncoder().encode(JSON.stringify(body)).length<=defaultCloudflarePacketLimit)return request(kind,body,secret);
  const {uploadId,manifest,chunks}=await splitDeltaAnchor(envelope,{kind,expectedRevision,rotation}),path='multipart/'+kind+'/'+uploadId+'/';
  const begun=await request(path+'begin',{manifest},secret);
  if(begun?.revision===expectedRevision+1&&begun.replayed===true)return {revision:begun.revision,replayed:true};
  check(begun?.uploadId===uploadId&&Number.isSafeInteger(begun.expiresAt),'Сервер не подтвердил начало загрузки');
  for(let index=0;index<chunks.length;index++){
   const ack=await request(path+'part/'+index,{data:chunks[index]},secret);
   check(ack?.index===index&&typeof ack.replayed==='boolean','Сервер не подтвердил часть снимка');
  }
  const ack=await request(path+'commit',{},secret);
  check(ack?.revision===expectedRevision+1&&typeof ack.replayed==='boolean','Сервер не подтвердил снимок');
  return ack;
 }
 return {head:()=>request('head'),rollbackStatus:()=>request('rollback-status'),rollbackReceipt:()=>request('rollback-receipt'),sealRollback:migrationId=>{check(validToken(sealToken)&&typeof migrationId==='string'&&uuid.test(migrationId),'Нужен отдельный ключ закрытия назначения');return request('rollback-seal',{expectedRevision:1,migrationId},sealToken);},getRevision:async rev=>{
   check(revision(rev),'Некорректная ревизия');const row=await request('revision/'+rev);
   if(!Object.hasOwn(row,'multipart'))return row;
   const manifest=normalizeAnchorManifest(row.multipart);
   check(row.revision===rev&&row.kind==='anchor'&&manifest?.expectedRevision===rev-1,'Некорректный multipart снимок');
   const envelope=await joinDeltaAnchor(manifest,row.uploadId,async index=>{
    const part=await request('revision/'+rev+'/part/'+index);
    check(part?.revision===rev&&part.index===index,'Подмена части снимка');return part.data;
   });
   return {revision:rev,kind:'anchor',envelope};
  },
  anchor:envelope=>writeAnchor('anchor',0,envelope,token),
  append:(expectedRevision,envelope)=>request('append',{expectedRevision,envelope}),
  compact:(expectedRevision,envelope)=>{check(validToken(compactToken),'Нужен отдельный ключ компактизации');return writeAnchor('compact',expectedRevision,envelope,compactToken);},
  rotate:(expectedRevision,envelope,rotation)=>{check(validToken(rotateToken)&&normalizeRotationHashes(rotation),'Нужен отдельный ключ ротации');return writeAnchor('rotate',expectedRevision,envelope,rotateToken,rotation);}
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
 check(syncUploadBytes(remote.snapshot,{area,workspaceId:remote.workspaceId,expectedRevision})<=DELTA_MAX_DATA+1024,'Полный снимок превышает ограниченный лимит multipart; история сохранена');
 const envelope=await encryptBackup(packetPayload(remote.snapshot,area,remote.workspaceId,expectedRevision+1),password);
 check(envelope.data.length<=DELTA_MAX_DATA,'Полный снимок превышает лимит multipart; история сохранена');
 const result=await client.compact(expectedRevision,envelope);
 check(result?.revision===expectedRevision+1,'Сервер не подтвердил компактизацию');
 return {revision:result.revision,workspaceId:remote.workspaceId,snapshot:remote.snapshot,envelope};
}

// Rotation recovery is a separate encrypted file, never a normal sync profile.
// All secrets are generated locally; the server sees only hashes and ciphertext.
const randomSecret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const secretPattern=/^[a-f0-9]{64}$/;
function labEndpoint(endpoint){
 const value=normalizeEndpoint(endpoint),url=new URL(value);
 check(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Ротация только в Delta LAB');return value;
}
export async function prepareDeltaRotation({endpoint,client,area,password,current,checkpoint=null,expectedRevision,recoveryPassword,deviceCount=2,synthetic=false}){
 check(synthetic===true&&revision(expectedRevision)&&Number.isInteger(deviceCount)&&deviceCount>=1&&deviceCount<=8,'Ротация только для синтетического контура');
 endpoint=labEndpoint(endpoint);
 check(typeof recoveryPassword==='string'&&recoveryPassword.length>=12&&recoveryPassword!==password,'Нужен отдельный пароль файла восстановления');
 const remote=await readDeltaLab({client,area,password,current,checkpoint});
 check(remote.revision===expectedRevision&&!remote.compactedPastCheckpoint,'Ревизия изменилась или требует согласования');
 const newPassword=randomSecret(),readTokens=Array.from({length:deviceCount},randomSecret),compactToken=randomSecret();
 const envelope=await encryptBackup(packetPayload(remote.snapshot,area,remote.workspaceId,expectedRevision+1),newPassword);
 check(envelope.data.length<=DELTA_MAX_DATA,'Снимок превышает лимит ротации');
 const payload={app:'teachapp-delta-recovery',version:1,endpoint,area,workspaceId:remote.workspaceId,expectedRevision,digest:await scopeDigest(remote.snapshot,area),newPassword,readTokens,compactToken,envelope};
 const recovery=await encryptBackup(payload,recoveryPassword);
 return {area,expectedRevision,newRevision:expectedRevision+1,records:Object.values(remote.snapshot).reduce((n,rows)=>n+rows.length,0),recovery};
}
export async function openDeltaRecovery({recovery,recoveryPassword,endpoint,area,current,synthetic=false}){
 check(synthetic===true,'Восстановление только для Delta LAB');
 const p=await decryptBackup(recovery,recoveryPassword);
 check(exactFields(p,['app','version','endpoint','area','workspaceId','expectedRevision','digest','newPassword','readTokens','compactToken','envelope'])&&p.app==='teachapp-delta-recovery'&&p.version===1&&p.endpoint===labEndpoint(endpoint)&&p.area===area&&uuid.test(p.workspaceId)&&revision(p.expectedRevision)&&p.expectedRevision<Number.MAX_SAFE_INTEGER&&digestPattern.test(p.digest)&&typeof p.newPassword==='string'&&secretPattern.test(p.newPassword)&&Array.isArray(p.readTokens)&&p.readTokens.length>=1&&p.readTokens.length<=8&&p.readTokens.every(t=>typeof t==='string'&&secretPattern.test(t))&&typeof p.compactToken==='string'&&secretPattern.test(p.compactToken)&&new Set([p.newPassword,...p.readTokens,p.compactToken]).size===p.readTokens.length+2,'Неверный файл восстановления');
 const anchor=await readPacket(p.envelope,p.newPassword,area,p.expectedRevision+1);
 check(anchor.workspaceId===p.workspaceId&&await scopeDigest(anchor.snapshot,area)===p.digest,'Снимок восстановления не совпадает');
 combineScope(current,anchor.snapshot,area);
 const rotation=normalizeRotationHashes({readHashes:await Promise.all(p.readTokens.map(deltaPartHash)),compactHash:await deltaPartHash(p.compactToken)});
 check(rotation,'Некорректные новые ключи');
 return {...p,rotation,snapshot:anchor.snapshot};
}
// Accept only a verified recovery file read back by the caller. On a lost ACK,
// a retry checks the exact rotated anchor using the new credentials instead
// of rotating again. If it has been compacted away, stop for manual review.
export async function commitDeltaRotation({endpoint,client,area,password,current,recovery,recoveryPassword,confirmed=false,backupVerified=false,synthetic=false,fetcher}){
 check(confirmed&&backupVerified&&synthetic===true,'Подтвердите сохранённый файл восстановления и смену ключей');
 const p=await openDeltaRecovery({endpoint,area,current,recovery,recoveryPassword,synthetic});
 const next=deltaLabClient(endpoint,area,p.readTokens[0],{compactToken:p.compactToken,fetcher});
 let remote;
 try{remote=await readDeltaLab({client,area,password,current});}
 catch(e){if(e.status!==401)throw e;
  const row=await next.getRevision(p.expectedRevision+1);
  check(row.kind==='anchor'&&same(row.envelope,p.envelope),'Ротация не подтверждена');
  return {revision:row.revision,replayed:true};
 }
 check(remote.revision===p.expectedRevision&&remote.workspaceId===p.workspaceId&&await scopeDigest(remote.snapshot,area)===p.digest,'Сервер изменился; подготовьте новый файл восстановления');
 const result=await client.rotate(p.expectedRevision,p.envelope,p.rotation);
 check(result?.revision===p.expectedRevision+1,'Сервер не подтвердил смену ключей');
 const row=await next.getRevision(result.revision);
 check(row.kind==='anchor'&&same(row.envelope,p.envelope),'Новая ревизия не подтверждена');
 return {revision:result.revision,replayed:result.replayed};
}

// A device file deliberately contains only its own ordinary access token, not
// the owner recovery file, other device tokens or either privileged credential.
export async function createDeltaDeviceRecovery({endpoint,area,current,recovery,recoveryPassword,devicePassword,index,synthetic=false,fetcher}){
 const p=await openDeltaRecovery({endpoint,area,current,recovery,recoveryPassword,synthetic});
 check(Number.isInteger(index)&&index>=0&&index<p.readTokens.length&&typeof devicePassword==='string'&&devicePassword.length>=12&&devicePassword!==recoveryPassword&&devicePassword!==p.newPassword,'Выберите устройство и отдельный пароль');
 const token=p.readTokens[index],client=deltaLabClient(endpoint,area,token,{fetcher}),revision=p.expectedRevision+1;
 const anchor=await client.getRevision(revision);
 check(anchor.revision===revision&&anchor.kind==='anchor'&&same(anchor.envelope,p.envelope),'Новая контрольная точка не подтверждена');
 return encryptBackup({app:'teachapp-delta-device-recovery',version:1,endpoint:p.endpoint,area,workspaceId:p.workspaceId,anchorRevision:revision,digest:p.digest,anchorHash:await deltaPartHash(canonical(anchor.envelope)),password:p.newPassword,token},devicePassword);
}
export async function openDeltaDeviceRecovery({endpoint,area,file,devicePassword,synthetic=false}){
 check(synthetic===true&&validArea(area),'Восстановление только для Delta LAB');
 const p=await decryptBackup(file,devicePassword);
 check(exactFields(p,['app','version','endpoint','area','workspaceId','anchorRevision','digest','anchorHash','password','token'])&&p.app==='teachapp-delta-device-recovery'&&p.version===1&&p.endpoint===labEndpoint(endpoint)&&p.area===area&&uuid.test(p.workspaceId)&&revision(p.anchorRevision)&&p.anchorRevision>=2&&digestPattern.test(p.digest)&&digestPattern.test(p.anchorHash)&&typeof p.password==='string'&&secretPattern.test(p.password)&&typeof p.token==='string'&&secretPattern.test(p.token)&&p.password!==p.token,'Неверный файл устройства');
 return p;
}
// Rebind only the encrypted local ancestor, never the local business records
// or the remote head. An explicitly reviewed normal three-way merge follows.
export async function rebindDeltaDevice({endpoint,area,file,devicePassword,oldPassword,synthetic=false,confirmed=false,expectedRemoteRevision,expectedLocalRevision,acceptHistoricalBase=false,fetcher}){
 const p=await openDeltaDeviceRecovery({endpoint,area,file,devicePassword,synthetic}),current=await db.dumpAll(),cp=getCheckpoint(current,area);
 check(cp&&cp.endpoint===p.endpoint&&cp.workspaceId===p.workspaceId&&revision(cp.revision)&&cp.revision<p.anchorRevision,'Нет подходящей прежней контрольной точки; не заменяйте локальные данные');
 check(typeof oldPassword==='string'&&oldPassword!==p.password,'Нужен прежний пароль контрольной точки');
 const ancestor=await readPacket(cp.envelope,oldPassword,area,cp.revision);
 check(ancestor.workspaceId===p.workspaceId,'Контрольная точка другого пространства');
 combineScope(current,ancestor.snapshot,area);
 const historical=cp.revision<p.anchorRevision-1;
 if(!historical)check(await scopeDigest(ancestor.snapshot,area)===p.digest,'Прежняя контрольная точка не совпадает с проверенной ревизией ротации');
 const client=deltaLabClient(endpoint,area,p.token,{fetcher}),row=await client.getRevision(p.anchorRevision);
 check(row.revision===p.anchorRevision&&row.kind==='anchor'&&await deltaPartHash(canonical(row.envelope))===p.anchorHash,'Контрольная точка ротации отсутствует или подменена');
 const anchor=await readPacket(row.envelope,p.password,area,p.anchorRevision);
 check(anchor.workspaceId===p.workspaceId&&await scopeDigest(anchor.snapshot,area)===p.digest,'Снимок ротации не совпадает');
 const remote=await readDeltaLab({client,area,password:p.password,current,checkpoint:{revision:p.anchorRevision,workspaceId:p.workspaceId,snapshot:anchor.snapshot}});
 check(!remote.compactedPastCheckpoint&&remote.workspaceId===p.workspaceId,'История ротации уже удалена; требуется отдельное восстановление');
 const local=projectScope(current,area),draft=mergeScopes(ancestor.snapshot,local,remote.snapshot,area);
 if(!draft.conflicts.length)combineScope(current,draft.snapshot,area);
 const summary={area,localRevision:cp.revision,remoteRevision:remote.revision,historicalBase:historical,localChanges:counts(ancestor.snapshot,local),remoteChanges:counts(ancestor.snapshot,remote.snapshot),conflicts:draft.conflicts.length,requiresReview:true};
 if(!confirmed)return {...summary,status:'preview'};
 check(expectedRemoteRevision===remote.revision&&expectedLocalRevision===cp.revision,'Ревизии изменились; повторите проверку');
 check(!historical||acceptHistoricalBase===true,'Старая контрольная точка требует явного согласования: её история больше не доступна на сервере');
 const envelope=await encryptBackup(packetPayload(ancestor.snapshot,area,p.workspaceId,cp.revision),p.password);
 await db.transaction(names,'readwrite',async s=>{
  const latest=Object.fromEntries(await Promise.all(names.map(async n=>[n,await s[n].getAll()])));
  check(same(getCheckpoint(latest,area),cp)&&same(projectScope(latest,area),local),'Локальные данные изменились; повторите проверку');
  // Remove only stale success metadata. Retain old base/revision exactly;
  // explicit acceptCompactedHistory in the new adapter is still required.
  await s.meta.put({...cp,envelope});
  await s.meta.delete(statusKey(area));
 });
 return {...summary,status:'rebound'};
}

// One-way migration rehearsal. No production endpoints, source writes, ordinary
// profile changes or IndexedDB writes. The new workspace has its own revision
// sequence and encryption password, never a continuation of the old relay.
function migrationEndpoints(sourceEndpoint,destinationEndpoint,synthetic){
 check(synthetic===true,'Перенос доступен только в синтетическом Delta LAB');
 const source=labEndpoint(sourceEndpoint),destination=labEndpoint(destinationEndpoint);
 check(new URL(source).origin===source&&new URL(destination).origin===destination&&new URL(source).port&&new URL(destination).port&&source!==destination,'Нужны разные локальные серверы с явными портами');
 return {source,destination};
}
function migrationPasswords(sourcePassword,destinationPassword,backupPassword){
 check([sourcePassword,destinationPassword,backupPassword].every(p=>typeof p==='string'&&p.length>=12&&p.length<=1024)&&new Set([sourcePassword,destinationPassword,backupPassword]).size===3,'Используйте три разных пароля для источника, назначения и файла переноса');
}
const migrationRecordCount=s=>Object.values(s).reduce((n,a)=>n+a.length,0);
function migrationClients({sourceEndpoint,destinationEndpoint,sourceToken,destinationToken,area,protocolVersion=1,synthetic,fetcher}){
 const {source,destination}=migrationEndpoints(sourceEndpoint,destinationEndpoint,synthetic);
 check(validArea(area)&&sourceToken!==destinationToken&&(protocolVersion===1||protocolVersion===2),'Нужны разные ключи и корректный контур');
 // Only the read method is exposed internally for the source.
 const sourceRead=relayClient(source,area,sourceToken,{protocolVersion,fetcher}).get;
 const target=deltaLabClient(destination,area,destinationToken,{fetcher});
 return {source,destination,sourceRead,target};
}
export async function prepareDeltaMigration(args){
 const {area,current,sourcePassword,destinationPassword,backupPassword,protocolVersion=1}=args;
 migrationPasswords(sourcePassword,destinationPassword,backupPassword);
 const {source,destination,sourceRead,target}=migrationClients(args);
 const old=await sourceRead(),head=await target.head();
 check(validDeltaHead(head)&&head.revision===0,'Целевой контур должен быть пустым; перезапись запрещена');
 check(revision(old.revision)&&isEncryptedBackup(old.envelope),'Нет подтверждённого снимка источника');
 const packet=await readPacket(old.envelope,sourcePassword,area,old.revision);
 combineScope(current,packet.snapshot,area);
 const workspaceId=crypto.randomUUID(),digest=await scopeDigest(packet.snapshot,area);
 check(syncUploadBytes(packet.snapshot,{area,workspaceId,expectedRevision:0})<=DELTA_MAX_DATA+1024,'Снимок превышает лимит нового контура');
 const envelope=await encryptBackup(packetPayload(packet.snapshot,area,workspaceId,1),destinationPassword);
 check(envelope.data.length<=DELTA_MAX_DATA&&old.envelope.data.length<=DELTA_MAX_DATA,'Снимок превышает лимит переноса');
 const payload={app:'teachapp-delta-migration',version:1,source,destination,area,protocolVersion,sourceRevision:old.revision,sourceWorkspaceId:packet.workspaceId,workspaceId,digest,sourceEnvelope:old.envelope,envelope};
 const file=await encryptBackup(payload,backupPassword);
 return {area,migrationId:workspaceId,destinationAnchorCommitment:await migrationAnchorCommitment(envelope),sourceRevision:old.revision,destinationRevision:1,records:migrationRecordCount(packet.snapshot),encryptedBytes:envelope.data.length,file};
}
export async function openDeltaMigration({sourceEndpoint,destinationEndpoint,area,protocolVersion=1,current,file,sourcePassword,destinationPassword,backupPassword,synthetic=false}){
 const {source,destination}=migrationEndpoints(sourceEndpoint,destinationEndpoint,synthetic);
 migrationPasswords(sourcePassword,destinationPassword,backupPassword);
 const p=await decryptBackup(file,backupPassword);
 check(exactFields(p,['app','version','source','destination','area','protocolVersion','sourceRevision','sourceWorkspaceId','workspaceId','digest','sourceEnvelope','envelope'])&&p.app==='teachapp-delta-migration'&&p.version===1&&p.source===source&&p.destination===destination&&p.area===area&&p.protocolVersion===protocolVersion&&revision(p.sourceRevision)&&uuid.test(p.sourceWorkspaceId)&&uuid.test(p.workspaceId)&&p.workspaceId!==p.sourceWorkspaceId&&digestPattern.test(p.digest)&&isEncryptedBackup(p.sourceEnvelope)&&isEncryptedBackup(p.envelope)&&typeof p.sourceEnvelope.data==='string'&&p.sourceEnvelope.data.length<=DELTA_MAX_DATA&&typeof p.envelope.data==='string'&&p.envelope.data.length<=DELTA_MAX_DATA,'Неверный файл переноса или другой контур');
 const before=await readPacket(p.sourceEnvelope,sourcePassword,area,p.sourceRevision),after=await readPacket(p.envelope,destinationPassword,area,1);
 check(before.workspaceId===p.sourceWorkspaceId&&after.workspaceId===p.workspaceId&&await scopeDigest(before.snapshot,area)===p.digest&&await scopeDigest(after.snapshot,area)===p.digest&&same(before.snapshot,after.snapshot),'Содержимое снимков переноса не совпадает');
 combineScope(current,after.snapshot,area);
 return {...p,snapshot:after.snapshot};
}
// Device preflight is deliberately read-only. An offline/dirty device must be
// reconciled with the source before the rehearsal can be repeated.
export async function inspectDeltaMigrationDevice(args){
 const p=await openDeltaMigration(args),local=projectScope(args.current,p.area),cp=getCheckpoint(args.current,p.area);
 const result={area:p.area,sourceRevision:p.sourceRevision,localRevision:cp?.revision??null,localChanges:counts(p.snapshot,local)};
 if(!cp)return {...result,status:emptyScope(local)?'fresh-device':'missing-checkpoint',ready:false};
 if(cp.endpoint!==p.source||cp.workspaceId!==p.sourceWorkspaceId||!revision(cp.revision))return {...result,status:'different-workspace',ready:false};
 if(cp.revision!==p.sourceRevision)return {...result,status:'stale-checkpoint',ready:false};
 const before=await readPacket(cp.envelope,args.sourcePassword,p.area,cp.revision);
 if(before.workspaceId!==p.sourceWorkspaceId||await scopeDigest(before.snapshot,p.area)!==p.digest)return {...result,status:'checkpoint-mismatch',ready:false};
 const ready=await scopeDigest(local,p.area)===p.digest;
 return {...result,status:ready?'clean-source':'local-changes',ready};
}
// Separate loopback-only fence request. Normal devices can read status but never freeze.
async function migrationFenceRequest(source,area,token,path,fetcher,body,version=1){
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),15000);
 try{
  const res=await fetcher(source+'/v'+version+'/'+path+'/'+area,{method:body?'PUT':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:ctl.signal});
  check(res.ok,'Барьер записи LAB: HTTP '+res.status);
  const reader=res.body?.getReader();check(reader,'Нет ответа барьера записи');let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();throw Error('Слишком большой ответ барьера');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  const state=JSON.parse(text);
  check(exactFields(state,['revision','fence'])&&Number.isSafeInteger(state.revision)&&state.revision>=0&&(state.fence===null||exactFields(state.fence,['revision','migrationId'])&&revision(state.revision)&&state.fence.revision===state.revision&&typeof state.fence.migrationId==='string'&&uuid.test(state.fence.migrationId)),'Некорректный ответ барьера записи');
  if(body)check(path==='migration-rollback'?state.revision>=body.expectedRevision&&state.fence===null:state.revision===body.expectedRevision&&state.fence?.migrationId===body.migrationId,'Барьер не подтверждён');
  return state;
 }finally{clearTimeout(timer);}
}
export function deltaMigrationFenceClient({sourceEndpoint,destinationEndpoint,area,sourceToken,destinationToken,sourceFenceToken,protocolVersion=1,synthetic=false,fetcher=globalThis.fetch}){
 const {source}=migrationEndpoints(sourceEndpoint,destinationEndpoint,synthetic);
 check([1,2].includes(protocolVersion)&&validArea(area)&&typeof sourceFenceToken==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(sourceFenceToken)&&sourceFenceToken!==sourceToken&&sourceFenceToken!==destinationToken,'Нужен отдельный ключ блокировки источника LAB');
 const request=body=>migrationFenceRequest(source,area,sourceFenceToken,'migration-fence',fetcher,body);
 return {get:()=>request(),freeze:({expectedRevision,migrationId,confirmed,backupVerified,destinationAnchorCommitment})=>{
  check(confirmed===true&&backupVerified===true&&revision(expectedRevision)&&typeof migrationId==='string'&&uuid.test(migrationId),'Подтвердите резервную копию и необратимую блокировку LAB');
  check(destinationAnchorCommitment===undefined||typeof destinationAnchorCommitment==='string'&&/^(single|multipart):[a-f0-9]{64}$/.test(destinationAnchorCommitment),'Некорректная контрольная сумма назначения');
  return request({expectedRevision,migrationId:migrationId.toLowerCase(),...(destinationAnchorCommitment===undefined?{}:{destinationAnchorCommitment})});
 },resumeSource:({expectedRevision,migrationId,confirmed,backupVerified,allDevicesReconciled})=>{
  check(protocolVersion===1&&confirmed===true&&backupVerified===true&&allDevicesReconciled===true&&revision(expectedRevision)&&typeof migrationId==='string'&&uuid.test(migrationId),'Подтвердите проверенные копии и возврат всех устройств');
  return migrationFenceRequest(source,area,sourceFenceToken,'migration-rollback',fetcher,{expectedRevision,migrationId:migrationId.toLowerCase()});
 },resumeCloudflareSource:({expectedRevision,migrationId,confirmed,backupVerified,allDevicesReconciled,receipt})=>{
  check(confirmed===true&&backupVerified===true&&allDevicesReconciled===true&&revision(expectedRevision)&&typeof migrationId==='string'&&uuid.test(migrationId)&&plain(receipt),'Подтвердите возврат всех устройств и подписанную квитанцию закрытия');
  return migrationFenceRequest(source,area,sourceFenceToken,'migration-rollback',fetcher,{expectedRevision,migrationId:migrationId.toLowerCase(),receipt});
 }};
}
export async function deltaMigrationFenceStatus({sourceEndpoint,destinationEndpoint,area,sourceToken,protocolVersion=1,synthetic=false,fetcher=globalThis.fetch}){
 const {source}=migrationEndpoints(sourceEndpoint,destinationEndpoint,synthetic);
 check([1,2].includes(protocolVersion)&&validArea(area)&&typeof sourceToken==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(sourceToken),'Нужен ключ исходного контура LAB');
 return migrationFenceRequest(source,area,sourceToken,'migration-fence-status',fetcher,undefined,protocolVersion);
}
export async function commitDeltaMigration(args){
 check(args.confirmed===true&&args.backupVerified===true&&args.sourceFrozen===true,'Подтвердите проверенный файл и остановку записи на всех исходных устройствах');
 const p=await openDeltaMigration(args);
 const {sourceRead,target}=migrationClients(args);
 const fenced=args.sourceFenceToken!==undefined||args.sourceFenceId!==undefined;
 const fenceClient=fenced?deltaMigrationFenceClient(args):null;
 if(fenced)check(args.sourceFenceId===p.workspaceId,'ID барьера должен совпадать с ID нового пространства из проверенного файла');
 const verifyFence=async()=>{if(!fenced)return;const state=await fenceClient.get();check(state.revision===p.sourceRevision&&state.fence?.migrationId===args.sourceFenceId.toLowerCase(),'Источник не заблокирован на ревизии файла переноса');};
 await verifyFence();
 const before=await sourceRead(),h=await target.head();
 check((await target.rollbackStatus()).seal===null,'Назначение необратимо закрыто для отката');
 check(validDeltaHead(h),'Некорректная история назначения');
 const sourceMatches=r=>r.revision===p.sourceRevision&&same(r.envelope,p.sourceEnvelope);
 let replayed=false;
 if(h.revision===0){
  check(sourceMatches(before),'Источник изменился; подготовьте новый файл, целевой контур не изменён');
  const ack=await target.anchor(p.envelope);
  check(ack?.revision===1&&typeof ack.replayed==='boolean','Запись назначения не подтверждена; сравните ревизии');
  replayed=ack.replayed;
 }else{
  check(h.revision===1&&h.anchorRevision===1&&h.count===1,'Целевой контур уже используется; перезапись запрещена');
  const existing=await target.getRevision(1);
  check(existing.revision===1&&existing.kind==='anchor'&&same(existing.envelope,p.envelope),'Целевой контур содержит другой снимок; перезапись запрещена');
  replayed=true;
 }
 const row=await target.getRevision(1),remote=await readDeltaLab({client:target,area:p.area,password:args.destinationPassword,current:args.current});
 check(row.revision===1&&row.kind==='anchor'&&same(row.envelope,p.envelope)&&remote.revision===1&&remote.workspaceId===p.workspaceId&&await scopeDigest(remote.snapshot,p.area)===p.digest&&same(remote.snapshot,p.snapshot),'Назначение изменилось; переход запрещён');
 const after=await sourceRead();
 await verifyFence();
 check((await target.rollbackStatus()).seal===null,'Назначение необратимо закрыто для отката');
 // Client-side confirmation cannot actually freeze a legacy server. A late
 // source write leaves a verified *copy*, not permission to change devices.
 const unchanged=sourceMatches(before)&&sourceMatches(after);
 return {area:p.area,sourceRevision:p.sourceRevision,observedSourceRevision:after.revision,destinationRevision:1,replayed,status:unchanged?(fenced?'verified-fenced-copy':'verified-copy'):'source-changed',cutoverAllowed:false,requiresManualCutover:true};
}

// Local-only Delta LAB binding and checkpoint are committed together. Credentials
// stay in the operator's encrypted files; never change the ordinary TAP1/TAD2 profile.
const migrationBindingKey=area=>'sync-checkpoint-migration-'+area;
const migrationBinding=(data,area)=>data.meta.find(r=>r.id===migrationBindingKey(area))??null;
const labAdapters=new WeakMap();
function migrationGuardError(){return Object.assign(Error('Контур привязан к экспериментальному переносу Delta LAB. Обычный обмен запрещён; используйте проверенный файл переноса и согласованный возврат.'),{code:'migration-binding'});}
function bindingMatches(binding,cp,area){
 return binding?.protocol==='delta-lab-v1'&&[1,2].includes(binding.sourceProtocolVersion)&&binding.area===area&&typeof binding.migrationId==='string'&&uuid.test(binding.migrationId)&&binding.destinationWorkspaceId===binding.migrationId&&cp&&typeof binding.destinationEndpoint==='string'&&cp.endpoint===binding.destinationEndpoint&&cp.workspaceId===binding.destinationWorkspaceId&&revision(cp.revision)&&cp.revision>=binding.destinationRevision&&binding.destinationRevision===1;
}
function guardBinding(data,area,endpoint,client){
 const binding=migrationBinding(data,area);if(!binding)return null;
 const adapter=labAdapters.get(client),cp=getCheckpoint(data,area);
 if(!adapter||adapter.area!==area||adapter.endpoint!==endpoint||!bindingMatches(binding,cp,area)||cp.endpoint!==endpoint)throw migrationGuardError();
 return binding;
}
// Read-only local metadata; no token, password, encrypted payload or endpoint exposed.
export async function migrationBindingStatus(area,data){
 check(validArea(area),'Выберите рабочую область');const current=data||{meta:await db.getAll('meta')},binding=migrationBinding(current,area);
 if(!binding)return {area,status:'none'};
 const cp=getCheckpoint(current,area);
 return {area,status:bindingMatches(binding,cp,area)?'lab-bound':'review',revision:revision(cp?.revision)?cp.revision:null};
}
export async function cutoverDeltaMigrationDevice(args){
 check(args.synthetic===true,'Переключение доступно только для Delta LAB');
 check(args.sourceFenceToken===undefined,'Не передавайте административный ключ устройству');
 const current=await db.dumpAll(),p=await openDeltaMigration({...args,current}),{sourceRead,target}=migrationClients(args);
 const cp=getCheckpoint(current,p.area),local=projectScope(current,p.area);
 const binding={id:migrationBindingKey(p.area),protocol:'delta-lab-v1',sourceProtocolVersion:p.protocolVersion,area:p.area,migrationId:p.workspaceId,sourceEndpoint:p.source,sourceWorkspaceId:p.sourceWorkspaceId,sourceRevision:p.sourceRevision,destinationEndpoint:p.destination,destinationWorkspaceId:p.workspaceId,destinationRevision:1,digest:p.digest};
 const prior=current.meta.find(r=>r.id===binding.id)??null;
 const next={id:keyOf(p.area),endpoint:p.destination,workspaceId:p.workspaceId,revision:1,envelope:p.envelope};
 const replay=prior!==null;
 if(replay)check(same(prior,binding)&&same(cp,next),'Устройство уже переключено или контрольная точка изменилась; повторное переключение запрещено');
 else{
  check(cp&&cp.endpoint===p.source&&cp.workspaceId===p.sourceWorkspaceId&&cp.revision===p.sourceRevision,'Исходная контрольная точка отсутствует или устарела');
  const ancestor=await readPacket(cp.envelope,args.sourcePassword,p.area,cp.revision);
  check(ancestor.workspaceId===p.sourceWorkspaceId&&same(ancestor.snapshot,p.snapshot),'Исходная контрольная точка не совпадает с файлом переноса');
 }
 check(same(local,p.snapshot),'Локальные изменения не согласованы; переключение запрещено');
 const verifySource=async()=>{
  const f=await deltaMigrationFenceStatus(args),source=await sourceRead();
  check(f.revision===p.sourceRevision&&f.fence?.migrationId===p.workspaceId&&source.revision===p.sourceRevision&&same(source.envelope,p.sourceEnvelope),'Нет подтверждённого барьера для этого файла переноса');
 };
 const verifyTarget=async()=>{
  const status=await target.rollbackStatus();check(status.revision===1&&status.seal===null,'Назначение закрыто для отката или уже изменилось');
  const h=await target.head();
  check(validDeltaHead(h)&&h.revision===1&&h.anchorRevision===1&&h.count===1,'Целевой контур должен оставаться на начальной ревизии до переключения');
  const row=await target.getRevision(1);
  check(row.revision===1&&row.kind==='anchor'&&same(row.envelope,p.envelope),'Целевая контрольная точка не совпадает с файлом');
 };
 await verifySource();await verifyTarget();
 const summary={area:p.area,migrationId:p.workspaceId,sourceRevision:p.sourceRevision,destinationRevision:1,replayed:replay};
 if(args.confirmed!==true)return {...summary,status:'cutover-preview'};
 check(args.backupVerified===true&&args.expectedMigrationId===p.workspaceId&&args.expectedSourceRevision===p.sourceRevision,'Подтвердите проверенную копию и точную ревизию предпросмотра');
 // Network verification outside IndexedDB. Even if destination advances after
 // this check, the authenticated revision-1 ancestor is retained locally.
 await verifySource();await verifyTarget();
 await db.transaction(names,'readwrite',async s=>{
  const latest=Object.fromEntries(await Promise.all(names.map(async n=>[n,await s[n].getAll()])));
  check(same(getCheckpoint(latest,p.area),cp)&&same(projectScope(latest,p.area),local)&&same(latest.meta.find(r=>r.id===binding.id)??null,prior),'Локальные данные изменились; повторите предпросмотр');
  if(!replay){
   await s.meta.put(next);await s.meta.put(binding);await s.meta.delete(statusKey(p.area));
  }
 });
 return {...summary,status:'cutover-completed'};
}

// Conservative rollback: only the original, unused destination anchor can
// be permanently sealed. No deleting records or rolling back a live ledger.
async function verifyRollbackDestination(p,target,requireSeal){
 const h=await target.head(),status=await target.rollbackStatus();
 check(validDeltaHead(h)&&h.revision===1&&h.anchorRevision===1&&h.count===1&&status.revision===1,'Назначение уже использовалось; автоматический откат запрещён');
 const row=await target.getRevision(1);
 check(row.revision===1&&row.kind==='anchor'&&same(row.envelope,p.envelope),'Якорь назначения не совпадает с файлом');
 const expected={migrationId:p.workspaceId,revision:1};
 check(requireSeal?same(status.seal,expected):status.seal===null||same(status.seal,expected),'Нет подходящего необратимого барьера назначения');
 return status;
}
async function verifyRollbackSource(p,args,sourceRead){
 const f=await deltaMigrationFenceStatus(args),source=await sourceRead();
 check(f.revision===p.sourceRevision&&f.fence?.migrationId===p.workspaceId&&source.revision===p.sourceRevision&&same(source.envelope,p.sourceEnvelope),'Источник больше не заблокирован на исходном снимке');
}
export async function sealDeltaMigrationRollback(args){
 const p=await openDeltaMigration(args),{sourceRead}=migrationClients(args);
 check(args.confirmed===true&&args.backupVerified===true&&args.expectedMigrationId===p.workspaceId&&args.expectedSourceRevision===p.sourceRevision,'Подтвердите проверенный файл и точную ревизию отката');
 check(typeof args.destinationSealToken==='string'&&![args.sourceToken,args.destinationToken,args.sourceFenceToken].includes(args.destinationSealToken),'Нужен отдельный ключ закрытия назначения');
 const target=deltaLabClient(p.destination,p.area,args.destinationToken,{sealToken:args.destinationSealToken,fetcher:args.fetcher});
 await verifyRollbackSource(p,args,sourceRead);
 const before=await verifyRollbackDestination(p,target,false);
 const ack=await target.sealRollback(p.workspaceId);
 check(ack.revision===1&&same(ack.seal,{migrationId:p.workspaceId,revision:1}),'Закрытие назначения не подтверждено');
 await verifyRollbackDestination(p,target,true);
 return {area:p.area,migrationId:p.workspaceId,sourceRevision:p.sourceRevision,destinationRevision:1,replayed:before.seal!==null,status:'rollback-sealed'};
}
export async function rollbackDeltaMigrationDevice(args){
 check(args.synthetic===true&&args.sourceFenceToken===undefined&&args.destinationSealToken===undefined,'Возврат устройства только в LAB, без административных ключей');
 const current=await db.dumpAll(),p=await openDeltaMigration({...args,current}),{sourceRead,target}=migrationClients(args);
 const cp=getCheckpoint(current,p.area),local=projectScope(current,p.area),bindingId=migrationBindingKey(p.area);
 const binding=current.meta.find(r=>r.id===bindingId)??null;
 const expectedBinding={id:bindingId,protocol:'delta-lab-v1',sourceProtocolVersion:p.protocolVersion,area:p.area,migrationId:p.workspaceId,sourceEndpoint:p.source,sourceWorkspaceId:p.sourceWorkspaceId,sourceRevision:p.sourceRevision,destinationEndpoint:p.destination,destinationWorkspaceId:p.workspaceId,destinationRevision:1,digest:p.digest};
 const next={id:keyOf(p.area),endpoint:p.source,workspaceId:p.sourceWorkspaceId,revision:p.sourceRevision,envelope:p.sourceEnvelope};
 const replay=binding===null;
 if(replay)check(same(cp,next),'Нет точной исходной контрольной точки; возврат требует отдельной проверки');
 else check(same(binding,expectedBinding)&&same(cp,{id:keyOf(p.area),endpoint:p.destination,workspaceId:p.workspaceId,revision:1,envelope:p.envelope}),'Назначение или контрольная точка изменились; возврат запрещён');
 check(same(local,p.snapshot),'Есть несогласованные локальные изменения; сохраните их и не откатывайте устройство автоматически');
 await verifyRollbackSource(p,args,sourceRead);await verifyRollbackDestination(p,target,true);
 const summary={area:p.area,migrationId:p.workspaceId,sourceRevision:p.sourceRevision,destinationRevision:1,replayed:replay};
 if(args.confirmed!==true)return {...summary,status:'rollback-preview'};
 check(args.backupVerified===true&&args.expectedMigrationId===p.workspaceId&&args.expectedSourceRevision===p.sourceRevision,'Подтвердите проверенный файл и точную ревизию');
 await db.transaction(names,'readwrite',async s=>{
  const latest=Object.fromEntries(await Promise.all(names.map(async n=>[n,await s[n].getAll()])));
  check(same(getCheckpoint(latest,p.area),cp)&&same(projectScope(latest,p.area),local)&&same(latest.meta.find(r=>r.id===bindingId)??null,binding),'Локальные данные изменились; повторите предпросмотр');
  if(!replay){await s.meta.put(next);await s.meta.delete(bindingId);await s.meta.delete(statusKey(p.area));}
 });
 return {...summary,status:'rollback-completed'};
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
 const adapter={
  get:()=>exclusive(async()=>{
   baseline=null;pending=null;
   const current=await readData(),cp=getCheckpoint(current,area);
   guardBinding(current,area,endpoint,adapter);
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
   guardBinding(current,area,endpoint,adapter);
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
    }else check(envelope.data.length<=DELTA_MAX_DATA,'Первичный снимок превышает лимит multipart; данные не отправлены');
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
 labAdapters.set(adapter,{area,endpoint});return adapter;
}

export async function prepareSync({area,endpoint,password,client,data}){
 endpoint=normalizeEndpoint(endpoint);
 check(validArea(area),'Выберите рабочую область');
 check(typeof password==='string'&&password.length>=12,'Пароль шифрования должен быть не короче 12 символов');
 const current=data||await db.dumpAll(),local=projectScope(current,area),checkpoint=getCheckpoint(current,area);
 if(checkpoint)check(checkpoint.endpoint===endpoint&&revision(checkpoint.revision)&&uuid.test(checkpoint.workspaceId),'Этот контур уже связан с другим сервером или повреждён');
 const binding=guardBinding(current,area,endpoint,client);
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
 return {area,endpoint,workspaceId,revision:remote.revision,checkpoint,...(binding?{migrationBinding:binding}:{}),base,local,remote:remoteSnapshot,remoteEnvelope:remote.envelope,conflicts:draft.conflicts};
}
export function previewSync(current,plan,choices={}){
 if(!same(migrationBinding(current,plan.area),plan.migrationBinding??null))throw migrationGuardError();
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
 const initial=await db.dumpAll();guardBinding(initial,plan.area,plan.endpoint,client);
 const preview=previewSync(initial,plan,choices);
 guardSync(stillAllowed);
 check(!preview.conflicts.length,'Сначала разрешите все конфликты');
 const pullOnly=reuseRemote&&plan.revision>0&&same(preview.snapshot,plan.remote)&&isEncryptedBackup(plan.remoteEnvelope);
 if(pullOnly&&plan.checkpoint?.revision===plan.revision&&same(plan.local,plan.remote)){
  // No network write and no rewrite of the potentially large encrypted checkpoint.
  const stores=[...new Set([...keysFor(plan.area),'meta'])];
  await db.transaction(stores,'readwrite',async s=>{
   guardSync(stillAllowed);
   const current=Object.fromEntries(await Promise.all(stores.map(async n=>[n,await s[n].getAll()])));
   guardBinding(current,plan.area,plan.endpoint,client);
   if(!same(migrationBinding(current,plan.area),plan.migrationBinding??null))throw migrationGuardError();
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
 const beforeWrite=await db.dumpAll();guardBinding(beforeWrite,plan.area,plan.endpoint,client);previewSync(beforeWrite,plan,choices);
 guardSync(stillAllowed);
 if(!pullOnly){
  let committed;
  try{committed=await client.put(plan.revision,envelope);}catch(e){guardSync(stillAllowed,true);if(e?.retryable||e instanceof SyntaxError||e instanceof TypeError)throw Object.assign(Error(e.message),{retryable:e.retryable===true,remoteMayHaveCommitted:true});throw e;}
  guardSync(stillAllowed,true);
  if(committed?.revision!==nextRevision||!same(committed.envelope,envelope))throw Object.assign(Error('Сервер не подтвердил запись ожидаемой ревизии'),{remoteMayHaveCommitted:true});
 }
 try{
  return await db.transaction(names,'readwrite',async s=>{
   guardSync(stillAllowed,!pullOnly);
   const current=Object.fromEntries(await Promise.all(names.map(async n=>[n,await s[n].getAll()])));
   guardSync(stillAllowed,!pullOnly);
   guardBinding(current,plan.area,plan.endpoint,client);
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
 const binding=await migrationBindingStatus(area);if(binding.status!=='none')return {area,status:'review',reason:'migration-binding'};
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
 if(migrationBinding(current,area))return {area,status:'review',reason:'migration-binding',revision:revision(cp?.revision)?cp.revision:null,successfulAt:null};
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
  if(await s.meta.get(migrationBindingKey(area)))throw migrationGuardError();
  await s.meta.delete(keyOf(area));
  await s.meta.delete(statusKey(area));
 });
}
