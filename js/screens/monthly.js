/* screens/monthly.js — раздел «Месячные»: строки — ученики, столбцы — месяцы.
   Ячейка показывает предложенное (расчётное) и принятое значение.
   Расчёт вынесен в model.computeMonthly, здесь только представление и команды. */

import * as M from '../model.js';
import * as store from '../store.js';
import * as ui from '../ui.js';

const { el, icon } = ui;

/** Считает предложение для всех учеников класса за месяц. */
export function suggestFor(classId, year, month) {
  const lessons = store.lessonsOfMonth(classId, year, month);
  const students = store.studentsOfClass(classId);
  const markMap = store.markMap(classId);
  const rules = store.state.settings.rules;

  const out = new Map();
  for (const st of students) {
    const marks = lessons
      .map((l) => markMap.get(`${l.id}|${st.id}`))
      .filter(Boolean);
    out.set(st.id, M.computeMonthly({ lessons, marks, rules }));
  }
  return { lessons, students, out };
}

/** Общая проверка «проставлена ли М и устарела ли». */
export function monthlyStatus(studentId, year, month, suggestion) {
  const mm = store.monthlyFor(studentId, year, month);
  if (!mm || !mm.value) {
    return { accepted: null, stale: false, suggest: suggestion.pick };
  }
  const stale = !mm.overriddenByTeacher && M.isMonthlyStale(mm, suggestion.pick);
  return { accepted: mm.value, stale, suggest: suggestion.pick, overridden: !!mm.overriddenByTeacher };
}

export function renderMonthly(root, classId, opts = {}) {
  const cls = store.state.classes.find((c) => c.id === classId);
  const settings = store.state.settings;
  const months = M.monthsOfYear(settings);
  const students = store.studentsOfClass(classId);

  /* шапка */
  const topbar = el('div', { class: 'topbar' }, [
    el('div', { class: 'topbar-row' }, [
      opts.onBack ? el('button', { class: 'icon-btn plain', type: 'button', onclick: opts.onBack }, [icon('back')]) : null,
      el('h1', { text: 'Месячные' }),
      el('button', {
        class: 'icon-btn', type: 'button', title: 'Рассчитать все М',
        onclick: () => openBulkCalc(classId, opts),
      }, [icon('sparkle')]),
    ]),
    el('div', { class: 'subtitle', text: `${cls ? cls.name : ''} · ${months.length} месяцев` }),
  ]);
  topbar.firstElementChild.append(el('div', { style: 'flex:1' }));
  // h1 уже растянут flex:1 — добавим кнопку в конец строки
  topbar.firstElementChild.append(el('button', {
    class: 'icon-btn', type: 'button', title: 'Скопировать как TSV',
    onclick: async () => {
      const { copyTsvMonthly } = await import('../export.js');
      const { ok } = await copyTsvMonthly(classId);
      ui.toast(ok ? 'Таблица скопирована' : 'Не удалось скопировать');
    },
  }, [icon('copy')]));

  root.append(topbar);

  if (!students.length) {
    root.append(el('div', { class: 'empty', text: 'В классе нет учеников.' }));
    return;
  }

  const wrap = el('div', { class: 'grid-wrap' });
  const table = el('table', { class: 'monthly-table' });
  const thead = el('thead');
  const hr = el('tr');

  hr.append(el('th', { class: 'col-num', text: '№' }));
  hr.append(el('th', { class: 'col-name', text: 'ФИО' }));

  const monthByTrimester = new Map();
  for (const t of settings.trimesters) {
    for (const m of M.monthsOfTrimester(t)) {
      monthByTrimester.set(`${m.year}-${m.month}`, t.index);
    }
  }

  months.forEach(({ year, month }, i) => {
    const state_ = M.monthState(year, month);
    const th = el('th', {
      class: `${state_ === 'future' ? 'future' : ''} ${i > 0 ? '' : ''}`,
      title: state_ === 'current' ? 'месяц не завершён' : '',
    }, [
      el('span', { class: 'mname', text: `${M.monthShort(month)}` }),
      el('span', { class: 'state', text: state_ === 'current' ? '◐' : state_ === 'future' ? '·' : '' }),
    ]);
    hr.append(th);
  });

  thead.append(hr);
  table.append(thead);

  const tbody = el('tbody');
  const suggestions = new Map();

  // Предрасчёт по всем месяцам — один раз, чтобы не считать в каждом цикле
  for (const { year, month } of months) {
    suggestions.set(`${year}-${month}`, suggestFor(classId, year, month).out);
  }

  for (const st of students) {
    const tr = el('tr');
    tr.append(el('td', { class: 'col-num', text: st.number ?? '' }));
    tr.append(el('td', { class: 'col-name', text: M.shortName(st.fullName) }));

    const activeEx = store.exemptionsOfStudent(st.id).find((e) => M.exemptionActive(e));

    months.forEach(({ year, month }, i) => {
      const sugg = suggestions.get(`${year}-${month}`).get(st.id) || { pick: '—' };
      const mm = store.monthlyFor(st.id, year, month);
      const status = monthlyStatus(st.id, year, month, sugg);

      const td = el('td', {
        class: `mcell ${i === months.length - 1 ? '' : ''} ${status.stale ? 'stale' : ''}`,
        'data-student': st.id,
        'data-year': year,
        'data-month': month,
      });

      const inner = el('div', { class: 'mcell-inner' });

      if (status.accepted) {
        inner.append(el('span', {
          class: `accepted ${status.overridden ? 'overridden' : ''}`,
          text: status.accepted,
          style: status.overridden ? `color: var(--mark-m)` : '',
        }));
        if (status.stale && status.suggest !== status.accepted) {
          inner.append(el('span', { class: 'suggest' }, [
            el('span', { class: 'spark', text: '⚡' }),
            el('span', { text: `${status.suggest}` }),
          ]));
        }
      } else if (sugg.pick && sugg.pick !== '—') {
        inner.append(el('span', { class: 'suggest' }, [
          el('span', { class: 'spark', text: '✨' }),
          el('span', { text: sugg.pick }),
        ]));
      } else {
        inner.append(el('span', { class: 'cell-empty-dash', text: '·' }));
      }

      td.append(inner);
      td.addEventListener('click', () => {
        ui.haptic(6);
        openMonthlySheet(st.id, year, month, classId, opts);
      });
      tr.append(td);
    });

    tbody.append(tr);
  }

  table.append(tbody);
  wrap.append(table);
  root.append(wrap);
}

