/* store.js — состояние приложения и все команды записи.
   UI читает состояние отсюда и подписывается на изменения.
   Каждая мутация: сначала IndexedDB, потом обновление кэша и уведомление подписчиков.
   Автосохранение каждого тапа обеспечено самим фактом записи в базу. */

import * as db from './db.js';
import * as M from './model.js';

/** Кэш в памяти. Грузим один раз при старте — база маленькая (сотни записей). */
export const state = {
  ready: false,
  settings: M.defaultSettings(),
  classes: [],
  students: [],   // все ученики
  lessons: [],    // все уроки
  topics: [],
  marks: [],      // все отметки
  exemptions: [],
  monthly: [],
  // выбор пользователя
  currentClassId: null,
  currentTrimesterId: 't1',
  currentTab: 'classes',
  lastBackupAt: null,
};

const subs = new Set();

/** Подписка на изменение состояния. Возвращает функцию отписки. */
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

let _notifyScheduled = false;
/** Уведомление подписчиков с дебаунсом — несколько записей подряд дают один рендер. */
export function notify() {
  if (_notifyScheduled) return;
  _notifyScheduled = true;
  const flush = () => {
    _notifyScheduled = false;
    for (const fn of subs) {
      try { fn(state); } catch (e) { console.error('[store] подписчик упал:', e); }
    }
  };
  // В среде без window (тесты, worker) просто откладываем таймером.
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(flush, { timeout: 120 });
  } else {
    setTimeout(flush, 16);
  }
}

/** Первичная загрузка всей базы в кэш. */
export async function load() {
  const [settingsArr, classes, students, lessons, topics, marks, exemptions, monthly] = await Promise.all([
    db.getAll('meta'),
    db.getAll('classes'),
    db.getAll('students'),
    db.getAll('lessons'),
    db.getAll('topics'),
    db.getAll('marks'),
    db.getAll('exemptions'),
    db.getAll('monthly'),
  ]);

  state.settings = { ...M.defaultSettings(), ...(settingsArr.find((s) => s.id === 'settings') || {}) };
  state.settings.trimesters = (settingsArr.find((s) => s.id === 'settings')?.trimesters) || M.defaultSettings().trimesters;
  state.settings.rules = { ...M.defaultSettings().rules, ...(settingsArr.find((s) => s.id === 'settings')?.rules || {}) };
  rightOrderTrimesters(state.settings);

  state.classes = classes.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  state.students = M.sortStudents(students);
  state.lessons = M.sortLessons(lessons);
  state.topics = topics.sort((a, b) => (a.ktpOrder || 0) - (b.ktpOrder || 0));
  state.marks = marks;
  state.exemptions = exemptions;
  state.monthly = monthly;
  state.lastBackupAt = state.settings.lastBackupAt || null;

  if (!state.currentClassId && state.classes.length) {
    state.currentClassId = state.classes[0].id;
  }
  if (state.classes.length && !state.classes.some((c) => c.id === state.currentClassId)) {
    state.currentClassId = state.classes[0].id;
  }
  state.ready = true;
  notify();
  return state;
}

function rightOrderTrimesters(settings) {
  if (!Array.isArray(settings.trimesters)) {
    settings.trimesters = M.defaultSettings().trimesters;
  }
  settings.trimesters.sort((a, b) => a.from.localeCompare(b.from));
  settings.trimesters.forEach((t, i) => { t.index = i + 1; });
}

/* ---------- выборки (селекторы) ---------- */

export const studentsOfClass = (classId) => state.students.filter((s) => s.classId === classId);

export const lessonsOfClass = (classId) => state.lessons.filter((l) => l.classId === classId);

/** Уроки класса в диапазоне дат включительно. */
export function lessonsInRange(classId, from, to) {
  return lessonsOfClass(classId).filter((l) => M.inRange(l.date, from, to));
}

