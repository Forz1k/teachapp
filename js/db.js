/* db.js — слой доступа к IndexedDB.
   Никаких зависимостей. Все операции — промисы.
   Схема: 1 объект-хранилище на каждую сущность + keyPath 'id'.
   Индексы: по classId, studentId, lessonId, date — чтобы выборки были без полного скана. */

const DB_NAME = 'teachapp';
const DB_VERSION = 10;

/** Список хранилищ и их индексы. Единственное место, где описана схема. */
const STORES = {
  meta:      { keyPath: 'id', indexes: [] },            // глобальные настройки: учебный год, триместры, правила М
  classes:   { keyPath: 'id', indexes: [] },
  students:  { keyPath: 'id', indexes: [
                 ['classId', 'classId'],
                 ['classId_number', ['classId', 'number'], { unique: false }],
               ] },
  lessons:   { keyPath: 'id', indexes: [
                 ['classId', 'classId'],
                 ['classId_date', ['classId', 'date'], { unique: false }],
                 ['date', 'date'],
               ] },
  topics:    { keyPath: 'id', indexes: [
                 ['ktpOrder', 'ktpOrder'],
                 ['ktpId', 'ktpId'],
               ] },
  // КТП как отдельная сущность: свой список тем, привязанный к одному или нескольким классам
  ktp:       { keyPath: 'id', indexes: [] },
  // Расписание: «день недели + номер урока» → класс и время
  schedule:  { keyPath: 'id', indexes: [
                 ['weekday', 'weekday'],
                 ['weekday_slot', ['weekday', 'slot'], { unique: false }],
               ] },
  // Переопределения расписания на конкретную дату (замена, отмена, сдвиг)
  scheduleOverrides: { keyPath: 'id', indexes: [['date', 'date']] },
  marks:     { keyPath: 'id', indexes: [
                 ['lessonId', 'lessonId'],
                 ['studentId', 'studentId'],
                 ['lessonId_studentId', ['lessonId', 'studentId'], { unique: true }],
               ] },
  exemptions:{ keyPath: 'id', indexes: [
                 ['studentId', 'studentId'],
                 ['dateFrom', 'dateFrom'],
               ] },
  studentHealthProfiles: { keyPath: 'id', indexes: [] },
  activityRestrictions: { keyPath: 'id', indexes: [['studentId','studentId'], ['activityId','activityId'], ['dateTo','dateTo']] },
  activityCategories: { keyPath: 'id', indexes: [] },
  participation: { keyPath: 'id', indexes: [
    ['studentLesson', ['studentId', 'lessonId'], { unique: true }],
    ['studentId', 'studentId'], ['lessonId', 'lessonId'], ['date', 'date'],
  ] },
  norms: {keyPath:'id',indexes:[]},
  normResults: {keyPath:'id',indexes:[['studentId','studentId'],['lessonId','lessonId'],['normId','normId']]},
  workRecords: {keyPath:'id',indexes:[['kind','kind']]},
  coachTests: {keyPath:'id',indexes:[['teamId','teamId'],['date','date']]},
  coachTeams: {keyPath:'id',indexes:[]},
  coachPlayers: {keyPath:'id',indexes:[['teamId','teamId']]},
  coachTrainings: {keyPath:'id',indexes:[['teamId','teamId'],['date','date']]},
  coachLive: {keyPath:'id',indexes:[['teamId','teamId']]},
  coachLineups: {keyPath:'id',indexes:[['teamId','teamId']]},
  coachMatches: {keyPath:'id',indexes:[['teamId','teamId'],['date','date']]},
  finalGrades: {keyPath:'id',indexes:[['studentId','studentId'],['studentPeriod',['studentId','from','to'],{unique:true}]]},
  monthly:   { keyPath: 'id', indexes: [
                 ['studentId', 'studentId'],
                 ['studentId_period', ['studentId', 'year', 'month'], { unique: true }],
               ] },
};

function ensureSchema(db, transaction, schema) {
  for (const [name, def] of Object.entries(schema)) {
    let store;
    if (!db.objectStoreNames.contains(name)) {
      store = db.createObjectStore(name, { keyPath: def.keyPath });
    } else {
      store = transaction.objectStore(name);
    }
    for (const [idxName, keyPath, opts] of def.indexes) {
      if (!store.indexNames.contains(idxName)) {
        store.createIndex(idxName, keyPath, opts || {});
      }
    }
  }
}

// Обе исторические версии приводим к совместимой схеме добавлением хранилищ и индексов.
// Следующие миграции выполняются внутри той же versionchange-транзакции.
const migrations = {
  1() {}, // чистая установка продолжится миграцией 2
  10(db, transaction) { ensureSchema(db, transaction, STORES); },
  9(db, transaction) { ensureSchema(db, transaction, STORES); },
  8(db, transaction) { ensureSchema(db, transaction, STORES); },
  7(db, transaction) { ensureSchema(db, transaction, STORES); },
  6(db, transaction) { ensureSchema(db, transaction, STORES); },
  5(db, transaction) { ensureSchema(db, transaction, STORES); },
  4(db, transaction) { ensureSchema(db, transaction, STORES); },
  3(db, transaction) { ensureSchema(db, transaction, { participation: STORES.participation }); },
  2(db, transaction) { ensureSchema(db, transaction, STORES); },
};

