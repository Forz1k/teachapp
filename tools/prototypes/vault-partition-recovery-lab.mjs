/* Ciphertext-only recovery copies of the three-key writable LAB.
 * Every partition authenticates the same backup ID and exact source pointer.
 * No real data, no files in GitHub, no production backup format. */
import {splitVaultScopesLab,joinVaultScopesLab,validateVaultScopeResultLab} from './vault-scope-bundle.mjs';
import {sealPartitionScopeLab,openPartitionKeySessionLab,encodePartitionCiphertextLab,decodePartitionCiphertextLab,partitionCiphertextFileLimitLab} from './local-vault.mjs';
import {splitDeviceSnapshot,joinDeviceSnapshot,validateDeviceCheckpoints} from '../../js/device-checkpoint-migration.js';
const scopes=['school','coach','workspace'],check=(v,m)=>{if(!v)throw Error(m);};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,rev=/^[0-9a-f]{32}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const validRevisions=r=>exact(r,scopes)&&scopes.every(s=>typeof r[s]==='string'&&rev.test(r[s]));
const validSource=s=>exact(s,['id','sourceBundleId','sourceRevisions'])&&s.id==='recovery'&&typeof s.sourceBundleId==='string'&&uuid.test(s.sourceBundleId)&&validRevisions(s.sourceRevisions);
export const validPartitionPasswordsLab=p=>exact(p,scopes)&&scopes.every(s=>typeof p[s]==='string'&&p[s].length>=12&&p[s].length<=1024)&&new Set(scopes.map(s=>p[s])).size===scopes.length;
export const independentPartitionPasswordsLab=(...sets)=>sets.every(validPartitionPasswordsLab)&&new Set(sets.flatMap(p=>scopes.map(s=>p[s]))).size===sets.length*scopes.length;
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const samePartitionSnapshotLab=(a,b)=>canonical(Object.fromEntries(Object.entries(a).map(([n,rows])=>[n,[...rows].sort((x,y)=>indexedDB.cmp(x.id,y.id))])))===canonical(Object.fromEntries(Object.entries(b).map(([n,rows])=>[n,[...rows].sort((x,y)=>indexedDB.cmp(x.id,y.id))])));
export const sourceMatchesPartitionLab=(source,pointer)=>validSource(source)&&source.sourceBundleId===pointer.bundleId&&canonical(source.sourceRevisions)===canonical(pointer.revisions);
const maxFile=3*partitionCiphertextFileLimitLab+4096;
export async function createPartitionRecoveryCopyLab({data,pointer,passwords,deviceLocal=false}){
 check(validPartitionPasswordsLab(passwords),'Требуются три независимых пароля копии LAB');
 const source={id:'recovery',sourceBundleId:pointer.bundleId,sourceRevisions:{...pointer.revisions}};
 check(validSource(source),'Некорректная исходная ревизия LAB');
 const separated=deviceLocal?splitDeviceSnapshot(data):{portable:data,device:[]};
 const parts=splitVaultScopesLab(separated.portable),bundleId=crypto.randomUUID(),sealed={};
 for(const scope of scopes){
  const rows=await sealPartitionScopeLab({scope,bundleId,password:passwords[scope],data:{...parts[scope],...(deviceLocal&&scope==='workspace'?{deviceMeta:separated.device}:{}),bundleMeta:[{id:'bundle',scope,bundleId}],recoveryMeta:[source]}});
  sealed[scope]=JSON.parse(encodePartitionCiphertextLab(rows));
 }
 const file=JSON.stringify({app:'teachapp-partition-recovery-lab',version:deviceLocal?2:1,bundleId,parts:sealed});
 check(file.length<=maxFile,'Копия LAB слишком велика');
 const reopened=await openPartitionRecoveryCopyLab(file,{passwords,deviceLocal});
 check(sourceMatchesPartitionLab(reopened.source,pointer)&&samePartitionSnapshotLab(reopened.data,data),'Копия LAB не совпадает с исходным снимком');
 return {file,source:reopened.source,bundleId};
}
export async function openPartitionRecoveryCopyLab(file,{passwords,deviceLocal=false}){
 check(validPartitionPasswordsLab(passwords),'Требуются три независимых пароля копии LAB');
 check(typeof file==='string'&&file.length<=maxFile,'Копия LAB слишком велика');
 const parsed=JSON.parse(file);
 check(exact(parsed,['app','version','bundleId','parts'])&&parsed.app==='teachapp-partition-recovery-lab'&&parsed.version===(deviceLocal?2:1)&&typeof parsed.bundleId==='string'&&uuid.test(parsed.bundleId)&&exact(parsed.parts,scopes),'Некорректная копия областей LAB');
 const parts={};let source=null,device=[];
 for(const scope of scopes){
  const rows=decodePartitionCiphertextLab(JSON.stringify(parsed.parts[scope]));
  const key=await openPartitionKeySessionLab({scope,bundleId:parsed.bundleId,password:passwords[scope],rows});
  try{
   const result=await key.read(rows),{recoveryMeta,deviceMeta,...data}=result.data;
   if(deviceLocal&&scope==='workspace'){check(Object.hasOwn(result.data,'deviceMeta'),'Отсутствуют локальные контрольные точки копии');device=validateDeviceCheckpoints(deviceMeta);}
   else check(!Object.hasOwn(result.data,'deviceMeta'),'Локальные контрольные точки в чужой области копии');
   check(Array.isArray(recoveryMeta)&&recoveryMeta.length===1&&validSource(recoveryMeta[0]),'Повреждена исходная ревизия копии LAB');
   if(source)check(canonical(source)===canonical(recoveryMeta[0]),'Области копии из разных исходных ревизий LAB');
   else source=recoveryMeta[0];
   parts[scope]=validateVaultScopeResultLab({...result,data},scope).data;
  }finally{key.close();}
 }
 const portable=joinVaultScopesLab(parts);
 return {bundleId:parsed.bundleId,source,data:deviceLocal?joinDeviceSnapshot(portable,device):portable};
}
