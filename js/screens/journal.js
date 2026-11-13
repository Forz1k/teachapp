/* screens/journal.js — сетка журнала класса: ученики × даты уроков.
   Здесь же шторка отметки с трёхрежимной постановкой ОСВ. */

import * as M from '../model.js';
import * as store from '../store.js';
import * as ui from '../ui.js';

const { el, icon } = ui;

/** Цвет класса бейджа по значению. */
const valueClass = (v) => `v${v}`;

function badgeFor(mark) {
  if (!mark) return el('span', { class: 'cell-empty-dash', text: '·' });
  const wrap = el('span', { class: 'badge-pair' });

  if (mark.value) {
    wrap.append(el('span', { class: `badge ${valueClass(mark.value)}`, text: mark.value }));
    if (mark.flag === 'ОСВ') wrap.append(el('span', { class: 'mini-osv', text: 'ОСВ' }));
  } else if (mark.flag === 'ОСВ') {
    wrap.append(el('span', { class: 'badge osv', text: 'ОСВ' }));
  } else if (mark.flag === 'Н') {
    wrap.append(el('span', { class: 'badge absent', text: '—' }));
  } else {
    wrap.append(el('span', { class: 'cell-empty-dash', text: '·' }));
  }
  return wrap;
}

/** День недели сокращённо. */
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const dowOf = (isoStr) => DOW[M.parseIso(isoStr).getDay()];

/**
 * Рисует экран журнала в контейнер.
 * @param {HTMLElement} root
 * @param {{onOpenClassPicker: Function}} ctx
 */
export function renderJournal(root, ctx) {
  const classId = store.state.currentClassId;
  if (!classId) {
    root.append(el('div', { class: 'empty' }, ['Сначала добавьте класс в разделе «Настройки» или загрузите демо-данные.']));
    return;
  }

  const cls = store.state.classes.find((c) => c.id === classId);
  const students = store.studentsOfClass(classId);
  const settings = store.state.settings;
  const tr = store.currentTrimester();
  const lessons = store.lessonsInRange(classId, tr.from, tr.to);
  const markMap = store.markMap(classId);
  const today = M.todayIso();

  /* ---- шапка ---- */
  const topbar = el('div', { class: 'topbar' });
  const row1 = el('div', { class: 'topbar-row' }, [
    el('button', {
      class: 'chip', type: 'button', text: `${cls ? cls.name : 'Класс'} ▾`,
      onclick: () => ctx.onOpenClassPicker(),
    }),
    el('div', { style: 'flex:1' }),
    el('button', {
      class: 'icon-btn', type: 'button', title: 'Быстрый ввод',
      onclick: () => openQuickEntrySheet(classId, lessons[lessons.length - 1]?.date || today),
    }, [icon('quick')]),
    el('button', {
      class: 'icon-btn', type: 'button', title: 'Освобождения',
      onclick: () => ctx.onOpenExemptions(classId),
    }, [icon('shield')]),
  ]);

  const trChips = el('div', { class: 'segmented', style: 'margin-top:8px' },
    settings.trimesters.map((t) => el('button', {
      type: 'button',
      class: t.id === store.state.currentTrimesterId ? 'active' : '',
      text: `Т${t.index}`,
      onclick: () => {
        store.state.currentTrimesterId = t.id;
        store.notify();
      },
    })));

  topbar.append(row1, trChips);

  /* ---- сетка ---- */
  const wrap = el('div', { class: 'grid-wrap' });

  if (!lessons.length) {
    wrap.append(el('div', { class: 'empty' }, [
      el('div', { text: `В ${tr.index}-м триместре (${M.fmtFull(tr.from)} – ${M.fmtFull(tr.to)}) уроков пока нет.` }),
      el('div', { style: 'margin-top:16px' }, [
        el('button', {
          class: 'btn primary', type: 'button', text: 'Добавить уроки',
          onclick: () => ctx.onOpenLessonPlanner(classId),
        }),
      ]),
    ]));
    root.append(topbar, wrap);
    return;
  }

  if (!students.length) {
    wrap.append(el('div', { class: 'empty' }, ['В классе нет учеников. Добавьте их в настройках класса.']));
    root.append(topbar, wrap);
    return;
  }

  const table = el('table', { class: 'journal' });
  const thead = el('thead');
  const headRow = el('tr');

  headRow.append(el('th', { class: 'col-num', text: '№' }));
  headRow.append(el('th', { class: 'col-name', text: 'ФИО' }));

  for (const lesson of lessons) {
    const topic = store.state.topics.find((t) => t.id === lesson.topicId);
    headRow.append(el('th', {
      class: 'col-lesson',
      title: topic ? topic.name : 'Тема не указана',
    }, [
      el('span', { class: 'date', text: M.fmtShort(lesson.date) }),
      el('span', { class: 'dow', text: dowOf(lesson.date) }),
      el('span', { class: 'topic', text: topic ? topic.name : '' }),
    ]));
  }

  headRow.append(el('th', { class: 'col-sum', text: 'Средн.' }));
  headRow.append(el('th', { class: 'col-sum', text: 'Посещ.' }));

  thead.append(headRow);
  table.append(thead);

  const tbody = el('tbody');

  for (const st of students) {
    const tr_ = el('tr');

    tr_.append(el('td', { class: 'col-num', text: st.number ?? '' }));

    const activeEx = store.exemptionsOfStudent(st.id).find((e) => M.exemptionActive(e));
    const nameCell = el('td', { class: 'col-name' }, [
      el('span', { class: 'name-cell', text: M.shortName(st.fullName) }),
    ]);
    if (activeEx) nameCell.firstChild.append(el('span', { class: 'ex-dot', title: M.exemptionLabel(activeEx) }));
    nameCell.addEventListener('click', () => openStudentSheet(st.id, classId));
    tr_.append(nameCell);

    let absent = 0;
    const values = [];

    for (const lesson of lessons) {
      const mark = markMap.get(`${lesson.id}|${st.id}`);
      if (mark?.flag === 'Н') absent += 1;
      if (mark?.value) values.push(Number(mark.value));

      const cell = el('td', {
        class: `cell ${mark ? 'filled' : ''}`,
        'data-student': st.id,
        'data-lesson': lesson.id,
      }, [el('div', { class: 'cell-inner' }, [badgeFor(mark)])]);

      cell.addEventListener('click', () => {
        ui.haptic(6);
        openMarkSheet(st.id, lesson.id, classId);
      });
      tr_.append(cell);
    }

    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const att = M.attendance(lessons.length, absent);

    tr_.append(el('td', { class: 'col-sum', text: avg === null ? '—' : M.fmtAvg(avg) }));
    tr_.append(el('td', {
      class: 'col-sum',
      text: att.pct === null ? '—' : `${String(att.pct).replace('.', ',')}%`,
      style: att.pct !== null && att.pct < 80 ? `color: var(--mark-2)` : '',
    }));

    tbody.append(tr_);
  }

  table.append(tbody);
  wrap.append(table);
  root.append(topbar, wrap);
}