/**
 * Шторка месячной отметки: крупные кнопки, строка со средним и предложением,
 * кнопка «Принять».
 */
export function openMonthlySheet(studentId, year, month, classId, opts = {}) {
  const student = store.state.students.find((s) => s.id === studentId);
  if (!student) return;

  const lessons = store.lessonsOfMonth(classId, year, month);
  const markMap = store.markMap(classId);
  const marks = lessons.map((l) => markMap.get(`${l.id}|${studentId}`)).filter(Boolean);
  const rules = store.state.settings.rules;
  const sugg = M.computeMonthly({ lessons, marks, rules });
  const mm = store.monthlyFor(studentId, year, month);
  const monthLabel = `${M.monthName(month)} ${year}`;

  const sheet = el('div');
  const draw = () => {
    sheet.innerHTML = '';
    sheet.append(
      el('h2', { text: M.shortName(student.fullName) }),
      el('div', { class: 'sub', text: `Месячная отметка · ${monthLabel}` }),
    );

    const buttons = el('div', { class: 'sheet-buttons' });
    const current = store.monthlyFor(studentId, year, month)?.value;

    [...['5', '4', '3', '2', '1'], 'ОСВ', 'Н', '—'].forEach((v) => {
      const isNum = ['1', '2', '3', '4', '5'].includes(v);
      buttons.append(el('button', {
        type: 'button',
        class: `${isNum ? 'v' + v : v === 'ОСВ' ? 'osv' : v === 'Н' ? 'absent' : 'clear-cell'} ${current === v ? 'on' : ''} ${isNum ? '' : 'small-label'}`,
        text: v,
        onclick: async () => {
          await store.setMonthlyOverride(studentId, year, month, v);
          ui.haptic(10);
          ui.closeSheet();
          ui.toast(`М за ${monthLabel}: ${v} (вручную)`);
          setTimeout(() => draw && afterClose(), 10);
        },
      }));
    });

    sheet.append(buttons);

    // Пояснение расчёта
    const lines = [];
    if (sugg.count) {
      lines.push(`Средний балл за ${M.monthNameGen(month)}: <b>${M.fmtAvg(sugg.raw)}</b> (оценок: ${sugg.count}) — расчётная М: <b>${sugg.pick}</b>`);
      if (sugg.capped) lines.push('Применено ограничение: есть оценки 1–2, поэтому не выше 3.');
    } else if (sugg.osvOnly) {
      lines.push('Все уроки месяца — ОСВ. Предлагается «ОСВ».');
    } else if (sugg.allAbsent) {
      lines.push('Все уроки месяца пропущены (Н). Предлагается «Н».');
    } else {
      lines.push(`За ${M.monthNameGen(month)} оценок нет — предлагается «—».`);
    }
    if (mm?.overriddenByTeacher) {
      lines.push('<br>Эта отметка выставлена вручную и больше не пересчитывается.');
    }
    const el_ = el('div', { class: 'compare-line', html: lines.join('<br>') });
    sheet.append(el_);

    if (sugg.pick && sugg.pick !== '—' && current !== sugg.pick) {
      sheet.append(el('div', { class: 'actions' }, [
        el('button', {
          class: 'btn primary wide', type: 'button', text: `Принять ${sugg.pick}`,
          onclick: async () => {
            await store.setMonthlyComputed(studentId, year, month, sugg.pick);
            ui.haptic(10);
            ui.closeSheet();
            ui.toast(`Принято: ${sugg.pick}`);
          },
        }),
      ]));
    }

    if (mm) {
      sheet.append(el('div', { class: 'actions' }, [
        el('button', {
          class: 'btn wide', type: 'button', text: 'Сбросить и считать заново',
          onclick: async () => {
            await store.clearMonthlyOverride(studentId, year, month);
            ui.closeSheet();
            ui.toast('Отметка сброшена — считается автоматически');
          },
        }),
      ]));
    }

    const rulesNote = el('div', {
      style: 'margin-top:14px;font-size:12px;color:var(--text-3);text-align:center',
      text: `Правило подсчёта: режим ${rules.mode}${rules.capAt3OnBad ? ', не выше 3 при двойках' : ''}`,
    });
    sheet.append(rulesNote);
  };

  let closed = false;
  const afterClose = () => { closed = true; };
  draw();
  ui.openSheet(sheet, { onClose: () => { if (opts.onChanged) opts.onChanged(); } });
}

