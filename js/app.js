/* app.js — точка входа: маршрутизация между табами, инициализация, service worker. */

import * as store from './store.js';
import {displayClassName} from './model.js';
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

import {openWorkspaceSearch} from './screens/search.js';
import {openStudentSheet} from './screens/journal.js';
import * as C from './coach.js';
import {openCoachSearchResult} from './screens/coach.js';
import {readNavigation,saveNavigation,coachRoutes,schoolRoutes} from './design.js';
import {animateOnce} from './motion.js';
import {readSyncIdentity} from './device-trust.js';
import {installPrivacyShield,screenLockEnabled} from './privacy-shield.js';
import {openSyncSession,runPersonalSync,autoSyncStatus,syncRetryDelay} from './auto-sync.js';
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
let syncSession=null,autoBusy=false,autoAttempt=0;
let syncHint='',autoRetryTimer=null,autoRetryCount=0;
function clearAutoRetry(reset=false){if(autoRetryTimer!==null)clearTimeout(autoRetryTimer);autoRetryTimer=null;if(reset)autoRetryCount=0;}
function updateSyncIndicator(){
 const node=appRoot.querySelector('.personal-sync-action');if(!node)return;
 const report=autoSyncStatus(),problem=report.phase==='interrupted'||report.areas.some(x=>!['synced','setup'].includes(x.status)),setup=report.areas.some(x=>x.status==='setup');
 const label=navigator.onLine===false?'Нет сети · данные сохранены локально':syncHint||(problem?'Требуется проверка синхронизации':setup?'Нужно подтвердить первое подключение':report.at?'Последняя проверка: '+new Date(report.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'Синхронизировать сейчас');
 node.title=label;node.setAttribute('aria-label','Синхронизировать сейчас. '+label);node.dataset.status=navigator.onLine===false?'offline':problem?'review':report.at&&!setup?'ok':'idle';
}
function safeAutoRoute(){
 return store.state.currentTab==='today'||store.state.currentTab==='coach'&&navigation.coach==='home';
}
async function maybeAutoSync(initial=false,manual=false,retry=false){
 if(!readSyncIdentity()||autoBusy||document.body.classList.contains('privacy-covered'))return;
 if(!syncSession||navigator.onLine===false||document.visibilityState==='hidden'){
  if(manual)ui.toast(navigator.onLine===false?'Нет интернета. Изменения сохранены на устройстве.':'Откройте синхронизацию в настройках для ручного обмена.');return;
 }
 if(!initial&&(ui.isSheetOpen()||document.querySelector('.dialog-backdrop,.privacy-cover')||document.activeElement?.matches('input,textarea,select,[contenteditable=true]')||!manual&&(!safeAutoRoute()||!retry&&Date.now()-autoAttempt<55000)))return;
 clearAutoRetry(manual);autoBusy=true;autoAttempt=Date.now();syncHint='Синхронизация…';updateSyncIndicator();
 const oldTabbar=tabbarEl;
 ui.setUnderlyingInert(appRoot,true);ui.setUnderlyingInert(oldTabbar,true);
 try{
  const result=await syncSession.exclusive(()=>runPersonalSync());
  if(result?.areas.some(x=>x.changed))await store.load();
  syncHint=result?'':'Другая вкладка открыта · обмен отложен';
   const delay=syncRetryDelay(result,autoRetryCount),code=readSyncIdentity();
   if(delay!==null&&code&&navigator.onLine!==false){
    autoRetryCount++;syncHint='Временная ошибка · повторная проверка через '+(delay/1000)+' с';
    autoRetryTimer=setTimeout(()=>{
     autoRetryTimer=null;syncHint='';updateSyncIndicator();
     if(readSyncIdentity()===code)void maybeAutoSync(false,false,true);
    },delay);
   }else if(result&&!result.areas.some(x=>x.retryable===true))autoRetryCount=0;
  if(manual){const needsReview=result&&(result.phase!=='finished'||result.areas.some(x=>!['synced','setup'].includes(x.status))),hasSetup=result?.areas.some(x=>x.status==='setup');ui.toast(!result?'Закройте другие вкладки TeachApp.':needsReview?'Проверьте синхронизацию в настройках.':hasSetup?'Проверьте первичное подключение контуров в настройках.':'Синхронизация завершена.');}
 }catch{syncHint='Обмен не завершён';if(manual)ui.toast(syncHint);}
 finally{ui.setUnderlyingInert(appRoot,false);ui.setUnderlyingInert(oldTabbar,false);ui.setUnderlyingInert(tabbarEl,false);autoBusy=false;updateSyncIndicator();}
}
let journalUpdate = null;
let renderedRoute = '';
let renderedTab = '';
let navigation=readNavigation();
const routeKey = () => [store.state.currentTab,store.state.currentTab==='coach'?navigation.coach:'', store.state.currentTab === 'journal' ? store.state.currentClassId : '', store.state.currentTab === 'journal' ? store.state.classSubtab || 'journal' : '', store.state.currentTab === 'journal' ? store.state.currentTrimesterId : ''].join('|');

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
  if(!sameRoute)screen.classList.add('route-enter');
  const workspace=store.state.currentTab==='coach'?'coach':'school';
  document.documentElement.dataset.workspace=workspace;
  const switcher=el('div',{class:'workspace-switch',role:'group','aria-label':'Рабочее пространство'},[
    ...[['school','Учитель'],['coach','Тренер']].map(([id,label])=>el('button',{type:'button',class:'workspace-option'+(workspace===id?' selected':''),'aria-pressed':String(workspace===id),text:label,onclick:()=>switchWorkspace(id)}))
  ]);
  appRoot.append(el('header',{class:'app-shell'},[el('div',{class:'app-brand'},[el('img',{class:'brand-mark',src:'./icons/brand.svg',alt:'',width:32,height:32}),el('span',{text:'TeachApp'})]),switcher,readSyncIdentity()?el('button',{class:'icon-btn plain personal-sync-action',type:'button','aria-label':'Синхронизировать сейчас',onclick:()=>void maybeAutoSync(false,true)},[icon('refresh')]):null,el('button',{class:'icon-btn plain search-action',type:'button','aria-label':'Поиск',title:'Поиск',onclick:()=>openSearch(workspace)},[icon('search')]),el('button',{class:'icon-btn plain privacy-action',type:'button','aria-label':'Скрыть данные',title:'Скрыть данные',onclick:()=>ui.coverPrivacy()},[icon('shield')])]),screen);

  updateSyncIndicator();
  const tab = store.state.currentTab;

  if (tab === 'today') {
    renderToday(screen,{onSchedule:()=>setTab('schedule'),onCoach:()=>setTab('coach'),onJournal:()=>setTab('journal'),onNorms:()=>setTab('norms'),onAnalytics:()=>setTab('analytics'),onSettings:()=>setTab('settings')});
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
    renderCoach(screen,{section:navigation.coach,onSettings:()=>setTab('settings'),onBack:()=>switchWorkspace('school'),onSection:id=>{navigation=saveNavigation({...navigation,coach:id});renderTabbar();}});
  } else if (tab === 'settings') {
    renderSettings(screen, { onChanged: render,onCoach:()=>setTab('coach'),onAnalytics:()=>setTab('analytics') });
  }

  if (scrollPos) {
    const nextGrid = screen.querySelector('.grid-wrap');
    if (nextGrid) [nextGrid.scrollLeft, nextGrid.scrollTop] = scrollPos;
  }
  if (page) page.scrollTop = pageTop || 0;
  if (!tabbarEl || renderedTab !== tab || tab==='coach') { renderTabbar(); renderedTab = tab; }
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
    class:'journal-subnav',role:'group','aria-label':'Разделы журнала',
  }, [
    ['journal', 'Журнал'],
    ['participation', 'Участие'],
    ['exemptions', 'Освобождения'],
  ].map(([id, label]) => el('button', {
    type: 'button',
    class:'journal-subnav-button'+(subtab===id?' active':''),'aria-pressed':String(subtab===id),
    text: label,
    onclick: () => { store.state.classSubtab = id; render(); },
  })));
  screen.insertBefore(switcher,screen.firstChild);
}