/* ---------- шторка отметки ---------- */

/**
 * Шторка ячейки. Главная логика: выбор значения, затем — при ОСВ — второй шаг со сроком.
 */
export function openMarkSheet(studentId, lessonId, classId) {
  const student = store.state.students.find((s) => s.id === studentId);
  const lesson = store.state.lessons.find((l) => l.id === lessonId);
  if (!student || !lesson) return;

  const existing = store.state.marks.find((m) => m.lessonId === lessonId && m.studentId === studentId) || null;
  const exemption = store.activeExemption(studentId, lesson.date);

  const sheet = el('div');

  const header = el('div', {}, [
    el('h2', { text: M.shortName(student.fullName) }),
    el('div', { class: 'sub', text: `${M.fmtFull(lesson.date)} · ${topicName(lesson.topicId)}` }),
  ]);
  sheet.append(header);

  if (exemption) {
    sheet.append(el('div', {
      class: 'compare-line',
      style: 'margin-top:0;margin-bottom:12px',
      text: `Ученик освобождён: ${M.exemptionLabel(exemption)}${exemption.reason ? ` (${exemption.reason})` : ''}`,
    }));
  }

  sheet.append(el('div', { class: 'sheet-buttons' }, [
    ...[5, 4, 3, 2, 1].map((v) => el('button', {
      type: 'button', class: `v${v} ${existing?.value === String(v) ? 'on' : ''}`, text: String(v),
      onclick: () => applyAndClose({ value: String(v), flag: null }),
    })),
    el('button', {
      type: 'button', class: `osv ${existing?.flag === 'ОСВ' && !existing.value ? 'on' : ''}`, text: 'ОСВ',
      onclick: () => showOsvStep(sheet, student, lesson, existing, exemption),
    }),
    el('button', {
      type: 'button', class: `absent ${existing?.flag === 'Н' ? '' : ''}`, text: 'Н',
      onclick: () => handleAbsent(student, lesson, exemption, existing),
    }),
    el('button', {
      type: 'button', class: 'm small-label', text: 'М',
      onclick: () => {
        ui.closeSheet();
        import('./monthly.js').then((m) => m.openMonthlySheet(studentId, M.yearOf(lesson.date), M.monthOf(lesson.date), classId));
      },
    }),
    el('button', {
      type: 'button', class: 'clear-cell', text: '✕',
      onclick: () => applyAndClose({ value: null, flag: null }),
    }),
  ]));

  // Вес оценки — для режима B «средневзвешенное»
  if (store.state.settings.rules.mode === 'B' && existing?.value) {
    const wRow = el('div', { class: 'preset-chips' }, [
      el('button', {
        type: 'button', class: existing.weight === 2 ? '' : 'active', text: 'обычная',
        onclick: async () => { await store.setMarkWeight(studentId, lessonId, 1); ui.closeSheet(); },
      }),
      el('button', {
        type: 'button', class: existing.weight === 2 ? 'active' : '', text: 'вес 2 (норматив)',
        onclick: async () => { await store.setMarkWeight(studentId, lessonId, 2); ui.closeSheet(); },
      }),
    ]);
    sheet.append(el('div', { class: 'sub', style: 'margin-top:14px;margin-bottom:0', text: 'Вес оценки' }), wRow);
  }

  const actions = el('div', { class: 'actions' }, [
    el('button', {
      class: 'btn small', type: 'button', text: 'Изменить дату или тему урока',
      onclick: () => {
        ui.closeSheet();
        import('./lesson.js').then((m) => m.openLessonSheet(lessonId, classId));
      },
    }),
  ]);
  sheet.append(actions);

  ui.openSheet(sheet);

  async function applyAndClose(vals) {
    const { mark, undo } = await store.setMark(studentId, lessonId, vals);
    ui.closeSheet();
    ui.haptic(10);
    if (mark) {
      ui.toast('Сохранено', { label: 'Отменить', onClick: () => undo() });
    }
  }

  /** Обработка «Н» с учётом освобождения: требуется подтверждение. */
  async function handleAbsent(st, ls, ex, cur) {
    if (ex && M.exemptionCovers(ex, ls.date)) {
      const ok = await ui.confirmDialog({
        title: 'Ученик освобождён',
        text: `Освобождение действует до ${ex.dateTo ? M.fmtFull(ex.dateTo) : 'конца года'}. Вы точно отмечаете отсутствие? Отметка станет «ОСВ + Н», и посещаемость учтёт его как отсутствующего.`,
        ok: 'Отметить Н',
        danger: true,
      });
      if (!ok) return;
      const { mark, undo } = await store.setMark(studentId, lessonId, { value: null, flag: 'Н' });
      // Сохраняем признак ОСВ вторым проходом, т.к. normalizeMark для Н убирает флаг.
      if (mark && ex) {
        mark.flag = 'Н';
        mark.osv = true;
        await store.setMark(studentId, lessonId, { value: null, flag: 'Н' });
      }
      ui.closeSheet();
      ui.toast('Отмечено: ОСВ + Н', { label: 'Отменить', onClick: () => undo() });
      return;
    }
    await applyAndClose({ value: null, flag: 'Н' });
  }
}