let _db = null;
let _opening = null;
let nativeFenced = false, encryptedRoute=null,nativeStarted=false;
export const isEncryptedStorage=()=>encryptedRoute!==null;
export const encryptedStorageAllowed=()=>encryptedRoute===null||encryptedRoute.isUnlocked();
export function configureEncryptedStorage(route){
 if(nativeStarted||nativeFenced||encryptedRoute||!route||typeof route.transaction!=='function'||typeof route.syncTransaction!=='function'||typeof route.isUnlocked!=='function')throw Error('Маршрут хранилища уже выбран или некорректен');
 encryptedRoute=Object.freeze(route);
}
export const NATIVE_STORAGE_FENCED_EVENT='teachapp:native-storage-fenced';
const fencedError=()=>new DOMException('Версия локального хранилища изменилась. Повторный доступ в этом документе запрещён.','NativeStorageFencedError');

/** Открывает базу. Параллельные обращения используют один запрос IndexedDB. */
export function open() {
  if(nativeFenced||encryptedRoute)return Promise.reject(fencedError());
  nativeStarted=true;
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;
  const pending = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;

    req.onblocked = () => {
      blocked = true;
      reject(new DOMException('Закройте другие вкладки TeachApp и запустите приложение снова.', 'DatabaseBlockedError'));
    };
    req.onupgradeneeded = (event) => {
      // Запрос IndexedDB нельзя отменить, пока другая вкладка удерживает базу.
      // Не запускаем отложенную миграцию после того, как сообщили об ошибке.
      if (blocked) { req.transaction.abort(); return; }
      for (let version = event.oldVersion + 1; version <= DB_VERSION; version++) {
        migrations[version](req.result, req.transaction);
      }
    };
    req.onsuccess = () => {
      const connection = req.result;
      if (blocked) { connection.close(); return; }
      _db = connection;
      connection.onversionchange = event => {
        connection.close();
        if (_db === connection) _db = null;
        if(event?.newVersion===null||event?.newVersion>DB_VERSION){
          nativeFenced=true;
          globalThis.window?.dispatchEvent(new Event(NATIVE_STORAGE_FENCED_EVENT));
        }
      };
      connection.onclose = () => {
        if (_db === connection) _db = null;
      };
      resolve(connection);
    };
    req.onerror = () => {
      if(req.error?.name==='VersionError'){nativeFenced=true;reject(fencedError());}
      else reject(req.error);
    };
  });
  _opening = pending.finally(() => { _opening = null; });
  return _opening;
}

/** Обёртка над транзакцией. fn получает объект со store-хелперами, может быть async. */
async function tx(storeNames, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = {};
    for (const name of [].concat(storeNames)) {
      stores[name] = wrapStore(t.objectStore(name));
    }
    let result;
    try {
      result = fn(stores, t);
      if (result?.catch) result.catch(error => {
        try { t.abort(); } catch { /* транзакция уже завершена */ }
        reject(error);
      });
    } catch (err) {
      try { t.abort(); } catch { /* already inactive */ }
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error || new Error('Транзакция отменена'));
    t.onerror = event => reject(event.target.error || t.error);
  }).catch(error => {
    if (error?.name === 'QuotaExceededError') {
      throw new DOMException('Недостаточно места на устройстве для записи в журнал. Освободите место и повторите операцию.', 'QuotaExceededError');
    }
    throw error;
  });
}

/** Промис-обёртки над IDBRequest, чтобы внутри транзакции писать читаемо. */
function req(r) {
  const pending=new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  // Some batched callers rely on transaction abort instead of awaiting every
  // request. Observe the rejection without suppressing IDB's native abort.
  pending.catch(()=>{});
  return pending;
}

function wrapStore(store) {
  return {
    get: (key) => req(store.get(key)),
    getAll: (query, count) => req(store.getAll(query, count)),
    put: (value) => req(store.put(value)),
    add: (value) => req(store.add(value)),
    delete: (key) => req(store.delete(key)),
    clear: () => req(store.clear()),
    count: () => req(store.count()),
    index: (name) => {
      const idx = store.index(name);
      return {
        getAll: (query, count) => req(idx.getAll(query, count)),
        get: (query) => req(idx.get(query)),
        count: (query) => req(idx.count(query)),
        getAllKeys: (query) => req(idx.getAllKeys(query)),
      };
    },
  };
}

/** Shared Promise data-access contract. A backend is fixed at creation;
 * callers cannot mutate the native singleton or install a global fallback.
 * Native readBoundedSnapshot/open stay separate: LAB materializes full data. */