/** Триместр по id. */
export const trimester = (id) => state.settings.trimesters.find((t) => t.id === id) || state.settings.trimesters[0];

export const currentTrimester = () => trimester(state.currentTrimesterId);

/** Карта отметок по ключу lessonId|studentId — для быстрого рендера сетки. */
export function markMap(classId) {
  const lessonIds = new Set(lessonsOfClass(classId).map((l) => l.id));
  const map = new Map();
  for (const m of state.marks) {
    if (lessonIds.has(m.lessonId)) map.set(`${m.lessonId}|${m.studentId}`, m);
  }
  return map;
}

/** Освобождения ученика как массив. */
export const exemptionsOfStudent = (studentId) => state.exemptions.filter((e) => e.studentId === studentId);

/** Действующее на дату освобождение ученика. */
export function activeExemption(studentId, dateIso) {
  return exemptionsOfStudent(studentId).find((e) => M.exemptionCovers(e, dateIso)) || null;
}

/** Освобождение, действующее сегодня. */
const activeNow = (studentId) => exemptionsOfStudent(studentId).find((e) => M.exemptionActive(e)) || null;

/** Все «сегодня освобождены» ученики класса. */
export function currentlyExempt(classId) {
  return studentsOfClass(classId).filter((s) => activeNow(s.id));
}

/** Месячная отметка ученика. */
export function monthlyFor(studentId, year, month) {
  return state.monthly.find((m) => m.studentId === studentId && m.year === year && m.month === month) || null;
}

/** Все уроки месяца для класса. */
export function lessonsOfMonth(classId, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return lessonsOfClass(classId).filter((l) => l.date.startsWith(prefix));
}

/* ---------- настройки ---------- */

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  rightOrderTrimesters(state.settings);
  await db.put('meta', state.settings);
  notify();
}

export async function setTrimesterRange(id, from, to) {
  const list = state.settings.trimesters.map((t) => (t.id === id ? { ...t, from, to } : t));
  await saveSettings({ trimesters: list });
}

export async function setYear(from, to) {
  await saveSettings({ year: { from, to } });
}

export async function setRules(patch) {
  await saveSettings({ rules: { ...state.settings.rules, ...patch } });
}

/* ---------- классы и ученики ---------- */

export async function addClass(name) {
  const cls = { id: M.uid('cls'), name: name.trim() };
  await db.put('classes', cls);
  state.classes.push(cls);
  state.classes.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  notify();
  return cls;
}

export async function renameClass(id, name) {
  const cls = state.classes.find((c) => c.id === id);
  if (!cls) return;
  cls.name = name.trim();
  await db.put('classes', cls);
  state.classes.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  notify();
}

/** Удаление класса со всем содержимым. Команда destructive — вызывать только после подтверждения. */
export async function deleteClass(id) {
  const studentIds = new Set(studentsOfClass(id).map((s) => s.id));
  const lessonIds = new Set(lessonsOfClass(id).map((l) => l.id));
  const marks = state.marks.filter((m) => lessonIds.has(m.lessonId));
  const lessons = state.lessons.filter((l) => l.classId === id);
  const students = state.students.filter((s) => s.classId === id);
  const exemptions = state.exemptions.filter((e) => studentIds.has(e.studentId));
  const monthly = state.monthly.filter((m) => studentIds.has(m.studentId));

  await db.transaction(['classes', 'students', 'lessons', 'marks', 'exemptions', 'monthly'], 'readwrite', (s) => {
    for (const m of marks) s.marks.delete(m.id);
    for (const l of lessons) s.lessons.delete(l.id);
    for (const st of students) s.students.delete(st.id);
    for (const e of exemptions) s.exemptions.delete(e.id);
    for (const mm of monthly) s.monthly.delete(mm.id);
    s.classes.delete(id);
  });

  state.classes = state.classes.filter((c) => c.id !== id);
  state.students = state.students.filter((s) => s.classId !== id);
  state.lessons = state.lessons.filter((l) => l.classId !== id);
  const markIds = new Set(marks.map((m) => m.id));
  state.marks = state.marks.filter((m) => !markIds.has(m.id));
  const exIds = new Set(exemptions.map((e) => e.id));
  state.exemptions = state.exemptions.filter((e) => !exIds.has(e.id));
  const mmIds = new Set(monthly.map((m) => m.id));
  state.monthly = state.monthly.filter((m) => !mmIds.has(m.id));

  if (state.currentClassId === id) state.currentClassId = state.classes[0]?.id || null;
  notify();
}

