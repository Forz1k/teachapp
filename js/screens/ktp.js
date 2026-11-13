/* screens/ktp.js — управление КТП: отдельный список на класс (или несколько классов).
   Каждое КТП — своя нумерация тем. Один и тот же КТП можно привязать к нескольким классам:
   тогда 6А и 6Б идут по одному плану, а 7В — по своему. */

import * as M from '../model.js';
import * as store from '../store.js';
import * as ui from '../ui.js';

const { el, icon } = ui;

/** Экран списка КТП. */
export function renderKtp(root, opts = {}) {
  const topbar = el('div', { class: 'topbar' }, [
    el('div', { class: 'topbar-row' }, [
      opts.onBack ? el('button', { class: 'icon-btn plain', type: 'button', onclick: opts.onBack }, [icon('back')]) : null,
      el('h1', { text: 'КТП' }),
      el('div', { style: 'flex:1' }),
      el('button', {
        class: 'icon-btn', type: 'button', title: 'Создать КТП',
        onclick: () => openCreateSheet(opts),
      }, [icon('plus')]),
    ]),
    el('div', { class: 'subtitle', text: `${store.state.ktp.length} планов · ${store.state.topics.length} тем` }),
  ]);
  root.append(topbar);

  const body = el('div', { class: 'list', style: 'gap:10px;padding-top:12px' });
  root.append(body);

  if (!store.state.ktp.length) {
    body.append(el('div', { class: 'empty' }, [
      icon('box'),
      el('div', { text: 'КТП пока нет. Создайте план и привяжите его к классам — можно к нескольким сразу.' }),
      el('div', { style: 'margin-top:16px;display:flex;flex-direction:column;gap:8px' }, [
        el('button', {
          class: 'btn primary wide', type: 'button', text: 'Создать КТП',
          onclick: () => openCreateSheet(opts),
        }),
        el('button', {
          class: 'btn wide', type: 'button', text: 'Загрузить темы из Excel',
          onclick: () => openImportForNew(opts),
        }),
      ]),
    ]));
    return;
  }

  for (const ktp of store.state.ktp) {
    const topics = store.topicsOfKtp(ktp.id);
    const classNames = (ktp.classIds || [])
      .map((id) => store.state.classes.find((c) => c.id === id)?.name)
      .filter(Boolean);

    const card = el('div', {
      style: 'background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow-1);padding:14px 16px;display:flex;align-items:center;gap:12px',
    }, [
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { style: 'font-size:17px;font-weight:700', text: ktp.name }),
        el('div', {
          style: 'font-size:13px;color:var(--text-2);margin-top:2px',
          text: `${topics.length} тем · ${classNames.length ? classNames.join(', ') : 'не привязан к классам'}`,
        }),
      ]),
      el('button', {
        class: 'icon-btn plain', type: 'button', title: 'Открыть',
        onclick: () => openKtpDetail(ktp.id, opts),
      }, [icon('chevron')]),
    ]);
    body.append(card);
  }

  body.append(el('div', { style: 'margin-top:6px;display:flex;flex-direction:column;gap:8px' }, [
    el('button', {
      class: 'btn wide', type: 'button', text: '+ Создать ещё одно КТП',
      onclick: () => openCreateSheet(opts),
    }),
  ]));
}

/* ---------- открытие из настроек ---------- */

/** Показывает управление КТП в нижней шторке (для вызова из настроек). */
export function renderKtpInSheet() {
  const sheet = el('div', { style: 'min-height:60vh' });
  renderKtp(sheet, { inSheet: true });
  // В шторке нет своего скролла экрана — убираем лишний верхний отступ
  const tb = sheet.querySelector('.topbar');
  if (tb) tb.style.position = 'static';
  ui.openSheet(sheet, { onClose: () => {} });
}

/* ---------- создание КТП ---------- */

