/* screens/exemptions.js — список освобождений класса и управление ими. */

import * as M from '../model.js';
import * as store from '../store.js';
import * as ui from '../ui.js';

const { el, icon } = ui;

export function renderExemptionsInto(container, classId, opts = {}) {
  const students = store.studentsOfClass(classId);
  const studentIds = new Set(students.map((s) => s.id));
  const list = store.state.exemptions
    .filter((e) => studentIds.has(e.studentId))
    .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));

  const today = M.todayIso();
  const active = list.filter((e) => M.exemptionActive(e, today));
  const future = list.filter((e) => e.dateFrom > today);
  const past = list.filter((e) => e.dateTo !== null && e.dateTo < today);

  if (!list.length) {
    container.append(el('div', { class: 'empty' }, [
      icon('shield'),
      el('div', { text: 'Освобождений нет. Их можно поставить из ячейки журнала (ОСВ → до даты) или кнопкой ниже.' }),
      el('div', { style: 'margin-top:16px' }, [
        el('button', {
          class: 'btn primary', type: 'button', text: 'Добавить освобождение',
          onclick: () => openPickStudent(classId),
        }),
      ]),
    ]));
    return;
  }

  const section = (title, items) => {
    if (!items.length) return;
    container.append(el('div', {
      style: 'padding:16px 16px 6px;font-size:13px;font-weight:600;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px',
      text: title,
    }));
    const wrap = el('div', { style: 'padding:0 16px' });
    for (const ex of items) {
      const st = students.find((s) => s.id === ex.studentId);
      if (!st) continue;
      const item = el('div', { class: 'ex-item' }, [
        el('div', { class: 'who' }, [
          el('div', { class: 'fio', text: st.fullName }),
          el('div', { class: 'dates', text: M.exemptionLabel(ex) }),
          ex.reason ? el('div', { class: 'reason', text: ex.reason }) : null,
        ]),
      ]);

      item.append(el('button', {
        class: 'btn small', type: 'button', text: 'Изменить',
        onclick: () => openEditExemption(ex.id, classId),
      }));
      item.append(el('button', {
        class: 'btn small danger', type: 'button', text: 'Снять',
        onclick: async () => {
          const n = store.state.marks.filter((m) => m.studentId === st.id && m.source === 'auto-osv').length;
          const ok = await ui.confirmDialog({
            title: 'Снять освобождение?',
            text: n ? `Будет удалено ${n} автоматических отметок ОСВ. Оценки и ручные отметки сохранятся.` : 'Автоматических отметок ОСВ нет.',
            ok: 'Снять', danger: true,
          });
          if (!ok) return;
          const res = await store.removeExemption(ex.id);
          ui.toast(res?.deleted ? `Снято, удалено ${res.deleted} отметок` : 'Освобождение снято');
          opts.onChanged?.();
        },
      }));

      wrap.append(item);
    }
    container.append(wrap);
  };

  section('Действуют сейчас', active);
  section('Начнутся позже', future);
  section('Завершены', past);
}

/** Выбор ученика для нового освобождения. */
function openPickStudent(classId) {
  const students = store.studentsOfClass(classId);
  const sheet = el('div', {}, [
    el('h2', { text: 'Кто освобождён?' }),
    el('div', { class: 'sub', text: 'Выберите ученика, затем укажите срок' }),
  ]);
  const list = el('div', { class: 'preview-list' });
  for (const st of students) {
    const row = el('div', { class: 'preview-item' }, [
      el('div', { class: 'txt', text: `${st.number ?? ''}. ${st.fullName}` }),
      el('div', { style: 'color:var(--accent);font-weight:700;font-size:14px', text: 'выбрать' }),
    ]);
    row.addEventListener('click', () => {
      ui.closeSheet();
      setTimeout(() => openNewExemption(st.id), 320);
    });
    list.append(row);
  }
  sheet.append(list);
  ui.openSheet(sheet);
}

