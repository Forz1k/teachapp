/* screens/settings.js — настройки, импорт, экспорт, резервные копии, управление классами. */

import * as M from '../model.js';
import * as store from '../store.js';
import * as ui from '../ui.js';
import * as exporter from '../export.js';
import { seedDemo } from '../demo.js';

const { el, icon } = ui;

export function renderSettings(root, ctx = {}) {
  const settings = store.state.settings;

  root.append(el('div', { class: 'topbar' }, [
    el('div', { class: 'topbar-row' }, [el('h1', { text: 'Настройки' })]),
  ]));

  const body = el('div', { class: 'list', style: 'gap:0' });
  root.append(body);

  /* ---------- учебный год ---------- */
  const yearBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Учебный год' })]);
  const yearFrom = el('input', { type: 'date', value: settings.year.from });
  const yearTo = el('input', { type: 'date', value: settings.year.to });
  yearFrom.addEventListener('change', () => store.setYear(yearFrom.value, yearTo.value));
  yearTo.addEventListener('change', () => store.setYear(yearFrom.value, yearTo.value));
  yearBlock.append(el('div', { style: 'padding:12px 16px' }, [
    el('label', { class: 'field' }, [el('span', { text: 'Начало' }), yearFrom]),
    el('label', { class: 'field', style: 'margin-bottom:0' }, [el('span', { text: 'Окончание' }), yearTo]),
  ]));
  body.append(yearBlock);

  /* ---------- триместры ---------- */
  const trBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Триместры' })]);
  for (const t of settings.trimesters) {
    const f = el('input', { type: 'date', value: t.from });
    const to = el('input', { type: 'date', value: t.to });
    f.addEventListener('change', () => store.setTrimesterRange(t.id, f.value, to.value));
    to.addEventListener('change', () => store.setTrimesterRange(t.id, f.value, to.value));
    trBlock.append(el('div', { style: 'padding:12px 16px;border-bottom:.5px solid var(--sep)' }, [
      el('div', { style: 'font-weight:600;margin-bottom:8px', text: `${t.index}-й триместр` }),
      el('label', { class: 'field' }, [el('span', { text: 'С' }), f]),
      el('label', { class: 'field', style: 'margin-bottom:0' }, [el('span', { text: 'По' }), to]),
    ]));
  }
  body.append(trBlock);

  /* ---------- правила М ---------- */
  const rules = settings.rules;
  const rulesBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Правила месячной отметки (М)' })]);

  const modeSeg = el('div', { class: 'segmented', style: 'margin:12px 16px' },
    [
      { id: 'A', label: 'Округление' },
      { id: 'B', label: 'Вес 2' },
      { id: 'C', label: 'Банк' },
    ].map((m) => el('button', {
      type: 'button', class: rules.mode === m.id ? 'active' : '', text: m.label,
      onclick: () => store.setRules({ mode: m.id }),
    })));

  const modeHelp = {
    A: 'Обычное школьное округление: 4,5 → 5; 3,5 → 4.',
    B: 'Средневзвешенное: оценка с пометкой «вес 2» (контрольный норматив) считается дважды.',
    C: 'Строгое среднее с банком: округление к ближайшему целому, ровно ,5 — в пользу ученика.',
  }[rules.mode] || '';

  rulesBlock.append(
    el('div', { style: 'padding:0 16px 4px;font-size:13px;color:var(--text-2)', text: 'Режим подсчёта' }),
    modeSeg,
    el('div', { style: 'padding:0 16px 12px;font-size:13px;color:var(--text-3);line-height:1.45', text: modeHelp }),
  );

  const capSwitch = el('button', {
    type: 'button', class: `switch ${rules.capAt3OnBad ? 'on' : ''}`, role: 'switch',
    'aria-checked': String(rules.capAt3OnBad),
    onclick: () => store.setRules({ capAt3OnBad: !rules.capAt3OnBad }),
  });
  rulesBlock.append(el('div', { class: 'row-item' }, [
    el('div', { class: 'label', text: 'Не выводить М выше 3, если в месяце есть 1 или 2' }),
    capSwitch,
  ]));
  body.append(rulesBlock);

  /* ---------- классы ---------- */
  const clsBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Классы' })]);
  for (const cls of store.state.classes) {
    const n = store.studentsOfClass(cls.id).length;
    clsBlock.append(el('div', { class: 'row-item' }, [
      el('div', { class: 'label' }, [
        el('div', { text: cls.name + (cls.isDemo ? ' (демо)' : '') }),
        el('div', { style: 'font-size:12px;color:var(--text-3)', text: `${n} учеников` }),
      ]),
      el('button', {
        class: 'btn small', type: 'button', text: 'Состав',
        onclick: () => openClassStudents(cls.id),
      }),
      el('button', {
        class: 'btn small', type: 'button', text: '✎',
        onclick: async () => {
          const name = await ui.promptDialog({ title: 'Название класса', value: cls.name });
          if (name === null || !name.trim()) return;
          await store.renameClass(cls.id, name);
        },
      }),
      el('button', {
        class: 'btn small danger', type: 'button', text: '✕',
        onclick: async () => {
          const cnt = store.studentsOfClass(cls.id).length;
          const ok = await ui.confirmDialog({
            title: `Удалить класс ${cls.name}?`,
            text: `Удалятся ${cnt} учеников вместе со всеми оценками, освобождениями и месячными отметками. Отменить это будет нельзя.`,
            ok: 'Удалить', danger: true,
          });
          if (!ok) return;
          await store.deleteClass(cls.id);
          ui.toast('Класс удалён');
        },
      }),
    ]));
  }
  clsBlock.append(el('div', { class: 'row-item' }, [
    el('button', {
      class: 'btn small', type: 'button', text: '+ Добавить класс',
      onclick: async () => {
        const name = await ui.promptDialog({ title: 'Название класса', placeholder: 'например: 9А', ok: 'Добавить' });
        if (name === null || !name.trim()) return;
        await store.addClass(name);
        ui.toast('Класс добавлен');
      },
    }),
  ]));
  body.append(clsBlock);

  /* ---------- КТП ---------- */
  const ktpBlock = el('div', { class: 'card-block' }, [
    el('div', { class: 'head', text: `КТП (${store.state.ktp.length})` }),
  ]);
  ktpBlock.append(el('div', { class: 'row-item' }, [
    el('div', { class: 'label' }, [
      el('div', { text: 'Планы по классам' }),
      el('div', {
        style: 'font-size:12px;color:var(--text-3)',
        text: store.state.ktp.length
          ? store.state.ktp.map((k) => k.name).slice(0, 3).join(', ') + (store.state.ktp.length > 3 ? '…' : '')
          : 'ещё не созданы',
      }),
    ]),
    el('button', {
      class: 'btn small', type: 'button', text: 'Открыть',
      onclick: () => {
        import('./ktp.js').then((m) => m.renderKtpInSheet());
      },
    }),
  ]));
  body.append(ktpBlock);

  /* ---------- импорт ---------- */
  const impBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Импорт' })]);
  const fileInput = el('input', {
    type: 'file', accept: '.xlsx,.xls,.csv', style: 'display:none',
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = '';
    try {
      await handleImport(file);
    } catch (err) {
      ui.toast('Ошибка импорта: ' + err.message, null, 6000);
    }
  });
  document.body.append(fileInput);

  impBlock.append(el('div', { class: 'row-item' }, [
    el('div', { class: 'label' }, [
      el('div', { text: 'Списки классов из Excel' }),
      el('div', { style: 'font-size:12px;color:var(--text-3)', text: 'Лист = класс, или колонка «Класс»' }),
    ]),
    el('button', {
      class: 'btn small', type: 'button', text: 'Выбрать файл',
      onclick: () => fileInput.click(),
    }),
  ]));
  if (!exporter.hasXlsx()) {
    impBlock.append(el('div', { class: 'row-item' }, [
      el('div', { class: 'label', style: 'color:var(--mark-2);font-size:13px', text: 'Модуль XLSX не загружен — положите vendor/xlsx.full.min.js' }),
    ]));
  }
  body.append(impBlock);

  /* ---------- экспорт ---------- */
  const expBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Экспорт' })]);
  expBlock.append(el('div', { class: 'row-item' }, [
    el('div', { class: 'label' }, [
      el('div', { text: 'Выгрузка журнала' }),
      el('div', { style: 'font-size:12px;color:var(--text-3)', text: 'Сводная, для «Моей школы», CSV, TSV' }),
    ]),
    el('button', { class: 'btn small', type: 'button', text: 'Открыть', onclick: () => openExportSheet() }),
  ]));
  body.append(expBlock);

  /* ---------- резервная копия ---------- */
  const backupBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Резервная копия' })]);
  const lastBackup = store.state.lastBackupAt
    ? `Последняя: ${store.state.lastBackupAt.slice(0, 10)}`
    : 'Ещё не делали';
  backupBlock.append(
    el('div', { class: 'row-item' }, [
      el('div', { class: 'label' }, [
        el('div', { text: 'Сохранить копию (JSON)' }),
        el('div', { style: 'font-size:12px;color:var(--text-3)', text: lastBackup }),
      ]),
      el('button', {
        class: 'btn small', type: 'button', text: 'Сохранить',
        onclick: async () => {
          const name = await exporter.exportBackup();
          ui.toast(`Файл ${name} сохранён`, null, 4000);
        },
      }),
    ]),
  );

  const restoreInput = el('input', { type: 'file', accept: '.json', style: 'display:none' });
  restoreInput.addEventListener('change', async () => {
    const file = restoreInput.files?.[0];
    if (!file) return;
    restoreInput.value = '';
    const ok = await ui.confirmDialog({
      title: 'Восстановить из копии?',
      text: 'Текущие данные будут полностью заменены содержимым файла. Рекомендуем сначала сохранить текущую копию.',
      ok: 'Восстановить', danger: true,
    });
    if (!ok) return;
    try {
      const payload = await exporter.readBackupFile(file);
      await store.restoreBackup(payload);
      ui.toast('Данные восстановлены');
    } catch (err) {
      ui.toast('Не удалось: ' + err.message, null, 6000);
    }
  });
  document.body.append(restoreInput);

  backupBlock.append(el('div', { class: 'row-item' }, [
    el('div', { class: 'label', text: 'Восстановить из копии' }),
    el('button', { class: 'btn small', type: 'button', text: 'Выбрать файл', onclick: () => restoreInput.click() }),
  ]));
  body.append(backupBlock);

  /* ---------- демо-данные ---------- */
  const demoBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Демонстрационные данные' })]);
  const demoDesc = el('div', {
    style: 'padding:12px 16px 0;font-size:13px;color:var(--text-2);line-height:1.45',
    text: '3 класса по 30 учеников, темы КТП по физкультуре и заполненные уроки. Помечаются как демо и удаляются одной кнопкой — реальный журнал они не затрагивают.',
  });
  demoBlock.append(demoDesc);
  demoBlock.append(el('div', { class: 'row-item', style: 'border-top:0;margin-top:8px' }, [
    el('div', { class: 'label', text: 'Загрузить демо-данные' }),
    el('button', {
      class: 'btn small primary', type: 'button', text: 'Загрузить',
      onclick: async () => {
        const ok = await ui.confirmDialog({
          title: 'Загрузить демо?',
          text: 'К существующим данным добавятся 3 демо-класса. Затем их можно удалить кнопкой «Стереть демо».',
          ok: 'Загрузить',
        });
        if (!ok) return;
        ui.toast('Готовим демо-данные…', null, 2000);
        const res = await seedDemo({});
        ui.toast(`Загружено: ${res.classes} класса, ${res.students} учеников, ${res.lessons} уроков`, null, 5000);
        ctx.onChanged?.();
      },
    }),
  ]));
  demoBlock.append(el('div', { class: 'row-item' }, [
    el('div', { class: 'label' }, [
      el('div', { text: 'Стереть демо-данные' }),
      el('div', { style: 'font-size:12px;color:var(--text-3)', text: store.hasDemo() ? 'Демо-классы есть' : 'Демо-классов нет' }),
    ]),
    el('button', {
      class: 'btn small danger', type: 'button', text: 'Стереть',
      onclick: async () => {
        if (!store.hasDemo()) { ui.toast('Демо-классов нет'); return; }
        const ok = await ui.confirmDialog({
          title: 'Стереть демо?',
          text: 'Удалятся только классы, помеченные как демонстрационные, вместе с их уроками и отметками.',
          ok: 'Стереть', danger: true,
        });
        if (!ok) return;
        const n = await store.clearDemo();
        ui.toast(`Удалено классов: ${n}`);
        ctx.onChanged?.();
      },
    }),
  ]));
  body.append(demoBlock);

  /* ---------- оформление и о программе ---------- */
  const themeBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Оформление' })]);
  const themeSeg = el('div', { class: 'segmented', style: 'margin:12px 16px' },
    [
      { id: 'auto', label: 'Как в системе' },
      { id: 'light', label: 'Светлая' },
      { id: 'dark', label: 'Тёмная' },
    ].map((t) => el('button', {
      type: 'button', class: settings.theme === t.id ? 'active' : '', text: t.label,
      onclick: () => {
        store.saveSettings({ theme: t.id });
        applyTheme(t.id);
        ctx.onChanged?.();
      },
    })));
  themeBlock.append(themeSeg);
  body.append(themeBlock);

  const aboutBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'О приложении' })]);
  aboutBlock.append(el('div', {
    style: 'padding:14px 16px;font-size:13px;color:var(--text-2);line-height:1.55',
    html: 'Журнал учителя физкультуры. Все данные хранятся <b>только на этом устройстве</b> (IndexedDB), '
      + 'без сервера, аккаунтов и телеметрии. Приложение работает офлайн.<br><br>'
      + `Версия 1.0 · записей в базе: ${store.state.students.length + store.state.marks.length + store.state.lessons.length}`,
  }));
  body.append(aboutBlock);

  body.append(el('div', { style: 'height:20px' }));
}