const schoolTabs=[
 {id:'today',label:'Главная',icon:'home'},{id:'classes',label:'Классы',icon:'classes'},{id:'journal',label:'Журнал',icon:'journal'},{id:'schedule',label:'Календарь',icon:'calendar'},{id:'more',label:'Ещё',icon:'menu'}
];
const coachTabs=[
 {id:'home',label:'Главная',icon:'home'},{id:'roster',label:'Команда',icon:'classes'},{id:'trainings',label:'Тренировки',icon:'quick'},{id:'matches',label:'Матчи',icon:'trophy'},{id:'analytics',label:'Аналитика',icon:'chart'}
];
function renderTabbar(){
 const previous=tabbarEl?[...tabbarEl.querySelectorAll('.tab')].findIndex(n=>n.classList.contains('active')):-1;
 const previousArea=tabbarEl?.dataset.area;
 if(tabbarEl)tabbarEl.remove();
 const coach=store.state.currentTab==='coach',active=coach?navigation.coach:store.state.currentTab;
 const tabs=coach?coachTabs:schoolTabs;
 tabbarEl=el('nav',{class:'tabbar workspace-nav','aria-label':coach?'Навигация тренера':'Навигация учителя'},tabs.map(t=>{
  const current=active===t.id||!coach&&t.id==='more'&&!schoolTabs.some(x=>x.id===active);
  return el('button',{type:'button',class:'tab'+(current?' active':''),'aria-label':t.label,'aria-current':current?'page':null,onclick:()=>{if(coach)setCoachSection(t.id);else if(t.id==='more')openMore();else setTab(t.id);ui.haptic(6);}},[icon(t.icon),el('span',{text:t.label})]);
 }));
 tabbarEl.dataset.area=coach?'coach':'school';
 const current=[...tabbarEl.querySelectorAll('.tab')].findIndex(n=>n.classList.contains('active'));
 tabbarEl.style.setProperty('--nav-index',Math.max(0,current));
 if(previous>=0&&current>=0&&previous!==current&&previousArea===tabbarEl.dataset.area){tabbarEl.style.setProperty('--nav-from',previous);tabbarEl.classList.add('nav-moving');animateOnce(tabbarEl.querySelector('.tab.active svg'),'pulse',{duration:180});}
 document.body.append(tabbarEl);
}
async function openSearch(area){
 try{const data=area==='coach'?await C.loadCoach():store.state;if(document.body.classList.contains('privacy-covered')||(store.state.currentTab==='coach'?'coach':'school')!==area)return;
 openWorkspaceSearch(area,data,r=>{
  if(area==='coach'){openCoachSearchResult(data,r,render);return;}
  if(r.kind==='student'){openStudentSheet(r.id,r.classId);return;}
  ui.closeSheet();if(r.kind==='class'){store.state.currentClassId=r.id;store.state.classSubtab='journal';setTab('journal');}else setTab(r.kind==='norm'?'norms':'schedule');
 });}catch(e){ui.toast(e.message);}
}
function openMore(){
 ui.openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Ещё'}),...TABS.filter(t=>['norms','settings'].includes(t.id)).concat({id:'analytics',label:'Аналитика и отчёты',icon:'chart'}).map(t=>el('button',{class:'btn wide menu-action',type:'button',onclick:()=>{ui.closeSheet();setTab(t.id);}},[icon(t.icon),el('span',{text:t.label}),icon('chevron')])),el('button',{class:'btn wide',type:'button',text:'Закрыть',onclick:ui.closeSheet})]));
}
function switchWorkspace(id){
 if(id==='coach')setCoachSection(navigation.coach);
 else setTab(navigation.school);
}
function setCoachSection(id){
 if(!coachRoutes.includes(id))return;
 navigation=saveNavigation({...navigation,workspace:'coach',coach:id});
 store.state.currentTab='coach';render();
}
function setTab(id){
 store.refreshSchoolPeriod();
 if(id==='coach'){setCoachSection(navigation.coach);return;}
 if(!schoolRoutes.includes(id))return;
 navigation=saveNavigation({...navigation,workspace:'school',school:id});
 store.state.currentTab=id;
 if(id==='journal'&&!store.state.classSubtab)store.state.classSubtab='journal';
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
    const selected=store.state.currentClassId===c.id;
    const row=el('button',{class:'class-picker-row',type:'button','aria-pressed':String(selected)},[
      el('span',{class:'class-name-pill',text:displayClassName(c.name)}),
      el('span',{class:'class-picker-count',text:n+' учеников'}),
      el('span',{class:'class-picker-check','aria-hidden':'true'},selected?[icon('check')]:[]),
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
  if(screenLockEnabled())ui.coverPrivacy();
  // Тема — до первой отрисовки, чтобы не было вспышки белого
  try {
    const db = await import('./db.js');
    const meta = await db.get('meta', 'settings');
    applyTheme(meta?.theme || 'auto');
  } catch (error) {
    if (error?.name === 'DatabaseBlockedError') throw error;
    applyTheme('auto');
  }

  window.addEventListener('unhandledrejection', event => {
    event.preventDefault();
    if (event.reason?.name === 'QuotaExceededError') {
      event.preventDefault();
      ui.toast('Недостаточно места. Запись прервана. Освободите место и повторите операцию.', null, 8000);
    } else if (event.reason?.name === 'DatabaseBlockedError') {
      ui.toast('Закройте другие вкладки TeachApp и повторите действие.', null, 8000);
    } else {ui.toast('Операция не завершена. Повторите действие.');}
  });
  try{syncSession=await openSyncSession();}catch{/* Manual sync remains available. */}
  await store.load();
  await maybeAutoSync(true);
  const shortcut=location.hash.slice(1);
  if(shortcut==='coach')navigation=saveNavigation({...navigation,workspace:'coach'});
  else if(shortcut==='journal'||shortcut==='quick')navigation=saveNavigation({...navigation,workspace:'school',school:shortcut==='journal'?'journal':'today'});
  if(['coach','journal','quick'].includes(shortcut))history.replaceState(null,'',location.pathname+location.search);
  store.state.currentTab=navigation.workspace==='coach'?'coach':navigation.school;
  applyTheme(store.state.settings.theme || 'auto');

  store.subscribe((_state, changedStudents) => {
    if (changedStudents && journalUpdate && routeKey() === renderedRoute) journalUpdate(changedStudents);
    else render();
  });
  render();
  installPrivacyShield({cover:()=>ui.coverPrivacy()});
  window.addEventListener('storage',e=>{if(e.key==='teachapp.screen-lock.v1'&&screenLockEnabled())ui.coverPrivacy();});
  window.addEventListener('online',()=>{clearAutoRetry(true);autoAttempt=0;syncHint='';updateSyncIndicator();void maybeAutoSync();});
  window.addEventListener('offline',()=>{clearAutoRetry(true);syncHint='';updateSyncIndicator();});
  const refreshPeriod=()=>{if(store.refreshSchoolPeriod())store.notify();};
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refreshPeriod();autoAttempt=0;void maybeAutoSync();}});
  window.addEventListener('focus',refreshPeriod);
  setInterval(()=>{refreshPeriod();void maybeAutoSync();},60000);

  // Следим за системной темой в режиме «как в системе»
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((store.state.settings.theme || 'auto') === 'auto') applyTheme('auto');
  });

  // Горячие клавиши для отладки на десктопе: 1-5 — табы
  window.addEventListener('keydown', (e) => {
    if(autoBusy)return;
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
  const message = err?.name === 'DatabaseBlockedError'
    ? 'Обновление локальной базы заблокировано. Закройте другие вкладки и окна TeachApp, затем перезагрузите страницу. Не очищайте данные браузера.'
    : 'Не удалось запустить приложение. Попробуйте перезагрузить страницу. Не очищайте данные браузера без резервной копии.';
  appRoot.replaceChildren(el('div',{class:'empty',role:'alert'},[el('p',{text:message}),el('button',{class:'btn',type:'button',text:'Перезагрузить',onclick:()=>location.reload()})]));
});
