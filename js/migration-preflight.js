/* Read-only local migration screening, not activation or a backup. */
import {SCHEMA,readBoundedSnapshot} from './db.js';
import {BACKUP_VERSION,validateBackup} from './backup.js';
import {verifyVaultLayoutRoundtrip} from './vault-layout.js';
const names=Object.keys(SCHEMA),encoder=new TextEncoder();
export const migrationLabLimits=Object.freeze({records:10000,bytes:64*1024*1024});
function jsonSafe(value,depth=0,stack=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return true;
 if(depth>=100||!value||typeof value!=='object'||stack.has(value)||Object.getOwnPropertySymbols(value).length)return false;
 if(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
 if(Array.isArray(value)&&Object.keys(value).length!==value.length)return false;
 stack.add(value);
 const keys=Array.isArray(value)?Array.from({length:value.length},(_,i)=>String(i)):Object.keys(value);
 for(const k of keys){const d=Object.getOwnPropertyDescriptor(value,k);if(!d||!Object.hasOwn(d,'value')||!jsonSafe(d.value,depth+1,stack)){stack.delete(value);return false;}}
 stack.delete(value);return true;
}
export function inspectMigrationSnapshot(raw,{estimate=null,secure=false,webLocks=false}={}){
 const blockers=[],warnings=[];
 if(!raw||typeof raw!=='object'||Object.keys(raw).length!==names.length||names.some(n=>!Array.isArray(raw[n])))return {records:null,bytes:null,checkpoints:null,blockers:['schema'],warnings:[],activationAllowed:false};
 const checkpoints=raw.meta.filter(r=>typeof r?.id==='string'&&r.id.startsWith('sync-checkpoint-'));
 if(checkpoints.length){warnings.push('device-checkpoints');blockers.push('unmigrated-device-checkpoints');}
 if(checkpoints.some(r=>r.id.startsWith('sync-checkpoint-migration-')))blockers.push('active-delta-migration');
 const data={...raw,meta:raw.meta.filter(r=>!checkpoints.includes(r))};
 const records=names.reduce((sum,n)=>sum+data[n].length,0);
 if(records+checkpoints.length>migrationLabLimits.records)blockers.push('record-limit');
 let bytes=0;
 for(const n of names)for(const row of data[n]){
  if(!jsonSafe(row)){if(!blockers.includes('non-json'))blockers.push('non-json');continue;}
  bytes+=encoder.encode(JSON.stringify(row)).byteLength;
 }
 if(bytes>migrationLabLimits.bytes)blockers.push('byte-limit');
 try{validateBackup({app:'teachapp',version:BACKUP_VERSION,data});}catch{blockers.push('integrity');}
 // Use the exact school-v2 layout from the migration rehearsal, including
 // owner settings and archived grade history. No keys or records leave here.
 if(!blockers.some(b=>['record-limit','byte-limit','non-json','integrity'].includes(b))){
  try{verifyVaultLayoutRoundtrip(data);}catch{blockers.push('partition-roundtrip');}
 }
 if(!secure)blockers.push('crypto-unavailable');
 if(!webLocks)blockers.push('locks-unavailable');
 const free=estimate&&Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage)&&estimate.usage>=0&&estimate.quota>=estimate.usage?estimate.quota-estimate.usage:null;
 // Rough screening only: simultaneous source, encrypted and rollback copies
 // incur implementation/browser overhead that cannot be predicted here.
 if(free===null)warnings.push('quota-unknown');
 else if(free<bytes*2)warnings.push('low-estimated-space');
 return {records,bytes,checkpoints:checkpoints.length,blockers,warnings,activationAllowed:false};
}
export async function inspectLocalMigration({load,readBounded=readBoundedSnapshot,storage=globalThis.navigator?.storage,secure=!!globalThis.crypto?.subtle,webLocks=typeof globalThis.navigator?.locks?.request==='function'}={}){
 let snapshot;
 try{snapshot=load?{data:await load()}:await readBounded(migrationLabLimits.records);}
 catch(e){if(['MigrationSchemaError','NotFoundError','VersionError'].includes(e?.name))return {records:null,bytes:null,checkpoints:null,blockers:['schema'],warnings:[],activationAllowed:false};throw e;}
 if(snapshot.data===null){
  const blockers=['record-limit'];if(!secure)blockers.push('crypto-unavailable');if(!webLocks)blockers.push('locks-unavailable');
  return {records:snapshot.records,bytes:null,checkpoints:null,blockers,warnings:['snapshot-not-loaded'],activationAllowed:false};
 }
 let estimate=null;try{estimate=await storage?.estimate?.();}catch{}
 return inspectMigrationSnapshot(snapshot.data,{estimate,secure,webLocks});
}