/** Применяет тему к документу. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') {
    root.removeAttribute('data-theme');
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) root.setAttribute('data-theme', 'dark');
    else root.setAttribute('data-theme', 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = root.getAttribute('data-theme') === 'dark';
    meta.setAttribute('content', dark ? '#0B0B0E' : '#F5F5F7');
  }
}

/* ---------- состав класса ---------- */

function openClassStudents(classId) {
  const cls = store.state.classes.find((c) => c.id === classId);
  const students = store.studentsOfClass(classId);

  const sheet = el('div', {}, [
    el('h2', { text: cls ? cls.name : 'Класс' }),
    el('div', { class: 'sub', text: `${students.length} учеников` }),
  ]);

  const list = el('div', { class: 'preview-list' });
  for (const st of students) {
    const row = el('div', { class: 'preview-item' }, [
      el('div', { class: 'txt', text: `${st.number ?? '—'}. ${st.fullName}` }),
      el('button', {
        class: 'btn small', type: 'button', text: '✎',
        onclick: async (e) => {
          e.stopPropagation();
          const name = await ui.promptDialog({ title: 'ФИО', value: st.fullName });
          if (name === null) return;
          await store.updateStudent(st.id, { fullName: name.trim() || st.fullName });
          ui.closeSheet();
        },
      }),
      el('button', {
        class: 'btn small danger', type: 'button', text: '✕',
        onclick: async (e) => {
          e.stopPropagation();
          const ok = await ui.confirmDialog({
            title: `Удалить ${M.shortName(st.fullName)}?`,
            text: 'Вместе с учеником удалятся все его отметки.',
            ok: 'Удалить', danger: true,
          });
          if (!ok) return;
          await store.deleteStudent(st.id);
          ui.closeSheet();
        },
      }),
    ]);
    list.append(row);
  }
  sheet.append(list);

  const nameInput = el('input', { type: 'text', placeholder: 'Фамилия Имя Отчество' });
  sheet.append(
    el('label', { class: 'field', style: 'margin-top:8px' }, [el('span', { text: 'Добавить ученика' }), nameInput]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Добавить',
        onclick: async () => {
          const v = nameInput.value.trim();
          if (!v) { ui.toast('Введите ФИО'); return; }
          await store.addStudent(classId, v, students.length + 1);
          ui.closeSheet();
          ui.toast('Ученик добавлен');
        },
      }),
    ]),
  );

  ui.openSheet(sheet);
}

