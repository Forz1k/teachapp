import { alternatives } from '../health.js';
import {periodName} from '../assessment.js';
import * as store from '../store.js';
import * as M from '../model.js';
import { el, openSheet, closeSheet, toast, downloadBlob } from '../ui.js';
import { matrixToDelimited } from '../export.js';

const bases = { none: 'Без основания ограничения', parent: 'Записка от родителей', document: 'Ограничение по документу' };
const field = (label, input) => el('label', { class: 'field' }, [el('span', { text: label }), input]);
const button = (text, onclick) => el('button', { type: 'button', class: 'btn wide', text, onclick });
function select(options, value) {
  const control = el('select', {}, Object.entries(options).map(([id, text]) => el('option', { value: id, text })));
  control.value = value;
  return control;
}

export function openParticipation(studentId, lessonId, activityId, onReturn) {
  const student = store.state.students.find(s => s.id === studentId);
  const lesson = store.state.lessons.find(l => l.id === lessonId);
  if (!student || !lesson) return toast('Ученик или урок недоступен');
  const previous = store.state.participation.find(p => p.studentId === studentId && p.lessonId === lessonId);
  const mode = select({ '': 'Выберите режим', ...store.participationModes }, previous?.mode || '');
  const basis = select(bases, previous?.basis || 'none');
  const activity = store.activities().find(a => a.id === (activityId || previous?.activityId));
  const alternative = select(Object.fromEntries(['',...alternatives].map(a => [a,a || 'Не выбрано'])),previous?.alternative || '');
  const full = el('input', { type: 'checkbox' });
  full.checked = Boolean(previous?.full);
  const confirmation = field('Подтверждаю полное освобождение по документу на этом уроке. Поставить ОСВ', full);
  function refresh() {
    confirmation.hidden = !(basis.value === 'document' && mode.value === 'paused');
    if (confirmation.hidden) full.checked = false;
  }
  basis.onchange = mode.onchange = refresh;
  refresh();
  async function commit(data) {
    try {
      const undo = await store.saveParticipation(studentId, lessonId, data, previous?.revision ?? null);
      if(onReturn)onReturn();else closeSheet();
      toast('Изменения сохранены', { label: 'Отменить', onClick: async () => {
        try { await undo(); } catch (e) { toast(e.message); }
      } });
    } catch (e) { toast(e.message); }
  }
  const body = el('div', {}, [el('h2', { text: 'Самочувствие и нагрузка' }),
    el('p', { text: student.fullName + ' · ' + M.lessonLabel(lesson) }),
    el('p',{text:activity?.name || ''}), field('Фактическое участие', mode), field('Основание', basis), field('Вариант участия по выбору преподавателя',alternative), confirmation,
    button('Сохранить', () => commit({ mode: mode.value, basis: basis.value, activityId: activity?.id, alternative: alternative.value, full: full.checked }))]);
  if (previous) body.append(button('Снять запись', () => commit(null)));
  if(onReturn)body.append(button('Вернуться к уроку',onReturn));
  openSheet(body);
}