function topicName(topicId) {
  const t = store.state.topics.find((x) => x.id === topicId);
  return t ? t.name : 'тема не указана';
}

/* ---------- второй шаг ОСВ: срок освобождения ---------- */

/**
 * Второй экран шторки: «На какой срок?».
 * Режимы: только этот урок / до даты / бессрочно.
 */
function showOsvStep(sheet, student, lesson, existing, activeEx) {
  sheet.innerHTML = '';
  sheet.append(
    el('h2', { text: 'ОСВ — на какой срок?' }),
    el('div', { class: 'sub', text: `${M.shortName(student.fullName)} · урок ${M.fmtFull(lesson.date)}` }),
  );

  const modeRow = el('div', { class: 'actions', style: 'margin-top:0' });
  const step2 = el('div');
  sheet.append(modeRow, step2);

  if (activeEx) {
    sheet.insertBefore(el('div', {
      class: 'compare-line',
      text: `Уже есть освобождение: ${M.exemptionLabel(activeEx)}. Новое заменит его для этого периода.`,
    }), modeRow);
  }

  /** Вариант 1: только этот урок — запись mark, exemption не создаётся. */
  modeRow.append(el('button', {
    class: 'btn wide', type: 'button', text: 'Только этот урок',
    onclick: async () => {
      const { mark, undo } = await store.setMark(student.id, lesson.id, { value: null, flag: 'ОСВ' });
      if (mark) mark.source = 'manual';
      ui.closeSheet();
      ui.toast('ОСВ на один урок', { label: 'Отменить', onClick: () => undo() });
    },
  }));

  /** Вариант 3: бессрочно. */
  modeRow.append(el('button', {
    class: 'btn wide', type: 'button', text: 'Бессрочно (до конца года)',
    onclick: () => applyExemption(lesson.date, null),
  }));

  /** Вариант 2: до даты — раскрываем пикер с пресетами. */
  const toDateBtn = el('button', {
    class: 'btn wide primary', type: 'button', text: 'До даты…',
    onclick: () => buildDateStep(),
  });
  modeRow.append(toDateBtn);

  function buildDateStep() {
    step2.innerHTML = '';
    const tr = store.currentTrimester();
    const presets = [
      { label: '1 урок', days: null, date: nextLessonDate(lesson.date) },
      { label: '1 неделя', days: 7, date: M.addDays(lesson.date, 7) },
      { label: '2 недели', days: 14, date: M.addDays(lesson.date, 14) },
      { label: 'до конца триместра', days: null, date: tr.to },
      { label: 'до конца года', days: null, date: store.state.settings.year.to },
      { label: 'выбрать дату', days: null, date: null },
    ];

    let chosen = M.addDays(lesson.date, 7);
    const dateInput = el('input', { type: 'date', value: chosen, min: lesson.date });

    const chips = el('div', { class: 'preset-chips' },
      presets.map((p) => el('button', {
        type: 'button',
        class: p.date === chosen ? 'active' : '',
        text: p.label,
        onclick: (e) => {
          if (p.label === 'выбрать дату') {
            chips.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            dateInput.focus();
            try { dateInput.showPicker?.(); } catch { /* необязательно */ }
            return;
          }
          chosen = p.date;
          dateInput.value = p.date;
          chips.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
      })));

    step2.append(
      el('div', { class: 'sub', style: 'margin-top:16px;margin-bottom:0', text: 'Освобождение до:' }),
      chips,
      el('label', { class: 'field', style: 'margin-top:12px' }, [dateInput]),
      el('div', { class: 'actions' }, [
        el('button', {
          class: 'btn primary wide', type: 'button', text: 'Поставить освобождение',
          onclick: () => applyExemption(lesson.date, dateInput.value || chosen),
        }),
        el('button', {
          class: 'btn wide', type: 'button', text: 'Назад',
          onclick: () => showOsvStep(sheet, student, lesson, existing, activeEx),
        }),
      ]),
    );
    setTimeout(() => { try { dateInput.showPicker?.(); } catch { /* Safari может не дать */ } }, 220);
  }

  async function applyExemption(from, to) {
    const affected = store.countOsvAffected(student.id, from, to);
    if (affected > 0 && activeEx) {
      const ok = await ui.confirmDialog({
        title: 'Сократить освобождение?',
        text: `Будет удалено ${affected} отметок ОСВ за период. Продолжить?`,
        ok: 'Продолжить',
      });
      if (!ok) return;
    }

    try {
      if (activeEx) {
        await store.updateExemption(activeEx.id, { dateFrom: from, dateTo: to });
      } else {
        await store.addExemption({ studentId: student.id, dateFrom: from, dateTo: to, reason: '' });
      }
      ui.closeSheet();
      ui.haptic(12);
      ui.toast(to === null ? 'Освобождение до конца года' : `Освобождение до ${M.fmtFull(to)}`);
    } catch (err) {
      ui.toast('Не удалось сохранить: ' + err.message);
    }
  }
}

/** Ближайшая дата урока после указанной (для пресета «1 урок»). */
function nextLessonDate(afterIso) {
  const lessons = store.lessonsOfClass(store.state.currentClassId).filter((l) => l.date > afterIso);
  return lessons.length ? lessons[0].date : afterIso;
}

/* ---------- шторка ученика ---------- */

async function openStudentSheet(studentId, classId) {
  const student = store.state.students.find((s) => s.id === studentId);
  if (!student) return;
  const exs = store.exemptionsOfStudent(studentId).sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

  const sheet = el('div', {}, [
    el('h2', { text: student.fullName }),
    el('div', { class: 'sub', text: `№ ${student.number ?? '—'} в списке` }),
  ]);

  if (exs.length) {
    const block = el('div', { class: 'card-block', style: 'margin-top:8px' }, [
      el('div', { class: 'head', text: 'Освобождения' }),
    ]);
    for (const ex of exs) {
      block.append(el('div', { class: 'row-item' }, [
        el('div', { class: 'label' }, [
          el('div', { text: M.exemptionLabel(ex), style: 'font-size:14px' }),
          el('div', { text: ex.reason || 'без причины', style: 'font-size:12px;color:var(--text-3)' }),
        ]),
        el('button', {
          class: 'btn small danger', type: 'button', text: 'Снять',
          onclick: async () => {
            const n = store.state.marks.filter((m) => m.studentId === studentId && m.source === 'auto-osv').length;
            const ok = await ui.confirmDialog({
              title: 'Снять освобождение?',
              text: n ? `Будет удалено ${n} отметок ОСВ, проставленных автоматически. Оценки не пострадают.` : 'Автоматических отметок ОСВ нет.',
              ok: 'Снять', danger: true,
            });
            if (!ok) return;
            await store.removeExemption(ex.id);
            ui.closeSheet();
            ui.toast('Освобождение снято');
          },
        }),
      ]));
    }
    sheet.append(block);
  }

  sheet.append(el('div', { class: 'actions' }, [
    el('button', {
      class: 'btn wide', type: 'button', text: 'Добавить освобождение',
      onclick: () => openAddExemptionSheet(studentId),
    }),
    el('button', {
      class: 'btn wide', type: 'button', text: 'Переименовать / изменить №',
      onclick: async () => {
        const name = await ui.promptDialog({ title: 'ФИО', value: student.fullName, ok: 'Сохранить' });
        if (name === null) return;
        const num = await ui.promptDialog({
          title: 'Номер в списке', value: String(student.number ?? ''),
          ok: 'Сохранить',
        });
        if (num === null) return;
        await store.updateStudent(studentId, {
          fullName: name.trim() || student.fullName,
          number: Number(num) || student.number,
        });
        ui.closeSheet();
        ui.toast('Данные ученика обновлены');
      },
    }),
    el('button', {
      class: 'btn wide danger', type: 'button', text: 'Удалить ученика',
      onclick: async () => {
        const ok = await ui.confirmDialog({
          title: `Удалить ${M.shortName(student.fullName)}?`,
          text: 'Вместе с учеником удалятся все его оценки, отметки посещаемости, освобождения и месячные отметки. Действие необратимо.',
          ok: 'Удалить', danger: true,
        });
        if (!ok) return;
        await store.deleteStudent(studentId);
        ui.closeSheet();
        ui.toast('Ученик удалён');
      },
    }),
  ]));

  ui.openSheet(sheet);
}

/** Шторка добавления освобождения для ученика (когда урок не выбран). */
export function openAddExemptionSheet(studentId) {
  const student = store.state.students.find((s) => s.id === studentId);
  if (!student) return;
  const today = M.todayIso();
  const fromInput = el('input', { type: 'date', value: today });
  const toInput = el('input', { type: 'date', value: M.addDays(today, 14), min: today });
  const reasonInput = el('input', { type: 'text', placeholder: 'например: справка после ОРВИ' });

  const sheet = el('div', {}, [
    el('h2', { text: 'Освобождение' }),
    el('div', { class: 'sub', text: student.fullName }),
    el('label', { class: 'field' }, [el('span', { text: 'С даты' }), fromInput]),
    el('label', { class: 'field' }, [el('span', { text: 'По дату (оставьте пустым — бессрочно)' }), toInput]),
    el('label', { class: 'field' }, [el('span', { text: 'Причина' }), reasonInput]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Сохранить',
        onclick: async () => {
          const to = toInput.value || null;
          if (to && to < fromInput.value) { ui.toast('Дата окончания раньше начала'); return; }
          const { changed } = await store.addExemption({
            studentId, dateFrom: fromInput.value, dateTo: to, reason: reasonInput.value.trim(),
          });
          ui.closeSheet();
          ui.toast(changed ? `Готово: отмечено ${changed} уроков` : 'Освобождение сохранено');
        },
      }),
      el('button', {
        class: 'btn wide', type: 'button', text: 'Сделать бессрочным',
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

/* ---------- быстрый ввод на один урок ---------- */

/**
 * Режим «на один урок»: список всех учеников класса крупными строками
 * с сегмент-контролом 1–5 / ОСВ / М / Н. Для ввода прямо в спортзале.
 */
export function openQuickEntrySheet(classId, initialDate) {
  const students = store.studentsOfClass(classId);
  const cls = store.state.classes.find((c) => c.id === classId);
  if (!students.length) { ui.toast('В классе нет учеников'); return; }

  const classLessons = store.lessonsOfClass(classId);
  let currentDate = initialDate || (classLessons.length ? classLessons[classLessons.length - 1].date : M.todayIso());

  const sheet = el('div');
  const headerWrap = el('div');
  const listWrap = el('div', { class: 'quick-list' });
  sheet.append(headerWrap, listWrap);

  async function ensureLesson() {
    let lesson = classLessons.find((l) => l.date === currentDate);
    if (!lesson) {
      lesson = await store.addLesson(classId, currentDate);
      classLessons.push(lesson);
      classLessons.sort((a, b) => a.date.localeCompare(b.date));
    }
    return lesson;
  }

  let lesson = classLessons.find((l) => l.date === currentDate) || null;

  function drawHeader() {
    headerWrap.innerHTML = '';
    const input = el('input', { type: 'date', value: currentDate, max: store.state.settings.year.to });
    input.addEventListener('change', async () => {
      currentDate = input.value;
      lesson = await ensureLesson();
      input.value = currentDate;
      draw();
    });

    headerWrap.append(
      el('h2', { text: 'Быстрый ввод' }),
      el('div', { class: 'sub', text: `${cls ? cls.name : ''} · ${students.length} учеников` }),
      el('label', { class: 'field' }, [el('span', { text: 'Дата урока' }), input]),
    );
  }

  function draw() {
    listWrap.innerHTML = '';
    const markMap = store.markMap(classId);

    for (const st of students) {
      const key = lesson ? `${lesson.id}|${st.id}` : null;
      const mark = key ? markMap.get(key) : null;
      const ex = lesson ? store.activeExemption(st.id, lesson.date) : null;

      const row = el('div', { class: 'quick-row' });
      row.append(el('div', { class: 'who' }, [
        el('span', { class: 'n', text: st.number ?? '' }),
        el('span', { class: 'fio', text: M.shortName(st.fullName) }),
      ]));

      if (ex && !mark) {
        row.append(el('span', { class: 'hint', text: `освобождён: ${M.exemptionLabel(ex)}` }));
      }

      const btns = el('div', { class: 'mark-buttons' });
      const set = async (value, flag) => {
        if (!lesson) lesson = await ensureLesson();
        await store.setMark(st.id, lesson.id, { value, flag });
        ui.haptic(8);
        draw();
      };

      [5, 4, 3, 2, 1].forEach((v) => {
        btns.append(el('button', {
          type: 'button',
          class: `v${v} ${mark?.value === String(v) && !mark.flag ? 'on' : ''}`,
          text: String(v),
          onclick: () => set(String(v), null),
        }));
      });
      btns.append(el('button', {
        type: 'button', class: `osv small-label ${mark?.flag === 'ОСВ' ? 'on' : ''}`, text: 'ОСВ',
        onclick: () => set(null, 'ОСВ'),
      }));
      btns.append(el('button', {
        type: 'button', class: 'm small-label', text: 'М',
        onclick: () => {
          ui.closeSheet();
          import('./monthly.js').then((m) => m.openMonthlySheet(st.id, M.yearOf(currentDate), M.monthOf(currentDate), classId));
        },
      }));
      btns.append(el('button', {
        type: 'button', class: `absent ${mark?.flag === 'Н' ? 'on' : ''}`, text: 'Н',
        onclick: () => set(null, 'Н'),
      }));

      row.append(btns);
      listWrap.append(row);
    }
  }

  (async () => {
    lesson = await ensureLesson();
    drawHeader();
    draw();
    ui.openSheet(sheet);
  })();
}