function openCreateSheet(opts) {
  const nameInput = el('input', { type: 'text', placeholder: 'например: Физическая культура 6 класс' });

  // Чекбоксы классов
  const classChecks = store.state.classes.map((c) => {
    const on = { value: false };
    const box = el('div', { class: 'checkbox' }, [icon('check')]);
    const row = el('div', { class: 'row-item', style: 'padding-left:0;padding-right:0;cursor:pointer' }, [
      el('div', { class: 'label', text: c.name }),
      box,
    ]);
    row.addEventListener('click', () => {
      on.value = !on.value;
      box.classList.toggle('on', on.value);
    });
    return { cls: c, state: on, node: row };
  });

  const sheet = el('div', {}, [
    el('h2', { text: 'Новое КТП' }),
    el('div', { class: 'sub', text: 'Один план можно привязать к нескольким классам' }),
    el('label', { class: 'field' }, [el('span', { text: 'Название' }), nameInput]),
    el('div', { class: 'sub', style: 'margin-bottom:0', text: 'К каким классам относится' }),
  ]);

  if (classChecks.length) {
    const boxWrap = el('div');
    for (const c of classChecks) boxWrap.append(c.node);
    sheet.append(boxWrap);
  } else {
    sheet.append(el('div', { class: 'sub', text: 'Классов нет — сначала добавьте классы в настройках.' }));
  }

  sheet.append(el('div', { class: 'actions' }, [
    el('button', {
      class: 'btn primary wide', type: 'button', text: 'Создать',
      onclick: async () => {
        const name = nameInput.value.trim();
        if (!name) { ui.toast('Введите название'); return; }
        const classIds = classChecks.filter((c) => c.state.value).map((c) => c.cls.id);
        const ktp = await store.addKtp({ name, classIds });
        ui.closeSheet();
        ui.toast('КТП создано');
        setTimeout(() => openKtpDetail(ktp.id, opts), 320);
      },
    }),
    el('button', {
      class: 'btn wide', type: 'button', text: 'Создать и загрузить темы из Excel',
      onclick: async () => {
        const name = nameInput.value.trim();
        if (!name) { ui.toast('Введите название'); return; }
        const classIds = classChecks.filter((c) => c.state.value).map((c) => c.cls.id);
        const ktp = await store.addKtp({ name, classIds });
        ui.closeSheet();
        setTimeout(() => openImportTopics(ktp.id, opts), 320);
      },
    }),
  ]));

  ui.openSheet(sheet);
}

/** Быстрый импорт: сначала создаём КТП с именем из файла. */
function openImportForNew(opts) {
  const nameInput = el('input', { type: 'text', placeholder: 'например: КТП 6 класс' });
  const sheet = el('div', {}, [
    el('h2', { text: 'Загрузить КТП из Excel' }),
    el('div', { class: 'sub', text: 'Сначала название и классы, затем файл с темами' }),
    el('label', { class: 'field' }, [el('span', { text: 'Название плана' }), nameInput]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Далее — выбрать файл',
        onclick: async () => {
          const name = nameInput.value.trim() || 'КТП по физической культуре';
          const ktp = await store.addKtp({ name, classIds: [] });
          ui.closeSheet();
          setTimeout(() => openImportTopics(ktp.id, opts), 320);
        },
      }),
    ]),
  ]);
  ui.openSheet(sheet);
}

/* ---------- детали КТП ---------- */

