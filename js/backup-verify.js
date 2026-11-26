/* Verify a saved encrypted portable backup without writing any records.
 * Never returns plaintext, row IDs, file names, or secret material. */
import {SCHEMA} from './db.js';
import {BACKUP_VERSION,validateBackup} from './backup.js';
import {decryptBackup,isEncryptedBackup} from './privacy.js';
const names=Object.keys(SCHEMA);
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const plain=v=>v&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
// Parsed backup is ordinary JSON. Fail closed on unsupported live values
// instead of silently equating e.g. a Date with an empty object.
function sameJson(a,b,depth=0){
 if(depth>100)return false;
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return Object.is(a,b)&&(a===null||['string','boolean','number'].includes(typeof a))&&(typeof a!=='number'||Number.isFinite(a));
 if(Array.isArray(a)||Array.isArray(b)){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||Object.keys(a).length!==a.length||Object.keys(b).length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(!Object.hasOwn(a,i)||!Object.hasOwn(b,i)||!sameJson(a[i],b[i],depth+1))return false;
  return true;
 }
 if(!plain(a)||!plain(b)||Object.getOwnPropertySymbols(a).length||Object.getOwnPropertySymbols(b).length)return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&sameJson(a[k],b[k],depth+1));
}
function portable(payload){
 check(payload&&!Object.hasOwn(payload,'scope'),'Требуется полная, не выборочная копия');
 const data=validateBackup(payload);
 check(data.meta.every(r=>!r.id.startsWith('sync-checkpoint-')),'Копия содержит локальные контрольные точки');
 return data;
}
function compareRow(name,a,b){
 if(name==='meta'&&a.id==='settings'&&b.id==='settings'){
  // Export confirmation itself updates precisely these two fields.
  const {lastBackupAt:ignoredA,backupReminderAfter:ignoredB,...x}=a;
  const {lastBackupAt:ignoredC,backupReminderAfter:ignoredD,...y}=b;
  return sameJson(x,y);
 }
 return sameJson(a,b);
}
export async function verifyProtectedBackup(envelope,password,{load,active=()=>true}={}){
 check(isEncryptedBackup(envelope),'Выберите зашифрованную резервную копию TeachApp');
 const payload=await decryptBackup(envelope,password);check(active(),'Проверка отменена');
 const saved=portable(payload),records=names.reduce((n,k)=>n+saved[k].length,0);
 if(payload.version!==BACKUP_VERSION)return {verified:true,version:payload.version,records,comparison:'older-format',differentTables:null,restorePerformed:false};
 check(typeof load==='function','Требуется текущий снимок');
 const live=await load();check(active(),'Проверка отменена');
 check(live?.version===BACKUP_VERSION,'Текущая версия базы изменилась');
 const current=portable(live);let differentTables=0;
 for(const name of names){
  const rows=new Map(current[name].map(row=>[row.id,row]));
  if(rows.size!==saved[name].length||saved[name].some(row=>!rows.has(row.id)||!compareRow(name,row,rows.get(row.id))))differentTables++;
 }
 return {verified:true,version:payload.version,records,comparison:differentTables?'different':'matches',differentTables,restorePerformed:false};
}
