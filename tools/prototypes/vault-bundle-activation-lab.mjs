/* Immutable scope bundle activation LAB. No live DB or plaintext fallback.
 * Cooperative Web Lock protects registry operations; raw IDB is out of scope. */
import {SCHEMA} from '../../js/db.js';
import {openVaultLab,openVaultReadSessionLab} from './local-vault.mjs';
import {validateVaultScopeResultLab,readVaultScopeLab,readVaultScopeBundleLab,stageVaultScopeBundleLab,splitVaultScopesLab,joinVaultScopesLab} from './vault-scope-bundle.mjs';
const scopes=['school','coach','workspace'],names=Object.keys(SCHEMA);
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,revision=/^[0-9a-f]{32}$/;
const valid=s=>s&&Object.keys(s).sort().join('|')==='bundleId|id|revisions'&&s.id==='active'&&typeof s.bundleId==='string'&&uuid.test(s.bundleId)&&s.revisions&&Object.keys(s.revisions).length===3&&scopes.every(k=>Object.hasOwn(s.revisions,k)&&typeof s.revisions[k]==='string'&&revision.test(s.revisions[k]));
const ordered=data=>Object.fromEntries(names.map(n=>[n,[...data[n]].sort((a,b)=>indexedDB.cmp(a.id,b.id))]));
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
function openRegistry(name){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,1);let blocked=false;
  req.onblocked=()=>{blocked=true;reject(Error('Закройте другие вкладки LAB'));};
  req.onupgradeneeded=()=>{if(blocked)req.transaction.abort();else req.result.createObjectStore('state',{keyPath:'id'});};
  req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;if(blocked){db.close();return;}db.onversionchange=()=>db.close();resolve(db);};
 });
}
function readPointer(db){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('state'),req=tx.objectStore('state').get('active');
  tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error||Error('Чтение указателя LAB отменено'));
 });
}
function activatePointer(db,pointer){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),req=store.get('active');let failure=null;
  req.onsuccess=()=>{
   try{check(req.result===undefined,'Набор LAB уже активирован или указатель повреждён');store.add(pointer);}
   catch(e){failure=e;tx.abort();}
  };
  tx.oncomplete=resolve;tx.onabort=()=>reject(failure||tx.error||Error('Активация LAB отменена'));
 });
}
export function vaultBundleActivationLab(id,{locks=globalThis.navigator?.locks}={}){
 check(typeof id==='string'&&/^[a-z0-9-]{1,48}$/.test(id),'Некорректный ID набора LAB');
 check(typeof locks?.request==='function','Для LAB необходим Web Locks API');
 const registryName='teachapp-vault-bundle-registry-lab-'+id;
 const guarded=fn=>locks.request(registryName,{mode:'exclusive'},async()=>{
  const registry=await openRegistry(registryName),dbs={};
  try{for(const scope of scopes)dbs[scope]=await openVaultLab('teachapp-vault-lab-active-'+id+'-'+scope);return await fn(registry,dbs);}
  finally{Object.values(dbs).forEach(db=>db.close());registry.close();}
 });
 const inactive=async registry=>check((await readPointer(registry))===undefined,'Набор LAB уже активирован или указатель повреждён');
 const active=async registry=>{const pointer=await readPointer(registry);check(valid(pointer),'Набор LAB не активирован или указатель повреждён; fallback запрещён');return pointer;};
 const match=(pointer,result,scope)=>check(result.bundleId===pointer.bundleId&&result.revision===pointer.revisions[scope],'Активная ревизия области LAB изменилась');
 return {
  stage:({data,passwords})=>guarded(async(registry,dbs)=>{await inactive(registry);return stageVaultScopeBundleLab(dbs,{data,passwords});}),
  activate:({expectedData,passwords,expectedBundleId})=>guarded(async(registry,dbs)=>{
   await inactive(registry);check(typeof expectedBundleId==='string'&&uuid.test(expectedBundleId),'Требуется ID проверенного набора LAB');
   const expected=joinVaultScopesLab(splitVaultScopesLab(expectedData)),result=await readVaultScopeBundleLab(dbs,{passwords});
   check(result.bundleId===expectedBundleId&&canonical(ordered(expected))===canonical(ordered(result.data)),'Набор LAB не совпадает с ожидаемым снимком');
   const pointer={id:'active',bundleId:result.bundleId,revisions:result.revisions};
   check(valid(pointer),'Некорректный указатель LAB');await activatePointer(registry,pointer);return pointer;
  }),
  status:()=>guarded(async registry=>{const pointer=await readPointer(registry);if(pointer===undefined)return {active:false};check(valid(pointer),'Указатель LAB повреждён');return {active:true,...pointer};}),
  readScope:({scope,password})=>guarded(async(registry,dbs)=>{
   check(scopes.includes(scope),'Неизвестная область LAB');const pointer=await active(registry),result=await readVaultScopeLab(dbs[scope],{scope,password});
   match(pointer,result,scope);return result.data;
  }),
  openScopeSession:({scope,password,idleMs,now})=>guarded(async(registry,dbs)=>{
   check(scopes.includes(scope),'Неизвестная область LAB');const pointer=await active(registry);
   const session=await openVaultReadSessionLab(dbs[scope],{scope,password,idleMs,now});
   try{match(pointer,validateVaultScopeResultLab(await session.read(),scope),scope);}
   catch(e){session.close();throw e;}
   return Object.freeze({
    scope,close:session.close,isLocked:session.isLocked,
    async read(){
     check(!session.isLocked(),'Сеанс LAB заблокирован; откройте заново');
     try{
      return await guarded(async(registry,dbs)=>{
       const current=await active(registry),result=validateVaultScopeResultLab(await session.read(dbs[scope]),scope);
       match(pointer,result,scope);match(current,result,scope);
       check(!session.isLocked(),'Сеанс LAB заблокирован; откройте заново');return result.data;
      });
     }catch(e){session.close();throw e;}
    }
   });
  }),
  snapshot:({passwords})=>guarded(async(registry,dbs)=>{
   const pointer=await active(registry),result=await readVaultScopeBundleLab(dbs,{passwords});
   for(const scope of scopes)match(pointer,{bundleId:result.bundleId,revision:result.revisions[scope]},scope);
   return result.data;
  })
 };
}
