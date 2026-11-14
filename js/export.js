/* export.js — выгрузка в XLSX (сводная и плоская), CSV, TSV в буфер; резервная копия JSON.
   SheetJS подключается как глобальный XLSX из vendor/xlsx.full.min.js — локально, для офлайна. */

import * as store from './store.js';
import * as M from './model.js';
import { downloadBlob, copyText } from './ui.js';

/** Есть ли SheetJS. Если нет — приложение работает, но XLSX отключается с понятным сообщением. */
export const hasXlsx = () => typeof window.XLSX !== 'undefined';

/* ---------- сбор данных ---------- */

/**
 * Готовит матрицу сводной ведомости за диапазон.
 * @returns {{lessons: Array, rows: Array<Array>, header: Array<string>, monthlyFrom: number}}
 */
export function buildSummary({ classId, from, to, settings }) {
  const cls = store.state.classes.find((c) => c.id === classId);
  const students = store.studentsOfClass(classId);
  const lessons = store.lessonsInRange(classId, from, to);
  const markMap = store.markMap(classId);

  const header = ['№', 'ФИО', ...lessons.map((l) => M.fmtFull(l.date)), 'Средний', 'Посещаемость'];

  const rows = students.map((st) => {
    const cells = [];
    let absent = 0;
    const values = [];

    for (const lesson of lessons) {
      const m = markMap.get(`${lesson.id}|${st.id}`);
      if (!m) { cells.push(''); continue; }
      if (m.flag === 'Н') absent += 1;
      if (m.value && m.flag === 'ОСВ') cells.push(`${m.value}+ОСВ`);
      else if (m.value) cells.push(m.value);
      else if (m.flag) cells.push(m.flag);
      else cells.push('');
      if (m.value) values.push(Number(m.value));
    }

    const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length) : null;
    const att = M.attendance(lessons.length, absent);

    return [
      st.number ?? '',
      st.fullName,
      ...cells,
      avg === null ? '' : avg.toFixed(2).replace('.', ','),
      att.pct === null ? '' : `${String(att.pct).replace('.', ',')}%`,
    ];
  });

  return { cls, students, lessons, header, rows };
}

/** Блок месячных отметок для сводной (справа). */
export function buildMonthlyBlock({ classId, settings }) {
  const students = store.studentsOfClass(classId);
  const months = M.monthsOfYear(settings);
  const head = months.map(({ year, month }) => `${M.monthShort(month).charAt(0).toUpperCase()}${M.monthShort(month).slice(1)}-М`);
  const rows = students.map((st) => months.map(({ year, month }) => {
    const mm = store.monthlyFor(st.id, year, month);
    return mm ? mm.value : '';
  }));
  return { head, rows, months };
}

/** Плоская таблица для «Моей школы»: одна запись на строку. */
export function buildFlat({ classId, from, to }) {
  const cls = store.state.classes.find((c) => c.id === classId);
  const className = cls ? cls.name : '';
  const students = store.studentsOfClass(classId);
  const lessons = store.lessonsInRange(classId, from, to);
  const markMap = store.markMap(classId);
  const rows = [['Класс', 'ФИО', 'Дата', 'Оценка', 'Отметка']];

  for (const st of students) {
    for (const lesson of lessons) {
      const m = markMap.get(`${lesson.id}|${st.id}`);
      if (!m) continue;
      if (!m.value && !m.flag) continue;
      rows.push([
        className,
        st.fullName,
        M.fmtFull(lesson.date),
        m.value || '',
        m.flag || '',
      ]);
    }
  }

  // Месячные — отдельными строками, дата = 1-е число месяца.
  for (const st of students) {
    for (const mm of store.state.monthly.filter((x) => x.studentId === st.id)) {
      if (!mm.value || mm.value === '—') continue;
      const isNum = ['1', '2', '3', '4', '5'].includes(String(mm.value));
      rows.push([
        className,
        st.fullName,
        `01.${String(mm.month).padStart(2, '0')}.${mm.year}`,
        isNum ? String(mm.value) : '',
        isNum ? 'М' : String(mm.value),
      ]);
    }
  }
  return rows;
}

/** Лист «Темы уроков». */
export function buildTopicsSheet({ classId, from, to }) {
  const lessons = store.lessonsInRange(classId, from, to);
  const rows = [['Дата', 'Тема', 'Примечание']];
  for (const l of lessons) {
    const topic = store.state.topics.find((t) => t.id === l.topicId);
    rows.push([M.fmtFull(l.date), topic ? topic.name : '', l.note || '']);
  }
  return rows;
}

