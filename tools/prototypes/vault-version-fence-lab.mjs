/* Native old-client version fence rehearsal. Synthetic DB names only.
 * No live storage, encryption activation, source deletion or production routing. */
import {SCHEMA} from '../../js/db.js';
const names=Object.keys(SCHEMA),marker='migrationFence',legacy=10,fenced=11;
const check=(ok,message)=>{if(!ok)throw Error(message);};
function nameOf(id){check(typeof id==='string'&&/^[a-z0-9-]{1,48}$/.test(id),'Invalid fence LAB id');return 'teachapp-vault-fence-lab-'+id;}
const hasSchema=db=>db.objectStoreNames.length===names.length&&names.every(n=>db.objectStoreNames.contains(n));
const canonical=value=>{
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return JSON.stringify(value);
 check(value&&typeof value==='object'&&Object.getOwnPropertySymbols(value).length===0,'Non-JSON LAB value');
 if(Array.isArray(value)){check(Object.keys(value).length===value.length,'Non-JSON LAB array');return '['+Array.from({length:value.length},(_,i)=>{check(Object.hasOwn(value,i),'Sparse LAB array');return canonical(value[i]);}).join(',')+']';}
 check([Object.prototype,null].includes(Object.getPrototypeOf(value)),'Non-JSON LAB object');
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
};
function snapshotIdentity(data){
 check(data&&Object.keys(data).length===names.length&&names.every(n=>Array.isArray(data[n])),'Incomplete LAB snapshot');
 return canonical(Object.fromEntries(names.map(n=>[n,[...data[n]].sort((a,b)=>indexedDB.cmp(a.id,b.id))])));
}
export function openLegacyFenceLab(id){
 const name=nameOf(id);
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,legacy);let blocked=false;
  req.onblocked=()=>{blocked=true;reject(Error('Fence LAB blocked'));};
  req.onupgradeneeded=e=>{
   if(blocked||e.oldVersion!==0){req.transaction.abort();return;}
   for(const [n,d] of Object.entries(SCHEMA)){const s=req.result.createObjectStore(n,{keyPath:d.keyPath});for(const [i,k,o] of d.indexes)s.createIndex(i,k,o||{});}
  };
  req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{const db=req.result;if(blocked||!hasSchema(db)){db.close();reject(Error('Unexpected legacy LAB schema'));return;}db.onversionchange=()=>db.close();resolve(db);};
 });
}
/** expectedData is the independently verified SYNTHETIC snapshot. This only
 * fences clients opening the explicit old version, not raw versionless IDB.
 * Atomic compare and marker creation inside versionchange; plaintext retained. */
export function fenceLegacyLab(id,expectedData){
 const name=nameOf(id),identity=snapshotIdentity(expectedData);
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,fenced);let blocked=false,failure=null,upgraded=false;
  req.onblocked=()=>{blocked=true;reject(Error('Legacy LAB connection still open; fence not activated'));};
  req.onupgradeneeded=e=>{
   const db=req.result,tx=req.transaction;
   const fail=err=>{failure=err;try{tx.abort();}catch{}};
   if(blocked||e.oldVersion!==legacy||!hasSchema(db)){fail(Error('Fence requires existing legacy LAB schema'));return;}
   const rows={};let remaining=names.length;
   for(const n of names){
    const read=tx.objectStore(n).getAll();
    read.onsuccess=()=>{
     if(failure)return;rows[n]=read.result;if(--remaining)return;
     try{
      check(snapshotIdentity(rows)===identity,'Legacy LAB snapshot changed; fence refused');
      db.createObjectStore(marker,{keyPath:'id'}).add({id:'fenced',legacyVersion:legacy,version:fenced});upgraded=true;
     }catch(err){fail(err);}
    };
   }
  };
  req.onerror=()=>reject(failure||req.error);
  req.onsuccess=()=>{const db=req.result;db.close();if(blocked||!upgraded){reject(Error('Fence LAB already activated or unexpected state'));return;}resolve({legacyVersion:legacy,version:fenced,fenced:true});};
 });
}