/** Массовый расчёт с превью и чекбоксами. */
function openBulkCalc(classId, opts) {
  const students = store.studentsOfClass(classId);
  const tr = store.currentTrimester();
  const months = M.monthsOfTrimester(tr);
  const items = [];

  for (const st of students) {
    for (const { year, month } of months) {
      const lessons = store.lessonsOfMonth(classId, year, month);
      const markMap = store.markMap(classId);
      const marks = lessons.map((l) => markMap.get(`${l.id}|${st.id}`)).filter(Boolean);
      const sugg = M.computeMonthly({ lessons, marks, rules: store.state.settings.rules });
      const mm = store.monthlyFor(st.id, year, month);

      // уже принятое и совпадающее — не предлагаем; ручное — снято с галочки
      if (!sugg.pick || sugg.pick === '—') continue;
      if (mm && mm.overriddenByTeacher) {
        items.push({ st, year, month, sugg, mm, checked: false, manual: true });
      } else if (!mm || mm.value !== sugg.pick) {
        items.push({ st, year, month, sugg, mm, checked: true, manual: false });
      }
    }
  }

  if (!items.length) {
    ui.toast('Все месячные отметки за триместр уже рассчитаны');
    return;
  }

  const sheet = el('div');
  sheet.append(
    el('h2', { text: 'Рассчитать все М' }),
    el('div', { class: 'sub', text: `${tr.index}-й триместр · найдено ${items.length} записей` }),
  );

  const list = el('div', { class: 'preview-list' });

  const renderItems = () => {
    list.innerHTML = '';
    for (const it of items) {
      const cb = el('div', { class: `checkbox ${it.checked ? 'on' : ''}` }, [icon('check')]);
      const row = el('div', { class: 'preview-item' }, [
        cb,
        el('div', { class: 'txt' }, [
          el('div', { text: `${M.shortName(it.st.fullName)} — ${M.monthShort(it.month)}`, style: 'font-weight:600' }),
          el('div', {
            class: 'calc',
            text: `${it.manual ? 'выставлено вручную: ' + (it.mm?.value || '—') + ' · ' : ''}средний ${M.fmtAvg(it.sugg.raw)} → М ${it.sugg.pick}`,
          }),
        ]),
      ]);
      row.addEventListener('click', () => {
        it.checked = !it.checked;
        renderItems();
      });
      list.append(row);
    }
  };
  renderItems();
  sheet.append(list);

  sheet.append(el('div', { class: 'actions' }, [
    el('button', {
      class: 'btn primary wide', type: 'button',
      text: 'Применить выбранные',
      onclick: async () => {
        const chosen = items.filter((i) => i.checked);
        if (!chosen.length) { ui.toast('Ничего не выбрано'); return; }
        const ok = await ui.confirmDialog({
          title: 'Применить?',
          text: `Будет записано ${chosen.length} месячных отметок. Ручные выставления не затрагиваются.`,
          ok: 'Применить',
        });
        if (!ok) return;
        await store.bulkSetMonthly(chosen.map((i) => ({
          studentId: i.st.id, year: i.year, month: i.month, value: i.sugg.pick, overridden: false,
        })));
        ui.closeSheet();
        ui.toast(`Записано ${chosen.length} отметок`);
        if (opts.onChanged) opts.onChanged();
      },
    }),
    el('button', { class: 'btn wide', type: 'button', text: 'Отмена', onclick: ui.closeSheet }),
  ]));

  ui.openSheet(sheet);
}
