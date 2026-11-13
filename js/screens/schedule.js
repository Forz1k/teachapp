/* screens/schedule.js — раздел «Расписание».
   Два режима: неделя (шаблон по дням недели) и день (конкретная дата с правками).
   Правка на конкретный день не меняет шаблон — она живёт в scheduleOverrides. */

import * as M from '../model.js';
import * as store from '../store.js';
import * as ui from '../ui.js';

const { el, icon } = ui;

/** Основной экран раздела. */
export function renderSchedule(root, opts = {}) {
  const state = { mode: opts.mode || 'day', date: opts.date || M.todayIso() };

  const topbar = el('div', { class: 'topbar' });
  const body = el('div');
  root.append(topbar, body);

  const draw = () => {
    topbar.innerHTML = '';
    body.innerHTML = '';

    const seg = el('div', { class: 'topbar-row' }, [
      el('h1', { text: 'Расписание' }),
      el('div', { style: 'flex:1' }),
      el('button', {
        class: 'icon-btn', type: 'button', title: 'Загрузить из Excel',
        onclick: () => openImportSheet(),
      }, [icon('upload')]),
    ]);

    const modeSwitch = el('div', { class: 'segmented', style: 'margin-top:8px' }, [
      el('button', {
        type: 'button', class: state.mode === 'day' ? 'active' : '', text: 'День',
        onclick: () => { state.mode = 'day'; draw(); },
      }),
      el('button', {
        type: 'button', class: state.mode === 'week' ? 'active' : '', text: 'Неделя',
        onclick: () => { state.mode = 'week'; draw(); },
      }),
    ]);

    topbar.append(seg, modeSwitch);

    if (state.mode === 'day') drawDay();
    else drawWeek();
  };

  /* ---------- режим «День» ---------- */

  function drawDay() {
    const dateInput = el('input', { type: 'date', value: state.date });
    dateInput.addEventListener('change', () => {
      state.date = dateInput.value;
      draw();
    });

    const nav = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:10px' }, [
      el('button', {
        class: 'icon-btn', type: 'button', title: 'Предыдущий день',
        onclick: () => { state.date = M.addDays(state.date, -1); draw(); },
      }, [icon('back')]),
      el('button', {
        class: 'chip', type: 'button', text: 'Сегодня',
        style: 'flex:1;text-align:center',
        onclick: () => { state.date = M.todayIso(); draw(); },
      }),
      el('button', {
        class: 'icon-btn', type: 'button', title: 'Следующий день',
        onclick: () => { state.date = M.addDays(state.date, 1); draw(); },
      }, [icon('chevron')]),
    ]);

    const list = store.scheduleForDate(state.date);
    const overrides = store.overridesOfDate(state.date);
    const changed = overrides.length > 0;

    const head = el('div', { style: 'padding:4px 16px 12px' }, [
      el('div', {
        style: 'font-size:20px;font-weight:700;letter-spacing:-.3px',
        text: `${M.weekdayFull(M.weekdayOf(state.date))}`,
      }),
      el('div', {
        style: 'font-size:14px;color:var(--text-2);margin-top:2px;font-feature-settings:"tnum" 1',
        text: M.fmtFull(state.date) + (state.date === M.todayIso() ? ' · сегодня' : ''),
      }),
      changed ? el('div', {
        style: 'font-size:13px;color:var(--accent);font-weight:600;margin-top:6px',
        text: `Изменено на этот день: ${overrides.length}`,
      }) : null,
      nav,
      el('label', { class: 'field', style: 'margin-top:12px;margin-bottom:0' }, [dateInput]),
    ]);
    body.append(head);

    const wrap = el('div', { style: 'padding:0 16px' });

    if (changed) {
      wrap.append(el('div', { style: 'display:flex;gap:8px;margin-bottom:12px' }, [
        el('button', {
          class: 'btn small', type: 'button', text: 'Вернуть как в расписании',
          onclick: async () => {
            const ok = await ui.confirmDialog({
              title: 'Сбросить правки?',
              text: `Все изменения на ${M.fmtFull(state.date)} будут отменены, день вернётся к обычному расписанию.`,
              ok: 'Сбросить',
            });
            if (!ok) return;
            await store.clearOverridesForDate(state.date);
            ui.toast('День сброшен к обычному расписанию');
            draw();
          },
        }),
      ]));
    }

    if (!list.length) {
      wrap.append(el('div', { class: 'empty' }, [
        icon('calendar'),
        el('div', { text: 'На этот день уроков нет.' }),
        el('div', { style: 'margin-top:16px;display:flex;flex-direction:column;gap:8px' }, [
          el('button', {
            class: 'btn', type: 'button', text: 'Добавить урок на этот день',
            onclick: () => openDayAddSheet(state.date, draw),
          }),
          el('button', {
            class: 'btn', type: 'button', text: 'Заполнить расписание на неделю',
            onclick: () => { state.mode = 'week'; draw(); },
          }),
        ]),
      ]));
      body.append(wrap);
      return;
    }

    for (const item of list) {
      const cls = store.state.classes.find((c) => c.id === item.classId);
      const isChanged = !!item.override;

      const row = el('div', {
        class: 'ex-item',
        style: isChanged ? 'border:1.5px solid var(--accent)' : '',
      }, [
        el('div', {
          style: 'width:44px;text-align:center;flex:0 0 auto',
        }, [
          el('div', { style: 'font-size:11px;color:var(--text-3);font-weight:600', text: 'урок' }),
          el('div', { style: 'font-size:22px;font-weight:800;font-feature-settings:"tnum" 1', text: String(item.slot) }),
        ]),
        el('div', { class: 'who' }, [
          el('div', { class: 'fio', text: cls ? cls.name : 'класс не найден' }),
          el('div', { class: 'dates', text: item.time ? item.time : 'время не указано' }),
          isChanged ? el('div', { class: 'reason', style: 'color:var(--accent)', text: 'изменено на этот день' }) : null,
        ]),
      ]);

      row.append(el('button', {
        class: 'icon-btn plain', type: 'button', title: 'Изменить',
        onclick: () => openDayEditSheet(state.date, item, draw),
      }, [icon('chevron')]));

      wrap.append(row);
    }

    wrap.append(el('div', { style: 'margin-top:14px' }, [
      el('button', {
        class: 'btn wide', type: 'button', text: '+ Добавить урок на этот день',
        onclick: () => openDayAddSheet(state.date, draw),
      }),
    ]));

    body.append(wrap);
  }

  /* ---------- режим «Неделя» ---------- */

  function drawWeek() {
    const head = el('div', { style: 'padding:0 16px 10px' }, [
      el('div', { style: 'font-size:13px;color:var(--text-2);line-height:1.45',
        text: 'Обычное расписание по дням недели. Правки на конкретный день делаются во вкладке «День».' }),
    ]);
    body.append(head);

    const wrap = el('div', { style: 'padding:0 16px' });

    const anySchedule = store.state.schedule.length > 0;
    if (!anySchedule) {
      wrap.append(el('div', { class: 'empty' }, [
        icon('calendar'),
        el('div', { text: 'Расписание пока пустое.' }),
        el('div', { style: 'margin-top:16px;display:flex;flex-direction:column;gap:8px' }, [
          el('button', {
            class: 'btn primary wide', type: 'button', text: 'Загрузить из Excel',
            onclick: () => openImportSheet(),
          }),
          el('button', {
            class: 'btn wide', type: 'button', text: 'Заполнить вручную',
            onclick: () => openWeekAddSheet(1, draw),
          }),
        ]),
      ]));
      body.append(wrap);
      return;
    }

    for (const day of M.WEEKDAYS) {
      const list = store.scheduleOfDay(day.n);
      if (!list.length) continue;

      wrap.append(el('div', {
        style: 'padding:14px 0 6px;font-size:13px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px',
        text: day.full,
      }));

      for (const item of list) {
        const cls = store.state.classes.find((c) => c.id === item.classId);
        const row = el('div', { class: 'ex-item' }, [
          el('div', { style: 'width:36px;text-align:center;flex:0 0 auto' }, [
            el('div', { style: 'font-size:11px;color:var(--text-3);font-weight:600', text: '№' }),
            el('div', { style: 'font-size:20px;font-weight:800;font-feature-settings:"tnum" 1', text: String(item.slot) }),
          ]),
          el('div', { class: 'who' }, [
            el('div', { class: 'fio', text: cls ? cls.name : 'класс не найден' }),
            el('div', { class: 'dates', text: item.time || 'время не указано' }),
          ]),
        ]);

        row.append(el('button', {
          class: 'icon-btn plain', type: 'button', title: 'Изменить',
          onclick: () => openWeekEditSheet(item, draw),
        }, [icon('chevron')]));
        row.append(el('button', {
          class: 'icon-btn plain', type: 'button', title: 'Удалить',
          onclick: async () => {
            const ok = await ui.confirmDialog({
              title: 'Удалить из расписания?',
              text: `${day.full}, ${item.slot}-й урок, ${cls ? cls.name : ''}.`,
              ok: 'Удалить', danger: true,
            });
            if (!ok) return;
            await store.deleteScheduleEntry(item.id);
            ui.toast('Удалено из расписания');
            draw();
          },
        }, [icon('trash')]));

        wrap.append(row);
      }

      wrap.append(el('div', { style: 'margin:6px 0 10px' }, [
        el('button', {
          class: 'btn small', type: 'button', text: `+ урок в ${day.short}`,
          onclick: () => openWeekAddSheet(day.n, draw, list),
        }),
      ]));
    }

    body.append(wrap);
  }

  draw();
}

