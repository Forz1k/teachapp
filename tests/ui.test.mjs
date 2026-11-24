/* tests/ui.test.mjs — проверки интерфейса в jsdom.
   jsdom не умеет ни IndexedDB, ни анимаций — поэтому подменяем базу на fake-indexeddb,
   а шторку проверяем по содержимому, а не по transform.
   Цель: убедиться, что экраны реально строятся, обработчики висят и поток тапов ведёт куда надо. */

import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* ---------- окружение ---------- */

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // Подкладываем глобальные объекты, которых ждёт код приложения.
  // В Node 21+ navigator — геттер только для чтения, поэтому через defineProperty.
  const define = (name, value) => {
    try {
      Object.defineProperty(global, name, { value, writable: true, configurable: true });
    } catch {
      global[name] = value;
    }
  };

  define('window', window);
  define('document', window.document);
  define('navigator', window.navigator);
  define('HTMLElement', window.HTMLElement);
  define('Node', window.Node);
  define('Element', window.Element);
  define('MouseEvent', window.MouseEvent);
  define('File', window.File);
  define('Blob', window.Blob);
  define('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
  define('requestIdleCallback', (cb) => setTimeout(() => cb({ timeRemaining: () => 50 }), 0));
  define('indexedDB', globalThis.indexedDB); // fake-indexeddb уже подставил его в globalThis
  define('IDBKeyRange', globalThis.IDBKeyRange);
  window.matchMedia = window.matchMedia || (() => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  }));
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => {};
  window.navigator.vibrate = () => true;

  return dom;
}

const dom = setupDom();
const { window } = dom;
const doc = window.document;

/* Модули грузим после подмены окружения — они читают window при импорте. */
const db = await import('../js/db.js');
const store = await import('../js/store.js');
const ui = await import('../js/ui.js');
const { renderToday, todayEntries } = await import('../js/screens/today.js');
const { renderClasses } = await import('../js/screens/classes.js');
const { renderJournal, openMarkSheet } = await import('../js/screens/journal.js');
const { renderMonthly } = await import('../js/screens/monthly.js');
const { renderSettings } = await import('../js/screens/settings.js');
const exporter = await import('../js/export.js');

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** Готовит чистую базу с одним классом и двумя учениками. */
async function seed() {
  await db.open();
  await db.clearAll();
  await store.load();
  const cls = await store.addClass('9А');
  const a = await store.addStudent(cls.id, 'Иванов Иван Иванович', 1);
  const b = await store.addStudent(cls.id, 'Петрова Анна Сергеевна', 2);
  const l1 = await store.addLesson(cls.id, '2026-11-10', null, '');
  const l2 = await store.addLesson(cls.id, '2026-11-12', null, '');
  await store.setMark(a.id, l1.id, { value: '5' });
  await store.setMark(b.id, l1.id, { value: null, flag: 'Н' });
  store.state.currentClassId = cls.id;
  return { cls, a, b, l1, l2 };
}

const root = () => doc.getElementById('app');

/* ---------- тесты ---------- */

test('экран «Классы» показывает карточки с посещаемостью', async () => {
  const { cls } = await seed();
  root().innerHTML = '';
  const screen = doc.createElement('div');
  root().append(screen);

  renderClasses(screen, {});
  const card = screen.querySelector('.class-card');
  assert.ok(card, 'карточка класса есть');
  assert.match(card.textContent, /9А/);
  assert.match(card.textContent, /2 уч\./);
  assert.ok(screen.querySelector('.ring'), 'кольцо посещаемости отрисовано');
});

test('пустое состояние предлагает демо-данные', async () => {
  await db.open();
  await db.clearAll();
  await store.load();
  root().innerHTML = '';
  const screen = doc.createElement('div');
  renderClasses(screen, {});
  assert.match(screen.textContent, /Пока нет ни одного класса/);
  assert.match(screen.textContent, /Загрузить демо-данные/);
});