export async function addStudent(classId, fullName, number) {
  const st = {
    id: M.uid('stu'),
    classId,
    number: number ?? studentsOfClass(classId).length + 1,
    fullName: fullName.trim(),
  };
  await db.put('students', st);
  state.students.push(st);
  state.students = M.sortStudents(state.students);
  notify();
  return st;
}

export async function updateStudent(id, patch) {
  const st = state.students.find((s) => s.id === id);
  if (!st) return;
  Object.assign(st, patch);
  await db.put('students', st);
  state.students = M.sortStudents(state.students);
  notify();
}

/** Удаление ученика вместе с его отметками — обычно нужно при ошибочном импорте. */
export async function deleteStudent(id) {
  const marks = state.marks.filter((m) => m.studentId === id);
  const exemptions = state.exemptions.filter((e) => e.studentId === id);
  const monthly = state.monthly.filter((m) => m.studentId === id);
  await db.transaction(['students', 'marks', 'exemptions', 'monthly'], 'readwrite', (s) => {
    for (const m of marks) s.marks.delete(m.id);
    for (const e of exemptions) s.exemptions.delete(e.id);
    for (const mm of monthly) s.monthly.delete(mm.id);
    s.students.delete(id);
  });
  state.students = state.students.filter((s) => s.id !== id);
  const ms = new Set(marks.map((m) => m.id));
  state.marks = state.marks.filter((m) => !ms.has(m.id));
  state.exemptions = state.exemptions.filter((e) => !exemptions.some((x) => x.id === e.id));
  state.monthly = state.monthly.filter((m) => !monthly.some((x) => x.id === m.id));
  notify();
}

/* ---------- уроки ---------- */

export async function addLesson(classId, dateIso, topicId = null, note = '') {
  const existing = state.lessons.find((l) => l.classId === classId && l.date === dateIso);
  if (existing) return existing;
  const lesson = { id: M.uid('les'), classId, date: dateIso, topicId, note };
  await db.put('lessons', lesson);
  state.lessons.push(lesson);
  state.lessons = M.sortLessons(state.lessons);
  notify();
  await applyExemptionsToLessons(classId, [lesson]);
  return lesson;
}

export async function updateLesson(id, patch) {
  const lesson = state.lessons.find((l) => l.id === id);
  if (!lesson) return;
  Object.assign(lesson, patch);
  await db.put('lessons', lesson);
  state.lessons = M.sortLessons(state.lessons);
  notify();
}

/** Удаление урока вместе с его отметками. Требует подтверждения в UI. */
export async function deleteLesson(id) {
  const marks = state.marks.filter((m) => m.lessonId === id);
  await db.transaction(['lessons', 'marks'], 'readwrite', (s) => {
    for (const m of marks) s.marks.delete(m.id);
    s.lessons.delete(id);
  });
  state.lessons = state.lessons.filter((l) => l.id !== id);
  const ids = new Set(marks.map((m) => m.id));
  state.marks = state.marks.filter((m) => !ids.has(m.id));
  notify();
}

/* ---------- отметки ---------- */

/**
 * Поставить/очистить отметку в ячейке. Главная операция.
 * Возвращает { mark, undo } — undo-функция восстанавливает прежнее состояние
 * (для тоста «Отменить»).
 */
