/* tests/model.test.mjs — проверки бизнес-логики без браузера.
   Запуск: node --test tests/

   Покрываем то, где ошибка дороже всего:
   • правила сочетания оценок и флагов (Н несовместим с оценкой, ОСВ совместим),
   • расчёт месячной отметки М во всех режимах и с ограничением,
   • подсчёт посещаемости,
   • работу с датами без часовых поясов,
   • месяцы триместров и признак частичного месяца. */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';

/* ---------- даты ---------- */

test('iso и parseIso не съезжают на часовой пояс', () => {
  assert.equal(M.iso(new Date(2026, 10, 12)), '2026-11-12');
  assert.equal(M.parseIso('2026-11-12').getMonth(), 10);
  assert.equal(M.parseIso('2026-11-12').getDate(), 12);
});

test('addDays переходит через месяц и год', () => {
  assert.equal(M.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(M.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(M.addDays('2027-02-28', 1), '2027-03-01'); // 2027 не високосный
  assert.equal(M.addDays('2028-02-28', 1), '2028-02-29');
});

test('addMonths корректно обрабатывает короткие месяцы', () => {
  assert.equal(M.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(M.addMonths('2026-03-31', -1), '2026-02-28');
});

test('fmtShort и fmtFull форматируют русские даты', () => {
  assert.equal(M.fmtShort('2026-11-12'), '12.11');
  assert.equal(M.fmtFull('2026-11-12'), '12.11.2026');
});

test('endOfMonth учитывает високосные годы', () => {
  assert.equal(M.endOfMonth(2027, 2), '2027-02-28');
  assert.equal(M.endOfMonth(2028, 2), '2028-02-29');
  assert.equal(M.endOfMonth(2026, 12), '2026-12-31');
});

/* ---------- нормализация отметок ---------- */

test('Н исключает оценку', () => {
  assert.deepEqual(M.normalizeMark({ value: '4', flag: 'Н' }), { value: null, flag: 'Н' });
});

test('ОСВ сохраняет оценку рядом с бейджем', () => {
  assert.deepEqual(M.normalizeMark({ value: '5', flag: 'ОСВ' }), { value: '5', flag: 'ОСВ' });
  assert.deepEqual(M.normalizeMark({ value: null, flag: 'ОСВ' }), { value: null, flag: 'ОСВ' });
});

test('М в ячейке урока не ставится', () => {
  assert.equal(M.normalizeMark({ value: null, flag: 'М' }), null);
  assert.deepEqual(M.normalizeMark({ value: '4', flag: 'М' }), { value: '4', flag: null });
});

test('пустая ячейка превращается в null', () => {
  assert.equal(M.normalizeMark({ value: null, flag: null }), null);
  // Прочерк — тоже пустота: отметку надо удалить, а не хранить строку «—».
  assert.equal(M.normalizeMark({ value: '—', flag: null }), null);
});

/* ---------- освобождения ---------- */

test('exemptionCovers проверяет диапазон и бессрочность', () => {
  const ex = { dateFrom: '2026-11-01', dateTo: '2026-11-15' };
  assert.equal(M.exemptionCovers(ex, '2026-10-31'), false);
  assert.equal(M.exemptionCovers(ex, '2026-11-01'), true);
  assert.equal(M.exemptionCovers(ex, '2026-11-15'), true);
  assert.equal(M.exemptionCovers(ex, '2026-11-16'), false);

  const inf = { dateFrom: '2026-11-01', dateTo: null };
  assert.equal(M.exemptionCovers(inf, '2030-01-01'), true);
  assert.equal(M.exemptionCovers(inf, '2026-10-31'), false);
});

/* ---------- посещаемость ---------- */

test('посещаемость считается как (уроки − Н) / уроки', () => {
  assert.deepEqual(M.attendance(10, 1), { total: 10, absent: 1, pct: 90 });
  assert.deepEqual(M.attendance(10, 0), { total: 10, absent: 0, pct: 100 });
  assert.deepEqual(M.attendance(0, 0), { total: 0, absent: 0, pct: null });
  assert.equal(M.attendance(3, 1).pct, 66.7);
});

test('ОСВ не считается отсутствием (передаём только Н)', () => {
  // Проверяем намерение: освобождённый ученик не уменьшает посещаемость
  const att = M.attendance(20, 0);
  assert.equal(att.pct, 100);
});

/* ---------- преобразование среднего ---------- */

test('режим A: школьное округление, 4.5 вверх', () => {
  assert.equal(M.rawToMark(4.5, 'A'), 5);
  assert.equal(M.rawToMark(4.49, 'A'), 4);
  assert.equal(M.rawToMark(3.5, 'A'), 4);
  assert.equal(M.rawToMark(2.5, 'A'), 3);
  assert.equal(M.rawToMark(1.5, 'A'), 2);
  assert.equal(M.rawToMark(1.49, 'A'), 1);
});

test('режим C: банк в пользу ученика', () => {
  assert.equal(M.rawToMark(3.5, 'C'), 4);
  assert.equal(M.rawToMark(4.5, 'C'), 5);
  assert.equal(M.rawToMark(2.46, 'C'), 2);
});

/* ---------- расчёт месячной отметки ---------- */

const L = (...ids) => ids.map((id) => ({ id, date: '2026-11-01' }));
const mk = (lessonId, value = null, flag = null, weight) => ({ lessonId, value, flag, ...(weight ? { weight } : {}) });

test('М: простой средний балл', () => {
  const res = M.computeMonthly({
    lessons: L('a', 'b', 'c', 'd'),
    marks: [mk('a', '5'), mk('b', '4'), mk('c', '5'), mk('d', '4')],
  });
  assert.equal(res.pick, '5');        // средний 4.5 → 5
  assert.equal(res.raw, 4.5);
  assert.equal(res.count, 4);
});

test('М: 4.2 округляется до 4', () => {
  const res = M.computeMonthly({
    lessons: L('a', 'b', 'c', 'd', 'e'),
    marks: [mk('a', '5'), mk('b', '4'), mk('c', '4'), mk('d', '4'), mk('e', '4')],
  });
  assert.equal(M.fmtAvg(res.raw), '4,2');
  assert.equal(res.pick, '4');
});

test('М: Н и ОСВ не участвуют в среднем', () => {
  const res = M.computeMonthly({
    lessons: L('a', 'b', 'c'),
    marks: [mk('a', '5'), mk('b', null, 'Н'), mk('c', null, 'ОСВ')],
  });
  assert.equal(res.count, 1);
  assert.equal(res.pick, '5');
});

test('М: все уроки ОСВ → предлагается ОСВ', () => {
  const res = M.computeMonthly({
    lessons: L('a', 'b'),
    marks: [mk('a', null, 'ОСВ'), mk('b', null, 'ОСВ')],
  });
  assert.equal(res.pick, 'ОСВ');
  assert.equal(res.osvOnly, true);
});

test('М: все уроки Н → предлагается Н', () => {
  const res = M.computeMonthly({
    lessons: L('a', 'b'),
    marks: [mk('a', null, 'Н'), mk('b', null, 'Н')],
  });
  assert.equal(res.pick, 'Н');
  assert.equal(res.allAbsent, true);
});

test('М: нет данных → прочерк', () => {
  const res = M.computeMonthly({ lessons: L('a', 'b'), marks: [] });
  assert.equal(res.pick, '—');
});

test('М: режим B учитывает вес 2', () => {
  const res = M.computeMonthly({
    lessons: L('a', 'b', 'c'),
    marks: [mk('a', '3', null, 2), mk('b', '5'), mk('c', '5')],
    rules: { mode: 'B' },
  });
  // (3*2 + 5 + 5) / 4 = 4.0
  assert.equal(res.raw, 4);
  assert.equal(res.pick, '4');
});

test('М: тот же набор в режиме A даёт больший средний', () => {
  const res = M.computeMonthly({
    lessons: L('a', 'b', 'c'),
    marks: [mk('a', '3', null, 2), mk('b', '5'), mk('c', '5')],
    rules: { mode: 'A' },
  });
  // (3+5+5)/3 = 4.33 → 4, но среднее выше, чем в B (4.0)
  assert.equal(M.fmtAvg(res.raw), '4,3');
});

test('М: ограничение при двойках', () => {
  const res = M.computeMonthly({
    lessons: L('a', 'b', 'c'),
    marks: [mk('a', '5'), mk('b', '5'), mk('c', '2')],
    rules: { mode: 'A', capAt3OnBad: true },
  });
  // средний 4.0 → 4, но есть 2 → не выше 3
  assert.equal(res.pick, '3');
  assert.equal(res.capped, true);
});

test('М: ограничение не срабатывает без двоек', () => {
  const res = M.computeMonthly({
    lessons: L('a', 'b', 'c'),
    marks: [mk('a', '5'), mk('b', '5'), mk('c', '4')],
    rules: { mode: 'A', capAt3OnBad: true },
  });
  assert.equal(res.pick, '5');
  assert.equal(res.capped, false);
});

test('устаревание М: принятое отличается от расчётного', () => {
  assert.equal(M.isMonthlyStale({ value: '4' }, '5'), true);
  assert.equal(M.isMonthlyStale({ value: '5' }, '5'), false);
  // Нет принятого значения — не «устарело», а «не принято»: предлагаем значение отдельно.
  assert.equal(M.isMonthlyStale(null, '5'), false);
  assert.equal(M.isMonthlyStale({ value: '4' }, '—'), true);
});

/* ---------- месяцы и триместры ---------- */

test('monthsInRange разворачивает учебный год', () => {
  const months = M.monthsInRange('2026-09-01', '2027-05-31');
  assert.equal(months.length, 9);
  assert.deepEqual(months[0], { year: 2026, month: 9 });
  assert.deepEqual(months[8], { year: 2027, month: 5 });
});

test('monthsOfTrimester помечает частичные месяцы', () => {
  const t = { index: 2, from: '2026-12-01', to: '2027-02-28' };
  const months = M.monthsOfTrimester(t);
  assert.equal(months.length, 3);
  assert.equal(months.every((m) => !m.partial), true);

  const partial = M.monthsOfTrimester({ from: '2026-11-15', to: '2026-12-20' });
  assert.equal(partial.length, 2);
  assert.equal(partial[0].partial, true);
  assert.equal(partial[1].partial, true);
});

test('monthState определяет прошлое, настоящее и будущее', () => {
  const now = '2026-11-12';
  assert.equal(M.monthState(2026, 10, now), 'past');
  assert.equal(M.monthState(2026, 11, now), 'current');
  assert.equal(M.monthState(2026, 12, now), 'future');
});

/* ---------- имена ---------- */

test('shortName и initialsName сокращают ФИО', () => {
  assert.equal(M.shortName('Иванов Иван Сергеевич'), 'Иванов И.');
  assert.equal(M.shortName('Иванов Иван'), 'Иванов И.');
  assert.equal(M.shortName('Иванов'), 'Иванов');
  assert.equal(M.initialsName('Иванов Иван Сергеевич'), 'Иванов И.С.');
});

test('sortStudents сортирует по номеру', () => {
  const list = [
    { number: 10, fullName: 'Я' },
    { number: 2, fullName: 'Б' },
    { number: 1, fullName: 'В' },
  ];
  assert.deepEqual(M.sortStudents(list).map((s) => s.number), [1, 2, 10]);
});

/* ---------- планирование ОСВ ---------- */

test('planOsv удаляет auto-osv вне нового диапазона', () => {
  const lessons = [
    { id: 'l1', date: '2026-11-01' },
    { id: 'l2', date: '2026-11-05' },
    { id: 'l3', date: '2026-11-10' },
  ];
  const marks = [
    { id: 'm1', studentId: 's1', lessonId: 'l1', value: null, flag: 'ОСВ', source: 'auto-osv' },
    { id: 'm2', studentId: 's1', lessonId: 'l2', value: null, flag: 'ОСВ', source: 'auto-osv' },
    { id: 'm3', studentId: 's1', lessonId: 'l3', value: null, flag: 'ОСВ', source: 'auto-osv' },
  ];
  const plan = M.planOsv({ lessons, marks, studentIds: ['s1'], from: '2026-11-05', to: '2026-11-05' });
  assert.equal(plan.toDelete.length, 2);
  assert.deepEqual(plan.toDelete.map((m) => m.id).sort(), ['m1', 'm3']);
});

test('planOsv сохраняет оценку, добавляя бейдж ОСВ', () => {
  const lessons = [{ id: 'l1', date: '2026-11-01' }];
  const marks = [{ id: 'm1', studentId: 's1', lessonId: 'l1', value: '5', flag: null, source: 'manual' }];
  const plan = M.planOsv({ lessons, marks, studentIds: ['s1'], from: '2026-11-01', to: '2026-11-10' });
  assert.equal(plan.toPut.length, 1);
  assert.equal(plan.toPut[0].value, '5');
  assert.equal(plan.toPut[0].flag, 'ОСВ');
});

test('planOsv переписывает Н на ОСВ', () => {
  const lessons = [{ id: 'l1', date: '2026-11-01' }];
  const marks = [{ id: 'm1', studentId: 's1', lessonId: 'l1', value: null, flag: 'Н', source: 'manual' }];
  const plan = M.planOsv({ lessons, marks, studentIds: ['s1'], from: '2026-11-01', to: '2026-11-10' });
  assert.equal(plan.toPut[0].flag, 'ОСВ');
  assert.equal(plan.toPut[0].source, 'auto-osv');
});

test('planOsv не трогает чужих учеников', () => {
  const lessons = [{ id: 'l1', date: '2026-11-01' }];
  const marks = [{ id: 'm1', studentId: 's2', lessonId: 'l1', value: null, flag: 'ОСВ', source: 'auto-osv' }];
  const plan = M.planOsv({ lessons, marks, studentIds: ['s1'], from: '2026-11-01', to: '2026-11-10' });
  // Чужая отметка не удаляется и не переписывается; для s1 создаётся своя на пустом уроке.
  assert.equal(plan.toDelete.length, 0);
  assert.equal(plan.toPut.length, 1);
  assert.equal(plan.toPut[0].studentId, 's1');
});

test('planOsv не дублирует существующую auto-osv на том же уроке', () => {
  const lessons = [{ id: 'l1', date: '2026-11-01' }];
  const marks = [{ id: 'm1', studentId: 's1', lessonId: 'l1', value: null, flag: 'ОСВ', source: 'auto-osv' }];
  const plan = M.planOsv({ lessons, marks, studentIds: ['s1'], from: '2026-11-01', to: '2026-11-10' });
  assert.equal(plan.toPut.length, 0, 'повторно не создаём');
  assert.equal(plan.toDelete.length, 0);
});

test('planOsv при снятии (from = null) только удаляет', () => {
  const lessons = [{ id: 'l1', date: '2026-11-01' }];
  const marks = [{ id: 'm1', studentId: 's1', lessonId: 'l1', value: null, flag: 'ОСВ', source: 'auto-osv' }];
  const plan = M.planOsv({ lessons, marks, studentIds: ['s1'], from: null, to: null });
  assert.equal(plan.toDelete.length, 1);
  assert.equal(plan.toPut.length, 0);
});