/* ---------- шторки ---------- */

/** Выбор класса из списка. Возвращает id или null. */
function classSelect(selectedId = null) {
  const sel = el('select', {});
  sel.append(el('option', { value: '', text: '— выберите класс —' }));
  for (const c of store.state.classes) {
    const o = el('option', { value: c.id, text: c.name });
    if (c.id === selectedId) o.selected = true;
    sel.append(o);
  }
  return sel;
}

/** Шторка добавления урока в недельный шаблон. */
function openWeekAddSheet(weekday, onDone, existing = []) {
  const usedSlots = new Set(existing.map((r) => r.slot));
  let nextSlot = 1;
  while (usedSlots.has(nextSlot)) nextSlot += 1;

  const slotInput = el('input', { type: 'number', min: '1', max: '12', value: String(nextSlot) });
  const sel = classSelect();
  const timeInput = el('input', { type: 'text', placeholder: '08:30', inputmode: 'numeric' });

  const sheet = el('div', {}, [
    el('h2', { text: 'Урок в расписании' }),
    el('div', { class: 'sub', text: M.weekdayFull(weekday) }),
    el('label', { class: 'field' }, [el('span', { text: 'Номер урока' }), slotInput]),
    el('label', { class: 'field' }, [el('span', { text: 'Класс' }), sel]),
    el('label', { class: 'field' }, [el('span', { text: 'Время урока' }), timeInput]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Сохранить',
        onclick: async () => {
          if (!sel.value) { ui.toast('Выберите класс'); return; }
          const slot = Number(slotInput.value);
          if (!Number.isFinite(slot) || slot <= 0) { ui.toast('Неверный номер урока'); return; }
          const clash = store.scheduleOfDay(weekday).find((r) => r.slot === slot);
          if (clash) {
            ui.toast(`Урок №${slot} в этот день уже есть`);
            return;
          }
          await store.setScheduleEntry({
            weekday, slot, classId: sel.value, time: timeInput.value,
          });
          ui.closeSheet();
          ui.toast('Добавлено в расписание');
          onDone();
        },
      }),
    ]),
  ]);
  ui.openSheet(sheet);
}