export async function setMark(studentId, lessonId, { value = null, flag = null, weight = null } = {}) {
  const key = `${lessonId}|${studentId}`;
  const existing = state.marks.find((m) => m.lessonId === lessonId && m.studentId === studentId) || null;
  const prev = existing ? { ...existing } : null;

  const normalized = M.normalizeMark({ value, flag });
  let next = null;
  if (normalized) {
    next = {
      id: existing?.id || M.uid('mk'),
      studentId,
      lessonId,
      value: normalized.value,
      flag: normalized.flag,
      // Ручная правка всегда делает отметку ручной
      source: 'manual',
    };
    if (weight === 2) next.weight = 2;
  }

  if (next) {
    await db.put('marks', next);
    if (existing) Object.assign(existing, next);
    else state.marks.push(next);
  } else if (existing) {
    await db.del('marks', existing.id);
    state.marks = state.marks.filter((m) => m.id !== existing.id);
  }
  notify();

  const undo = async () => {
    if (prev) {
      await db.put('marks', prev);
      const cur = state.marks.find((m) => m.id === prev.id);
      if (cur) Object.assign(cur, prev);
      else state.marks.push(prev);
    } else if (next) {
      await db.del('marks', next.id);
      state.marks = state.marks.filter((m) => m.id !== next.id);
    }
    notify();
  };

  return { mark: next, undo };
}

/** Изменить вес оценки (2 = контрольный норматив, учитывается дважды в режиме B). */
export async function setMarkWeight(studentId, lessonId, weight) {
  const m = state.marks.find((x) => x.lessonId === lessonId && x.studentId === studentId);
  if (!m) return;
  if (weight === 2) m.weight = 2; else delete m.weight;
  await db.put('marks', m);
  notify();
}

/* ---------- освобождения ---------- */

/**
 * Создать освобождение и разложить auto-osv по урокам класса.
 * Транзакция атомарная: либо справка + отметки, либо ничего.
 */
export async function addExemption({ studentId, dateFrom, dateTo, reason = '' }) {
  const ex = {
    id: M.uid('exm'),
    studentId,
    dateFrom,
    dateTo: dateTo ?? null,
    reason,
    createdAt: new Date().toISOString(),
  };
  const student = state.students.find((s) => s.id === studentId);
  if (!student) throw new Error('Ученик не найден');

  const lessons = lessonsOfClass(student.classId);
  const marks = state.marks.filter((m) => m.studentId === studentId);
  const plan = M.planOsv({ lessons, marks, studentIds: [studentId], from: ex.dateFrom, to: ex.dateTo });

  await db.transaction(['exemptions', 'marks'], 'readwrite', (s) => {
    s.exemptions.put(ex);
    for (const m of plan.toPut) s.marks.put(m);
    for (const m of plan.toDelete) s.marks.delete(m.id);
  });

  state.exemptions.push(ex);
  applyPlanToCache(plan);
  notify();
  return { exemption: ex, changed: plan.toPut.length + plan.toDelete.length };
}

function applyPlanToCache(plan) {
  const deleteIds = new Set(plan.toDelete.map((m) => m.id));
  state.marks = state.marks.filter((m) => !deleteIds.has(m.id));
  for (const m of plan.toPut) {
    const cur = state.marks.find((x) => x.id === m.id);
    if (cur) Object.assign(cur, m);
    else state.marks.push(m);
  }
}

/** Сколько auto-osv отметок будет удалено при снятии/сокращении — для диалога подтверждения. */
export function countOsvAffected(studentId, from, to) {
  const student = state.students.find((s) => s.id === studentId);
  if (!student) return 0;
  return M.countOsvToDelete({
    lessons: lessonsOfClass(student.classId),
    marks: state.marks.filter((m) => m.studentId === studentId),
    studentId,
    from,
    to,
  });
}

/**
 * Изменить существующее освобождение (сократить или продлить).
 * Автоматически пересобирает auto-osv отметки и возвращает план для undo.
 */
