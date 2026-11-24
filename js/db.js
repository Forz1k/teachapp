/* db.js — слой доступа к IndexedDB.
   Никаких зависимостей. Все операции — промисы.
   Схема: 1 объект-хранилище на каждую сущность + keyPath 'id'.
   Индексы: по classId, studentId, lessonId, date — чтобы выборки были без полного скана. */

const DB_NAME = 'teachapp';
const DB_VERSION = 8;

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
  8(db, transaction) { ensureSchema(db, transaction, STORES); },
  7(db, transaction) { ensureSchema(db, transaction, STORES); },
  6(db, transaction) { ensureSchema(db, transaction, STORES); },
  5(db, transaction) { ensureSchema(db, transaction, STORES); },
  4(db, transaction) { ensureSchema(db, transaction, STORES); },
  3(db, transaction) { ensureSchema(db, transaction, { participation: STORES.participation }); },
  2(db, transaction) { ensureSchema(db, transaction, STORES); },
};

let _db = null;

/** Открывает базу, при первом запуске создаёт хранилища. Кэширует соединение. */
export function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      for (let version = event.oldVersion + 1; version <= DB_VERSION; version++) {
        migrations[version](req.result, req.transaction);
      }
    };

    req.onsuccess = () => {
      _db = req.result;
      // Если в другой вкладке подняли версию — закрываемся, чтобы не блокировать.
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
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
      t.abort();
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
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
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

/** Массовая запись одной транзакцией — для импорта и seed-данных. */
export function bulkPut(storeName, items) {
  if (!items.length) return Promise.resolve();
  return tx(storeName, 'readwrite', (s) => {
    for (const item of items) s[storeName].put(item);
  });
}

export const get    = (store, key)      => tx(store, 'readonly',  (s) => s[store].get(key));
export const getAll = (store)           => tx(store, 'readonly',  (s) => s[store].getAll());
export const put    = (store, value)    => tx(store, 'readwrite', (s) => s[store].put(value));
export const del    = (store, key)      => tx(store, 'readwrite', (s) => s[store].delete(key));
export const clear  = (store)           => tx(store, 'readwrite', (s) => s[store].clear());
export const count  = (store)           => tx(store, 'readonly',  (s) => s[store].count());
export const byIndex = (store, index, query) =>
  tx(store, 'readonly', (s) => s[store].index(index).getAll(query));

/**
 * Атомарная операция над несколькими хранилищами.
 * Нужна там, где нельзя допустить частичной записи: снятие освобождения + удаление auto-osv.
 */
export function transaction(storeNames, mode, fn) {
  return tx(storeNames, mode, (stores) => fn(stores));
}

/** Полное стирание базы (для «стереть демо» и восстановления из бэкапа). */
export async function clearAll() {
  const names = Object.keys(STORES);
  return tx(names, 'readwrite', (s) => {
    for (const n of names) s[n].clear();
  });
}

/** Полная выгрузка базы в один объект — для JSON-бэкапа. */
export async function dumpAll() {
  const names = Object.keys(STORES);
  return tx(names, 'readonly', async stores => Object.fromEntries(await Promise.all(
    names.map(async name => [name, await stores[name].getAll()]))));
}

/** Замена базы одной транзакцией. add отклоняет повторяющиеся ключи. */
export function replaceAll(data) {
  const names = Object.keys(STORES);
  return tx(names, 'readwrite', async stores => {
    for (const name of names) {
      await stores[name].clear();
      for (const row of data[name]) await stores[name].add(row);
    }
  });
}

export const SCHEMA = STORES;