/** Матрица «ученики × месяцы» для CSV/TSV. */
export function buildMonthlyMatrix(classId) {
  const students = store.studentsOfClass(classId);
  const months = M.monthsOfYear(store.state.settings);
  const head = ['№', 'ФИО', ...months.map(({ year, month }) => `${M.monthShort(month)}-М`)];
  const rows = students.map((st) => [
    st.number ?? '',
    st.fullName,
    ...months.map(({ year, month }) => {
      const mm = store.monthlyFor(st.id, year, month);
      return mm ? mm.value : '';
    }),
  ]);
  return [head, ...rows];
}

/* ---------- XLSX ---------- */

/** Ширина колонок по содержимому — чтобы файл открывался читаемо. */
function autoWidths(matrix) {
  const cols = Math.max(...matrix.map((r) => r.length), 1);
  const widths = new Array(cols).fill(8);
  for (const row of matrix) {
    row.forEach((cell, i) => {
      const len = String(cell ?? '').length;
      widths[i] = Math.max(widths[i], Math.min(38, len + 2));
    });
  }
  widths[1] = Math.max(widths[1], 26); // ФИО
  return widths.map((w) => ({ wch: w }));
}

function sheetFromMatrix(XLSX, matrix, widths) {
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  ws['!cols'] = widths || autoWidths(matrix);
  ws['!freeze'] = { xSplit: 2, ySplit: 1 };
  return ws;
}

/**
 * Сводная ведомость в XLSX: лист «Журнал», лист «Темы уроков», лист «Месячные».
 */
export function exportXlsxSummary({ classId, from, to, includeMonthly = true }) {
  if (!hasXlsx()) throw new Error('Модуль XLSX не загружен');
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const { cls, header, rows } = buildSummary({ classId, from, to });
  const title = [
    [`Журнал ${cls ? cls.name : ''} — ${M.fmtFull(from)} – ${M.fmtFull(to)}`],
    [],
  ];
  const matrix = [...title, header, ...rows];

  if (includeMonthly) {
    const { head, rows: mrows } = buildMonthlyBlock({ classId });
    // Дописываем блок М справа от «Посещаемости»
    const mHeaderRow = matrix[1];
    const startCol = mHeaderRow.length;
    matrix[1] = [...mHeaderRow, ...head.map((h) => `${h} (мес.)`)];
    rows.forEach((r, i) => {
      matrix[2 + i] = [...r, ...mrows[i]];
    });
  }

  const ws = sheetFromMatrix(XLSX, matrix);
  XLSX.utils.book_append_sheet(wb, ws, 'Журнал');

  const topics = buildTopicsSheet({ classId, from, to });
  XLSX.utils.book_append_sheet(wb, sheetFromMatrix(XLSX, topics), 'Темы уроков');

  const monthly = buildMonthlyMatrix(classId);
  XLSX.utils.book_append_sheet(wb, sheetFromMatrix(XLSX, monthly), 'Месячные');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const name = `Журнал_${cls ? cls.name : 'класс'}_${from}_${to}.xlsx`;
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  return name;
}

