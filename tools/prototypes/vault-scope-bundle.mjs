/* Synthetic, immutable three-key migration bundle. Not a live adapter.
 * Cross-scope activation and multi-DB updates are deliberately not implemented. */
import {SCHEMA} from '../../js/db.js';
import {BACKUP_VERSION,validateBackup} from '../../js/backup.js';
import {stageVaultLab,readVaultLab} from './local-vault.mjs';
const scopes=['school','coach','workspace'],names=Object.keys(SCHEMA),check=(ok,msg)=>{if(!ok)throw Error(msg);};
import {workRecordScope as workScope} from '../../js/work-scope.js';
const tableScope=n=>n==='meta'?'workspace':n.startsWith('coach')?'coach':'school';
const keysFor=scope=>[...names.filter(n=>n!=='workRecords'&&tableScope(n)===scope),'workRecords'];
const full=data=>{
 check(data&&Object.keys(data).length===names.length&&names.every(n=>Array.isArray(data[n])),'Требуется полная схема LAB');
 check(data.meta.every(r=>typeof r.id==='string'&&!r.id.startsWith('sync-checkpoint-')),'Контрольные точки sync не переносятся в LAB');
 return validateBackup({app:'teachapp',version:BACKUP_VERSION,data});
};
export function splitVaultScopesLab(data){
 const checked=full(structuredClone(data)),out=Object.fromEntries(scopes.map(s=>[s,Object.fromEntries(keysFor(s).map(n=>[n,[]]))]));
 for(const n of names){
  if(n==='workRecords'){for(const r of checked[n])out[workScope(r)][n].push(r);}
  else out[tableScope(n)][n]=checked[n];
 }
 return out;
}
function checkPart(data,scope){
 check(scopes.includes(scope)&&data&&Object.keys(data).length===keysFor(scope).length&&keysFor(scope).every(n=>Array.isArray(data[n])),'Неверный состав области LAB');
 check(data.workRecords.every(r=>workScope(r)===scope),'Запись другой области LAB');
 if(scope==='workspace')check(data.meta.every(r=>typeof r.id==='string'&&!r.id.startsWith('sync-checkpoint-')),'Контрольные точки sync не переносятся в LAB');
 return data;
}
export function joinVaultScopesLab(parts){
 check(parts&&Object.keys(parts).length===scopes.length&&scopes.every(s=>Object.hasOwn(parts,s)),'Требуются все области LAB');
 const data=Object.fromEntries(names.map(n=>[n,[]]));
 for(const s of scopes){const part=checkPart(parts[s],s);for(const n of keysFor(s))data[n].push(...part[n]);}
 // Cross-scope duplicated IDs, broken relationships and unknown types fail.
 return full(data);
}
function databases(dbs){
 check(dbs&&Object.keys(dbs).length===scopes.length&&scopes.every(s=>/^teachapp-vault-lab-[a-z0-9-]{1,80}$/.test(dbs[s]?.name)&&dbs[s].objectStoreNames.contains('sealed'))&&new Set(scopes.map(s=>dbs[s].name)).size===scopes.length,'Требуются три разные базы LAB');
}
function passwordsOf(passwords){
 check(passwords&&scopes.every(s=>typeof passwords[s]==='string'&&passwords[s].length>=12&&passwords[s].length<=1024)&&new Set(scopes.map(s=>passwords[s])).size===scopes.length,'Требуются три разных пароля LAB от 12 символов');
}
function empty(db){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('sealed','readonly'),req=tx.objectStore('sealed').count();
  tx.oncomplete=()=>resolve(req.result===0);tx.onabort=()=>reject(tx.error||Error('Чтение LAB отменено'));
 });
}
const bundleIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function readVaultScopeLab(db,{scope,password}){
 check(scopes.includes(scope),'Неизвестная область LAB');
 return validateVaultScopeResultLab(await readVaultLab(db,{scope,password}),scope);
}
export function validateVaultScopeResultLab(result,scope){
 check(scopes.includes(scope)&&result.scope===scope,'Неизвестная область LAB');
 const {bundleMeta,...part}=result.data;
 const row=bundleMeta?.[0];
 check(Array.isArray(bundleMeta)&&bundleMeta.length===1&&row&&Object.keys(row).sort().join('|')==='bundleId|id|scope'&&row.id==='bundle'&&row.scope===scope&&typeof row.bundleId==='string'&&bundleIdPattern.test(row.bundleId),'Повреждена связь областей LAB');
 return {bundleId:row.bundleId,scope,revision:result.revision,data:checkPart(part,scope)};
}
export async function readVaultScopeBundleLab(dbs,{passwords}){
 databases(dbs);passwordsOf(passwords);
 const entries=await Promise.all(scopes.map(s=>readVaultScopeLab(dbs[s],{scope:s,password:passwords[s]})));
 check(entries.every(x=>x.bundleId===entries[0].bundleId),'Области из разных наборов LAB');
 return {bundleId:entries[0].bundleId,revisions:Object.fromEntries(entries.map(x=>[x.scope,x.revision])),data:joinVaultScopesLab(Object.fromEntries(entries.map(x=>[x.scope,x.data])))};
}
const ordered=data=>Object.fromEntries(names.map(n=>[n,[...data[n]].sort((a,b)=>indexedDB.cmp(a.id,b.id))]));
export async function stageVaultScopeBundleLab(dbs,{passwords,data}){
 databases(dbs);passwordsOf(passwords);
 const expected=full(structuredClone(data)),parts=splitVaultScopesLab(expected);
 check((await Promise.all(scopes.map(s=>empty(dbs[s])))).every(Boolean),'Одна из баз LAB уже существует; перезапись запрещена');
 const bundleId=crypto.randomUUID();
 // No cross-database atomic transaction exists. A partial stage cannot be
 // opened as a complete bundle and is never activated or automatically erased.
 for(const s of scopes)await stageVaultLab(dbs[s],{scope:s,password:passwords[s],data:{...parts[s],bundleMeta:[{id:'bundle',bundleId,scope:s}]}});
 const result=await readVaultScopeBundleLab(dbs,{passwords});
 check(result.bundleId===bundleId&&JSON.stringify(ordered(result.data))===JSON.stringify(ordered(expected)),'Проверка полноты областей LAB не прошла');
 return {verified:true,bundleId,counts:Object.fromEntries(scopes.map(s=>[s,Object.values(parts[s]).reduce((sum,rows)=>sum+rows.length,0)]))};
}