export async function updateExemption(id, { dateFrom, dateTo, reason }) {
  const ex = state.exemptions.find((e) => e.id === id);
  if (!ex) return null;
  const prev = { ...ex };
  const student = state.students.find((s) => s.id === ex.studentId);
  if (!student) return null;

  const lessons = lessonsOfClass(student.classId);
  const marks = state.marks.filter((m) => m.studentId === ex.studentId);
  const plan = M.planOsv({ lessons, marks, studentIds: [ex.studentId], from: dateFrom, to: dateTo });

  ex.dateFrom = dateFrom;
  ex.dateTo = dateTo ?? null;
  if (reason !== undefined) ex.reason = reason;

  await db.transaction(['exemptions', 'marks'], 'readwrite', (s) => {
    s.exemptions.put(ex);
    for (const m of plan.toPut) s.marks.put(m);
    for (const m of plan.toDelete) s.marks.delete(m.id);
  });
  applyPlanToCache(plan);
  notify();
  return { prev, plan };
}

/** Снять освобождение целиком. Удаляет auto-osv отметки, ручные не трогает. */
export async function removeExemption(id) {
  const ex = state.exemptions.find((e) => e.id === id);
  if (!ex) return null;
  const student = state.students.find((s) => s.id === ex.studentId);
  const lessons = student ? lessonsOfClass(student.classId) : [];
  const marks = state.marks.filter((m) => m.studentId === ex.studentId);
  // Снимаем всё: диапазон null → все auto-osv попадают в toDelete.
  const toDelete = marks.filter((m) => m.source === 'auto-osv');

  await db.transaction(['exemptions', 'marks'], 'readwrite', (s) => {
    s.exemptions.delete(id);
    for (const m of toDelete) s.marks.delete(m.id);
  });

  state.exemptions = state.exemptions.filter((e) => e.id !== id);
  const delIds = new Set(toDelete.map((m) => m.id));
  state.marks = state.marks.filter((m) => !delIds.has(m.id));
  notify();
  return { deleted: toDelete.length, exemption: ex, lessons };
}

/** При создании нового урока — проставить auto-osv всем, у кого справка покрывает дату. */
export async function applyExemptionsToLessons(classId, lessons) {
  const students = studentsOfClass(classId);
  if (!students.length) return 0;
  const toPut = [];

  for (const lesson of lessons) {
    for (const st of students) {
      const ex = activeExemption(st.id, lesson.date);
      if (!ex) continue;
      const existing = state.marks.find((m) => m.lessonId === lesson.id && m.studentId === st.id);
      if (existing?.source === 'manual' || existing?.source === 'auto-m') continue;
      if (existing) {
        if (existing.flag === 'ОСВ') continue;
        if (existing.value) {
          // Оценка — сохраняем, добавляем бейдж
          toPut.push({ ...existing, flag: existing.flag === 'Н' ? 'ОСВ' : 'ОСВ' });
        } else {
          toPut.push({ ...existing, flag: 'ОСВ', source: 'auto-osv' });
        }
      } else {
        toPut.push({
          id: M.uid('mk'),
          studentId: st.id,
          lessonId: lesson.id,
          value: null,
          flag: 'ОСВ',
          source: 'auto-osv',
        });
      }
    }
  }

  if (!toPut.length) return 0;
  await db.bulkPut('marks', toPut);
  for (const m of toPut) {
    const cur = state.marks.find((x) => x.id === m.id);
    if (cur) Object.assign(cur, m);
    else state.marks.push(m);
  }
  notify();
  return toPut.length;
}

/* ---------- месячные отметки ---------- */

/**
 * Принять месячную отметку вручную (overriddenByTeacher = true).
 * Такая ячейка больше не пересчитывается автоматически.
 */
