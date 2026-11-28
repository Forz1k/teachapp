/* Shared snapshot transaction contract. No DB selection or key material. */
import {SCHEMA} from './db.js';
import {splitDeviceSnapshot,joinDeviceSnapshot} from './device-checkpoint-migration.js';
import {BACKUP_VERSION,validateBackup} from './backup.js';
const names=Object.keys(SCHEMA);
const check=(v,msg)=>{if(!v)throw Error(msg);};
const copy=v=>structuredClone(v);
const cmp=(a,b)=>indexedDB.cmp(a,b);
const keyOK=k=>{try{cmp(k,k);return true;}catch{return false;}};
const keyPath=(row,path)=>Array.isArray(path)?path.map(p=>row[p]):row[path];
const dom=(name,message)=>new DOMException(message,name);
const payload=data=>({app:'teachapp',version:BACKUP_VERSION,data});
export function checkedData(data,{deviceLocal=false}={}){
 check(data&&Object.keys(data).length===names.length&&names.every(n=>Array.isArray(data[n])),'Требуется полный снимок текущей схемы');
 if(deviceLocal){const {portable,device}=splitDeviceSnapshot(data);return joinDeviceSnapshot(validateBackup(payload(portable)),device);}
 check(data.meta.every(r=>typeof r.id==='string'&&!r.id.startsWith('sync-checkpoint-')),'Контрольные точки синхронизации не переносятся в LAB');
 return validateBackup(payload(data));
}

function validateQuery(query,{required=false}={}){
 if(query==null&&!required)return;
 if(typeof IDBKeyRange!=='undefined'&&query instanceof IDBKeyRange)return;
 if(!keyOK(query))throw dom('DataError','Некорректный ключ');
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
function makeStore(table,def,active,writable,failed){
 const ensure=write=>{if(!active())throw dom('TransactionInactiveError','Транзакция завершена');if(write&&!writable)throw dom('ReadOnlyError','Только чтение');};
 const ordered=()=>[...table.values()].sort((a,b)=>cmp(a.id,b.id));
 const lookup=k=>{validateQuery(k,{required:true});return typeof IDBKeyRange!=='undefined'&&k instanceof IDBKeyRange?ordered().find(row=>k.includes(row.id)):table.get(k);};
 function select(query,count){ensure(false);validateQuery(query);return limited(ordered().filter(row=>match(row.id,query)),count);}
 function write(value,add){
  ensure(true);const row=copy(value),k=row?.id;
  if(typeof k!=='string'||!k.length)throw dom('DataError','Отсутствует ключ записи');
  if(add&&table.has(k))throw dom('ConstraintError','Повтор ключа');
  for(const [,path,opts] of def.indexes){if(!opts?.unique)continue;const ik=keyPath(row,path);if(!keyOK(ik))continue;
   if([...table.values()].some(old=>old.id!==k&&keyOK(keyPath(old,path))&&cmp(keyPath(old,path),ik)===0))throw dom('ConstraintError','Повтор уникального индекса');
  }
  table.set(k,row);return k;
 }
 // Request failures in a writable LAB transaction are fatal, even when
 // the callback catches them. Observe ignored rejections without changing
 // the returned promise's rejection semantics.
 const asyncOp=fn=>(...args)=>{
  try{return Promise.resolve(fn(...args));}
  catch(error){if(active()&&writable)failed(error);const rejected=Promise.reject(error);rejected.catch(()=>{});return rejected;}
 };
 return {
  get:asyncOp(key=>{ensure(false);return copy(lookup(key));}),
  getAll:asyncOp((q,c)=>copy(select(q,c))),
  count:asyncOp(()=>{ensure(false);return table.size;}),
  add:asyncOp(v=>write(v,true)),put:asyncOp(v=>write(v,false)),
  delete:asyncOp(key=>{ensure(true);if(!keyOK(key))throw dom('DataError','Некорректный ключ');if(typeof IDBKeyRange!=='undefined'&&key instanceof IDBKeyRange)throw dom('DataError','Диапазон удаления пока не поддержан');table.delete(key);}),
  clear:asyncOp(()=>{ensure(true);table.clear();}),
  index(name){
   ensure(false);const idx=def.indexes.find(i=>i[0]===name);if(!idx){const error=dom('NotFoundError','Нет индекса');if(writable)failed(error);throw error;}
   const rows=(query,count)=>{ensure(false);validateQuery(query);const found=ordered().map(row=>({row,key:keyPath(row,idx[1])})).filter(x=>keyOK(x.key)&&match(x.key,query)).sort((a,b)=>cmp(a.key,b.key)||cmp(a.row.id,b.row.id));return limited(found,count).map(x=>x.row);};
   return {getAll:asyncOp((q,c)=>copy(rows(q,c))),get:asyncOp(q=>{ensure(false);validateQuery(q,{required:true});return copy(rows(q,1)[0]);}),getAllKeys:asyncOp((q,c)=>rows(q,c).map(row=>row.id)),count:asyncOp(q=>rows(q).length)};
  }
 };
}
/** Prepare a validated snapshot transaction without committing. Callback is
 * invoked once; its store handles expire before any CAS write. LAB only. */
export async function prepareSchemaSnapshotTransaction(input,storeNames,mode,fn,{guard=()=>{},isOpen=()=>true,deviceLocal=false}={}){
 const selected=[].concat(storeNames);
 check(selected.length&&new Set(selected).size===selected.length&&selected.every(n=>Object.hasOwn(SCHEMA,n))&&['readonly','readwrite'].includes(mode)&&typeof fn==='function','Некорректная транзакция LAB');
 guard();const data=checkedData(copy(input),{deviceLocal}),tables=new Map(selected.map(n=>[n,new Map(data[n].map(row=>[row.id,row]))]));
 let active=true,firstError=null;const failed=error=>{if(!firstError)firstError=error;};
 const stores=Object.fromEntries(selected.map(n=>[n,makeStore(tables.get(n),SCHEMA[n],()=>active&&isOpen(),mode==='readwrite',failed)]));
 let result;try{result=await fn(stores);}finally{active=false;}
 guard();
 if(mode==='readwrite'){
  if(firstError)throw firstError;
  for(const n of selected)data[n]=[...tables.get(n).values()].sort((a,b)=>cmp(a.id,b.id));
  checkedData(data,{deviceLocal});
 }
 return {result,data,selected};
}