/** Плоская выгрузка для «Моей школы» — одна запись на строку, без объединений. */
export function exportXlsxFlat({ classId, from, to }) {
  if (!hasXlsx()) throw new Error('Модуль XLSX не загружен');
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const rows = buildFlat({ classId, from, to });
  const ws = sheetFromMatrix(XLSX, rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Моя школа');
  const cls = store.state.classes.find((c) => c.id === classId);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const name = `МояШкола_${cls ? cls.name : 'класс'}_${from}_${to}.xlsx`;
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  return name;
}

/* ---------- CSV / TSV ---------- */

const csvEscape = (v, delim) => {
  const s = String(v ?? '');
  if (s.includes(delim) || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

/** Матрица → текст с разделителем. BOM добавляется по желанию (для Excel). */
export function matrixToDelimited(matrix, delim = '\t', bom = false) {
  const body = matrix.map((row) => row.map((c) => csvEscape(c, delim)).join(delim)).join('\r\n');
  return (bom ? '\uFEFF' : '') + body;
}

/** CSV для скачивания (разделитель ';' — так Excel в русской локали открывает правильно). */
export function exportCsvSummary({ classId, from, to }) {
  const { cls, header, rows } = buildSummary({ classId, from, to });
  const matrix = [header, ...rows];
  const text = matrixToDelimited(matrix, ';', true);
  const name = `Журнал_${cls ? cls.name : 'класс'}_${from}_${to}.csv`;
  downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), name);
  return name;
}

/** TSV в буфер — основной мобильный сценарий для Google Таблиц. */
export async function copyTsvSummary({ classId, from, to }) {
  const { header, rows } = buildSummary({ classId, from, to });
  const text = matrixToDelimited([header, ...rows], '\t');
  const ok = await copyText(text);
  return { ok, text };
}

export async function copyTsvMonthly(classId) {
  const matrix = buildMonthlyMatrix(classId);
  const text = matrixToDelimited(matrix, '\t');
  const ok = await copyText(text);
  return { ok, text };
}

export async function copyTsvFlat({ classId, from, to }) {
  const rows = buildFlat({ classId, from, to });
  const text = matrixToDelimited(rows, '\t');
  const ok = await copyText(text);
  return { ok, text };
}

/* ---------- импорт расписания ---------- */

const WD_MAP = {
  'пн': 1, 'пон': 1, 'понедельник': 1, 'monday': 1, 'mon': 1, '1': 1,
  'вт': 2, 'втор': 2, 'вторник': 2, 'tuesday': 2, 'tue': 2, '2': 2,
  'ср': 3, 'сред': 3, 'среда': 3, 'wednesday': 3, 'wed': 3, '3': 3,
  'чт': 4, 'чет': 4, 'четверг': 4, 'thursday': 4, 'thu': 4, '4': 4,
  'пт': 5, 'пят': 5, 'пятница': 5, 'friday': 5, 'fri': 5, '5': 5,
  'сб': 6, 'суб': 6, 'суббота': 6, 'saturday': 6, 'sat': 6, '6': 6,
};

/** Угадывает день недели из строки. Возвращает 1..6 или null. */
function parseWeekday(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase().replace(/\./g, '');
  if (!s) return null;
  if (WD_MAP[s]) return WD_MAP[s];
  // «Понедельник, 14 ноября» — ищем первое известное слово
  for (const key of Object.keys(WD_MAP)) {
    if (key.length > 1 && s.startsWith(key)) return WD_MAP[key];
  }
  return null;
}

/**
 * Разбирает Excel с расписанием.
 * Ожидаемые колонки (порядок и названия — гибко): Номер урока | Класс | Время урока | [День недели].
 * Если колонки дня недели нет — считается, что каждый лист соответствует одному дню (имя листа = день).
 *
 * @returns {{entries: Array<{weekday, slot, classId, time, className}>, unknownClasses: string[], warnings: string[]}}
 */
export async function parseScheduleFile(file) {
  if (!hasXlsx()) throw new Error('Модуль XLSX не загружен');
  const XLSX = window.XLSX;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  const entries = [];
  const warnings = [];
  const unknownClasses = new Set();
  const byName = new Map(store.state.classes.map((c) => [c.name.toLowerCase().trim(), c]));

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
    if (!aoa.length) continue;

    // Заголовок: ищем строку с «урок» / «класс» / «время» / «день»
    let headerRow = -1;
    let colSlot = 0, colClass = 1, colTime = 2, colDay = -1;

    for (let i = 0; i < Math.min(4, aoa.length); i++) {
      const row = aoa[i].map((c) => String(c).toLowerCase().trim());
      const joined = row.join('|');
      if (/урок|класс|время|день|slot|class|time|day/.test(joined)) {
        headerRow = i;
        row.forEach((h, idx) => {
          if (/номер\s*урок|^урок|^№\s*урок|slot/.test(h)) colSlot = idx;
          else if (/^класс|class/.test(h)) colClass = idx;
          else if (/время|time/.test(h)) colTime = idx;
          else if (/день|day/.test(h)) colDay = idx;
        });
        break;
      }
    }

    // День недели из имени листа, если колонки нет
    const sheetDay = colDay === -1 ? parseWeekday(sheetName) : null;
    if (colDay === -1 && !sheetDay) {
      warnings.push(`Лист «${sheetName}»: не удалось определить день недели (ни в имени листа, ни в колонке)`);
    }

    const start = headerRow >= 0 ? headerRow + 1 : 0;

    for (let r = start; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row || !row.length) continue;

      const weekday = colDay >= 0 ? parseWeekday(row[colDay]) : sheetDay;
      const slotRaw = String(row[colSlot] ?? '').trim();
      const className = String(row[colClass] ?? '').trim();
      const timeRaw = String(row[colTime] ?? '').trim();

      if (!className && !slotRaw) continue;
      if (/^итого|^всего|^номер/i.test(className)) continue;

      const slot = Number(slotRaw);
      if (!Number.isFinite(slot) || slot <= 0) continue;
      if (!className) continue;

      // Специальная обработка для "окно"
      if (className.toLowerCase() === 'окно') {
        entries.push({
          weekday,
          slot,
          classId: 'window',
          className: 'окно',
          time: M.normalizeTime(timeRaw) || '',
        });
        continue;
      }

      const cls = byName.get(className.toLowerCase().trim());
      if (!cls) {
        unknownClasses.add(className);
        continue;
      }

      entries.push({
        weekday,
        slot,
        classId: cls.id,
        className,
        time: M.normalizeTime(timeRaw) || '',
      });
    }
  }

  if (unknownClasses.size) {
    warnings.push(`Классы не найдены в приложении: ${[...unknownClasses].join(', ')}`);
  }

  return { entries, unknownClasses: [...unknownClasses], warnings };
}

