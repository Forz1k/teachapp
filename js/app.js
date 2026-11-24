/* app.js — точка входа: маршрутизация между табами, инициализация, service worker. */

import * as store from './store.js';
import * as ui from './ui.js';
import { renderAnalytics } from './screens/analytics.js';
import { renderCoach } from './screens/coach.js';
import { renderNorms } from './screens/norms.js';
import { renderToday } from './screens/today.js';
import { renderClasses } from './screens/classes.js';
import { renderJournal } from './screens/journal.js';
import { renderParticipation } from './screens/participation.js';
import { renderExemptionsInto } from './screens/exemptions.js';
import { renderSchedule } from './screens/schedule.js';
import { renderSettings, applyTheme, openExportSheet } from './screens/settings.js';

const { el, icon } = ui;

const TABS = [
  { id: 'today', label: 'Сегодня', icon: 'sun' },
  { id: 'classes', label: 'Классы', icon: 'classes' },
  { id: 'journal', label: 'Журнал', icon: 'journal' },
  { id: 'schedule', label: 'Расписание', icon: 'calendar' },
  { id: 'norms', label: 'Нормативы', icon: 'quick' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];

const appRoot = document.getElementById('app');
let tabbarEl = null;
let journalUpdate = null;
let renderedRoute = '';
let renderedTab = '';
const routeKey = () => [store.state.currentTab, store.state.currentTab === 'journal' ? store.state.currentClassId : '', store.state.currentTab === 'journal' ? store.state.classSubtab || 'journal' : '', store.state.currentTab === 'journal' ? store.state.currentTrimesterId : ''].join('|');

/** Перерисовка текущего таба. Вызывается на любое изменение состояния. */
function render() {
  if (!store.state.ready) return;

  const route = routeKey();
  const sameRoute = route === renderedRoute;
  const grid = sameRoute ? appRoot.querySelector('.grid-wrap') : null;
  const scrollPos = grid ? [grid.scrollLeft, grid.scrollTop] : null;
  const page = document.scrollingElement;
  const pageTop = sameRoute ? page?.scrollTop : 0;
  renderedRoute = route;
  journalUpdate = null;
  appRoot.replaceChildren();
  const screen = el('div', { class: 'screen' });
  appRoot.append(el('div',{class:'privacy-bar'},[el('button',{class:'btn small',type:'button',text:'Скрыть данные',onclick:()=>ui.coverPrivacy()})]),screen);

  const tab = store.state.currentTab;

  if (tab === 'today') {
    renderToday(screen, { onSchedule: () => setTab('schedule'),onCoach:()=>setTab('coach') });
    screen.append(el('div',{class:'analytics-shortcut'},[el('button',{class:'btn wide',type:'button',text:'Аналитика и отчёты',onclick:()=>setTab('analytics')})]));
  } else if (tab === 'classes') {
    renderClasses(screen, {
      onOpenJournal: () => { setTab('journal'); },
      onGoSettings: () => setTab('settings'),
      onChanged: render,
    });
  } else if (tab === 'journal') {
    renderJournalScreen(screen);
  } else if (tab === 'schedule') {
    renderSchedule(screen, { onChanged: render });
  } else if (tab === 'norms') {
    renderNorms(screen);
  } else if (tab === 'analytics') {
    renderAnalytics(screen,{onBack:()=>setTab('settings')});
  } else if (tab === 'coach') {
    renderCoach(screen,{onBack:()=>setTab('today')});
  } else if (tab === 'settings') {
    renderSettings(screen, { onChanged: render,onCoach:()=>setTab('coach'),onAnalytics:()=>setTab('analytics') });
  }

  if (scrollPos) {
    const nextGrid = screen.querySelector('.grid-wrap');
    if (nextGrid) [nextGrid.scrollLeft, nextGrid.scrollTop] = scrollPos;
  }
  if (page) page.scrollTop = pageTop || 0;
  if (!tabbarEl || renderedTab !== tab) { renderTabbar(); renderedTab = tab; }
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
    journalUpdate = renderJournal(screen, {
      onOpenClassPicker: () => openClassPicker(),
      onOpenExemptions: (id) => { store.state.classSubtab = 'exemptions'; render(); },
      onOpenLessonPlanner: (id) => import('./screens/lesson.js').then((m) => m.openLessonPlanner(id)),
    });
  } else if (subtab === 'participation') {
    renderParticipation(screen, classId, {
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
    ['participation', 'Участие'],
    ['exemptions', 'Освобождения'],
  ].map(([id, label]) => el('button', {
    type: 'button',
    style: `padding:8px 14px;border-radius:999px;font-size:14px;font-weight:600;${subtab === id ? 'background:var(--accent);color:#fff' : 'color:var(--text-2)'}`,
    text: label,
    onclick: () => { store.state.classSubtab = id; render(); },
  })));
  screen.append(switcher);
}

function renderTabbar() {
  if (tabbarEl) tabbarEl.remove();
  tabbarEl = el('nav', { class: 'tabbar' },
    (store.state.currentTab==='coach'?[{id:'today',label:'Школа',icon:'back'},{id:'coach',label:'Волейбол',icon:'quick'}]:TABS).map((t) => el('button', {
      type: 'button',
      class: `tab ${store.state.currentTab === t.id ? 'active' : ''}`,
      'aria-label': t.label,
      'aria-current': store.state.currentTab === t.id ? 'page' : null,
      onclick: () => { setTab(t.id); ui.haptic(6); },
    }, [icon(t.icon), el('span', { text: t.label })])));
  if(store.state.currentTab==='coach')tabbarEl.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';
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

  window.addEventListener('unhandledrejection', event => {
    event.preventDefault();
    if (event.reason?.name === 'QuotaExceededError') {
      event.preventDefault();
      ui.toast('Недостаточно места. Запись прервана. Освободите место и повторите операцию.', null, 8000);
    } else {ui.toast('Операция не завершена. Повторите действие.');}
  });
  await store.load();
  applyTheme(store.state.settings.theme || 'auto');

  store.subscribe((_state, changedStudents) => {
    if (changedStudents && journalUpdate && routeKey() === renderedRoute) journalUpdate(changedStudents);
    else render();
  });
  render();

  // Следим за системной темой в режиме «как в системе»
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((store.state.settings.theme || 'auto') === 'auto') applyTheme('auto');
  });

  // Горячие клавиши для отладки на десктопе: 1-5 — табы
  window.addEventListener('keydown', (e) => {
    if(e.altKey && e.code==='KeyH'){e.preventDefault();ui.coverPrivacy();return;}
    if(document.body.classList.contains('privacy-covered'))return;
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
  const sw = navigator.serviceWorker;
  let controlled = Boolean(sw.controller);
  sw.addEventListener('controllerchange', () => {
    if (controlled) location.reload();
    controlled = true;
  });
  async function register() {
    try {
      const reg = await sw.register('./sw.js');
      let banner;
      const offer = () => {
        if (!reg.waiting || !sw.controller || banner?.isConnected) return;
        banner = el('div',{class:'update-banner',role:'status'},[
          el('span',{text:'Доступна новая версия TeachApp'}),
          el('button',{class:'btn',type:'button',text:'Обновить',onclick:() => reg.waiting?.postMessage('skipWaiting')}),
        ]);
        document.body.append(banner);
      };
      const watch = () => reg.installing?.addEventListener('statechange', offer);
      reg.addEventListener('updatefound', watch);
      watch(); offer();
    } catch { /* Уже установленная версия доступна офлайн. */ }
  }
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, {once:true});
}

boot().catch((err) => {
  console.error('[teachapp] ошибка запуска');
  appRoot.replaceChildren(el('div',{class:'empty'},['Не удалось запустить приложение. Попробуйте перезагрузить страницу. Не очищайте данные браузера без резервной копии.']));
});