/** Шторка редактирования записи недельного шаблона. */
function openWeekEditSheet(item, onDone) {
  const slotInput = el('input', { type: 'number', min: '1', max: '12', value: String(item.slot) });
  const sel = classSelect(item.classId);
  const timeInput = el('input', { type: 'text', value: item.time || '', placeholder: '08:30', inputmode: 'numeric' });

  const sheet = el('div', {}, [
    el('h2', { text: 'Изменить урок' }),
    el('div', { class: 'sub', text: M.weekdayFull(item.weekday) }),
    el('label', { class: 'field' }, [el('span', { text: 'Номер урока' }), slotInput]),
    el('label', { class: 'field' }, [el('span', { text: 'Класс' }), sel]),
    el('label', { class: 'field' }, [el('span', { text: 'Время урока' }), timeInput]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Сохранить',
        onclick: async () => {
          if (!sel.value) { ui.toast('Выберите класс'); return; }
          await store.setScheduleEntry({
            id: item.id,
            weekday: item.weekday,
            slot: Number(slotInput.value),
            classId: sel.value,
            time: timeInput.value,
          });
          ui.closeSheet();
          ui.toast('Сохранено');
          onDone();
        },
      }),
      el('button', {
        class: 'btn wide danger', type: 'button', text: 'Удалить из расписания',
        onclick: async () => {
          const ok = await ui.confirmDialog({
            title: 'Удалить урок?',
            text: 'Урок исчезнет из недельного расписания. Правки на отдельные дни тоже удалятся.',
            ok: 'Удалить', danger: true,
          });
          if (!ok) return;
          await store.deleteScheduleEntry(item.id);
          ui.closeSheet();
          ui.toast('Удалено');
          onDone();
        },
      }),
    ]),
  ]);
  ui.openSheet(sheet);
}

