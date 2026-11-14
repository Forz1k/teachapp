/* model.js — предметная логика без DOM.
   Здесь всё, что можно проверить тестами: идентификаторы, даты, конфликты отметок,
   автозаполнение ОСВ по справкам, расчёт месячной отметки «М», посещаемость.
   Модуль ничего не знает про IndexedDB и про интерфейс. */

/* ---------- идентификаторы ---------- */

let _counter = 0;
/** Устойчивый локальный id: не зависит от crypto.randomUUID (его нет в старых WebView). */
export function uid(prefix = 'id') {
  _counter = (_counter + 1) % 100000;
  const rnd = Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}_${Date.now().toString(36)}${_counter.toString(36)}${rnd}`;
}

/* ---------- даты (только ISO 'YYYY-MM-DD', без часовых поясов) ---------- */

export const iso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Парсинг ISO в локальную дату. new Date('2026-11-12') дал бы UTC — так нельзя. */
export function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayIso = () => iso(new Date());

export function addDays(isoStr, n) {
  const d = parseIso(isoStr);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function addMonths(isoStr, n) {
  const d = parseIso(isoStr);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return iso(d);
}

export const monthOf = (isoStr) => Number(isoStr.slice(5, 7));
export const yearOf = (isoStr) => Number(isoStr.slice(0, 4));

/** '12.11' — для шапки колонок. */
export const fmtShort = (isoStr) => `${isoStr.slice(8, 10)}.${isoStr.slice(5, 7)}`;
/** '12.11.2026' */
export const fmtFull = (isoStr) => `${isoStr.slice(8, 10)}.${isoStr.slice(5, 7)}.${isoStr.slice(0, 4)}`;

const MONTH_NAMES = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const MONTH_NAMES_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MONTH_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

export const monthName = (m) => MONTH_NAMES[m - 1] || '';
export const monthNameGen = (m) => MONTH_NAMES_GEN[m - 1] || '';
export const monthShort = (m) => MONTH_SHORT[m - 1] || '';

export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

/** Последний день месяца в ISO. */
export const endOfMonth = (y, m) => `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`;

/* ---------- учебный год и триместры ---------- */

/** Значения по умолчанию. Реальный год учитель задаёт в настройках. */
export function defaultSettings() {
  return {
    id: 'settings',
    year: { from: '2026-09-01', to: '2027-05-31' },
    trimesters: [
      { id: 't1', kind: 'trimester', index: 1, from: '2026-09-01', to: '2026-11-30' },
      { id: 't2', kind: 'trimester', index: 2, from: '2026-12-01', to: '2027-02-28' },
      { id: 't3', kind: 'trimester', index: 3, from: '2027-03-01', to: '2027-05-31' },
    ],
    rules: {
      mode: 'A',            // A — округление, B — вес 2 у контрольных, C — банк (.5 в пользу ученика)
      capAt3OnBad: false,   // не выводить М выше 3 при наличии 1–2 в месяце
      incompleteMonthPreview: true,
    },
    theme: 'auto',
    lastBackupAt: null,
    breath: true, // заставка/анимация статуса
  };
}

/** Календарные месяцы, пересекающиеся с диапазоном [from, to]. Возвращает [{year, month}]. */
export function monthsInRange(from, to) {
  if (!from || !to) return [];
  const out = [];
  let y = yearOf(from), m = monthOf(from);
  const yEnd = yearOf(to), mEnd = monthOf(to);
  let guard = 0;
  while ((y < yEnd || (y === yEnd && m <= mEnd)) && guard++ < 48) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function inRange(dateIso, from, to) {
  return (!from || dateIso >= from) && (!to || dateIso <= to);
}

/** Триместр, в который попадает дата (или null). */
export function trimesterOf(dateIso, settings) {
  return (settings.trimesters || []).find((t) => inRange(dateIso, t.from, t.to)) || null;
}

/** Месяцы триместра с пометкой partial — если месяц выходит за границы триместра. */
export function monthsOfTrimester(trimester) {
  return monthsInRange(trimester.from, trimester.to).map(({ year, month }) => {
    const mFrom = `${year}-${String(month).padStart(2, '0')}-01`;
    const mTo = endOfMonth(year, month);
    const partial = mFrom < trimester.from || mTo > trimester.to;
    return { year, month, partial };
  });
}

/** Месяцы учебного года (сентябрь…май, июнь — только если год до него доходит). */
export function monthsOfYear(settings) {
  return monthsInRange(settings.year.from, settings.year.to);
}

/** Идёт ли месяц сейчас (или ещё не начался). Нужно для «предварительно» в шапке М. */
export function monthState(year, month, now = todayIso()) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = endOfMonth(year, month);
  if (now < start) return 'future';
  if (now > end) return 'past';
  return 'current';
}

/* ---------- оценки: допустимые сочетания ---------- */

export const VALUES = ['5', '4', '3', '2', '1'];
export const FLAGS = ['ОСВ', 'Н', 'М'];

/**
 * Нормализует ячейку отметки по правилам из ТЗ:
 *  - Н и 1..5 — взаимоисключающие (Н убирает оценку),
 *  - М в сетке уроков не ставится (М — отдельная сущность месяца),
 *  - ОСВ совместим с оценкой (5 + ОСВ),
 *  - ОСВ совместим с Н (освобождён, но отсутствовал).
 * Возвращает { value, flag } либо null, если ячейку надо очистить.
 */
export function normalizeMark({ value = null, flag = null } = {}) {
  if (value === '--') value = null;
  if (flag === 'М') { flag = null; } // защита от ошибочного вызова
  if (value === null && flag === null) return null;

  if (flag === 'Н') {
    // Н несовместим с оценкой — оценка отбрасывается.
    return { value: null, flag: 'Н' };
  }
  if (flag === 'ОСВ') {
    return { value: value && VALUES.includes(String(value)) ? String(value) : null, flag: 'ОСВ' };
  }
  if (value && VALUES.includes(String(value))) {
    return { value: String(value), flag: null };
  }
  return null;
}

/** Правило обучения: можно ли ставить Н, если ученик освобождён в этот день (требует подтверждения). */
export function needsAbsenceConfirm(exemption, dateIso) {
  return !!exemption && exemptionCovers(exemption, dateIso);
}

export function exemptionCovers(ex, dateIso) {
  if (!ex) return false;
  return ex.dateFrom <= dateIso && (ex.dateTo === null || dateIso <= ex.dateTo);
}

/** Активность освобождения: бессрочное — активно всегда, иначе по дате. */
export function exemptionActive(ex, dateIso = todayIso()) {
  if (!ex) return false;
  if (ex.dateFrom > dateIso) return false;
  return ex.dateTo === null || ex.dateTo >= dateIso;
}

/** Человекочитаемый срок освобождения. */
export function exemptionLabel(ex) {
  if (!ex) return '';
  if (ex.dateTo === null) return `с ${fmtFull(ex.dateFrom)} — бессрочно`;
  if (ex.dateFrom === ex.dateTo) return fmtFull(ex.dateFrom);
  return `${fmtFull(ex.dateFrom)} — ${fmtFull(ex.dateTo)}`;
}

/* ---------- расписание ---------- */

/** Дни недели в порядке, принятом в школе: 1 = понедельник … 6 = суббота. */
export const WEEKDAYS = [
  { n: 1, short: 'Пн', full: 'Понедельник' },
  { n: 2, short: 'Вт', full: 'Вторник' },
  { n: 3, short: 'Ср', full: 'Среда' },
  { n: 4, short: 'Чт', full: 'Четверг' },
  { n: 5, short: 'Пт', full: 'Пятница' },
  { n: 6, short: 'Сб', full: 'Суббота' },
];

/** День недели ISO-даты: 1..7, где вс = 7. Приводим к школьному 1..6. */
export function weekdayOf(isoStr) {
  const dow = parseIso(isoStr).getDay(); // 0 = вс
  return dow === 0 ? 7 : dow;
}

export const weekdayName = (n) => {
  const w = WEEKDAYS.find((x) => x.n === n);
  return w ? w.short : '';
};

export const weekdayFull = (n) => {
  const w = WEEKDAYS.find((x) => x.n === n);
  return w ? w.full : '';
};

/**
 * Разбор строки времени «08:30» / «8.30» / «8 30» в минуты от полуночи.
 * Возвращает null, если разобрать не удалось.
 */
export function parseTime(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})\s*[:.\-\s]\s*(\d{2})$/);
  if (!m) {
    // Может быть просто число — считаем часами ровно
    const h = String(str).trim().match(/^(\d{1,2})$/);
    if (h) {
      const hh = Number(h[1]);
      return hh >= 0 && hh <= 23 ? hh * 60 : null;
    }
    return null;
  }
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Приводит время к виду «08:30» или «08:30-09:15» (для хранения и отображения). */
export function normalizeTime(str) {
  if (!str) return '';
  const s = String(str).trim();
  
  // Проверяем, является ли строка диапазоном времени (например, "15:00-15:40" или "15.00 - 15.40")
  const rangeMatch = s.match(/^(\d{1,2})\s*[:.]\s*(\d{2})\s*[-–]\s*(\d{1,2})\s*[:.]\s*(\d{2})$/);
  if (rangeMatch) {
    const h1 = String(Number(rangeMatch[1])).padStart(2, '0');
    const m1 = String(Number(rangeMatch[2])).padStart(2, '0');
    const h2 = String(Number(rangeMatch[3])).padStart(2, '0');
    const m2 = String(Number(rangeMatch[4])).padStart(2, '0');
    return `${h1}:${m1}-${h2}:${m2}`;
  }

  // Стандартная обработка одиночного времени
  const minutes = parseTime(str);
  if (minutes === null) return '';
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const fmtTime = (str) => normalizeTime(str) || '';

/**
 * Собирает расписание на конкретную дату с учётом переопределений.
 * @param {Array} rules     — записи расписания [{id, weekday, slot, classId, time}]
 * @param {Array} overrides — переопределения на дату [{id, date, ruleId|null, action, classId, slot, time}]
 * @param {string} dateIso
 * @returns {Array} отсортированные по номеру урока записи {slot, classId, time, override?}
 */
export function scheduleForDate(rules, overrides, dateIso) {
  const weekday = weekdayOf(dateIso);
  const dayOverrides = overrides.filter((o) => o.date === dateIso);
  const byRule = new Map();
  const added = [];

  for (const rule of rules) {
    if (rule.weekday !== weekday) continue;
    byRule.set(rule.id, { ...rule, override: null });
  }

  for (const ov of dayOverrides) {
    if (ov.action === 'cancel' && ov.ruleId && byRule.has(ov.ruleId)) {
      byRule.delete(ov.ruleId);
    } else if (ov.action === 'move' && ov.ruleId && byRule.has(ov.ruleId)) {
      const item = byRule.get(ov.ruleId);
      if (ov.time) item.time = ov.time;
      if (ov.classId) item.classId = ov.classId;
      if (ov.slot) item.slot = ov.slot;
      item.override = ov;
    } else if (ov.action === 'add') {
      added.push({
        id: ov.id,
        slot: ov.slot,
        classId: ov.classId,
        time: ov.time,
        weekday,
        override: ov,
      });
    }
  }

  const list = [...byRule.values(), ...added];
  return list.sort((a, b) => {
    if (a.slot !== b.slot) return (a.slot || 0) - (b.slot || 0);
    const ta = parseTime(a.time) ?? 9999;
    const tb = parseTime(b.time) ?? 9999;
    return ta - tb;
  });
}

/** Есть ли переопределения на дату (чтобы показать маркер «изменено»). */
export function hasOverrides(overrides, dateIso) {
  return overrides.some((o) => o.date === dateIso);
}

/** Следующая дата после указанной, когда у учителя есть уроки. Для кнопки «сегодня». */
export function findNextDateWithLessons(rules, overrides, fromIso, limit = 60) {
  let d = fromIso;
  for (let i = 0; i < limit; i++) {
    const list = scheduleForDate(rules, overrides, d);
    if (list.length) return { date: d, list };
    d = addDays(d, 1);
  }
  return null;
}

/* ---------- посещаемость ---------- */

/**
 * Посещаемость: (уроки − Н) / уроки.
 * ОСВ при этом не считается отсутствием: освобождённый ученик не «пропустил» урок.
 * Возвращает { total, absent, pct } — pct как число 0..100 или null, если уроков нет.
 */
export function attendance(lessonCount, absentCount) {
  if (!lessonCount) return { total: 0, absent: 0, pct: null };
  return {
    total: lessonCount,
    absent: absentCount,
    pct: Math.round(((lessonCount - absentCount) / lessonCount) * 1000) / 10,
  };
}

/* ---------- месячная отметка «М» ---------- */

/** Среднее по массиву чисел. */
const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;

/**
 * Преобразование среднего в целое 1..5.
 * Режим A — обычное школьное округление (>=4.5 → 5).
 * Режим B — то же, но оценки с весом 2 считаются дважды (средневзвешенное).
 * Режим C — «банк»: .5 в пользу ученика (то есть 3.5 → 4), что арифметически совпадает с A,
 *            но при весах требует отдельного порога; держим отдельно, чтобы правило было явным.
 */
export function rawToMark(raw, mode = 'A') {
  if (raw === null || Number.isNaN(raw)) return null;
  if (mode === 'C') {
    // Банк: к ближайшему целому, .5 — в пользу ученика (вверх).
    return Math.min(5, Math.max(1, Math.floor(raw + 0.5)));
  }
  // A и B используют одинаковые пороги; разница только в исходных весах.
  if (raw >= 4.5) return 5;
  if (raw >= 3.5) return 4;
  if (raw >= 2.5) return 3;
  if (raw >= 1.5) return 2;
  return 1;
}

/**
 * Расчёт предложенной месячной отметки.
 * @param {object} p
 * @param {Array}  p.lessons   — уроки класса за месяц [{id, date}]
 * @param {Array}  p.marks     — отметки ученика по этим урокам [{lessonId, value, flag, weight}]
 * @returns {{pick: string|null, raw: number|null, count: number, osvOnly: boolean, allAbsent: boolean, capped: boolean}}
 */
export function computeMonthly({ lessons, marks, rules = {} }) {
  const byLesson = new Map();
  for (const m of marks) byLesson.set(m.lessonId, m);

  const numbers = [];
  let weightSum = 0, weightCount = 0;
  let withOsv = 0, withAbsent = 0, filled = 0;

  for (const lesson of lessons) {
    const m = byLesson.get(lesson.id);
    if (!m || (!m.value && !m.flag)) continue;
    filled += 1;
    if (m.flag === 'ОСВ') withOsv += 1;
    if (m.flag === 'Н') withAbsent += 1;
    if (m.value) {
      const v = Number(m.value);
      numbers.push(v);
      const w = m.weight === 2 ? 2 : 1;
      weightSum += v * w;
      weightCount += w;
    }
  }

  const total = lessons.length;

  // шаг 2: оценок нет — что предлагать?
  if (numbers.length === 0) {
    if (total > 0 && withOsv === total) {
      return { pick: 'ОСВ', raw: null, count: 0, osvOnly: true, allAbsent: false, capped: false };
    }
    if (total > 0 && withAbsent === total) {
      return { pick: 'Н', raw: null, count: 0, osvOnly: false, allAbsent: true, capped: false };
    }
    return { pick: '—', raw: null, count: 0, osvOnly: false, allAbsent: false, capped: false };
  }

  const mode = rules.mode || 'A';
  // шаг 3: среднее
  const raw = mode === 'B' && weightCount ? weightSum / weightCount : avg(numbers);

  // шаг 4: в целое
  let pick = rawToMark(raw, mode);

  // шаг 5: ограничение при наличии 1–2
  let capped = false;
  if (rules.capAt3OnBad && pick !== null && pick > 3 && numbers.some((n) => n <= 2)) {
    pick = 3;
    capped = true;
  }

  return { pick: pick === null ? '—' : String(pick), raw, count: numbers.length, osvOnly: false, allAbsent: false, capped };
}

/** Красиво печатает среднее: «4,2». */
export const fmtAvg = (raw) => (raw === null || raw === undefined ? '—' : raw.toFixed(1).replace('.', ','));

/** Приведение значения в месячной ячейке к строке для отображения. */
export function monthlyDisplay(mm) {
  if (!mm) return '';
  return mm.value ?? '';
}

/** Устарела ли принятая М относительно нового расчёта. */
export function isMonthlyStale(mm, suggestion) {
  // Нет принятого значения — сравнивать нечего, предлагаем принять расчётное.
  if (!mm || !mm.value) return false;
  if (suggestion === null || suggestion === undefined) return false;
  return String(mm.value) !== String(suggestion);
}

/* ---------- ОСВ: какие ячейки менять ---------- */

/**
 * Строит план изменения auto-osv отметок при создании/снятии/правке освобождения.
 * Не мутирует данные — возвращает списки для записи, чтобы вызывающий код
 * сделал это одной транзакцией.
 *
 * @param {object} p
 * @param {Array} p.lessons      — все уроки класса в диапазоне проверки
 * @param {Array} p.marks        — все отметки класса
 * @param {Array} p.studentIds   — ученики, которых касается освобождение
 * @param {string|null} p.from   — новое начало (null при снятии)
 * @param {string|null} p.to     — новый конец (null = бессрочно)
 * @returns {{toPut: Array, toDelete: Array}}
 */
export function planOsv({ lessons, marks, studentIds, from, to }) {
  const studentSet = new Set(studentIds);
  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  const covered = new Set();  // ячейки, которые уже покрыты справкой
  const toPut = [];
  const toDelete = [];

  for (const mark of marks) {
    if (!studentSet.has(mark.studentId)) continue;
    const lesson = lessonById.get(mark.lessonId);
    if (!lesson) continue;

    const inPeriod = from !== null && lesson.date >= from && (to === null || lesson.date <= to);

    if (mark.source === 'auto-osv') {
      if (!inPeriod) {
        toDelete.push(mark);
      } else {
        covered.add(`${mark.lessonId}|${mark.studentId}`);
      }
    } else if (inPeriod) {
      covered.add(`${mark.lessonId}|${mark.studentId}`);
      // Ручную отметку Н при включении справки перезаписываем на ОСВ, оценку сохраняем.
      if (mark.flag === 'Н') {
        toPut.push({ ...mark, flag: 'ОСВ', source: 'auto-osv' });
      } else if (!mark.flag && mark.value) {
        // Оценка без флага — добавляем бейдж ОСВ, но не трогаем source (оценка остаётся ручной).
        toPut.push({ ...mark, flag: 'ОСВ' });
      }
    }
  }

  // Уроки в периоде, где у ученика нет ни одной отметки, — создаём auto-osv.
  if (from !== null) {
    for (const lesson of lessons) {
      if (!(lesson.date >= from && (to === null || lesson.date <= to))) continue;
      for (const studentId of studentSet) {
        const key = `${lesson.id}|${studentId}`;
        if (covered.has(key)) continue;
        covered.add(key);
        toPut.push({
          id: uid('mk'),
          studentId,
          lessonId: lesson.id,
          value: null,
          flag: 'ОСВ',
          source: 'auto-osv',
        });
      }
    }
  }

  return { toPut, toDelete };
}

/**
 * Снимает auto-osv отметки вне нового диапазона. Чистый вариант плана для «снять справку целиком».
 * Возвращает количество к удалению — для диалога «Будет удалено N отметок ОСВ».
 */
export function countOsvToDelete({ lessons, marks, studentId, from, to }) {
  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  let n = 0;
  for (const mark of marks) {
    if (mark.studentId !== studentId || mark.source !== 'auto-osv') continue;
    const lesson = lessonById.get(mark.lessonId);
    if (!lesson) continue;
    const inside = from !== null && lesson.date >= from && (to === null || lesson.date <= to);
    if (!inside) n += 1;
  }
  return n;
}
/** Сортировка учеников: по номеру (числом), затем по ФИО. */
export function sortStudents(list) {
  return [...list].sort((a, b) => {
    const na = Number(a.number), nb = Number(b.number);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    if (!Number.isNaN(na) && Number.isNaN(nb)) return -1;
    if (Number.isNaN(na) && !Number.isNaN(nb)) return 1;
    return a.fullName.localeCompare(b.fullName, 'ru');
  });
}

/** Короткое ФИО: «Иванов И.» из «Иванов Иван Сергеевич». */
export function shortName(fullName) {
  const parts = String(fullName).trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || '';
  return `${parts[0]} ${parts[1][0]}.`;
}

/** Фамилия и инициалы с двумя инициалами, если есть отчество. */
export function initialsName(fullName) {
  const parts = String(fullName).trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || '';
  const ini = parts.slice(1).map((p) => p[0] + '.').join('');
  return `${parts[0]} ${ini}`;
}

/** Сортировка уроков по дате. */
export function sortLessons(list) {
  return [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