export function openKtpDetail(ktpId, opts = {}) {
  const ktp = store.state.ktp.find((k) => k.id === ktpId);
  if (!ktp) return;

  const sheet = el('div');
  const draw = () => {
    sheet.innerHTML = '';
    const current = store.state.ktp.find((k) => k.id === ktpId);
    if (!current) { ui.closeSheet(); return; }

    const topics = store.topicsOfKtp(ktpId);
    const classNames = (current.classIds || [])
      .map((id) => store.state.classes.find((c) => c.id === id)?.name)
      .filter(Boolean);

    sheet.append(
      el('h2', { text: current.name }),
      el('div', { class: 'sub', text: `${topics.length} тем · ${classNames.length ? classNames.join(', ') : 'классы не выбраны'}` }),
    );

    // Классы
    const clsChips = el('div', { class: 'preset-chips' },
      store.state.classes.length
        ? store.state.classes.map((c) => {
          const active = (current.classIds || []).includes(c.id);
          return el('button', {
            type: 'button', class: active ? 'active' : '', text: c.name,
            onclick: async () => {
              const set = new Set(current.classIds || []);
              if (set.has(c.id)) set.delete(c.id); else set.add(c.id);
              await store.setKtpClasses(ktpId, [...set]);
              draw();
            },
          });
        })
        : [el('div', { class: 'sub', text: 'Классов нет' })]);

    sheet.append(
      el('div', { class: 'sub', style: 'margin:14px 0 0', text: 'Привязан к классам' }),
      clsChips,
    );

    // Темы
    const list = el('div', { class: 'preview-list', style: 'margin-top:14px' });
    if (!topics.length) {
      list.append(el('div', { class: 'empty', style: 'padding:20px 8px', text: 'Тем пока нет — загрузите из Excel или добавьте вручную.' }));
    } else {
      topics.forEach((t, i) => {
        const row = el('div', { class: 'preview-item' }, [
          el('div', { style: 'width:26px;color:var(--text-3);font-size:12px;font-feature-settings:"tnum" 1', text: String(t.ktpOrder ?? i + 1) }),
          el('div', { class: 'txt', text: t.name }),
          el('button', {
            class: 'btn small', type: 'button', text: '✎',
            onclick: async (e) => {
              e.stopPropagation();
              const name = await ui.promptDialog({ title: 'Тема', value: t.name });
              if (name === null || !name.trim()) return;
              await store.updateTopic(t.id, { name: name.trim() });
              draw();
            },
          }),
          el('button', {
            class: 'btn small danger', type: 'button', text: '✕',
            onclick: async (e) => {
              e.stopPropagation();
              await store.deleteTopic(t.id);
              draw();
            },
          }),
        ]);
        list.append(row);
      });
    }

    sheet.append(el('div', {
      style: 'display:flex;align-items:center;justify-content:space-between;margin-top:16px',
    }, [
      el('div', { style: 'font-size:13px;font-weight:600;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px', text: 'Темы' }),
      el('button', {
        class: 'btn small', type: 'button', text: '↑↓ порядок',
        onclick: () => openReorder(ktpId, draw),
      }),
    ]), list);

    const newTopic = el('input', { type: 'text', placeholder: 'Название новой темы' });
    sheet.append(
      el('label', { class: 'field', style: 'margin-top:12px' }, [newTopic]),
      el('div', { class: 'actions' }, [
        el('button', {
          class: 'btn primary wide', type: 'button', text: 'Загрузить темы из Excel',
          onclick: () => openImportTopics(ktpId, opts, draw),
        }),
        el('button', {
          class: 'btn wide', type: 'button', text: 'Добавить тему',
          onclick: async () => {
            const v = newTopic.value.trim();
            if (!v) return;
            const maxOrder = topics.reduce((mx, t) => Math.max(mx, t.ktpOrder || 0), 0);
            await store.addTopic(v, maxOrder + 1, ktpId);
            newTopic.value = '';
            draw();
          },
        }),
        el('button', {
          class: 'btn wide danger', type: 'button', text: 'Удалить КТП',
          onclick: async () => {
            const ok = await ui.confirmDialog({
              title: `Удалить «${current.name}»?`,
              text: `Удалятся ${topics.length} тем. В уроках, где они стояли, тема станет пустой — оценки сохранятся.`,
              ok: 'Удалить', danger: true,
            });
            if (!ok) return;
            await store.deleteKtp(ktpId);
            ui.closeSheet();
            ui.toast('КТП удалено');
          },
        }),
      ]),
    );
  };

  draw();
  ui.openSheet(sheet);
}

/* ---------- порядок тем ---------- */

function openReorder(ktpId, onDone) {
  const sheet = el('div');
  const draw = () => {
    sheet.innerHTML = '';
    const topics = store.topicsOfKtp(ktpId);
    sheet.append(
      el('h2', { text: 'Порядок тем' }),
      el('div', { class: 'sub', text: 'Стрелками меняйте местами' }),
    );
    const list = el('div', { class: 'preview-list' });
    topics.forEach((t, i) => {
      list.append(el('div', { class: 'preview-item' }, [
        el('div', { style: 'width:24px;color:var(--text-3);font-size:12px', text: String(t.ktpOrder ?? i + 1) }),
        el('div', { class: 'txt', text: t.name }),
        el('button', {
          class: 'btn small', type: 'button', text: '↑', disabled: i === 0,
          onclick: async () => {
            if (i === 0) return;
            const prev = topics[i - 1];
            const o1 = t.ktpOrder ?? i + 1;
            const o2 = prev.ktpOrder ?? i;
            await store.updateTopic(t.id, { ktpOrder: o2 });
            await store.updateTopic(prev.id, { ktpOrder: o1 });
            draw();
          },
        }),
        el('button', {
          class: 'btn small', type: 'button', text: '↓', disabled: i === topics.length - 1,
          onclick: async () => {
            if (i === topics.length - 1) return;
            const next = topics[i + 1];
            const o1 = t.ktpOrder ?? i + 1;
            const o2 = next.ktpOrder ?? i + 2;
            await store.updateTopic(t.id, { ktpOrder: o2 });
            await store.updateTopic(next.id, { ktpOrder: o1 });
            draw();
          },
        }),
      ]));
    });
    sheet.append(list, el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn wide', type: 'button', text: 'Готово',
        onclick: () => { ui.closeSheet(); onDone(); },
      }),
    ]));
  };
  draw();
  ui.openSheet(sheet);
}