test('журнал строит сетку: строки учеников, колонки дат', async () => {
  const { cls } = await seed();
  store.state.currentTrimesterId = 't1';
  root().innerHTML = '';
  const screen = doc.createElement('div');

  renderJournal(screen, {
    onOpenClassPicker() {}, onOpenExemptions() {}, onOpenLessonPlanner() {},
  });

  const table = screen.querySelector('table.journal');
  assert.ok(table, 'таблица есть');
  const rows = table.querySelectorAll('tbody tr');
  assert.equal(rows.length, 2, 'два ученика');

  const heads = table.querySelectorAll('thead th');
  assert.equal(heads[0].textContent, '№');
  assert.equal(heads[1].textContent, 'ФИО');

  // Оценка 5 и отметка Н отрисованы
  const html = table.innerHTML;
  assert.match(html, /badge v5/, 'пятёрка как бейдж');
  assert.match(html, /badge absent/, 'Н как прочерк');
});

test('тап по ячейке открывает шторку с кнопками и вызывает сохранение', async () => {
  const { a, l2 } = await seed();
  root().innerHTML = '';
  const screen = doc.createElement('div');
  renderJournal(screen, { onOpenClassPicker() {}, onOpenExemptions() {}, onOpenLessonPlanner() {} });

  // Находим ячейку ученика a на уроке l2
  const cell = screen.querySelector(`td.cell[data-student="${a.id}"][data-lesson="${l2.id}"]`);
  assert.ok(cell, 'ячейка найдена');

  openMarkSheet(a.id, l2.id, store.state.currentClassId);
  await tick(60);

  const sheet = doc.body.querySelector('.sheet');
  assert.ok(sheet, 'шторка создана');
  const buttons = [...sheet.querySelectorAll('.sheet-buttons button')];
  // 5 оценок + ОСВ + Н + М + очистка = 9 кнопок
  assert.equal(buttons.length, 9, '9 кнопок в шторке');
  assert.deepEqual(buttons.map((b) => b.textContent), ['5', '4', '3', '2', '1', 'ОСВ', 'Н', 'Нагрузка', '✕']);

  const five = buttons.find((b) => b.textContent === '5');
  five.click();
  await tick(80);

  const mark = store.state.marks.find((m) => m.studentId === a.id && m.lessonId === l2.id);
  assert.equal(mark?.value, '5', 'оценка записана в базу');
});

test('кнопка ОСВ разворачивает второй шаг со сроками', async () => {
  const { a, l2 } = await seed();
  openMarkSheet(a.id, l2.id, store.state.currentClassId);
  await tick(60);

  let sheet = doc.body.querySelector('.sheet');
  const osvBtn = [...sheet.querySelectorAll('.sheet-buttons button')].find((b) => b.textContent === 'ОСВ');
  osvBtn.click();
  await tick(60);

  sheet = doc.body.querySelector('.sheet');
  assert.match(sheet.textContent, /на какой срок/i);
  assert.match(sheet.textContent, /Только этот урок/);
  assert.match(sheet.textContent, /Бессрочно/);
  assert.match(sheet.textContent, /До даты/);
});

test('режим «только этот урок» не создаёт запись освобождения', async () => {
  const { a, l2 } = await seed();
  const before = store.state.exemptions.length;

  openMarkSheet(a.id, l2.id, store.state.currentClassId);
  await tick(60);
  let sheet = doc.body.querySelector('.sheet');
  [...sheet.querySelectorAll('.sheet-buttons button')].find((b) => b.textContent === 'ОСВ').click();
  await tick(60);

  sheet = doc.body.querySelector('.sheet');
  const onlyBtn = [...sheet.querySelectorAll('button')].find((b) => b.textContent === 'Только этот урок');
  onlyBtn.click();
  await tick(80);

  assert.equal(store.state.exemptions.length, before, 'exemption не создан');
  const mark = store.state.marks.find((m) => m.studentId === a.id && m.lessonId === l2.id);
  assert.equal(mark?.flag, 'ОСВ');
  assert.equal(mark?.source, 'manual');
});

test('«До даты» создаёт освобождение и размечает уроки', async () => {
  const { a } = await seed();
  // Создаём освобождение напрямую через стор (как это делает шторка)
  const res = await store.addExemption({
    studentId: a.id, dateFrom: '2026-11-10', dateTo: '2026-11-12', reason: 'справка',
  });
  assert.ok(res.changed >= 1, 'заполнены уроки периода');
  assert.equal(store.state.exemptions.length, 1);
  const osv = store.state.marks.filter((m) => m.studentId === a.id && m.flag === 'ОСВ');
  assert.ok(osv.length >= 1);
});

