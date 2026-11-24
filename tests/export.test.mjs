import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as store from '../js/store.js';
import * as exp from '../js/export.js';

const context = vm.createContext({ ArrayBuffer, Uint8Array });
vm.runInContext(readFileSync(new URL('../vendor/xlsx.full.min.js', import.meta.url), 'utf8'), context);
const XLSX = context.XLSX;
const { window } = new JSDOM('');
Object.assign(globalThis, { window, document: window.document });
window.XLSX = XLSX;
const range = { classId: 'c', from: '2026-11-01', to: '2026-11-30' };

test('Повторное чтение файлов сводной и плоской ведомости', async t => {
  Object.assign(store.state, {
    classes: [{ id: 'c', name: '8А' }],
    students: ['А', 'Б'].map((id, i) => ({ id, fullName: id, classId: 'c', number: i + 1 })),
    lessons: [{ id: 'l', classId: 'c', date: range.from, topicId: 't' }],
    topics: [{ id: 't', name: '=Тема' }],
    marks: [{ lessonId: 'l', studentId: 'А', value: '5', flag: 'ОСВ' }, { lessonId: 'l', studentId: 'Б', flag: 'Н' }],
    monthly: [10, 11, 12].map(month => ({ studentId: 'А', year: 2026, month, value: '4' })),
    settings: { year: { from: range.from, to: range.to } },
  });
  let blob;
  t.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:test'; });
  t.mock.method(window.HTMLAnchorElement.prototype, 'click', () => {});
  const readBook = async () => XLSX.read(await blob.arrayBuffer(), { type: 'array' });
  exp.exportXlsxSummary({...range,includeMonthly:true,includeExemptions:true});
  const { Sheets } = await readBook();
  const journal = Sheets['Журнал'];
  assert.equal(journal.B3.v, 'ФИО');
  assert.equal(journal.C3.v, '01.11.2026');
  assert.match(journal.F3.v, /мес/);
  assert.deepEqual(['B4','C4','E4','F4','B5','C5','E5'].map(k => journal[k].v),
    ['А','5+ОСВ','100%','4','Б','Н','0%']);
  assert.equal(Sheets['Темы уроков'].B2.v, '=Тема');
  assert.equal(Sheets['Темы уроков'].B2.f, undefined);
  exp.exportXlsxFlat({...range,includeMonthly:true,includeExemptions:true});
  const flat = (await readBook()).Sheets['Моя школа'];
  assert.equal(flat['!ref'], 'A1:E4');
  assert.deepEqual(['C4','D4','E4'].map(k => flat[k].v), ['01.11.2026','4','М']);
  assert.equal(exp.buildFlat({ ...range, from: '2026-11-02' }).length, 1);
  // Обычный экспорт должен скрывать ОСВ и архив месячных отметок по умолчанию.
  exp.exportXlsxSummary(range);
  const safe=(await readBook()).Sheets;
  assert.equal(safe['Журнал'].C4.v,'5');
  assert.equal(safe['Месячные'],undefined);
  assert.equal(safe['Темы уроков'].C1,undefined);
  exp.exportXlsxFlat(range);
  const safeFlat=(await readBook()).Sheets['Моя школа'];
  assert.equal(safeFlat['!ref'],'A1:E3');
  assert.notEqual(safeFlat.E2?.v,'ОСВ');

});

test('XLSX, CSV и TSV повторно импортируются без дублирования', async () => {
  await store.load();
  const matrix = [['Класс','№','ФИО'], ['8А',1,'Ёжова Анна'], ['8А',2,'Ёжова  Анна']];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrix), 'Список');
  const files = [
    new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'список.xlsx'),
    new File([exp.matrixToDelimited(matrix, ';', true)], 'список.csv'),
    new File([exp.matrixToDelimited(matrix)], 'список.tsv'),
  ];
  let studentId;
  for (const file of files) {
    const parsed = await exp.parseRosterFile(file);
    const result = await exp.applyRoster(parsed);
    assert.equal(result.added, studentId ? 0 : 1);
    assert.equal(result.skipped, 1);
    await store.load();
    const [student] = store.state.students;
    assert.equal(store.state.students.length, 1);
    assert.equal(student.fullName, 'Ёжова Анна');
    assert.equal(student.number, 1);
    if (studentId) assert.equal(student.id, studentId);
    studentId = student.id;
  }
});

test('CSV и TSV экранируют разделители, кавычки, переносы и формулы', () => {
  for (const sep of [';', '\t']) {
    const text = exp.matrixToDelimited([[' =1+1', '@имя', 'строка\r2', 'а"б', 'а' + sep + 'б']], sep);
    assert.equal(text, ["' =1+1", "'@имя", '"строка\r2"', '"а""б"', '"а' + sep + 'б"'].join(sep));
  }
});