/* ---------- импорт ---------- */

async function handleImport(file) {
  const parsed = await exporter.parseRosterFile(file);
  if (!parsed.length) {
    ui.toast('В файле не найдено ни одного класса с учениками', null, 5000);
    return;
  }

  const sheet = el('div', {}, [
    el('h2', { text: 'Импорт списков' }),
    el('div', { class: 'sub', text: 'Проверьте, что распознано верно, затем подтвердите' }),
  ]);

  const list = el('div', { class: 'preview-list' });
  const items = parsed.map((p) => ({ ...p, checked: true }));
  const renderItems = () => {
    list.innerHTML = '';
    for (const p of items) {
      const dup = exporter.findDuplicates(p.students);
      const cb = el('div', { class: `checkbox ${p.checked ? 'on' : ''}` }, [icon('check')]);
      const row = el('div', { class: 'preview-item' }, [
        cb,
        el('div', { class: 'txt' }, [
          el('div', { text: `${p.className} — ${p.students.length} учеников`, style: 'font-weight:600' }),
          dup.length ? el('div', { style: 'font-size:12px;color:var(--mark-3)', text: `Дубликаты ФИО: ${dup.slice(0, 3).join(', ')}${dup.length > 3 ? '…' : ''}` }) : null,
        ]),
      ]);
      row.addEventListener('click', () => { p.checked = !p.checked; renderItems(); });
      list.append(row);
    }
  };
  renderItems();
  sheet.append(list);

  sheet.append(el('div', {
    style: 'font-size:12px;color:var(--text-3);line-height:1.45;margin-bottom:10px',
    text: 'Если ученик с таким ФИО уже есть в классе, обновятся только номер и имя — оценки сохранятся. Новые ученики добавятся.',
  }));

  sheet.append(el('div', { class: 'actions' }, [
    el('button', {
      class: 'btn primary wide', type: 'button', text: 'Импортировать',
      onclick: async () => {
        const chosen = items.filter((i) => i.checked);
        if (!chosen.length) { ui.toast('Ничего не выбрано'); return; }
        ui.closeSheet();
        ui.toast('Импортирую…', null, 2000);
        const report = await exporter.applyRoster(chosen);
        ui.toast(`Готово: классов ${report.classes}, добавлено ${report.added}, обновлено ${report.updated}`, null, 6000);
      },
    }),
    el('button', { class: 'btn wide', type: 'button', text: 'Отмена', onclick: ui.closeSheet }),
  ]));

  ui.openSheet(sheet);
}