export async function setMonthlyOverride(studentId, year, month, value) {
  const existing = monthlyFor(studentId, year, month);
  const mm = {
    id: existing?.id || M.uid('mon'),
    studentId,
    year,
    month,
    value,
    computed: false,
    overriddenByTeacher: true,
    updatedAt: new Date().toISOString(),
  };
  await db.put('monthly', mm);
  if (existing) Object.assign(existing, mm);
  else state.monthly.push(mm);
  notify();
  return mm;
}

/** Убрать ручное переопределение — ячейка снова считается автоматически. */
export async function clearMonthlyOverride(studentId, year, month) {
  const existing = monthlyFor(studentId, year, month);
  if (!existing) return;
  if (existing.id) await db.del('monthly', existing.id);
  state.monthly = state.monthly.filter((m) => m.id !== existing.id);
  notify();
}

/** Записать автоматически рассчитанную отметку (после «Принять рассчитанное»). */
export async function setMonthlyComputed(studentId, year, month, value) {
  const existing = monthlyFor(studentId, year, month);
  const mm = {
    id: existing?.id || M.uid('mon'),
    studentId,
    year,
    month,
    value,
    computed: true,
    overriddenByTeacher: false,
    updatedAt: new Date().toISOString(),
  };
  await db.put('monthly', mm);
  if (existing) Object.assign(existing, mm);
  else state.monthly.push(mm);
  notify();
  return mm;
}

/** Массовое применение месячных отметок — одной транзакцией. */
export async function bulkSetMonthly(items) {
  const records = items.map((it) => {
    const existing = monthlyFor(it.studentId, it.year, it.month);
    return {
      id: existing?.id || M.uid('mon'),
      studentId: it.studentId,
      year: it.year,
      month: it.month,
      value: it.value,
      computed: !it.overridden,
      overriddenByTeacher: !!it.overridden,
      updatedAt: new Date().toISOString(),
    };
  });
  if (!records.length) return;
  await db.bulkPut('monthly', records);
  for (const r of records) {
    const cur = state.monthly.find((m) => m.id === r.id);
    if (cur) Object.assign(cur, r);
    else state.monthly.push(r);
  }
  notify();
}

/* ---------- КТП ---------- */

export async function addTopic(name, ktpOrder) {
  const t = { id: M.uid('top'), name: name.trim(), ktpOrder: ktpOrder || state.topics.length + 1 };
  await db.put('topics', t);
  state.topics.push(t);
  state.topics.sort((a, b) => (a.ktpOrder || 0) - (b.ktpOrder || 0));
  notify();
  return t;
}

export async function updateTopic(id, patch) {
  const t = state.topics.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  await db.put('topics', t);
  state.topics.sort((a, b) => (a.ktpOrder || 0) - (b.ktpOrder || 0));
  notify();
}

export async function deleteTopic(id) {
  await db.del('topics', id);
  state.topics = state.topics.filter((t) => t.id !== id);
  for (const l of state.lessons.filter((x) => x.topicId === id)) {
    l.topicId = null;
    await db.put('lessons', l);
  }
  notify();
}

/* ---------- резервная копия ---------- */

export async function makeBackup() {
  const data = await db.dumpAll();
  const payload = {
    app: 'teachapp',
    version: 1,
    createdAt: new Date().toISOString(),
    data,
  };
  state.lastBackupAt = payload.createdAt;
  await saveSettings({ lastBackupAt: payload.createdAt });
  return payload;
}

export async function restoreBackup(payload) {
  if (!payload || payload.app !== 'teachapp' || !payload.data) {
    throw new Error('Файл не похож на резервную копию этого приложения');
  }
  await db.clearAll();
  await db.restoreAll(payload.data);
  await load();
  return true;
}

/** Удалить все демо-записи (классы с isDemo и всё, что к ним относится). */
export async function clearDemo() {
  const demoClasses = state.classes.filter((c) => c.isDemo);
  for (const cls of demoClasses) {
    await deleteClass(cls.id);
  }
  return demoClasses.length;
}

export const hasDemo = () => state.classes.some((c) => c.isDemo);