function openNewExemption(studentId) {
  const student = store.state.students.find((s) => s.id === studentId);
  const today = M.todayIso();
  const tr = store.currentTrimester();

  const fromInput = el('input', { type: 'date', value: today });
  const dateInput = el('input', { type: 'date', value: M.addDays(today, 14) });
  const reasonInput = el('input', { type: 'text', placeholder: 'например: справка после ОРВИ' });

  const sheet = el('div', {}, [
    el('h2', { text: student.fullName }),
    el('div', { class: 'sub', text: 'Освобождение по здоровью' }),
    el('label', { class: 'field' }, [el('span', { text: 'С даты' }), fromInput]),
    el('div', { class: 'preset-chips' }, [
      el('button', {
        type: 'button', text: '1 неделя',
        onclick: () => { dateInput.value = M.addDays(fromInput.value, 7); },
      }),
      el('button', {
        type: 'button', text: '2 недели',
        onclick: () => { dateInput.value = M.addDays(fromInput.value, 14); },
      }),
      el('button', {
        type: 'button', text: 'до конца триместра',
        onclick: () => { dateInput.value = tr.to; },
      }),
      el('button', {
        type: 'button', text: 'до конца года',
        onclick: () => { dateInput.value = store.state.settings.year.to; },
      }),
    ]),
    el('label', { class: 'field', style: 'margin-top:12px' }, [el('span', { text: 'По дату' }), dateInput]),
    el('label', { class: 'field' }, [el('span', { text: 'Причина' }), reasonInput]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Сохранить',
        onclick: async () => {
          if (dateInput.value < fromInput.value) { ui.toast('Дата окончания раньше начала'); return; }
          const { changed } = await store.addExemption({
            studentId, dateFrom: fromInput.value, dateTo: dateInput.value, reason: reasonInput.value.trim(),
          });
          ui.closeSheet();
          ui.toast(changed ? `Отмечено ${changed} уроков` : 'Сохранено');
        },
      }),
      el('button', {
        class: 'btn wide', type: 'button', text: 'Бессрочно (до конца года)',
        onclick: async () => {
          await store.addExemption({ studentId, dateFrom: fromInput.value, dateTo: null, reason: reasonInput.value.trim() });
          ui.closeSheet();
          ui.toast('Освобождение до конца года');
        },
      }),
    ]),
  ]);
  ui.openSheet(sheet);
}

function openEditExemption(exId, classId) {
  const ex = store.state.exemptions.find((e) => e.id === exId);
  if (!ex) return;
  const student = store.state.students.find((s) => s.id === ex.studentId);

  const fromInput = el('input', { type: 'date', value: ex.dateFrom });
  const toInput = el('input', { type: 'date', value: ex.dateTo || '' });
  const reasonInput = el('input', { type: 'text', value: ex.reason || '' });

  const sheet = el('div', {}, [
    el('h2', { text: student ? M.shortName(student.fullName) : 'Освобождение' }),
    el('div', { class: 'sub', text: 'Изменить срок' }),
    el('label', { class: 'field' }, [el('span', { text: 'С даты' }), fromInput]),
    el('label', { class: 'field' }, [el('span', { text: 'По дату (пусто — бессрочно)' }), toInput]),
    el('label', { class: 'field' }, [el('span', { text: 'Причина' }), reasonInput]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Сохранить',
        onclick: async () => {
          const to = toInput.value || null;
          if (to && to < fromInput.value) { ui.toast('Дата окончания раньше начала'); return; }
          const affected = store.countOsvAffected(ex.studentId, fromInput.value, to);
          if (affected > 0) {
            const ok = await ui.confirmDialog({
              title: 'Изменить период?',
              text: `Часть отметок ОСВ окажется вне нового периода. Будет затронуто ${affected} записей.`,
              ok: 'Продолжить',
            });
            if (!ok) return;
          }
          await store.updateExemption(exId, { dateFrom: fromInput.value, dateTo: to, reason: reasonInput.value.trim() });
          ui.closeSheet();
          ui.toast('Обновлено');
        },
      }),
      el('button', {
        class: 'btn wide', type: 'button', text: 'Сделать бессрочным',
        onclick: async () => {
          await store.updateExemption(exId, { dateFrom: fromInput.value, dateTo: null, reason: reasonInput.value.trim() });
          ui.closeSheet();
          ui.toast('Теперь бессрочно');
        },
      }),
    ]),
  ]);
  ui.openSheet(sheet);
}
