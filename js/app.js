/* app.js — точка входа: маршрутизация между табами, инициализация, service worker. */

import * as store from './store.js';
import * as ui from './ui.js';
import { renderClasses } from './screens/classes.js';
import { renderJournal } from './screens/journal.js';
import { renderMonthly } from './screens/monthly.js';
import { renderExemptionsInto } from './screens/exemptions.js';
import { renderSettings, applyTheme, openExportSheet } from './screens/settings.js';

const { el, icon } = ui;

const TABS = [
  { id: 'classes', label: 'Классы', icon: 'classes' },
  { id: 'journal', label: 'Журнал', icon: 'journal' },
  { id: 'quick', label: 'Ввод', icon: 'quick' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];

const appRoot = document.getElementById('app');
let tabbarEl = null;

/** Перерисовка текущего таба. Вызывается на любое изменение состояния. */
function render() {
  if (!store.state.ready) return;

  const scrollPos = { journal: null };

  appRoot.innerHTML = '';
  const screen = el('div', { class: 'screen' });
  appRoot.append(screen);

  const tab = store.state.currentTab;

  if (tab === 'classes') {
    renderClasses(screen, {
      onOpenJournal: () => { setTab('journal'); },
      onGoSettings: () => setTab('settings'),
      onChanged: render,
    });
  } else if (tab === 'journal') {
    renderJournalScreen(screen);
  } else if (tab === 'quick') {
    renderQuickTab(screen);
  } else if (tab === 'settings') {
    renderSettings(screen, { onChanged: render });
  }

  renderTabbar();
}

function renderJournalScreen(screen) {
  const classId = store.state.currentClassId;
  if (!classId) {
    screen.append(el('div', { class: 'empty' }, ['Выберите класс в разделе «Классы»']));
    return;
  }

  // Внутреннее переключение разделов класса: Журнал | Месячные | Освобождения
  const subtab = store.state.classSubtab || 'journal';

  if (subtab === 'journal') {
    renderJournal(screen, {
      onOpenClassPicker: () => openClassPicker(),
      onOpenExemptions: (id) => { store.state.classSubtab = 'exemptions'; render(); },
      onOpenLessonPlanner: (id) => import('./screens/lesson.js').then((m) => m.openLessonPlanner(id)),
    });
  } else if (subtab === 'monthly') {
    renderMonthly(screen, classId, {
      onBack: () => { store.state.classSubtab = 'journal'; render(); },
      onChanged: render,
    });
  } else if (subtab === 'exemptions') {
    screen.append(el('div', { class: 'topbar' }, [
      el('div', { class: 'topbar-row' }, [
        el('button', {
          class: 'icon-btn plain', type: 'button',
          onclick: () => { store.state.classSubtab = 'journal'; render(); },
        }, [icon('back')]),
        el('h1', { text: 'Освобождения' }),
      ]),
    ]));
    const body = el('div');
    renderExemptionsInto(body, classId, { onChanged: render });
    screen.append(body);
  }

  // Плавающий переключатель разделов класса
  const switcher = el('div', {
    style: 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--tabbar) + var(--safe-b) + 12px);z-index:35;display:flex;gap:4px;padding:4px;border-radius:999px;background:color-mix(in srgb, var(--card) 94%, transparent);backdrop-filter:blur(14px);box-shadow:var(--shadow-2)',
  }, [
    ['journal', 'Журнал'],
    ['monthly', 'Месячные'],
    ['exemptions', 'Освобождения'],
  ].map(([id, label]) => el('button', {
    type: 'button',
    style: `padding:8px 14px;border-radius:999px;font-size:14px;font-weight:600;${subtab === id ? 'background:var(--accent);color:#fff' : 'color:var(--text-2)'}`,
    text: label,
    onclick: () => { store.state.classSubtab = id; render(); },
  })));
  screen.append(switcher);
}