/** Шторка правки расписания на конкретную дату. */
function openDayEditSheet(dateIso, item, onDone) {
  const cls = store.state.classes.find((c) => c.id === item.classId);
  const sheet = el('div', {}, [
    el('h2', { text: `Урок ${item.slot}` }),
    el('div', { class: 'sub', text: `${cls ? cls.name : ''} · ${M.fmtFull(dateIso)}` }),
    el('div', { class: 'sub', style: 'margin-bottom:12px', text: 'Что изменить на этот день?' }),
    el('div', { class: 'actions', style: 'margin-top:0' }, [
      el('button', {
        class: 'btn wide', type: 'button', text: 'Изменить время',
        onclick: () => openDayFieldSheet(dateIso, item, 'time', onDone),
      }),
      el('button', {
        class: 'btn wide', type: 'button', text: 'Заменить класс',
        onclick: () => openDayFieldSheet(dateIso, item, 'class', onDone),
      }),
      el('button', {
        class: 'btn wide', type: 'button', text: 'Сдвинуть номер урока',
        onclick: () => openDayFieldSheet(dateIso, item, 'slot', onDone),
      }),
      el('button', {
        class: 'btn wide danger', type: 'button', text: 'Отменить урок в этот день',
        onclick: async () => {
          await store.setScheduleOverride({
            date: dateIso,
            ruleId: item.override?.ruleId || item.id,
            action: 'cancel',
          });
          ui.closeSheet();
          ui.toast('Урок отменён на этот день');
          onDone();
        },
      }),
    ]),
  ]);
  ui.openSheet(sheet);
}

/** Меняет одно поле на дату. */
function openDayFieldSheet(dateIso, item, field, onDone) {
  let input;
  let label;
  if (field === 'time') {
    label = 'Время урока';
    input = el('input', { type: 'text', value: item.time || '', placeholder: '08:30', inputmode: 'numeric' });
  } else if (field === 'slot') {
    label = 'Номер урока';
    input = el('input', { type: 'number', min: '1', max: '12', value: String(item.slot) });
  } else {
    label = 'Класс';
    input = classSelect(item.classId);
  }

  const sheet = el('div', {}, [
    el('h2', { text: label }),
    el('div', { class: 'sub', text: M.fmtFull(dateIso) }),
    el('label', { class: 'field' }, [input]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Применить на этот день',
        onclick: async () => {
          const override = item.override;
          const base = {
            date: dateIso,
            ruleId: override?.ruleId || item.id,
            action: 'move',
          };
          if (field === 'time') base.time = input.value;
          if (field === 'slot') base.slot = Number(input.value);
          if (field === 'class') base.classId = input.value;

          // Если правка уже существует — обновляем её, а не плодим дубликаты
          await store.setScheduleOverride({ id: override?.id || null, ...base });
          ui.closeSheet();
          ui.toast('Изменено на этот день');
          onDone();
        },
      }),
      el('button', {
        class: 'btn wide', type: 'button', text: 'Отмена',
        onclick: () => { ui.closeSheet(); setTimeout(() => openDayEditSheet(dateIso, item, onDone), 320); },
      }),
    ]),
  ]);
  ui.openSheet(sheet);
}

/** Добавить урок в конкретный день (сверх обычного расписания). */
function openDayAddSheet(dateIso, onDone) {
  const weekday = M.weekdayOf(dateIso);
  const slotInput = el('input', { type: 'number', min: '1', max: '12', value: '1' });
  const sel = classSelect();
  const timeInput = el('input', { type: 'text', placeholder: '08:30', inputmode: 'numeric' });

  const sheet = el('div', {}, [
    el('h2', { text: 'Добавить урок' }),
    el('div', { class: 'sub', text: `${M.weekdayFull(weekday)}, ${M.fmtFull(dateIso)}` }),
    el('div', {
      class: 'compare-line',
      style: 'margin-top:0;margin-bottom:12px;font-size:12px',
      text: 'Урок появится только в этот день. Недельное расписание не изменится.',
    }),
    el('label', { class: 'field' }, [el('span', { text: 'Номер урока' }), slotInput]),
    el('label', { class: 'field' }, [el('span', { text: 'Класс' }), sel]),
    el('label', { class: 'field' }, [el('span', { text: 'Время' }), timeInput]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Добавить',
        onclick: async () => {
          if (!sel.value) { ui.toast('Выберите класс'); return; }
          await store.setScheduleOverride({
            date: dateIso,
            action: 'add',
            classId: sel.value,
            slot: Number(slotInput.value) || 1,
            time: timeInput.value || null,
          });
          ui.closeSheet();
          ui.toast('Урок добавлен на этот день');
          onDone();
        },
      }),
    ]),
  ]);
  ui.openSheet(sheet);
}