/* ---------- импорт тем ---------- */

export function openImportTopics(ktpId, opts = {}, onDone = null) {
  const fileInput = el('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: 'display:none' });
  document.body.append(fileInput);

  const sheet = el('div', {}, [
    el('h2', { text: 'Темы из Excel' }),
    el('div', { class: 'sub', text: 'Колонки: номер (необязательно) и название темы' }),
    el('div', { class: 'compare-line', html:
      'Подойдёт таблица вида:<br>'
      + '<b>№</b> | <b>Тема</b><br>1 | Инструктаж по технике безопасности<br>'
      + '2 | Бег на 30 м с высокого старта<br><br>'
      + 'Строка заголовка необязательна.',
    }),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Выбрать файл',
        onclick: () => fileInput.click(),
      }),
    ]),
  ]);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = '';
    try {
      const { parseKtpFile, applyKtpTopics } = await import('../export.js');
      const parsed = await parseKtpFile(file);
      ui.closeSheet();
      setTimeout(() => showTopicsPreview(ktpId, parsed, onDone), 320);
    } catch (err) {
      ui.toast('Ошибка чтения: ' + err.message, null, 6000);
    }
  });

  ui.openSheet(sheet);
}

function showTopicsPreview(ktpId, parsed, onDone) {
  const { items, warnings } = parsed;

  const sheet = el('div', {}, [
    el('h2', { text: 'Проверьте темы' }),
    el('div', { class: 'sub', text: `Найдено тем: ${items.length}` }),
  ]);

  if (warnings.length) {
    const warn = el('div', { class: 'compare-line', style: 'margin-top:0;margin-bottom:10px;color:var(--mark-3)' });
    warn.innerHTML = warnings.map((w) => '• ' + w).join('<br>');
    sheet.append(warn);
  }

  const list = el('div', { class: 'preview-list' });
  items.slice(0, 200).forEach((t, i) => {
    list.append(el('div', { class: 'preview-item' }, [
      el('div', { style: 'width:26px;color:var(--text-3);font-size:12px;font-feature-settings:"tnum" 1', text: String(t.order ?? i + 1) }),
      el('div', { class: 'txt', text: t.name }),
    ]));
  });
  sheet.append(list);

  let append = false;
  const appendRow = el('div', { class: 'row-item' }, [
    el('div', { class: 'label' }, [
      el('div', { text: 'Дописать к существующим' }),
      el('div', { style: 'font-size:12px;color:var(--text-3)', text: 'Иначе старые темы будут заменены' }),
    ]),
    el('button', {
      type: 'button', class: 'switch', role: 'switch', 'aria-checked': 'false',
      onclick: (e) => {
        append = !append;
        e.currentTarget.classList.toggle('on', append);
        e.currentTarget.setAttribute('aria-checked', String(append));
      },
    }),
  ]);
  sheet.append(appendRow);

  sheet.append(el('div', { class: 'actions' }, [
    el('button', {
      class: 'btn primary wide', type: 'button', text: 'Записать темы',
      disabled: !items.length,
      onclick: async () => {
        const { applyKtpTopics } = await import('../export.js');
        const n = await applyKtpTopics(ktpId, items, { append });
        ui.closeSheet();
        ui.toast(`Записано тем: ${n}`);
        if (onDone) setTimeout(onDone, 320);
        else setTimeout(() => openKtpDetail(ktpId), 320);
      },
    }),
    el('button', { class: 'btn wide', type: 'button', text: 'Отмена', onclick: ui.closeSheet }),
  ]));

  ui.openSheet(sheet);
}