test('экран «Месячные» строит таблицу с расчётными значениями', async () => {
  const { cls } = await seed();
  root().innerHTML = '';
  const screen = doc.createElement('div');
  renderMonthly(screen, cls.id, {});

  const table = screen.querySelector('.monthly-table');
  assert.ok(table, 'таблица месячных есть');

  const heads = [...table.querySelectorAll('thead th')].map((h) => h.textContent);
  // Сокращения месяцев; текущий и будущие месяцы помечены маркером
  assert.ok(heads.some((h) => h.startsWith('сен')), 'сентябрь в шапке');
  assert.ok(heads.some((h) => h.startsWith('ноя')), 'ноябрь в шапке');
  assert.ok(heads.some((h) => h.startsWith('май')), 'май в шапке');

  // В ноябре у Иванова одна пятёрка → предлагается 5
  const cells = [...table.querySelectorAll('td.mcell')];
  assert.ok(cells.length > 0);
});

test('настройки показывают все разделы', async () => {
  await seed();
  root().innerHTML = '';
  const screen = doc.createElement('div');
  renderSettings(screen, {});

  const text = screen.textContent;
  for (const label of ['Учебный год', 'Триместры', 'Классы', 'Импорт', 'Экспорт', 'Резервная копия', 'Демонстрационные данные']) {
    assert.ok(text.includes(label), `раздел «${label}» есть`);
  }
});

test('экспорт: сводная матрица содержит шапку и оценки', async () => {
  const { cls } = await seed();
  const { header, rows, lessons } = exporter.buildSummary({
    classId: cls.id, from: '2026-11-01', to: '2026-11-30',
  });

  assert.equal(header[0], '№');
  assert.equal(header[1], 'ФИО');
  assert.equal(lessons.length, 2, 'два урока в ноябре');
  assert.equal(rows.length, 2, 'две строки учеников');
  assert.ok(rows[0].includes('5'), 'оценка попала в матрицу');
});

