import {screenLockEnabled,verifyScreenLock,PRIVACY_VISIBILITY_EVENT} from './privacy-shield.js';
import {animateOnce} from './motion.js';
/* ui.js — мелкие строительные блоки интерфейса: иконки, шторка, тост, диалог, haptic.
   Никаких зависимостей. Только DOM. */

/** Inline SVG-иконки (без CDN — иначе офлайн сломается). */
export const icons = {
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M8 3h8v8a4 4 0 0 1-8 0zM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 15v5M8 21h8"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4v16h16M8 16v-5M13 16V7M18 16v-9"/></svg>`,
  classes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19v14H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 6.5v14"/><path d="M8 8h7M8 11.5h5"/></svg>`,
  journal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M9 9.5V20M14.5 9.5V20"/></svg>`,
  quick: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4.5 17v2.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V17"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5v-11M7.5 9 12 4.5 16.5 9"/><path d="M4.5 17v2.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V17"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5h16M9 6.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 6.5l.8 12.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8l.8-12.2"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>`,
  box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8L12 3.5 20.5 8v8L12 20.5 3.5 16z"/><path d="M3.5 8l8.5 4.5L20.5 8M12 12.5v8"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/></svg>`,
};

/** Подставляет иконку как элемент. */
export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = cls;
  span.style.display = 'contents';
  span.innerHTML = icons[name] || '';
  return span.firstElementChild || span;
}

/** Элемент с классом и содержимым. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/* ---------- haptic ---------- */

/** Вибрация, если доступна. На iOS её нет — не полагаемся. */
export function haptic(ms = 8) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch { /* тихо игнорируем */ }
}

/* ---------- шторка ---------- */

let sheetEl = null;
let backdropEl = null;
let onCloseCb = null;
let sheetRevision = 0;
let sheetReturnFocus=null;

function ensureSheet() {
  if (sheetEl) return;
  backdropEl = el('div', { class: 'sheet-backdrop' });
  backdropEl.addEventListener('click', closeSheet);
  sheetEl = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true',tabindex:'-1' });
  sheetEl.addEventListener('keydown',e=>{
    if(e.key!=='Tab'||!sheetEl.classList.contains('show'))return;
    const nodes=[...sheetEl.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex="0"]')].filter(n=>!n.disabled&&!n.closest('[hidden]')&&n.getClientRects().length);
    if(!nodes.length){e.preventDefault();sheetEl.focus();return;}
    if(e.shiftKey&&(document.activeElement===nodes[0]||document.activeElement===sheetEl)){e.preventDefault();nodes.at(-1).focus();}
    else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus();}
  });
  document.body.append(backdropEl, sheetEl);
}

/**
 * Открывает нижнюю шторку.
 * @param {Node|string} content — содержимое
 * @param {{onClose?: Function, fullHeight?: boolean}} opts
 */
export function openSheet(content, opts = {}) {
  ensureSheet();
  const revision = ++sheetRevision;
  const wasOpen=sheetEl.classList.contains('show');
  if(!sheetEl.classList.contains('show')&&!sheetEl.contains(document.activeElement))sheetReturnFocus=document.activeElement;
  onCloseCb = opts.onClose || null;
  sheetEl.classList.toggle('sheet-full',opts.fullHeight===true);
  sheetEl.classList.toggle('sheet-match',opts.match===true);
  sheetEl.innerHTML = '';
  sheetEl.scrollTop=0;
  sheetEl.append(el('div', { class: 'grabber' }));
  if (typeof content === 'string') sheetEl.append(el('div', { html: content }));
  else sheetEl.append(content);
  if(wasOpen&&typeof content!=='string'&&!opts.match)content.classList?.add('sheet-content-enter');
  sheetEl.setAttribute('aria-label',sheetEl.querySelector('h1,h2,h3')?.textContent||'Окно TeachApp');

  requestAnimationFrame(() => {
    if (revision !== sheetRevision) return;
    backdropEl.classList.add('show');
    sheetEl.classList.add('show');
    if(!sheetEl.contains(document.activeElement))sheetEl.focus({preventScroll:true});
  });
  return sheetEl;
}

