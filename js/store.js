import { BACKUP_VERSION, validateBackup } from './backup.js';
/* store.js — состояние приложения и все команды записи.
   UI читает состояние отсюда и подписывается на изменения.
   Каждая мутация: сначала IndexedDB, потом обновление кэша и уведомление подписчиков.
   Автосохранение каждого тапа обеспечено самим фактом записи в базу. */

import * as db from './db.js';
import * as H from './health.js';
import * as M from './model.js';
import {appendGradeHistory,gradeState,finalState,lessonHistoryKey,finalHistoryKey,checkUndo} from './grade-history.js';
import * as A from './assessment.js';
import {planNormImport} from './norm-import.js';

/** Кэш в памяти. Грузим один раз при старте — база маленькая (сотни записей). */
export const state = {
  ready: false,
  settings: M.defaultSettings(),
  classes: [],
  students: [],   // все ученики
  lessons: [],    // все уроки
  topics: [],
  ktp: [],
  schedule: [],
  scheduleOverrides: [],
  marks: [],      // все отметки
  exemptions: [],
  monthly: [],
  studentHealthProfiles: [],
  activityRestrictions: [],
  activityCategories: [],
  participation: [],
  norms: [],
  normResults: [],
  finalGrades: [],
  // выбор пользователя
  currentClassId: null,
  currentTrimesterId: 't1',
  currentTab: 'today',
  lastBackupAt: null,
};

const subs = new Set();

/** Подписка на изменение состояния. Возвращает функцию отписки. */
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