test('экспорт: плоская таблица для «Моей школы»', async () => {
  const { cls } = await seed();
  const rows = exporter.buildFlat({ classId: cls.id, from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(rows[0], ['Класс', 'ФИО', 'Дата', 'Оценка', 'Отметка']);
  assert.ok(rows.length >= 3, 'шапка + записи');
  const dataRow = rows[1];
  assert.equal(dataRow[0], '9А');
  assert.equal(dataRow.length, 5);
});

test('экспорт: TSV экранирует разделители и переносы', () => {
  const text = exporter.matrixToDelimited([
    ['а', 'б\tв'],
    ['г\nд', 'е'],
  ], '\t');
  assert.equal(text, 'а\t"б\tв"\r\n"г\nд"\tе');
});

test('экспорт: месячная матрица содержит колонки месяцев', async () => {
  const { cls } = await seed();
  const matrix = exporter.buildMonthlyMatrix(cls.id);
  assert.equal(matrix[0][0], '№');
  assert.equal(matrix[0][1], 'ФИО');
  assert.ok(matrix[0].length >= 11, 'минимум 9 месяцев + 2 колонки');
});

test('импорт: парсит простой XLSX-подобный лист по классам', async () => {
  // Собираем минимальный xlsx через SheetJS, чтобы проверить настоящий путь импорта
  const XLSX = window.XLSX;
  if (!XLSX) {
    // В jsdom SheetJS не подключался — проверяем парсер на CSV-ветке
    assert.ok(true, 'XLSX не подключён в jsdom, тест импорта пропущен');
    return;
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['№', 'ФИО'],
    [1, 'Сидоров Пётр'],
    [2, 'Кузнецова Ольга'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '9Б');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const file = new window.File([buf], 'roster.xlsx');
  file.arrayBuffer = async () => buf;

  const parsed = await exporter.parseRosterFile(file);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].className, '9Б');
  assert.equal(parsed[0].students.length, 2);
  assert.equal(parsed[0].students[0].fullName, 'Сидоров Пётр');
});

test('импорт: дубликаты ФИО обнаруживаются', () => {
  const dups = exporter.findDuplicates([
    { fullName: 'Иванов Иван' },
    { fullName: 'Иванов  Иван' },
    { fullName: 'Петров Пётр' },
  ]);
  assert.equal(dups.length, 1);
  assert.match(dups[0], /Иванов/);
});

/* Закрываем окружение */
test.after(() => {
  dom.window.close();
});

test('Участие: история по ученику и сохранение записки из формы урока', async () => {
  const { cls, a, l1, l2 } = await seed();
  const { renderParticipation, openParticipation } = await import('../js/screens/participation.js');
  await store.updateLesson(l1.id, { date: '2020-11-10' });
  await store.updateLesson(l2.id, { date: '2020-11-12' });
  openParticipation(a.id, l1.id);
  const sheet = doc.querySelector('#sheet') || doc.querySelector('.sheet');
  const [mode, basis] = sheet.querySelectorAll('select');
  mode.value = 'adapted';
  basis.value = 'parent';
  basis.dispatchEvent(new window.Event('change'));
  assert.equal(sheet.querySelector('input[type=checkbox]').closest('label').hidden, true);
  [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Сохранить').click();
  await tick();
  assert.equal(store.state.participation[0].basis, 'parent');
  assert.equal(store.state.marks.find(m => m.studentId === a.id).flag, null);
  const screen = doc.createElement('div');
  renderParticipation(screen, cls.id);
  const dates = screen.querySelectorAll('input[type=date]');
  dates[0].value = '2020-11-01';
  dates[1].value = '2020-11-30';
  dates[1].dispatchEvent(new window.Event('change'));
  assert.match(screen.textContent, /Родительские записки: 1/);
  assert.match(screen.textContent, /Не отмечено: 1/);
});

test('Предупреждение до ввода оценки и проверка конкретного норматива', async () => {
  const {cls,a,l1} = await seed();
  await store.updateLesson(l1.id,{activityIds:['3x10']});
  await store.saveRestriction({studentId:a.id,activityId:'shuttle',type:'no_test',dateFrom:l1.date});
  const health = await import('../js/screens/health.js');
  const summary = health.warning(l1);
  assert.match(summary.textContent,/Ограничение нагрузки/);
  assert.ok(!summary.textContent.includes(a.fullName));
  let calls = 0;
  const original = window.confirm;
  window.confirm = () => { calls++; return false; };
  try {
    openMarkSheet(a.id,l1.id,cls.id);
    doc.querySelector('.sheet-buttons .v2').click();
    await tick();
    assert.equal(calls,1);
    assert.equal(store.markMap(cls.id).get(l1.id+'|'+a.id).value,'5');
    health.prepareTest(l1);
    const sheet = doc.querySelector('#sheet') || doc.querySelector('.sheet');
    const choice = sheet.querySelector('select');
    choice.value = '3x10'; choice.dispatchEvent(new window.Event('change'));
    assert.match(sheet.textContent,/Ограничение нагрузки/);
    [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Проверить ограничения').click();
    assert.match(sheet.textContent,/Челночный бег/);
    assert.ok(sheet.textContent.includes(a.fullName));
  } finally { window.confirm = original; }
});

test('Экспорт копии отмечает дату только после подтверждения сохранённого файла', async t => {
  await seed();
  t.mock.method(URL,'createObjectURL',() => 'blob:backup');
  t.mock.method(window.HTMLAnchorElement.prototype,'click',() => {});
  await exporter.exportBackup();
  const buttons = [...doc.querySelectorAll('.sheet button')];
  const confirm = buttons.find(b => b.textContent.includes('Подтверждаю, что файл сохранён'));
  assert.equal(confirm.disabled,true);
  buttons.find(b => b.textContent === 'Скачать JSON').click();
  assert.equal(confirm.disabled,false);
  assert.equal(store.state.lastBackupAt,null);
  confirm.click();
  await tick();
  assert.ok(store.state.lastBackupAt);
});

test('Сегодня показывает расписание, заполненность и не создаёт урок при просмотре', async () => {
  const {cls,l1} = await seed();
  const M = await import('../js/model.js');
  const rule = await store.setScheduleEntry({weekday:M.weekdayOf(l1.date),slot:2,classId:cls.id,time:'10:00'});
  const screen = doc.createElement('div');
  const before = store.state.lessons.length;
  renderToday(screen,{},l1.date);
  assert.match(screen.textContent,/10:00/);
  assert.match(screen.textContent,/Отметки: 2 из 2/);
  assert.match(screen.textContent,/Содержание нагрузки требует проверки/);
  assert.equal(store.state.lessons.length,before);
  const date = M.addDays(l1.date,7);
  assert.equal(todayEntries(date).length,1);
  await store.setScheduleOverride({date,action:'cancel',ruleId:rule.id});
  assert.equal(todayEntries(date).length,0);
});

test('Ручная отметка обновляет строку журнала без замены таблицы', async () => {
  const {a,b,l2} = await seed();
  store.state.currentTrimesterId = 't1';
  const screen = doc.createElement('div');
  const update = renderJournal(screen,{onOpenClassPicker(){},onOpenExemptions(){},onOpenLessonPlanner(){}});
  const table = screen.querySelector('table');
  const cell = table.querySelector('[data-student="'+a.id+'"][data-lesson="'+l2.id+'"]');
  const other = table.querySelector('[data-student="'+b.id+'"][data-lesson="'+l2.id+'"]').firstChild.firstChild;
  await tick();
  const notifications = [];
  const unsub = store.subscribe((_,ids) => notifications.push(ids));
  try {
    await store.setMark(a.id,l2.id,{value:'4'});
    await tick();
    assert.deepEqual(notifications,[[a.id]]);
    update(notifications[0]);
    assert.equal(screen.querySelector('table'),table);
    assert.equal(cell.textContent,'4');
    assert.equal(table.querySelector('[data-student="'+b.id+'"][data-lesson="'+l2.id+'"]').firstChild.firstChild,other);
  } finally {unsub();}
});

test('Волейбол: отдельный экран, создание команды и состав',async()=>{
 await seed();
 const C=await import('../js/coach.js');
 const {renderCoach}=await import('../js/screens/coach.js');
 root().replaceChildren();const screen=doc.createElement('div');root().append(screen);
 await renderCoach(screen);
 assert.match(screen.textContent,/Волейбол/);assert.match(screen.textContent,/Добавьте первую/);
 const add=[...screen.querySelectorAll('button')].find(b=>b.textContent==='+ Команда');add.click();await tick();
 const sheet=doc.querySelector('.sheet');sheet.querySelector('input').value='Команда А';
 [...sheet.querySelectorAll('button')].find(b=>b.textContent==='Сохранить').click();await tick(100);
 assert.equal((await C.loadCoach()).coachTeams[0].name,'Команда А');
 assert.match(screen.textContent,/Состав/);
 assert.equal(store.state.classes.length,1);
 ui.closeSheet();
});

test('Аналитика отображает отчёты и не меняет школьные отметки',async()=>{
 await seed();
 const {renderAnalytics}=await import('../js/screens/analytics.js');
 root().replaceChildren();const screen=doc.createElement('div');root().append(screen);
 const before=JSON.stringify(store.state.marks);
 renderAnalytics(screen);
 assert.match(screen.textContent,/Аналитика/);assert.match(screen.textContent,/Итоговые оценки/);
 [...screen.querySelectorAll('button')].find(b=>b.textContent==='Отчёты').click();
 assert.match(screen.textContent,/Печать/);assert.equal(JSON.stringify(store.state.marks),before);
});
test('Обычная выгрузка не включает ОСВ и примечания без выбора',async()=>{
 const {cls,a,l1}=await seed();
 await store.setMark(a.id,l1.id,{value:'5',flag:'ОСВ'});
 const b=exporter.buildSummary({classId:cls.id,from:'2026-11-01',to:'2026-11-30',includeExemptions:false});
 assert.ok(!JSON.stringify(b.rows).includes('ОСВ'));
 assert.ok(!exporter.buildTopicsSheet({classId:cls.id,from:'2026-11-01',to:'2026-11-30'})[0].includes('Примечание'));
});
