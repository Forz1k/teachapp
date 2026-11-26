/* Synthetic-only adapter for the current TeachApp schema.
 * No connection to db.open(), live IndexedDB, device checkpoints or sync.
 * Whole-snapshot CAS is intentionally a correctness baseline, not production storage. */
import {SCHEMA} from '../../js/db.js';
import {BACKUP_VERSION,validateBackup} from '../../js/backup.js';
import {stageVaultLab,readVaultLab,replaceVaultLab} from './local-vault.mjs';
const scope='workspace',names=Object.keys(SCHEMA);
const check=(v,msg)=>{if(!v)throw Error(msg);};
const copy=v=>structuredClone(v);
const cmp=(a,b)=>indexedDB.cmp(a,b);
const keyOK=k=>{try{cmp(k,k);return true;}catch{return false;}};
const keyPath=(row,path)=>Array.isArray(path)?path.map(p=>row[p]):row[path];
const dom=(name,message)=>new DOMException(message,name);
const payload=data=>({app:'teachapp',version:BACKUP_VERSION,data});
function checkedData(data){
 check(data&&Object.keys(data).length===names.length&&names.every(n=>Array.isArray(data[n])),'Требуется полный снимок текущей схемы');
 check(data.meta.every(r=>typeof r.id==='string'&&!r.id.startsWith('sync-checkpoint-')),'Контрольные точки синхронизации не переносятся в LAB');
 return validateBackup(payload(data));
}
export async function stageSchemaVault(db,{backup,password}){
 check(backup?.version===BACKUP_VERSION&&!backup.scope&&backup.app==='teachapp','Нужна полная копия текущего формата');
 const data=checkedData(copy(backup.data));
 return stageVaultLab(db,{scope,data,password});
}
function match(key,query){
 if(query==null)return true;
 if(typeof IDBKeyRange!=='undefined'&&query instanceof IDBKeyRange)return query.includes(key);
 if(!keyOK(query))throw dom('DataError','Некорректный ключ');
 return cmp(key,query)===0;
}
function limited(rows,count){
 if(count===undefined)return rows;
 if(!Number.isInteger(count)||count<0||count>0xffffffff)throw TypeError('Некорректный count');
 return count===0?rows:rows.slice(0,count);
}
function makeStore(table,def,active,writable){
 const ensure=write=>{if(!active())throw dom('TransactionInactiveError','Транзакция завершена');if(write&&!writable)throw dom('ReadOnlyError','Только чтение');};
 const ordered=()=>[...table.values()].sort((a,b)=>cmp(a.id,b.id));
 const lookup=k=>{if(!keyOK(k))throw dom('DataError','Некорректный ключ');return table.get(k);};
 function select(query,count){ensure(false);return limited(ordered().filter(row=>match(row.id,query)),count);}
 function write(value,add){
  ensure(true);const row=copy(value),k=row?.id;
  if(typeof k!=='string'||!k.length)throw dom('DataError','Отсутствует ключ записи');
  if(add&&table.has(k))throw dom('ConstraintError','Повтор ключа');
  for(const [,path,opts] of def.indexes){if(!opts?.unique)continue;const ik=keyPath(row,path);if(!keyOK(ik))continue;
   if([...table.values()].some(old=>old.id!==k&&keyOK(keyPath(old,path))&&cmp(keyPath(old,path),ik)===0))throw dom('ConstraintError','Повтор уникального индекса');
  }
  table.set(k,row);return k;
 }
 const asyncOp=fn=>async(...args)=>fn(...args);
 return {
  get:asyncOp(key=>{ensure(false);return copy(lookup(key));}),
  getAll:asyncOp((q,c)=>copy(select(q,c))),
  count:asyncOp(()=>{ensure(false);return table.size;}),
  add:asyncOp(v=>write(v,true)),put:asyncOp(v=>write(v,false)),
  delete:asyncOp(key=>{ensure(true);if(!keyOK(key))throw dom('DataError','Некорректный ключ');if(typeof IDBKeyRange!=='undefined'&&key instanceof IDBKeyRange)throw dom('DataError','Диапазон удаления пока не поддержан');table.delete(key);}),
  clear:asyncOp(()=>{ensure(true);table.clear();}),
  index(name){
   ensure(false);const idx=def.indexes.find(i=>i[0]===name);if(!idx)throw dom('NotFoundError','Нет индекса');
   const rows=(query,count)=>{ensure(false);const found=ordered().map(row=>({row,key:keyPath(row,idx[1])})).filter(x=>keyOK(x.key)&&match(x.key,query)).sort((a,b)=>cmp(a.key,b.key)||cmp(a.row.id,b.row.id));return limited(found,count).map(x=>x.row);};
   return {getAll:asyncOp((q,c)=>copy(rows(q,c))),get:asyncOp(q=>copy(rows(q,1)[0])),getAllKeys:asyncOp((q,c)=>rows(q,c).map(row=>row.id)),count:asyncOp(q=>rows(q).length)};
  }
 };
}
/** Prepare a validated snapshot transaction without committing. Callback is
 * invoked once; its store handles expire before any CAS write. LAB only. */
export async function prepareSchemaSnapshotTransactionLab(input,storeNames,mode,fn,{guard=()=>{}}={}){
 const selected=[].concat(storeNames);
 check(selected.length&&new Set(selected).size===selected.length&&selected.every(n=>Object.hasOwn(SCHEMA,n))&&['readonly','readwrite'].includes(mode)&&typeof fn==='function','Некорректная транзакция LAB');
 guard();const data=checkedData(copy(input)),tables=new Map(selected.map(n=>[n,new Map(data[n].map(row=>[row.id,row]))]));
 let active=true;const stores=Object.fromEntries(selected.map(n=>[n,makeStore(tables.get(n),SCHEMA[n],()=>active,mode==='readwrite')]));
 let result;try{result=await fn(stores);}finally{active=false;}
 guard();
 if(mode==='readwrite'){
  for(const n of selected)data[n]=[...tables.get(n).values()].sort((a,b)=>cmp(a.id,b.id));
  checkedData(data);
 }
 return {result,data,selected};
}
/** Uses the same store/index names and Promise API as js/db.js. Callback must
 * await its requests; no raw IDB transaction, cursor, arbitrary key type or
 * production adapter is promised. Conflicts never retry user callbacks. */
export function schemaVaultAdapter(db,{password}){
 let closed=false,key=password;
 const guard=()=>check(!closed,'Хранилище LAB закрыто');
 async function transaction(storeNames,mode,fn){
  guard();const pass=key,opened=await readVaultLab(db,{scope,password:pass});guard();
  const {result,data}=await prepareSchemaSnapshotTransactionLab(opened.data,storeNames,mode,fn,{guard});
  if(mode==='readwrite')await replaceVaultLab(db,{scope,password:pass,expectedRevision:opened.revision,data});
  return result;
 }
 return {transaction,async snapshot(){guard();const result=await readVaultLab(db,{scope,password:key});guard();return checkedData(result.data);},close(){closed=true;key='';}};
}