/* ---------- экспорт ---------- */

export function openExportSheet(presetClassId = null) {
  const classes = store.state.classes;
  if (!classes.length) { ui.toast('Сначала добавьте класс'); return; }

  const classId = presetClassId || store.state.currentClassId || classes[0].id;
  const tr = store.currentTrimester();

  const classSelect = el('select', {});
  for (const c of classes) {
    const o = el('option', { value: c.id, text: c.name });
    if (c.id === classId) o.selected = true;
    classSelect.append(o);
  }

  const fromInput = el('input', { type: 'date', value: tr.from });
  const toInput = el('input', { type: 'date', value: tr.to });

  const rangeChips = el('div', { class: 'preset-chips' },
    store.state.settings.trimesters.map((t) => el('button', {
      type: 'button', class: t.id === store.state.currentTrimesterId ? 'active' : '', text: `${t.index}-й триместр`,
      onclick: (e) => {
        fromInput.value = t.from;
        toInput.value = t.to;
        rangeChips.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      },
    })).concat([
      el('button', {
        type: 'button', text: 'весь год',
        onclick: (e) => {
          fromInput.value = store.state.settings.year.from;
          toInput.value = store.state.settings.year.to;
          rangeChips.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
      }),
    ]));

  const sheet = el('div', {}, [
    el('h2', { text: 'Выгрузить журнал' }),
    el('div', { class: 'sub', text: 'Выберите класс и период' }),
    el('label', { class: 'field' }, [el('span', { text: 'Класс' }), classSelect]),
    el('div', { class: 'sub', style: 'margin-bottom:0', text: 'Период' }),
    rangeChips,
    el('label', { class: 'field', style: 'margin-top:12px' }, [el('span', { text: 'С даты' }), fromInput]),
    el('label', { class: 'field' }, [el('span', { text: 'По дату' }), toInput]),
  ]);

  const actions = el('div', { class: 'actions' });
  const params = () => ({ classId: classSelect.value, from: fromInput.value, to: toInput.value });

  actions.append(el('button', {
    class: 'btn primary wide', type: 'button', text: 'Скопировать как TSV (для Google Таблиц)',
    onclick: async () => {
      const { ok } = await exporter.copyTsvSummary(params());
      if (ok) showTsvHelp();
      else ui.toast('Не удалось скопировать — попробуйте выгрузку файлом', null, 5000);
    },
  }));

  actions.append(el('button', {
    class: 'btn wide', type: 'button', text: 'XLSX: сводная ведомость',
    onclick: () => {
      try {
        const name = exporter.exportXlsxSummary(params());
        ui.toast(`Файл ${name} сохранён`);
      } catch (e) { ui.toast('Ошибка: ' + e.message); }
    },
  }));

  actions.append(el('button', {
    class: 'btn wide', type: 'button', text: 'XLSX: для ГИС «Моя школа» (плоская)',
    onclick: () => {
      try {
        const name = exporter.exportXlsxFlat(params());
        ui.toast(`Файл ${name} сохранён`);
      } catch (e) { ui.toast('Ошибка: ' + e.message); }
    },
  }));

  actions.append(el('button', {
    class: 'btn wide', type: 'button', text: 'CSV (резервный вариант)',
    onclick: () => {
      const name = exporter.exportCsvSummary(params());
      ui.toast(`Файл ${name} сохранён`);
    },
  }));

  sheet.append(actions);

  if (ui.isStandalone()) {
    sheet.append(el('div', {
      class: 'compare-line',
      style: 'margin-top:14px;font-size:12px',
      text: 'Вы открыли приложение с экрана «Домой». Если файл не сохраняется, откройте приложение в Safari или используйте копирование в буфер.',
    }));
  }

  ui.openSheet(sheet);
}

/** Инструкция из трёх шагов для вставки в Google Таблицы. */
function showTsvHelp() {
  const sheet = el('div', {}, [
    el('h2', { text: 'Скопировано' }),
    el('div', { class: 'sub', text: 'Данные в буфере обмена — как вставить в Google Таблицы' }),
    el('div', { class: 'compare-line', html:
      '<b>1.</b> Откройте свою таблицу в приложении Google Таблицы.<br>'
      + '<b>2.</b> Выберите ячейку, с которой начнётся вставка (например, A1).<br>'
      + '<b>3.</b> Долгое нажатие → «Вставить». Столбцы и строки разложатся сами.',
    }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn primary wide', type: 'button', text: 'Понятно', onclick: ui.closeSheet }),
    ]),
  ]);
  ui.openSheet(sheet);
}