let _notifyScheduled = false;
let pendingStudents = new Set();
/** Уведомление подписчиков с дебаунсом — несколько записей подряд дают один рендер. */
export function notify(studentId = null) {
  // Неизвестное или структурное изменение требует полной отрисовки.
  if (studentId === null) pendingStudents = null;
  else pendingStudents?.add(studentId);
  if (_notifyScheduled) return;
  _notifyScheduled = true;
  const flush = () => {
    _notifyScheduled = false;
    const changedStudents = pendingStudents === null ? null : [...pendingStudents];
    pendingStudents = new Set();
    for (const fn of subs) {
      try { fn(state, changedStudents); } catch (e) { console.error('[store] ошибка обновления интерфейса'); }
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
  return applySnapshot(await db.dumpAll());
}

function applySnapshot({ meta: settingsArr, classes, students, lessons, topics, ktp, schedule, scheduleOverrides,
  marks, exemptions, studentHealthProfiles, activityRestrictions, activityCategories, monthly, participation, norms, normResults, finalGrades }) {
  state.settings = { ...M.defaultSettings(), ...(settingsArr.find((s) => s.id === 'settings') || {}) };
  state.settings.trimesters = (settingsArr.find((s) => s.id === 'settings')?.trimesters) || M.defaultSettings().trimesters;
  state.settings.rules = { ...M.defaultSettings().rules, ...(settingsArr.find((s) => s.id === 'settings')?.rules || {}) };
  rightOrderTrimesters(state.settings);

  state.classes = classes.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  state.students = M.sortStudents(students);
  state.lessons = M.sortLessons(lessons);
  state.topics = topics.sort((a, b) => (a.ktpOrder || 0) - (b.ktpOrder || 0));
  state.ktp = ktp.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  state.schedule = schedule.sort((a, b) =>
    (a.weekday - b.weekday) || (a.slot - b.slot) || ((M.parseTime(a.time) ?? 0) - (M.parseTime(b.time) ?? 0)));
  state.scheduleOverrides = scheduleOverrides;
  state.marks = marks;
  state.exemptions = exemptions;
  state.studentHealthProfiles = studentHealthProfiles;
  state.activityRestrictions = activityRestrictions;
  state.activityCategories = activityCategories;
  state.monthly = monthly;
  state.participation = participation;
  state.norms=norms || [];
  state.normResults=normResults || [];
  state.finalGrades=finalGrades || [];
  state.lastBackupAt = state.settings.lastBackupAt || null;

  if (!state.classes.length) state.currentClassId = null;
  if (!state.currentClassId && state.classes.length) {
    state.currentClassId = state.classes[0].id;
  }
  if (state.classes.length && !state.classes.some((c) => c.id === state.currentClassId)) {
    state.currentClassId = state.classes[0].id;
  }
  if(!state.settings.trimesters.some(t=>t.id===state.currentTrimesterId))state.currentTrimesterId=(state.settings.trimesters.find(t=>M.inRange(M.todayIso(),t.from,t.to))||state.settings.trimesters[0]).id;
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
  const settings = await db.transaction(['meta'],'readwrite', async s => {
    const current = await s.meta.get('settings');
    const next = { ...M.defaultSettings(), ...current, ...patch };
    rightOrderTrimesters(next);
    await s.meta.put(next);
    return next;
  });
  state.settings = settings;
  if(!settings.trimesters.some(t=>t.id===state.currentTrimesterId))state.currentTrimesterId=(settings.trimesters.find(t=>M.inRange(M.todayIso(),t.from,t.to))||settings.trimesters[0]).id;
  state.lastBackupAt = settings.lastBackupAt || null;
  notify();
}

export async function savePeriods(periods) {
  await saveSettings({trimesters:A.validatePeriods(periods,state.settings.year)});
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

  const records = state.participation.filter(p => studentIds.has(p.studentId) || lessonIds.has(p.lessonId));
  const results=state.normResults.filter(r=>studentIds.has(r.studentId)||lessonIds.has(r.lessonId));
  const finals=state.finalGrades.filter(r=>studentIds.has(r.studentId));
  const removedStudents = studentIds;
  const restricted = state.activityRestrictions.filter(r => removedStudents.has(r.studentId));
  const schedules = state.schedule.filter(r => r.classId === id);
  const scheduleIds = new Set(schedules.map(r => r.id));
  const overrides = state.scheduleOverrides.filter(r => r.classId === id || scheduleIds.has(r.ruleId));
  const plans = state.ktp.filter(p => p.classIds.includes(id)).map(p => ({...p,classIds:p.classIds.filter(c => c !== id)}));
  await db.transaction(['classes', 'students', 'lessons', 'marks', 'exemptions', 'monthly', 'participation','studentHealthProfiles','activityRestrictions','schedule','scheduleOverrides','ktp','normResults','finalGrades','workRecords'], 'readwrite', async (s) => {
    const history=await s.workRecords.index('kind').getAll('gradeHistory');for(const r of history)if(studentIds.has(r.studentId)||lessonIds.has(r.lessonId))await s.workRecords.delete(r.id);
    for (const r of schedules) s.schedule.delete(r.id);
    for (const r of overrides) s.scheduleOverrides.delete(r.id);
    for (const p of plans) s.ktp.put(p);
    for (const key of removedStudents) s.studentHealthProfiles.delete(key);
    for (const r of restricted) s.activityRestrictions.delete(r.id);
    for (const p of records) s.participation.delete(p.id);
    for (const r of results) s.normResults.delete(r.id);
    for (const r of finals) s.finalGrades.delete(r.id);
    for (const m of marks) s.marks.delete(m.id);
    for (const l of lessons) s.lessons.delete(l.id);
    for (const st of students) s.students.delete(st.id);
    for (const e of exemptions) s.exemptions.delete(e.id);
    for (const mm of monthly) s.monthly.delete(mm.id);
    s.classes.delete(id);
  });

  state.schedule = state.schedule.filter(r => !scheduleIds.has(r.id));
  state.scheduleOverrides = state.scheduleOverrides.filter(r => !overrides.includes(r));
  state.ktp = state.ktp.map(p => plans.find(plan => plan.id === p.id) || p);
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
  state.participation = state.participation.filter(p => !records.includes(p));
  state.normResults=state.normResults.filter(r=>!results.includes(r));
  state.finalGrades=state.finalGrades.filter(r=>!finals.includes(r));
  state.studentHealthProfiles = state.studentHealthProfiles.filter(p => !removedStudents.has(p.id));
  state.activityRestrictions = state.activityRestrictions.filter(r => !removedStudents.has(r.studentId));
  notify();
}

export async function addStudent(classId, fullName, number, normGroup=null) {
  if(!A.validNormGroup(normGroup))throw Error('Проверьте категорию нормативов');
  const st = {
    id: M.uid('stu'),
    classId,
    number: number ?? studentsOfClass(classId).length + 1,
    fullName: fullName.trim(),
    normGroup,
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
  if(Object.hasOwn(patch,'normGroup')&&!A.validNormGroup(patch.normGroup))throw Error('Проверьте категорию нормативов');
  const next={...st,...patch};
  await db.put('students',next);
  Object.assign(st,next);
  state.students = M.sortStudents(state.students);
  notify();
}

export async function setClassNormLevel(classId,gradeLevel){
  if(!A.validGradeLevel(gradeLevel))throw Error('Параллель должна быть от 1 до 11');
  const cls=state.classes.find(c=>c.id===classId);if(!cls)throw Error('Класс недоступен');
  const next={...cls,gradeLevel};await db.put('classes',next);Object.assign(cls,next);notify();
}
export async function saveNormGroups(classId,entries){
  const rows=await db.transaction(['students'],'readwrite',async s=>{
    const out=[];for(const [id,normGroup] of Object.entries(entries)){
      if(!A.validNormGroup(normGroup))throw Error('Проверьте категорию нормативов');
      const st=await s.students.get(id);if(!st||st.classId!==classId)throw Error('Состав класса изменился');
      const next={...st,normGroup};await s.students.put(next);out.push(next);
    }return out;
  });
  const byId=new Map(rows.map(r=>[r.id,r]));state.students=state.students.map(s=>byId.get(s.id)||s);notify();
}

/** Удаление ученика вместе с его отметками — обычно нужно при ошибочном импорте. */
export async function deleteStudent(id) {
  const marks = state.marks.filter((m) => m.studentId === id);
  const exemptions = state.exemptions.filter((e) => e.studentId === id);
  const monthly = state.monthly.filter((m) => m.studentId === id);
  const records = state.participation.filter(p => p.studentId === id);
  const results=state.normResults.filter(r=>r.studentId===id);
  const finals=state.finalGrades.filter(r=>r.studentId===id);
  const removedStudents = new Set([id]);
  const restricted = state.activityRestrictions.filter(r => removedStudents.has(r.studentId));
  await db.transaction(['students', 'marks', 'exemptions', 'monthly', 'participation','studentHealthProfiles','activityRestrictions','normResults','finalGrades','workRecords'], 'readwrite', async (s) => {
    const history=await s.workRecords.index('kind').getAll('gradeHistory');for(const r of history)if(r.studentId===id)await s.workRecords.delete(r.id);
    for (const key of removedStudents) s.studentHealthProfiles.delete(key);
    for (const r of restricted) s.activityRestrictions.delete(r.id);
    for (const p of records) s.participation.delete(p.id);
    for (const r of results) s.normResults.delete(r.id);
    for (const r of finals) s.finalGrades.delete(r.id);
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
  state.participation = state.participation.filter(p => !records.includes(p));
  state.normResults=state.normResults.filter(r=>!results.includes(r));
  state.finalGrades=state.finalGrades.filter(r=>!finals.includes(r));
  state.studentHealthProfiles = state.studentHealthProfiles.filter(p => !removedStudents.has(p.id));
  state.activityRestrictions = state.activityRestrictions.filter(r => !removedStudents.has(r.studentId));
  notify();
}

/* ---------- уроки ---------- */

export async function addLesson(classId, dateIso, topicId = null, note = '') {
  const existing = state.lessons.find((l) => l.classId === classId && l.date === dateIso);
  if (existing) return existing;
  const lesson = { id: M.uid('les'), classId, date: dateIso, topicId, note };
  const result = await db.transaction(['lessons','students','exemptions','marks'],'readwrite',async s => {
    const found = await s.lessons.index('classId_date').get([classId,dateIso]);
    if (found) return {lesson:found,changes:[]};
    await s.lessons.put(lesson);
    const students = await s.students.index('classId').getAll(classId);
    const exemptions = await s.exemptions.getAll();
    const changes = [];
    for (const student of students) {
      const mark = withCoverage(null,null,lesson,student.id,exemptions,null);
      if (mark) { await s.marks.put(mark); changes.push({id:mark.id,next:mark}); }
    }
    return {lesson,changes};
  });
  if (!state.lessons.some(l => l.id === result.lesson.id)) state.lessons.push(result.lesson);
  state.lessons = M.sortLessons(state.lessons);
  cacheMarks(result.changes);
  notify();
  return result.lesson;
}

export async function updateLesson(id, patch) {
  const result = await db.transaction(['lessons','students','participation','exemptions','marks'],'readwrite',async s => {
    const previous = await s.lessons.get(id);
    if (!previous) return null;
    const lesson = {...previous,...patch};
    await s.lessons.put(lesson);
    const changes = [];
    const records = [];
    if (previous.date !== lesson.date) {
      const [students,parts,marks,exemptions] = await Promise.all([s.students.index('classId').getAll(lesson.classId),
        s.participation.index('lessonId').getAll(id),s.marks.index('lessonId').getAll(id),s.exemptions.getAll()]);
      const byStudent = new Map(marks.map(m => [m.studentId,m]));
      const participation = new Map(parts.map(p => [p.studentId,p]));
      for (const p of parts) {
        const record = {...p,date:lesson.date};
        await s.participation.put(record);
        records.push(record);
      }
      for (const student of students) {
        const mark = byStudent.get(student.id);
        const next = withCoverage(baseMark(mark),mark,lesson,student.id,exemptions,participation.get(student.id));
        if (JSON.stringify(mark || null) === JSON.stringify(next)) continue;
        await writeMark(s,mark,next);
        changes.push({id:mark?.id || next.id,next});
      }
    }
    return { lesson,changes,records };
  });
  if (!result) return;
  Object.assign(state.lessons.find(l => l.id === id),result.lesson);
  for (const record of result.records) Object.assign(state.participation.find(p => p.id === record.id) || {},record);
  cacheMarks(result.changes);
  state.lessons = M.sortLessons(state.lessons);
  notify();
}
/** Удаление урока вместе с его отметками. Требует подтверждения в UI. */
export async function deleteLesson(id) {
  const marks = state.marks.filter((m) => m.lessonId === id);
  const records = state.participation.filter(p => p.lessonId === id);
  const results=state.normResults.filter(r=>r.lessonId===id);
  await db.transaction(['lessons', 'marks', 'participation','normResults','workRecords'], 'readwrite', async (s) => {
    const history=await s.workRecords.index('kind').getAll('gradeHistory');for(const r of history)if(r.lessonId===id)await s.workRecords.delete(r.id);
    for (const p of records) s.participation.delete(p.id);
    for (const r of results) s.normResults.delete(r.id);
    for (const m of marks) s.marks.delete(m.id);
    s.lessons.delete(id);
  });
  state.lessons = state.lessons.filter((l) => l.id !== id);
  const ids = new Set(marks.map((m) => m.id));
  state.marks = state.marks.filter((m) => !ids.has(m.id));
  state.participation = state.participation.filter(p => !records.includes(p));
  state.normResults=state.normResults.filter(r=>!results.includes(r));
  notify();
}

/* ---------- отметки ---------- */

/**
 * Поставить/очистить отметку в ячейке. Главная операция.
 * Возвращает { mark, undo } — undo-функция восстанавливает прежнее состояние
 * (для тоста «Отменить»).
 */
// Ручная запись до наложения автоматического ОСВ. Старые ручные ОСВ
// без сведений об источнике сохраняются, пока учитель сам их не изменит.
function baseMark(mark) {
  if (!mark) return null;
  if ('baseMark' in mark) return mark.baseMark;
  if (mark.source !== 'auto-osv' && mark.source !== 'participation') return mark;
  const { previousFlag, previousSource, participationId, ...rest } = mark;
  const flag = previousFlag === 'ОСВ' && previousSource === 'auto-osv' ? null : previousFlag;
  if (!mark.value && !flag && mark.flag !== 'Н') return null;
  return { ...rest, flag: flag || (mark.flag === 'Н' ? 'Н' : null), source: previousSource === 'auto-osv' ? 'manual' : previousSource || 'manual' };
}

function withCoverage(base, mark, lesson, studentId, exemptions, participation) {
  const covered = exemptions.some(e => e.studentId === studentId && M.exemptionCovers(e,lesson.date));
  if (!covered && !participation?.full) return base;
  const absent = base?.flag === 'Н';
  const next = { ...base, id: base?.id || mark?.id || M.uid('mk'), studentId, lessonId: lesson.id,
    value: base?.value ?? null, flag: absent ? 'Н' : 'ОСВ',
    source: participation?.full ? 'participation' : 'auto-osv', baseMark: base };
  if (absent) next.osv = true;
  if (participation?.full) next.participationId = participation.id;
  return next;
}

function cacheMarks(changes) {
  const ids = new Set(changes.map(c => c.id));
  state.marks = state.marks.filter(m => !ids.has(m.id)).concat(changes.filter(c => c.next).map(c => c.next));
}

async function writeMark(s, previous, next) {
  if (next) await s.marks.put(next);
  else if (previous) await s.marks.delete(previous.id);
}

async function editMark(studentId, lessonId, edit,source='manual',undoEventId=null) {
  const result = await db.transaction(['students','lessons','marks','participation','exemptions','workRecords','topics','activityRestrictions','activityCategories'], 'readwrite', async s => {
    const [student,lesson, previous, part, exemptions] = await Promise.all([s.students.get(studentId),s.lessons.get(lessonId),
      s.marks.index('lessonId_studentId').get([lessonId,studentId]),
      s.participation.index('studentLesson').get([studentId,lessonId]), s.exemptions.index('studentId').getAll(studentId)]);
    if (!student||!lesson||student.classId!==lesson.classId) throw new Error('Ученик или урок не найден');
    const priorBase = baseMark(previous);
    const hist=undoEventId?await s.workRecords.get(lessonHistoryKey(studentId,lessonId)):null;
    if(undoEventId)checkUndo(hist,undoEventId,gradeState(priorBase));
    const base = edit(priorBase, previous);
    if(source==='undo'&&undoEventId&&base?.value){
      const [restrictions,custom,topic]=await Promise.all([s.activityRestrictions.index('studentId').getAll(studentId),s.activityCategories.getAll(),lesson.topicId?s.topics.get(lesson.topicId):Promise.resolve(null)]);
      const matches=H.checkLessonRestrictions({lesson:{...lesson,activityIds:lesson.activityIds??topic?.activityIds},students:[student],activities:[...H.catalog,...custom],restrictions}).matches;
      if(M.hasOsv(previous)||previous?.flag==='Н'||part?.mode==='paused'||part?.full||exemptions.some(e=>M.exemptionCovers(e,lesson.date))||matches.length)throw Error('Проверьте участие и ограничения в обычном журнале');
    }
    const next = withCoverage(base,previous,lesson,studentId,exemptions,part);
    await writeMark(s,previous,next);
    const audit=await appendGradeHistory(s.workRecords,{scope:'lesson',studentId,lessonId},gradeState(priorBase),gradeState(base),source,undoEventId||undefined);
    return { previous, priorBase, base, next,audit };
  });
  cacheMarks([{id:result.previous?.id || result.next?.id,next:result.next}]);
  notify(studentId);
  return { mark:result.next, undo:() => editMark(studentId,lessonId,current => {
    if (JSON.stringify(current) !== JSON.stringify(result.base)) throw new Error('Оценка уже изменена');
    return result.priorBase;
  },'undo',result.audit?.id||null) };
}
export async function undoGradeHistory(studentId,lessonId,eventId,confirmed=false){
  if(!confirmed)throw Error('Подтвердите отмену изменения');
  const hist=await db.get('workRecords',lessonHistoryKey(studentId,lessonId));
  const event=hist?.events.at(-1);
  if(!event||event.id!==eventId)throw Error('Оценка уже изменена');
  return editMark(studentId,lessonId,(base,previous)=>{
    if(base?.flag||previous?.flag||previous?.osv)throw Error('Состояние участия изменено. Используйте обычный журнал');
    const v=event.before;
    if(v.value===null)return null;
    const next={...base,id:previous?.id||M.uid('mk'),studentId,lessonId,value:v.value,flag:null,source:'manual'};
    if(v.weight===2)next.weight=2;else delete next.weight;
    return next;
  },'undo',eventId);
}
export function setMark(studentId,lessonId,{value = null,flag = null,weight,osv = false} = {}) {
  return editMark(studentId,lessonId,(base,previous) => {
    if (flag === 'ОСВ' && !value) value = base?.value ?? null;
    const normalized = M.normalizeMark({value,flag});
    if (!normalized) return null;
    const next = { ...base, id:previous?.id || M.uid('mk'), studentId,lessonId,...normalized,source:'manual' };
    delete next.osv;
    if (flag === 'Н' && (osv || M.hasOsv(base))) next.osv = true;
    if (flag === 'ОСВ' && base?.flag === 'Н' && !next.value) { next.flag = 'Н'; next.osv = true; }
    if (!next.value || weight === 1) delete next.weight;
    if (next.value && weight === 2) next.weight = 2;
    return next;
  });
}

export function setMarkWeight(studentId,lessonId,weight) {
  return editMark(studentId,lessonId,base => {
    if (!base?.value) return base;
    const next = {...base};
    if (weight === 2) next.weight = 2; else delete next.weight;
    return next;
  },'weight');
}

async function changeExemption(id,studentId,edit) {
  const result = await db.transaction(['students','lessons','marks','participation','exemptions'],'readwrite',async s => {
    const prev = await s.exemptions.get(id);
    const next = edit(prev);
    if (!prev && !next) return null;
    const owner = prev?.studentId || studentId;
    const student = await s.students.get(owner);
    if (!student) throw new Error('Ученик не найден');
    if (next && !H.validPeriod(next.dateFrom,next.dateTo)) throw new Error('Проверьте период освобождения');
    const [lessons,marks,parts,all] = await Promise.all([s.lessons.index('classId').getAll(student.classId),
      s.marks.index('studentId').getAll(owner),s.participation.index('studentId').getAll(owner),s.exemptions.index('studentId').getAll(owner)]);
    const remaining = all.filter(e => e.id !== id).concat(next || []);
    const byLesson = new Map(marks.map(m => [m.lessonId,m]));
    const participation = new Map(parts.map(p => [p.lessonId,p]));
    const changes = [];
    if (next) await s.exemptions.put(next); else await s.exemptions.delete(id);
    for (const lesson of lessons) {
      if (!M.exemptionCovers(prev,lesson.date) && !M.exemptionCovers(next,lesson.date)) continue;
      const mark = byLesson.get(lesson.id);
      const updated = withCoverage(baseMark(mark),mark,lesson,owner,remaining,participation.get(lesson.id));
      if (JSON.stringify(mark || null) === JSON.stringify(updated)) continue;
      await writeMark(s,mark,updated);
      changes.push({id:mark?.id || updated.id,next:updated});
    }
    return {prev,next,changes};
  });
  if (!result) return null;
  const {prev,next,changes} = result;
  state.exemptions = state.exemptions.filter(e => e.id !== id).concat(next || []);
  cacheMarks(changes);
  notify();
  return { exemption:next || prev, prev, changed:changes.length, deleted:changes.filter(c => !c.next).length,
    undo:() => changeExemption(id,studentId || prev?.studentId,current => {
      if (JSON.stringify(current || null) !== JSON.stringify(next)) throw new Error('Освобождение уже изменено');
      return prev || null;
    }) };
}

export function addExemption({studentId,dateFrom,dateTo,reason = ''}) {
  const id = M.uid('exm');
  return changeExemption(id,studentId,() => ({id,studentId,dateFrom,dateTo:dateTo || null,reason,createdAt:new Date().toISOString()}));
}

export function updateExemption(id,patch) {
  return changeExemption(id,null,prev => prev ? {...prev,...patch,id,studentId:prev.studentId} : null);
}

export function removeExemption(id) {
  return changeExemption(id,null,() => null);
}

export function countOsvAffected(studentId,from,to,id) {
  const current = state.exemptions.find(e => e.id === id);
  if (!current) return 0;
  const other = state.exemptions.filter(e => e.studentId === studentId && e.id !== id);
  const dates = new Map(state.lessons.map(l => [l.id,l.date]));
  return state.marks.filter(m => {
    const date = dates.get(m.lessonId);
    return m.studentId === studentId && M.hasOsv(m) && !M.hasOsv(baseMark(m)) && M.exemptionCovers(current,date)
      && !(from && M.inRange(date,from,to)) && !other.some(e => M.exemptionCovers(e,date))
      && !state.participation.some(p => p.full && p.lessonId === m.lessonId && p.studentId === studentId);
  }).length;
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

/** Список КТП. */
export const allKtp = () => state.ktp;

/** КТП, привязанные к классу (по classIds). */
export function ktpOfClass(classId) {
  return state.ktp.filter((k) => Array.isArray(k.classIds) && k.classIds.includes(classId));
}

/** Темы конкретного КТП, по порядку. */
export function topicsOfKtp(ktpId) {
  return state.topics
    .filter((t) => t.ktpId === ktpId)
    .sort((a, b) => (a.ktpOrder || 0) - (b.ktpOrder || 0));
}

/** Все темы, доступные для класса (из всех его КТП), плюс общие без КТП. */
export function topicsForClass(classId) {
  const lists = ktpOfClass(classId);
  const ids = new Set(lists.map((k) => k.id));
  return state.topics
    .filter((t) => !t.ktpId || ids.has(t.ktpId))
    .sort((a, b) => (a.ktpOrder || 0) - (b.ktpOrder || 0));
}

/**
 * Создать КТП и сразу привязать к классам.
 * @param {{name: string, classIds: string[]}} p
 */
export async function addKtp({ name, classIds = [] }) {
  const k = {
    id: M.uid('ktp'),
    name: name.trim(),
    classIds: [...classIds],
    createdAt: new Date().toISOString(),
  };
  await db.put('ktp', k);
  state.ktp.push(k);
  state.ktp.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  notify();
  return k;
}

export async function updateKtp(id, patch) {
  const k = state.ktp.find((x) => x.id === id);
  if (!k) return;
  Object.assign(k, patch);
  await db.put('ktp', k);
  state.ktp.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  notify();
}

/** Привязать/отвязать класс к КТП. */
export async function setKtpClasses(ktpId, classIds) {
  await updateKtp(ktpId, { classIds: [...new Set(classIds)] });
}

/** Удалить КТП вместе с его темами. Темы в уроках обнуляются. */
export async function deleteKtp(id) {
  const topics = state.topics.filter((t) => t.ktpId === id);
  const topicIds = new Set(topics.map((t) => t.id));
  const affectedLessons = state.lessons.filter((l) => topicIds.has(l.topicId));

  await db.transaction(['ktp', 'topics', 'lessons'], 'readwrite', (s) => {
    for (const l of affectedLessons) {
      s.lessons.put({ ...l, topicId: null });
    }
    for (const t of topics) s.topics.delete(t.id);
    s.ktp.delete(id);
  });

  for (const l of affectedLessons) l.topicId = null;
  state.topics = state.topics.filter((t) => !topicIds.has(t.id));
  state.ktp = state.ktp.filter((k) => k.id !== id);
  notify();
}

export async function addTopic(name, ktpOrder, ktpId = null) {
  const t = {
    id: M.uid('top'),
    name: name.trim(),
    ktpOrder: ktpOrder || state.topics.length + 1,
    ktpId,
  };
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

/** Массовая замена тем в КТП — одной транзакцией (для импорта из Excel). */
export async function replaceKtpTopics(ktpId, items) {
  const old = state.topics.filter((t) => t.ktpId === ktpId);
  const oldIds = new Set(old.map((t) => t.id));
  const affectedLessons = state.lessons.filter((l) => oldIds.has(l.topicId));

  const created = items.map((it, i) => ({
    id: M.uid('top'),
    name: String(it.name).trim(),
    ktpOrder: it.order ?? i + 1,
    ktpId,
  }));

  await db.transaction(['topics', 'lessons'], 'readwrite', (s) => {
    for (const l of affectedLessons) s.lessons.put({ ...l, topicId: null });
    for (const t of old) s.topics.delete(t.id);
    for (const t of created) s.topics.put(t);
  });

  for (const l of affectedLessons) l.topicId = null;
  state.topics = state.topics.filter((t) => !oldIds.has(t.id)).concat(created);
  state.topics.sort((a, b) => (a.ktpOrder || 0) - (b.ktpOrder || 0));
  notify();
  return created.length;
}

/** Дозаписать темы в существующее КТП (не удаляя старые). */
export async function appendKtpTopics(ktpId, items) {
  const existing = state.topics.filter((t) => t.ktpId === ktpId);
  let maxOrder = existing.reduce((mx, t) => Math.max(mx, t.ktpOrder || 0), 0);
  const created = items.map((it) => {
    maxOrder += 1;
    return {
      id: M.uid('top'),
      name: String(it.name).trim(),
      ktpOrder: it.order ?? maxOrder,
      ktpId,
    };
  });
  if (!created.length) return 0;
  await db.bulkPut('topics', created);
  state.topics.push(...created);
  state.topics.sort((a, b) => (a.ktpOrder || 0) - (b.ktpOrder || 0));
  notify();
  return created.length;
}

/* ---------- расписание ---------- */

/** Записи расписания на день недели. */
export function scheduleOfDay(weekday) {
  return state.schedule
    .filter((r) => r.weekday === weekday)
    .sort((a, b) => (a.slot || 0) - (b.slot || 0) || ((M.parseTime(a.time) ?? 0) - (M.parseTime(b.time) ?? 0)));
}

/** Расписание на конкретную дату с учётом переопределений. */
export function scheduleForDate(dateIso) {
  return M.scheduleForDate(state.schedule, state.scheduleOverrides, dateIso);
}

/** Добавить или обновить урок в расписании (по дню недели и номеру). */
export async function setScheduleEntry({ id = null, weekday, slot, classId, time }) {
  const existing = id
    ? state.schedule.find((r) => r.id === id)
    : state.schedule.find((r) => r.weekday === weekday && r.slot === slot);

  const record = {
    id: existing?.id || M.uid('sch'),
    weekday,
    slot,
    classId,
    time: M.normalizeTime(time) || '',
  };
  await db.put('schedule', record);
  if (existing) Object.assign(existing, record);
  else state.schedule.push(record);
  state.schedule.sort((a, b) => (a.weekday - b.weekday) || (a.slot - b.slot));
  notify();
  return record;
}

export async function deleteScheduleEntry(id) {
  await db.del('schedule', id);
  state.schedule = state.schedule.filter((r) => r.id !== id);
  // заодно снимаем переопределения, ссылавшиеся на эту запись
  const linked = state.scheduleOverrides.filter((o) => o.ruleId === id);
  for (const o of linked) await db.del('scheduleOverrides', o.id);
  const linkedIds = new Set(linked.map((o) => o.id));
  state.scheduleOverrides = state.scheduleOverrides.filter((o) => !linkedIds.has(o.id));
  notify();
}

/** Массовая замена расписания (импорт из Excel). */
export async function replaceSchedule(items) {
  const old = [...state.schedule];
  const oldOverrides = [...state.scheduleOverrides];
  const created = items.map((it) => ({
    id: M.uid('sch'),
    weekday: it.weekday,
    slot: it.slot,
    classId: it.classId,
    time: M.normalizeTime(it.time) || '',
  }));

  await db.transaction(['schedule', 'scheduleOverrides'], 'readwrite', (s) => {
    for (const r of old) s.schedule.delete(r.id);
    for (const o of oldOverrides) s.scheduleOverrides.delete(o.id);
    for (const r of created) s.schedule.put(r);
  });

  state.schedule = created.sort((a, b) => (a.weekday - b.weekday) || (a.slot - b.slot));
  state.scheduleOverrides = [];
  notify();
  return created.length;
}

/**
 * Переопределение расписания на дату.
 * action: 'cancel' | 'move' | 'add'
 */
export async function setScheduleOverride(patch) {
  const {date,action,ruleId = null} = patch;
  const record = await db.transaction(['scheduleOverrides'],'readwrite',async s => {
    const table = s.scheduleOverrides;
    const rows = await table.index('date').getAll(date);
    const existing = patch.id ? rows.find(r => r.id === patch.id) : rows.find(r =>
      action === 'add' ? r.action === 'add' && r.slot === patch.slot && r.classId === patch.classId
        : r.ruleId === ruleId && r.action === action);
    if (patch.id && !existing) throw new Error('Запись расписания изменилась');
    const next = {ruleId:null,classId:null,slot:null,time:null,...existing,...patch,id:existing?.id || M.uid('sov')};
    if (patch.time != null) {
      next.time = M.normalizeTime(patch.time);
      if (patch.time && !next.time) throw new Error('Проверьте время урока');
    }
    if (next.slot != null && (!Number.isInteger(next.slot) || next.slot < 1)) throw new Error('Проверьте номер урока');
    await table.put(next);
    return next;
  });
  state.scheduleOverrides = state.scheduleOverrides.filter(r => r.id !== record.id).concat(record);
  notify();
  return record;
}

export async function deleteScheduleOverride(id) {
  await db.del('scheduleOverrides', id);
  state.scheduleOverrides = state.scheduleOverrides.filter((o) => o.id !== id);
  notify();
}

/** Стереть ВСЕ переопределения на дату — «вернуть как в расписании». */
export async function clearOverridesForDate(dateIso) {
  const list = state.scheduleOverrides.filter((o) => o.date === dateIso);
  if (!list.length) return 0;
  await db.transaction(['scheduleOverrides'], 'readwrite', (s) => {
    for (const o of list) s.scheduleOverrides.delete(o.id);
  });
  const ids = new Set(list.map((o) => o.id));
  state.scheduleOverrides = state.scheduleOverrides.filter((o) => !ids.has(o.id));
  notify();
  return list.length;
}

/** Переопределения на конкретную дату. */
export function overridesOfDate(dateIso) {
  return state.scheduleOverrides.filter((o) => o.date === dateIso);
}

/* ---------- резервная копия ---------- */

export async function makeBackup() {
  const data = await db.dumpAll();
  const payload = {
    app: 'teachapp',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    data,
  };
  return payload;
}

export async function restoreBackup(payload) {
  if(payload?.scope)throw Error('Это выборочная копия. Используйте выборочное восстановление; полная замена запрещена');
  const copy = typeof structuredClone === 'function' ? structuredClone(payload) : JSON.parse(JSON.stringify(payload));
  const snapshot = validateBackup(copy);
  await db.replaceAll(snapshot);
  applySnapshot(snapshot);
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

export const participationModes = {
  normal: 'Обычная нагрузка',
  adapted: 'Облегчённая нагрузка',
  paused: 'Временно не выполняет упражнения',
};

/** Режим и основание относятся только к выбранной паре ученик/урок. */
export async function saveParticipation(studentId, lessonId, input, expectedRevision) {
  if (input && (!Object.hasOwn(participationModes, input.mode)
      || !['none', 'parent', 'document'].includes(input.basis)
      || (input.full && (input.basis !== 'document' || input.mode !== 'paused')))) {
    throw new Error('Проверьте режим участия и основание освобождения');
  }
  const result = await db.transaction(['students','lessons','participation','marks','exemptions'], 'readwrite', async s => {
    const [student, lesson, previous, mark, exemptions] = await Promise.all([
      s.students.get(studentId), s.lessons.get(lessonId),
      s.participation.index('studentLesson').get([studentId, lessonId]),
      s.marks.index('lessonId_studentId').get([lessonId, studentId]),
      s.exemptions.index('studentId').getAll(studentId),
    ]);
    if (!student || !lesson || student.classId !== lesson.classId) throw new Error('Ученик или урок недоступен');
    if (expectedRevision !== undefined && (previous?.revision ?? null) !== expectedRevision) {
      throw new Error('Запись изменилась. Откройте её повторно');
    }
    const id = previous?.id || M.uid('part');
    let nextMark = mark;
    const record = input ? { id, studentId, lessonId, date: lesson.date, mode: input.mode,
      activityId: activities().some(a => a.id === input.activityId) ? input.activityId : null,
      alternative: H.alternatives.includes(input.alternative) ? input.alternative : '', basis: input.basis, full: Boolean(input.full), revision: M.uid('rev') } : null;
    nextMark = withCoverage(baseMark(mark),mark,lesson,studentId,exemptions,record);
    if (record?.full) record.markId = nextMark.id;
    await writeMark(s,mark,nextMark);
    if (record) await s.participation.put(record);
    else if (previous) await s.participation.delete(previous.id);
    return { previous, record, nextMark };
  });
  const other = row => row.studentId !== studentId || row.lessonId !== lessonId;
  state.participation = state.participation.filter(other).concat(result.record || []);
  state.marks = state.marks.filter(other).concat(result.nextMark || []);
  notify();
  return () => saveParticipation(studentId, lessonId, result.previous, result.record?.revision ?? null);
}

export const activities = () => [...H.catalog, ...state.activityCategories];
export const healthGroups = () => [...new Set([...H.groups, ...(state.settings.healthGroups || [])])];
export function lessonCheck(lesson) {
  const topic = state.topics.find(t => t.id === lesson.topicId);
  return H.checkLessonRestrictions({ lesson: { ...lesson, activityIds: lesson.activityIds ?? topic?.activityIds },
    activities: activities(), students: state.students, restrictions: state.activityRestrictions });
}

export async function saveProfiles(ids, group, dateFrom, dateTo) {
  if (!ids.length || !ids.every(id => state.students.some(s => s.id === id))
      || (group && !healthGroups().includes(group)) || !H.validPeriod(dateFrom,dateTo)) throw new Error('Проверьте группу, учеников и даты');
  const records = ids.map(id => ({ id, group, dateFrom, dateTo: dateTo || null, updatedAt: new Date().toISOString() }));
  await db.bulkPut('studentHealthProfiles', records);
  state.studentHealthProfiles = state.studentHealthProfiles.filter(p => !ids.includes(p.id)).concat(records);
  notify();
}

export async function saveRestriction(input) {
  const existing = input.id && state.activityRestrictions.find(r => r.id === input.id);
  if (!state.students.some(s => s.id === input.studentId) || !activities().some(a => a.id === input.activityId)
      || !Object.hasOwn(H.types,input.type) || !H.validPeriod(input.dateFrom,input.dateTo)
      || (input.id && existing?.studentId !== input.studentId)) throw new Error('Проверьте упражнение, тип и даты');
  const now = new Date().toISOString();
  const record = { id: existing?.id || M.uid('rest'), studentId: input.studentId, activityId: input.activityId,
    type: input.type, dateFrom: input.dateFrom, dateTo: input.dateTo || null, enabled: input.enabled !== false,
    instruction: input.type === 'individual' ? String(input.instruction || '').trim().slice(0,160) : '',
    createdAt: existing?.createdAt || now, updatedAt: now };
  await db.put('activityRestrictions', record);
  state.activityRestrictions = state.activityRestrictions.filter(r => r.id !== record.id).concat(record);
  notify();
  return record;
}

export async function addActivity(name, parents) {
  const known = activities();
  if (!name.trim() || known.some(a => a.name.toLowerCase() === name.trim().toLowerCase())
      || !parents.every(id => known.some(a => a.id === id))) throw new Error('Проверьте название и категории');
  const record = { id: M.uid('act'), name: name.trim(), parents: [...new Set(parents)] };
  await db.put('activityCategories', record);
  state.activityCategories.push(record);
  notify();
  return record;
}

export function lessonHeld(lesson) {
  return lesson.date <= M.todayIso() && (lesson.held || state.participation.some(p => p.lessonId === lesson.id)
    || state.marks.some(m => m.lessonId === lesson.id && (m.source === 'manual' || m.baseMark?.source === 'manual')));
}

/** Перенос содержания между запланированными уроками. Записи журнала остаются на своих датах. */
export async function transferTopic(sourceId,targetId) {
  const records = await db.transaction(['lessons','marks','participation'],'readwrite',async s => {
    const [source,target] = await Promise.all([s.lessons.get(sourceId),s.lessons.get(targetId)]);
    if (!source?.topicId || !target || source.classId !== target.classId || sourceId === targetId) throw new Error('Выберите другой урок этого класса');
    for (const lesson of [source,target]) {
      const marks = await s.marks.index('lessonId').getAll(lesson.id);
      if (lesson.held || marks.some(m => m.source === 'manual' || m.baseMark?.source === 'manual')
          || await s.participation.index('lessonId').count(lesson.id)) throw new Error('Урок уже проведён или заполнен');
    }
    const updated = [{...source,topicId:target.topicId,activityIds:target.activityIds ?? null},
      {...target,topicId:source.topicId,activityIds:source.activityIds ?? null}];
    for (const lesson of updated) await s.lessons.put(lesson);
    return updated;
  });
  for (const lesson of records) Object.assign(state.lessons.find(l => l.id === lesson.id),lesson);
  notify();
}

export function attendanceFor(lessons,students,classId){
  const parts=new Map(state.participation.map(p=>[p.lessonId+'|'+p.studentId,p]));
  return A.attendanceDetails(lessons.map(l=>({...l,held:lessonHeld(l)})),students,markMap(classId),parts);
}
export async function saveNorm(input){
  const n={id:input.id||M.uid('norm'),name:input.name.trim(),activityId:input.activityId,unit:input.unit,direction:input.direction};
  if(input.scales!==undefined)n.scales=input.scales.map(r=>({classId:r.classId??null,gradeLevel:r.gradeLevel??null,group:r.group,scale:[...r.scale]}));
  else n.scale=[...input.scale];
  A.validateNorm(n,new Set(activities().map(a=>a.id)));
  await db.put('norms',n);state.norms=state.norms.filter(x=>x.id!==n.id).concat(n);notify();return n;
}
export function normCheck(norm,lesson,studentId){
  return lessonCheck({...lesson,activityIds:[norm.activityId,'test'],activitiesConfirmed:true}).matches.filter(m=>m.studentId===studentId);
}
function buildNormResult({normId,studentId,lessonId,status,value=null,basis=''},data){
  const {norm,lesson,cls,students,marks,exemptions,restrictions,custom,parts}=data;
  const student=students.find(s=>s.id===studentId);
  if(!norm||!lesson||!cls||!student||student.classId!==lesson.classId||lesson.date>M.todayIso())throw Error('Проверьте ученика и дату урока');
  const matches=H.checkLessonRestrictions({lesson:{...lesson,activityIds:[norm.activityId,'test'],activitiesConfirmed:true},students,activities:[...H.catalog,...custom],restrictions}).matches.filter(m=>m.studentId===studentId);
  const mark=marks.find(m=>m.studentId===studentId),full=exemptions.some(e=>e.studentId===studentId&&M.exemptionCovers(e,lesson.date))||M.hasOsv(mark),part=parts.find(p=>p.studentId===studentId);
  if(!['done','restricted'].includes(status)||typeof basis!=='string'||basis.length>2000)throw Error('Проверьте результат и основание');
  if(status==='restricted'&&!matches.length&&!full)throw Error('Нет внесённого основания ограничения');
  if(status==='done'&&(full||mark?.flag==='Н'||part?.mode==='paused'||matches.some(m=>['avoid','no_test'].includes(m.restriction.type))))throw Error('Обычная сдача не разрешена по внесённым сведениям');
  if(status==='done'&&(matches.length||part?.mode==='adapted')&&!basis.trim())throw Error('Укажите подтверждённое основание допуска');
  const definition=A.normSnapshot(norm,cls,student);
  return {id:M.uid('result'),normId,studentId,lessonId,date:lesson.date,status,value:status==='done'?value:null,grade:status==='done'?A.gradeNorm(definition,value):null,basis:basis.trim(),definition,createdAt:new Date().toISOString()};
}
async function writeNormResults(normId,lessonId,entries,batch){
  const records=await db.transaction(['normResults','norms','lessons','classes','students','marks','exemptions','activityRestrictions','activityCategories','participation'],'readwrite',async s=>{
    const [norm,lesson]=await Promise.all([s.norms.get(normId),s.lessons.get(lessonId)]);
    if(!norm||!lesson)throw Error('Норматив или урок удалён. Откройте список заново');
    const [cls,students,marks,exemptions,restrictions,custom,parts,existing]=await Promise.all([s.classes.get(lesson.classId),s.students.index('classId').getAll(lesson.classId),s.marks.index('lessonId').getAll(lessonId),s.exemptions.getAll(),s.activityRestrictions.getAll(),s.activityCategories.getAll(),s.participation.index('lessonId').getAll(lessonId),s.normResults.index('lessonId').getAll(lessonId)]);
    if(batch&&entries.some(r=>existing.some(x=>x.normId===normId&&x.studentId===r.studentId)))throw Error('Один из результатов уже существует. Откройте список заново');
    const records=entries.map(r=>buildNormResult({...r,normId,lessonId},{norm,lesson,cls,students,marks,exemptions,restrictions,custom,parts}));
    for(const r of records)await s.normResults.add(r);
    return records;
  });
  state.normResults.push(...records);notify();return records;
}
export async function saveNormResult(input){
  return (await writeNormResults(input.normId,input.lessonId,[input],false))[0];
}
export async function saveNormResultsBatch(normId,lessonId,entries,confirmed=false){
  if(!confirmed)throw Error('Подтвердите сохранение результатов');
  if(!Array.isArray(entries)||!entries.length||entries.length>500||new Set(entries.map(r=>r.studentId)).size!==entries.length)throw Error('Проверьте список учеников');
  return writeNormResults(normId,lessonId,entries,true);
}

export async function importNormScales(rows,{replace=false,confirmed=false,expected=null}={}){
  if(!confirmed)throw Error('Подтвердите импорт');
  const result=await db.transaction(['norms'],'readwrite',async s=>{
    const existing=await s.norms.getAll();
    const plan=planNormImport(rows,existing,activities(),{replace});
    if(plan.errors.length)throw Error(plan.errors.join('; '));
    if(expected&&JSON.stringify(plan.counts)!==JSON.stringify(expected))throw Error('Шкалы изменились. Повторите предпросмотр');
    for(const n of plan.records)await s.norms.put(n);
    return plan;
  });
  const map=new Map(result.records.map(n=>[n.id,n]));state.norms=state.norms.filter(n=>!map.has(n.id)).concat(result.records);notify();return result.counts;
}
export async function deleteNormResult(id){await db.del('normResults',id);state.normResults=state.normResults.filter(r=>r.id!==id);notify();}
export async function transferNormGrade(id,confirmed=false){
  if(!confirmed)throw Error('Подтвердите перенос оценки');
  const r=state.normResults.find(x=>x.id===id),lesson=state.lessons.find(l=>l.id===r?.lessonId);
  if(!r||!lesson||r.status!=='done'||!r.grade||lesson.date!==r.date||lesson.date>M.todayIso())throw Error('Оценка недоступна для переноса');
  if(normCheck(r.definition,lesson,r.studentId).length||activeExemption(r.studentId,lesson.date))throw Error('Сначала проверьте действующие ограничения');
  return editMark(r.studentId,r.lessonId,(base,previous)=>{
    if(previous)throw Error('В журнале уже есть отметка; автоматическая замена запрещена');
    return {id:M.uid('mk'),studentId:r.studentId,lessonId:r.lessonId,value:r.grade,flag:null,source:'manual'};
  },'norm');
}

/* Итоговая оценка сохраняется отдельно. Границы периода — исторический снимок. */
export async function saveFinalGrade(studentId,periodId,value,confirmed=false){
  if(!confirmed)throw Error('Подтвердите изменение итоговой отметки');
  const p=state.settings.trimesters.find(t=>t.id===periodId);
  if(!p||!H.validPeriod(p.from,p.to)||!p.to||p.to>M.todayIso()||!(value===null||['1','2','3','4','5'].includes(value)))throw Error('Выберите завершённый период и отметку 1–5');
  const result=await db.transaction(['students','finalGrades','workRecords'],'readwrite',async s=>{
    if(!await s.students.get(studentId))throw Error('Ученик недоступен');
    const previous=await s.finalGrades.index('studentPeriod').get([studentId,p.from,p.to]);
    const next=value===null?null:{id:previous?.id||M.uid('final'),studentId,from:p.from,to:p.to,periodName:A.periodName(p),value,updatedAt:new Date().toISOString()};
    if(next)await s.finalGrades.put(next);else if(previous)await s.finalGrades.delete(previous.id);
    await appendGradeHistory(s.workRecords,{scope:'final',studentId,from:p.from,to:p.to,periodName:A.periodName(p)},finalState(previous),finalState(next),'final');
    return {previous,next};
  });
  state.finalGrades=state.finalGrades.filter(r=>r.id!==result.previous?.id).concat(result.next||[]);
  notify();return result.next;
}

export async function undoFinalHistory(studentId,from,to,eventId,confirmed=false){
 if(!confirmed)throw Error('Подтвердите отмену итоговой оценки');
 const result=await db.transaction(['students','finalGrades','workRecords'],'readwrite',async s=>{
  if(!await s.students.get(studentId)||!H.validPeriod(from,to)||!to||to>M.todayIso())throw Error('Ученик или период недоступен');
  const [hist,previous]=await Promise.all([s.workRecords.get(finalHistoryKey(studentId,from,to)),s.finalGrades.index('studentPeriod').get([studentId,from,to])]);
  const event=checkUndo(hist,eventId,finalState(previous));
  const next=event.before.value===null?null:{id:previous?.id||M.uid('final'),studentId,from,to,periodName:hist.periodName,value:event.before.value,updatedAt:new Date().toISOString()};
  if(next)await s.finalGrades.put(next);else if(previous)await s.finalGrades.delete(previous.id);
  await appendGradeHistory(s.workRecords,{scope:'final',studentId,from,to,periodName:hist.periodName},finalState(previous),finalState(next),'undo',eventId);
  return {previous,next};
 });
 state.finalGrades=state.finalGrades.filter(r=>r.id!==result.previous?.id).concat(result.next||[]);notify();return result.next;
}

/* Массовые действия урока: только явно выбранные ученики, без перезаписи.
   Проверяем актуальные данные в той же транзакции, что и сохранение. */
export function lessonBatchReason(action,mark,part,covered,matched){
  if(mark)return 'В журнале уже есть отметка';
  if(action==='absent')return part?'Уже зафиксировано участие':'';
  if(covered)return 'Действует освобождение';
  if(matched)return 'Есть ограничение нагрузки';
  if(part&&(action==='normal'||part.mode!=='normal'))return 'Уже зафиксировано участие';
  return '';
}
export async function applyLessonBatch(lessonId,studentIds,action,value=null,confirmed=false){
  if(!confirmed)throw Error('Подтвердите массовое действие');
  if(!Array.isArray(studentIds)||!studentIds.length||studentIds.length>500||new Set(studentIds).size!==studentIds.length||
    !['grade','normal','absent'].includes(action)||(action==='grade'&&!['1','2','3','4','5'].includes(value)))throw Error('Проверьте выбранных учеников и действие');
  const result=await db.transaction(['students','lessons','topics','marks','participation','exemptions','activityRestrictions','activityCategories','workRecords'],'readwrite',async s=>{
    const lesson=await s.lessons.get(lessonId);
    if(!lesson||lesson.date>M.todayIso())throw Error('Урок недоступен или ещё не состоялся');
    const [students,marks,parts,exemptions,restrictions,custom,topic]=await Promise.all([
      s.students.index('classId').getAll(lesson.classId),s.marks.index('lessonId').getAll(lessonId),
      s.participation.index('lessonId').getAll(lessonId),s.exemptions.getAll(),s.activityRestrictions.getAll(),
      s.activityCategories.getAll(),lesson.topicId?s.topics.get(lesson.topicId):Promise.resolve(null)]);
    const ids=new Set(students.map(st=>st.id)),byMark=new Map(marks.map(m=>[m.studentId,m])),byPart=new Map(parts.map(p=>[p.studentId,p]));
    const matches=H.checkLessonRestrictions({lesson:{...lesson,activityIds:lesson.activityIds??topic?.activityIds},activities:[...H.catalog,...custom],students,restrictions}).matches;
    const restricted=new Set(matches.map(m=>m.studentId));
    const nextMarks=[],nextParts=[];
    for(const id of studentIds){
      if(!ids.has(id))throw Error('Состав класса изменился. Откройте урок заново');
      const covered=exemptions.some(x=>x.studentId===id&&M.exemptionCovers(x,lesson.date));
      const reason=lessonBatchReason(action,byMark.get(id),byPart.get(id),covered,restricted.has(id));
      if(reason)throw Error('Массовое действие отменено: '+reason+'. Проверьте список.');
      if(action==='normal')nextParts.push({id:M.uid('part'),studentId:id,lessonId,date:lesson.date,mode:'normal',basis:'none',activityId:null,alternative:'',full:false,revision:M.uid('rev')});
      else {
        const mark={id:M.uid('mk'),studentId:id,lessonId,value:action==='grade'?value:null,flag:action==='absent'?'Н':null,source:'manual'};
        nextMarks.push(withCoverage(mark,null,lesson,id,exemptions,null));
      }
    }
    for(const m of nextMarks){await s.marks.add(m);await appendGradeHistory(s.workRecords,{scope:'lesson',studentId:m.studentId,lessonId},gradeState(null),gradeState(baseMark(m)),'batch');}
    for(const p of nextParts)await s.participation.add(p);
    return {nextMarks,nextParts};
  });
  cacheMarks(result.nextMarks.map(m=>({id:m.id,next:m})));
  state.participation.push(...result.nextParts);notify();
  return studentIds.length;
}