export function closeSheet() {
  if (!sheetEl) return;
  const revision = ++sheetRevision;
  sheetEl.classList.remove('show');
  backdropEl.classList.remove('show');
  const cb = onCloseCb;
  onCloseCb = null;
  setTimeout(() => {
    if (revision !== sheetRevision) return;
    if (sheetEl && !sheetEl.classList.contains('show')) sheetEl.innerHTML = '';
    const previous=sheetReturnFocus;sheetReturnFocus=null;
    if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus?.({preventScroll:true});
    if (cb) cb();
  }, 300);
}

export const isSheetOpen = () => !!sheetEl && sheetEl.classList.contains('show');

/** Обновляет содержимое открытой шторки без анимации закрытия. */
export function replaceSheetContent(build) {
  if (!sheetEl) return;
  sheetEl.innerHTML = '';
  sheetEl.append(el('div', { class: 'grabber' }));
  const content = build(closeSheet);
  if (typeof content === 'string') sheetEl.append(el('div', { html: content }));
  else sheetEl.append(content);
}

/* ---------- тост ---------- */

let toastEl = null;
let toastTimer = null;

/**
 * Показывает тост. action = { label, onClick } добавляет кнопку (например, «Отменить»).
 */
export function toast(message, action = null, duration = 5000) {
  if (!toastEl) {
    toastEl = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  toastEl.innerHTML = '';
  toastEl.append(el('span', { text: message }));
  if (action) {
    toastEl.append(el('button', {
      type: 'button',
      text: action.label,
      onclick: () => {
        hideToast();
        action.onClick();
      },
    }));
  }
  requestAnimationFrame(() => {toastEl.classList.add('show');animateOnce(toastEl.querySelector('span'),'enter',{duration:180});});
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}

export function undoAction(result) {
  return result?.undo && {label:'Отменить',onClick:async () => {
    try { await result.undo(); } catch (err) { toast(err.message); }
  }};
}

export function hideToast() {
  if (!toastEl) return;
  toastEl.classList.remove('show');
  clearTimeout(toastTimer);
}

/* ---------- диалог подтверждения ---------- */

/**
 * Модальный диалог. Возвращает Promise<boolean>.
 * @param {{title: string, text?: string, ok?: string, cancel?: string, danger?: boolean}} opts
 */
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    const backdrop = el('div', { class: 'dialog-backdrop' });
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 220);
      resolve(value);
    };

    const dialog = el('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' }, [
      el('h3', { text: opts.title || 'Подтвердите действие' }),
      opts.text ? el('p', { text: opts.text }) : null,
      el('div', { class: 'btns' }, [
        el('button', { class: 'btn', type: 'button', text: opts.cancel || 'Отмена', onclick: () => finish(false) }),
        el('button', {
          class: `btn ${opts.danger ? 'danger' : 'primary'}`,
          type: 'button',
          text: opts.ok || 'OK',
          onclick: () => finish(true),
        }),
      ]),
    ]);

    backdrop.append(dialog);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(false); });
    document.body.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));
    dialog.querySelector('.btn:last-child').focus();
  });
}

/** Диалог с одним текстовым полем. Возвращает Promise<string|null>. */
export function promptDialog({ title, text, label, value = '', placeholder = '', ok = 'Сохранить', multiline = false, password = false }) {
  return new Promise((resolve) => {
    const backdrop = el('div', { class: 'dialog-backdrop' });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 220);
      resolve(v);
    };

    const input = multiline
      ? el('textarea', { placeholder, value })
      : el('input', { type: password?'password':'text', placeholder, value, autocomplete:password?'off':null });
    if (!multiline) input.value = value;
    else input.textContent = value;

    const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, [
      el('h3', { text: title }),
      text ? el('p', { text }) : null,
      label ? el('label', { class: 'field' }, [el('span', { text: label }), input]) : input,
      el('div', { class: 'btns' }, [
        el('button', { class: 'btn', type: 'button', text: 'Отмена', onclick: () => finish(null) }),
        el('button', { class: 'btn primary', type: 'button', text: ok, onclick: () => {const result=input.value;if(password)input.value='';finish(result);} }),
      ]),
    ]);

    backdrop.append(dialog);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(null); });
    document.body.append(backdrop);
    requestAnimationFrame(() => {
      backdrop.classList.add('show');
      setTimeout(() => input.focus(), 120);
    });
  });
}