/** Применяет разобранное расписание. */
export async function applySchedule(entries) {
  return store.replaceSchedule(entries);
}

/* ---------- импорт КТП ---------- */

/**
 * Разбирает Excel с темами КТП.
 * Колонки: [Номер |] Тема. Строка заголовка опциональна.
 * Возвращает [{order, name}].
 */
export async function parseKtpFile(file) {
  if (!hasXlsx()) throw new Error('Модуль XLSX не загружен');
  const XLSX = window.XLSX;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  const items = [];
  const warnings = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
    if (!aoa.length) continue;

    // Ищем заголовок, чтобы понять, где тема
    let headerRow = -1;
    let colName = 0, colOrder = -1;
    for (let i = 0; i < Math.min(3, aoa.length); i++) {
      const row = aoa[i].map((c) => String(c).toLowerCase().trim());
      const joined = row.join('|');
      if (/тема|назван|topic|name|содержан/.test(joined) && !/^\d/.test(joined.trim())) {
        headerRow = i;
        row.forEach((h, idx) => {
          if (/тема|назван|topic|name|содержан/.test(h)) colName = idx;
          else if (/^№|^номер|^п\/п|order/.test(h)) colOrder = idx;
        });
        break;
      }
    }

    const start = headerRow >= 0 ? headerRow + 1 : 0;
    let autoOrder = items.length;

    for (let r = start; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row || !row.length) continue;

      // Если колонки темы нет, но есть номер — тема может быть в первой непустой ячейке после номера
      let name = String(row[colName] ?? '').trim();
      if (!name) name = String(row[1] ?? '').trim();
      if (!name) name = String(row[0] ?? '').trim();
      if (!name) continue;
      if (/^(№|номер|п\/п|тема|итого|всего)$/i.test(name)) continue;
      // Слишком короткие строки-мусор пропускаем
      if (name.length < 3) continue;

      const orderRaw = colOrder >= 0 ? Number(String(row[colOrder] ?? '').trim()) : NaN;
      autoOrder += 1;
      items.push({
        order: Number.isFinite(orderRaw) && orderRaw > 0 ? orderRaw : autoOrder,
        name,
        sheet: sheetName,
      });
    }
  }

  // Сортируем по указанному порядку, если он был
  items.sort((a, b) => a.order - b.order);

  if (!items.length) warnings.push('В файле не найдено ни одной темы');
  return { items, warnings, sheets: wb.SheetNames };
}

/** Применяет темы к КТП: заменить целиком или дописать. */
export async function applyKtpTopics(ktpId, items, { append = false } = {}) {
  if (append) return store.appendKtpTopics(ktpId, items);
  return store.replaceKtpTopics(ktpId, items);
}

/* ---------- бэкап ---------- */