function renderQuickTab(screen) {
  const classId = store.state.currentClassId;
  screen.append(el('div', { class: 'topbar' }, [
    el('div', { class: 'topbar-row' }, [
      el('button', {
        class: 'chip', type: 'button',
        text: `${store.state.classes.find((c) => c.id === classId)?.name || 'Класс'} ▾`,
        onclick: () => openClassPicker(),
      }),
    ]),
  ]));

  const body = el('div', { class: 'empty' }, [
    icon('quick'),
    el('div', { text: 'Быстрый ввод на один урок: все ученики крупными строками.' }),
    el('div', { style: 'margin-top:18px' }, [
      el('button', {
        class: 'btn primary', type: 'button', text: 'Открыть',
        onclick: () => {
          if (!classId) { ui.toast('Сначала выберите класс'); return; }
          import('./screens/journal.js').then((m) => m.openQuickEntrySheet(classId));
        },
      }),
    ]),
  ]);
  screen.append(body);
}

function renderTabbar() {
  if (tabbarEl) tabbarEl.remove();
  tabbarEl = el('nav', { class: 'tabbar' },
    TABS.map((t) => el('button', {
      type: 'button',
      class: `tab ${store.state.currentTab === t.id ? 'active' : ''}`,
      'aria-label': t.label,
      onclick: () => { setTab(t.id); ui.haptic(6); },
    }, [icon(t.icon), el('span', { text: t.label })])));
  document.body.append(tabbarEl);
}

function setTab(id) {
  store.state.currentTab = id;
  if (id === 'journal' && !store.state.classSubtab) store.state.classSubtab = 'journal';
  render();
}

/** Выбор класса в шторке. */
function openClassPicker() {
  const classes = store.state.classes;
  if (!classes.length) { ui.toast('Нет классов'); return; }

  const sheet = el('div', {}, [
    el('h2', { text: 'Класс' }),
    el('div', { class: 'sub', text: 'Показать журнал класса' }),
  ]);

  for (const c of classes) {
    const n = store.studentsOfClass(c.id).length;
    const row = el('div', { class: 'row-item' }, [
      el('div', { class: 'label' }, [
        el('div', { text: c.name, style: 'font-weight:600' }),
        el('div', { style: 'font-size:12px;color:var(--text-3)', text: `${n} учеников` }),
      ]),
      store.state.currentClassId === c.id ? icon('check') : el('div'),
    ]);
    row.addEventListener('click', () => {
      store.state.currentClassId = c.id;
      ui.closeSheet();
      store.notify();
    });
    sheet.append(row);
  }

  ui.openSheet(sheet);
}

/* ---------- инициализация ---------- */

async function boot() {
  // Тема — до первой отрисовки, чтобы не было вспышки белого
  try {
    const db = await import('./db.js');
    const meta = await db.get('meta', 'settings');
    applyTheme(meta?.theme || 'auto');
  } catch {
    applyTheme('auto');
  }

  await store.load();
  applyTheme(store.state.settings.theme || 'auto');

  store.subscribe(render);
  render();

  // Следим за системной темой в режиме «как в системе»
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((store.state.settings.theme || 'auto') === 'auto') applyTheme('auto');
  });

  // Горячие клавиши для отладки на десктопе: 1-4 — табы
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') { ui.closeSheet(); return; }
    const idx = Number(e.key);
    if (idx >= 1 && idx <= TABS.length) setTab(TABS[idx - 1].id);
  });

  window.addEventListener('beforeunload', () => { /* данные уже в IndexedDB */ });

  registerServiceWorker();
}

/** Регистрация service worker для офлайна. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') {
    // SW не работает на file:// — приложение всё равно запустится, просто без кэша
    console.info('[teachapp] file:// — service worker не регистрируется');
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[teachapp] service worker не зарегистрирован:', err.message);
    });
  });
}

boot().catch((err) => {
  console.error(err);
  appRoot.innerHTML = `<div class="empty" style="padding-top:60px">
    <div style="font-weight:700;margin-bottom:8px">Не удалось запустить приложение</div>
    <div style="font-size:14px">${err.message}</div>
  </div>`;
});