/** Тактильный отклик на «нажатие» кнопки — общий обработчик для чипов и карточек. */
export function pressFeedback(node) {
  node.addEventListener('pointerdown', () => node.classList.add('pressed'), { passive: true });
  node.addEventListener('pointerup', () => node.classList.remove('pressed'), { passive: true });
  node.addEventListener('pointercancel', () => node.classList.remove('pressed'), { passive: true });
}

/* ---------- буфер обмена ---------- */

/** Копирует текст. Возвращает true при успехе. Учитывает ограничения iOS. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* падаем в запасной путь */ }

  try {
    const ta = el('textarea', { style: 'position:fixed;top:0;left:0;opacity:0;font-size:16px' });
    ta.value = text;
    document.body.append(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Скачивание файла. На iOS в standalone это может не сработать — возвращаем признак. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, style: 'display:none' });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 4000);
  return true;
}

/** Признак запуска как PWA с домашнего экрана (в standalone Safari скачивание капризно). */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** Форматирование «последний урок» / «сегодня». */
export function relativeDate(isoStr, today) {
  if (!isoStr) return 'нет уроков';
  if (isoStr === today) return 'сегодня';
  const d = new Date(isoStr);
  const t = new Date(today);
  const diff = Math.round((t - d) / 86400000);
  if (diff === 1) return 'вчера';
  if (diff === 2) return '2 дня назад';
  if (diff > 0 && diff < 7) return `${diff} дн. назад`;
  return `${isoStr.slice(8, 10)}.${isoStr.slice(5, 7)}`;
}

/* Экранная ширма, не блокировка устройства и не шифрование. */
let privacyUnderlying=null;
// Keep privacy inertness independent of the temporary synchronization lock.
export function setUnderlyingInert(node,inert){
 if(!node)return;
 if(privacyUnderlying?.has(node)){privacyUnderlying.set(node,inert);node.inert=true;}
 else node.inert=inert;
}
export function coverPrivacy(){
  if(document.body.classList.contains('privacy-covered'))return;
  const before=document.activeElement;
  before?.blur?.();
  const cover=el('div',{class:'privacy-cover',role:'dialog','aria-modal':'true','aria-label':'Данные скрыты'},[
    el('h1',{text:'TeachApp'}),el('p',{text:'Персональные данные скрыты'}),el('p',{text:screenLockEnabled()?'Локальная блокировка интерфейса. База данных не зашифрована.':'Это экранная ширма, не парольная блокировка.'})
  ]);
  const saved=new Map();privacyUnderlying=saved;
  const hide=node=>{if(node===cover||saved.has(node)||node.tagName==='SCRIPT')return;saved.set(node,node.inert);node.inert=true;};
  for(const child of document.body.children)hide(child);
  const observer=new MutationObserver(()=>{for(const child of document.body.children)hide(child);});
  document.body.append(cover);document.body.classList.add('privacy-covered');window.dispatchEvent(new window.Event(PRIVACY_VISIBILITY_EVENT));
  observer.observe(document.body,{childList:true});
  const locked=screenLockEnabled(),input=el('input',{type:'password','aria-label':'PIN или пароль разблокировки',autocomplete:'off',maxlength:128,hidden:!locked}),message=el('p',{role:'status',text:''});
  let attempts=0,working=false;
  const reveal=el('button',{type:'button',class:'btn primary wide',text:locked?'Разблокировать':'Показать данные',onclick:async()=>{
    if(working)return;working=true;reveal.disabled=true;
    try{if(!await verifyScreenLock(input?.value||'')){attempts++;input.hidden=false;input.value='';reveal.textContent='Разблокировать';message.textContent='Неверный PIN или пароль';await new Promise(r=>setTimeout(r,Math.min(30000,attempts*1000)));input?.focus();return;}
      if(input)input.value='';observer.disconnect();privacyUnderlying=null;for(const [node,inert] of saved)node.inert=inert;
      document.body.classList.remove('privacy-covered');cover.remove();window.dispatchEvent(new window.Event(PRIVACY_VISIBILITY_EVENT));before?.focus?.();
    }catch{message.textContent='Не удалось проверить блокировку';}finally{working=false;reveal.disabled=false;}
  }});
  if(input){cover.append(input);input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();reveal.click();}};}
  cover.append(message,reveal);(locked?input:reveal).focus();
}