let filters;
export function renderParticipation(screen, classId) {
  const students = store.studentsOfClass(classId);
  const period=store.currentTrimester(), key=period.id+'|'+period.from+'|'+period.to;
  if(filters?.classId!==classId||filters?.periodKey!==key)filters={classId,periodKey:key,studentId:filters?.classId===classId?filters.studentId:students[0]?.id,from:period.from,to:period.to};
  const periodSelect=select(Object.fromEntries(store.state.settings.trimesters.map(p=>[p.id,periodName(p)])),period.id);
  periodSelect.setAttribute('aria-label','Учебный период участия');
  const student = select(Object.fromEntries(students.map(s => [s.id, s.fullName])), filters.studentId);
  if (!student.value) student.selectedIndex = 0;
  const from = el('input', { type: 'date', value: filters.from });
  const to = el('input', { type: 'date', value: filters.to });
  const content = el('div', { class: 'card-block' });
  const body = el('section', { style: 'padding:16px 16px 150px' }, [
    el('h1', { text: 'Самочувствие и нагрузка' }),field('Учебный период',periodSelect), field('Ученик', student),
    field('С даты', from), field('По дату', to), content]);
  screen.append(body);
  function draw() {
    Object.assign(filters, { studentId: student.value, from: from.value, to: to.value });
    content.replaceChildren();
    if (!student.value || !from.value || !to.value || from.value > to.value) {
      content.append(el('p', { text: students.length ? 'Проверьте границы периода' : 'В классе пока нет учеников' }));
      return;
    }
    const lessons = store.lessonsInRange(classId, from.value, to.value).filter(l => l.date <= M.todayIso());
    const entries = new Map(store.state.participation.filter(p => p.studentId === student.value).map(p => [p.lessonId, p]));
    const marks = store.markMap(classId);
    const counts = { normal: 0, adapted: 0, paused: 0, parent: 0, document: 0, full: 0, empty: 0 };
    const held = new Set(store.state.participation.map(p => p.lessonId));
    for (const m of store.state.marks) if ((m.source === 'manual' || m.baseMark?.source === 'manual')) held.add(m.lessonId);
    for (const l of lessons) if (l.held) held.add(l.id);
    const history = el('div');
    const matrix = [['Ученик','Дата','Участие','Основание','Полное освобождение по документу','ОСВ в журнале','Вариант участия','Упражнение']];
    for (const l of lessons) {
      const p = entries.get(l.id);
      const mark = marks.get(l.id + '|' + student.value);
      const mode = store.participationModes[p?.mode] || 'Не отмечено';
      const basis = bases[p?.basis] || '';
      if (p) {
        counts[p.mode]++;
        if (p.basis !== 'none') counts[p.basis]++;
        if (p.full) counts.full++;
      } else counts.empty++;
      const osv = M.hasOsv(mark);
      matrix.push([student.selectedOptions[0].textContent, M.fmtFull(l.date), mode, basis, p?.full ? 'Да' : '', osv ? 'ОСВ' : '',p?.alternative || '',store.activities().find(a => a.id === p?.activityId)?.name || '']);
      history.append(button([M.fmtFull(l.date), mode, basis, p?.alternative, osv ? 'ОСВ в журнале' : ''].filter(Boolean).join(' · '),
        () => openParticipation(student.value, l.id)));
      if (!held.has(l.id)) history.append(button('Подтвердить проведение · ' + M.fmtFull(l.date), async () => {
        try { await store.updateLesson(l.id, { held: true }); draw(); }
        catch { toast('Не удалось подтвердить проведение урока'); }
      }));
    }
    const heldCount = lessons.filter(l => held.has(l.id)).length;
    content.append(el('p', { text: 'Проведено уроков: ' + heldCount }));
    if (heldCount < lessons.length) content.append(el('p', { text: 'Проведение не подтверждено: ' + (lessons.length - heldCount) }));
    for (const [key, label] of Object.entries({ ...store.participationModes, parent: 'Родительские записки',
      document: 'Документальные ограничения', full: 'Полные освобождения по документу', empty: 'Не отмечено' })) {
      content.append(el('div', { text: label + ': ' + counts[key] }));
    }
    content.append(button('Выгрузить отчёт CSV', () => {
      try { downloadBlob(new Blob([matrixToDelimited(matrix, ';', true)], { type: 'text/csv;charset=utf-8' }), 'Участие.csv'); }
      catch { toast('Не удалось выгрузить отчёт'); }
    }), history);
  }
  periodSelect.onchange=()=>{
    const selected=store.state.settings.trimesters.find(p=>p.id===periodSelect.value);
    if(!selected)return;
    store.selectSchoolPeriod(selected.id);
    filters.periodKey=selected.id+'|'+selected.from+'|'+selected.to;
    from.value=selected.from;to.value=selected.to;draw();
  };
  student.onchange = from.onchange = to.onchange = draw;
  draw();
}