export function createDataAccess(run){
  if(typeof run!=='function')throw TypeError('Требуется backend транзакций');
  const all=Object.keys(STORES);
  const access={
    bulkPut(store,items){
      if(!items.length)return Promise.resolve();
      return run(store,'readwrite',async s=>{await Promise.all(items.map(item=>s[store].put(item)));});
    },
    get:(store,key)=>run(store,'readonly',s=>s[store].get(key)),
    getAll:store=>run(store,'readonly',s=>s[store].getAll()),
    put:(store,value)=>run(store,'readwrite',s=>s[store].put(value)),
    del:(store,key)=>run(store,'readwrite',s=>s[store].delete(key)),
    clear:store=>run(store,'readwrite',s=>s[store].clear()),
    count:store=>run(store,'readonly',s=>s[store].count()),
    byIndex:(store,index,query)=>run(store,'readonly',s=>s[store].index(index).getAll(query)),
    transaction:(stores,mode,fn)=>run(stores,mode,s=>fn(s)),
    async clearAll(){
      return run(all,'readwrite',async s=>{await Promise.all(all.map(n=>s[n].clear()));});
    },
    async dumpAll(){return access.readSnapshot(all);},
    readSnapshot(names){
      if(!Array.isArray(names)||!names.length||new Set(names).size!==names.length||names.some(n=>!Object.hasOwn(STORES,n)))throw Error('Некорректный набор хранилищ');
      return run(names,'readonly',async stores=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await stores[name].getAll()]))));
    },
    replaceAll(data,{guardMigration=false}={}){
      return run(all,'readwrite',async stores=>{
        if(guardMigration&&(await stores.meta.getAll()).some(r=>typeof r.id==='string'&&r.id.startsWith('sync-checkpoint-migration-')))throw Error('Нельзя заменять базу во время незавершённого Delta LAB переноса. Сначала согласуйте возврат контрольной точки.');
        for(const name of all){
          await stores[name].clear();
          for(const row of data[name])await stores[name].add(row);
        }
      });
    }
  };
  return Object.freeze(access);
}

// Bootstrap fixes the encrypted route before importing the app. Native is
// the default only for legacy installations; no fallback after route choice.
const routed=(n,m,fn)=>encryptedRoute?encryptedRoute.transaction(n,m,fn):tx(n,m,fn);
export const {bulkPut,get,getAll,put,del,clear,count,byIndex,transaction,clearAll,dumpAll,readSnapshot,replaceAll}=createDataAccess(routed);
export const syncTransaction=(n,m,fn)=>encryptedRoute?encryptedRoute.syncTransaction(n,m,fn):tx(n,m,fn);

/** Count before materializing a full snapshot. Both operations use the same
 * readonly transaction, so a concurrent writer cannot bypass the row cap.
 * If above limit, return counts only: no getAll, cursor or data export. */
/** Exact native schema guard for migration diagnostics. Does not upgrade or
 * repair stores/indexes; unexpected definitions must block a migration. */
export function assertMigrationSchema(t){
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const fail=()=>{throw new DOMException('Неожиданная схема базы для переноса','MigrationSchemaError');};
 const names=Object.keys(STORES);
 if(t.db.version!==DB_VERSION||t.db.objectStoreNames.length!==names.length||names.some(n=>!t.db.objectStoreNames.contains(n)))fail();
 for(const [name,def] of Object.entries(STORES)){
  const s=t.objectStore(name);
  if(!same(s.keyPath,def.keyPath)||s.autoIncrement||s.indexNames.length!==def.indexes.length)fail();
  for(const [index,keyPath,options] of def.indexes){
   if(!s.indexNames.contains(index))fail();
   const actual=s.index(index);
   if(!same(actual.keyPath,keyPath)||actual.unique!==!!options?.unique||actual.multiEntry!==!!options?.multiEntry)fail();
  }
 }
}
export function readBoundedSnapshot(limit){
 if(!Number.isSafeInteger(limit)||limit<0)throw Error('Некорректный лимит снимка');
 const names=Object.keys(STORES);
 if(encryptedRoute)return encryptedRoute.transaction(names,'readonly',async stores=>{
  const records=(await Promise.all(names.map(n=>stores[n].count()))).reduce((a,b)=>a+b,0);
  return {records,data:records>limit?null:Object.fromEntries(await Promise.all(names.map(async n=>[n,await stores[n].getAll()]))) };
 });
 return tx(names,'readonly',async (stores,t)=>{
  assertMigrationSchema(t);
  const records=(await Promise.all(names.map(name=>stores[name].count()))).reduce((a,b)=>a+b,0);
  if(records>limit)return {records,data:null};
  const data=Object.fromEntries(await Promise.all(names.map(async name=>[name,await stores[name].getAll()])));
  return {records,data};
 });
}

export const SCHEMA = STORES;