/* ---------- импорт ---------- */

/** Загрузка расписания из Excel. */
export function openImportSheet() {
  const fileInput = el('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: 'display:none' });
  document.body.append(fileInput);

  const formatBox = el('div', { class: 'compare-line', html:
    'Файл Excel с колонками:<br>'
    + '<b>Номер урока</b> | <b>Класс</b> | <b>Время урока</b> | <b>День недели</b><br><br>'
    + 'Колонка «День недели» необязательна: если её нет, каждый лист считается одним днём — '
    + 'назовите лист «Пн», «Вторник» или «Понедельник».',
  });

  const sheet = el('div', {}, [
    el('h2', { text: 'Загрузить расписание' }),
    el('div', { class: 'sub', text: 'Из Excel — заменит текущее расписание' }),
    formatBox,
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Выбрать файл Excel',
        onclick: () => fileInput.click(),
      }),
      el('button', {
        class: 'btn wide', type: 'button', text: 'Ввести вручную',
        onclick: () => { ui.closeSheet(); setTimeout(() => openWeekAddSheet(1, () => store.notify()), 320); },
      }),
    ]),
  ]);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = '';
    try {
      const { parseScheduleFile } = await import('../export.js');
      const parsed = await parseScheduleFile(file);
      ui.closeSheet();
      setTimeout(() => showImportPreview(parsed), 320);
    } catch (err) {
      ui.toast('Ошибка чтения: ' + err.message, null, 6000);
    }
  });

  ui.openSheet(sheet);
}

/** Превью разобранного расписания перед записью. */
function showImportPreview(parsed) {
  const { entries, warnings } = parsed;

  const sheet = el('div', {}, [
    el('h2', { text: 'Проверьте расписание' }),
    el('div', { class: 'sub', text: `Найдено уроков: ${entries.length}` }),
  ]);

  if (warnings.length) {
    const warn = el('div', { class: 'compare-line', style: 'margin-top:0;margin-bottom:12px;color:var(--mark-3)' });
    warn.innerHTML = warnings.map((w) => '• ' + w).join('<br>');
    sheet.append(warn);
  }

  // Группируем по дням
  const list = el('div', { class: 'preview-list' });
  for (const day of M.WEEKDAYS) {
    const dayEntries = entries.filter((e) => e.weekday === day.n).sort((a, b) => a.slot - b.slot);
    if (!dayEntries.length) continue;
    list.append(el('div', {
      style: 'padding:10px 0 4px;font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase',
      text: day.full,
    }));
    for (const e of dayEntries) {
      list.append(el('div', { class: 'preview-item' }, [
        el('div', { style: 'width:28px;color:var(--text-3);font-feature-settings:"tnum" 1', text: String(e.slot) }),
        el('div', { class: 'txt', text: e.className }),
        el('div', { class: 'calc', text: e.time || '—' }),
      ]));
    }
  }
  sheet.append(list);

  if (!entries.length) {
    sheet.append(el('div', { class: 'empty', text: 'Ни одной записи не распознано. Проверьте формат файла.' }));
  }

  sheet.append(el('div', { class: 'actions' }, [
    el('button', {
      class: 'btn primary wide', type: 'button', text: 'Записать расписание',
      disabled: !entries.length,
      onclick: async () => {
        const { applySchedule } = await import('../export.js');
        const n = await applySchedule(entries);
        ui.closeSheet();
        ui.toast(`Расписание сохранено: ${n} уроков`);
      },
    }),
    el('button', { class: 'btn wide', type: 'button', text: 'Отмена', onclick: ui.closeSheet }),
  ]));

  ui.openSheet(sheet);
}