export async function exportBackup() {
  const payload = await store.makeBackup();
  const name = `teachapp-backup-${payload.createdAt.slice(0, 10)}.json`;
  downloadBlob(new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' }), name);
  return name;
}

/** Читает файл как JSON-бэкап. */
export async function readBackupFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

/* ---------- импорт списков ---------- */

/**
 * Разбирает XLSX/CSV со списками классов.
 * Поддерживает два формата:
 *  1) по листу на класс: имя листа = название класса;
 *  2) один лист с колонкой класса.
 * Колонки ищутся по заголовку, если он есть: «№», «ФИО», «Класс».
 * Возвращает [{className, students: [{number, fullName}]}] без записи в базу.
 */
export async function parseRosterFile(file) {
  if (!hasXlsx()) throw new Error('Модуль XLSX не загружен');
  const XLSX = window.XLSX;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  const result = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
    if (!aoa.length) continue;

    // Определяем, где заголовок: ищем строку, в которой встречается /фио|ф\.и\.о|ученик/i
    let headerRow = -1;
    for (let i = 0; i < Math.min(4, aoa.length); i++) {
      const joined = aoa[i].map((c) => String(c).toLowerCase()).join('|');
      if (/фио|ф\.\s?и\.\s?о|ученик|обучающ/.test(joined)) { headerRow = i; break; }
    }

    let colName = 1, colNum = 0, colClass = -1;
    if (headerRow >= 0) {
      const hdr = aoa[headerRow].map((c) => String(c).toLowerCase().trim());
      hdr.forEach((h, i) => {
        if (/фио|ф\.\s?и\.\s?о|ученик|обучающ|фамил/.test(h)) colName = i;
        else if (/^№|номер|num/.test(h)) colNum = i;
        else if (/класс|class/.test(h)) colClass = i;
      });
    }

    const start = headerRow >= 0 ? headerRow + 1 : 0;
    const sheetClass = String(sheetName).trim();
    const sheetLooksLikeClass = /^\d+\s*[а-яa-z]?$/i.test(sheetClass) || /^\d+\s*[-–]?\s*[А-ЯA-Z]$/.test(sheetClass);

    const byClass = new Map();

    for (let r = start; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row || !row.length) continue;
      const nameRaw = String(row[colName] ?? '').trim();
      if (!nameRaw) continue;
      // Отсеиваем строки-мусор: слишком короткие или похожие на заголовки
      if (nameRaw.length < 3) continue;
      if (/^(фио|итого|всего)$/i.test(nameRaw)) continue;
      if (!/[А-Яа-яЁёA-Za-z]/.test(nameRaw)) continue;
      if (/\d{2}\.\d{2}\.\d{2,4}/.test(nameRaw)) continue; // это дата, не ФИО

      let className = sheetClass;
      if (colClass >= 0 && String(row[colClass] ?? '').trim()) {
        className = String(row[colClass]).trim();
      } else if (!sheetLooksLikeClass) {
        // Лист назван не как класс — пробуем взять класс из первой колонки.
        const first = String(row[0] ?? '').trim();
        if (/^\d+\s*[А-ЯA-Zа-я]?$/i.test(first) && first !== nameRaw) {
          className = first.replace(/\s+/g, '');
        }
      }

      if (!byClass.has(className)) byClass.set(className, []);
      const numRaw = Number(String(row[colNum] ?? '').trim());
      byClass.get(className).push({
        number: Number.isFinite(numRaw) && numRaw > 0 ? numRaw : byClass.get(className).length + 1,
        fullName: nameRaw.replace(/\s+/g, ' '),
      });
    }

    for (const [className, students] of byClass) {
      if (!students.length) continue;
      // Если класс уже встречался в другом листе — дополняем
      const existing = result.find((x) => x.className === className);
      if (existing) existing.students.push(...students);
      else result.push({ className, students });
    }
  }

  return result;
}

/** Дубликаты ФИО внутри класса — предупреждение учителю. */
export function findDuplicates(students) {
  const seen = new Map();
  const dups = [];
  for (const s of students) {
    const key = s.fullName.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) dups.push(s.fullName);
    else seen.set(key, true);
  }
  return [...new Set(dups)];
}

/** Применяет разобранный список к базе. Существующих учеников обновляет по ФИО, оценки сохраняются. */
export async function applyRoster(parsed) {
  const report = { classes: 0, added: 0, updated: 0 };

  for (const { className, students } of parsed) {
    let cls = store.state.classes.find((c) => c.name.toLowerCase() === className.toLowerCase());
    if (!cls) {
      cls = await store.addClass(className);
      report.classes += 1;
    }

    const existing = store.studentsOfClass(cls.id);
    for (const s of students) {
      const norm = (n) => n.toLowerCase().replace(/\s+/g, ' ');
      const found = existing.find((x) => norm(x.fullName) === norm(s.fullName));
      if (found) {
        if (found.number !== s.number || found.fullName !== s.fullName) {
          await store.updateStudent(found.id, { number: s.number, fullName: s.fullName });
          report.updated += 1;
        }
      } else {
        await store.addStudent(cls.id, s.fullName, s.number);
        report.added += 1;
      }
    }
  }

  return report;
}
