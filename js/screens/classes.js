/* screens/classes.js — стартовый экран: 9 карточек классов. */

import * as M from '../model.js';
import * as store from '../store.js';
import * as ui from '../ui.js';

const { el, icon } = ui;

export function renderClasses(root, ctx = {}) {
  const settings = store.state.settings;
  const tr = store.currentTrimester();
  const today = M.todayIso();

  root.append(el('div', { class: 'topbar' }, [
    el('div', { class: 'topbar-row' }, [
      el('h1', { text: 'Классы' }),
      el('button', {
        class: 'icon-btn', type: 'button', title: 'Тема',
        onclick: () => {
          const order = ['auto', 'light', 'dark'];
          const next = order[(order.indexOf(store.state.settings.theme || 'auto') + 1) % order.length];
          store.saveSettings({ theme: next });
          import('./settings.js').then((m) => m.applyTheme(next));
        },
      }, [icon(store.state.settings.theme === 'dark' ? 'moon' : 'sun')]),
    ]),
    el('div', { class: 'subtitle', text: `${tr.index}-й триместр · ${M.fmtFull(tr.from)} – ${M.fmtFull(tr.to)}` }),
  ]));

  // Баннер о резервной копии: показываем, если копии не было больше 7 дней
  if (needsBackupReminder()) {
    const banner = el('div', { class: 'banner' }, [
      el('div', { class: 'txt', text: 'Давно не сохраняли резервную копию. Данные живут только на этом телефоне.' }),
      el('button', {
        type: 'button', text: 'Сохранить',
        onclick: async () => {
          const { exportBackup } = await import('../export.js');
          await exportBackup();
          ui.toast('Копия сохранена');
          ctx.onChanged?.();
        },
      }),
      el('button', {
        type: 'button', text: 'Позже', style: 'color:var(--text-3)',
        onclick: () => {
          banner.remove();
          store.saveSettings({ lastBackupAt: new Date().toISOString() });
        },
      }),
    ]);
    root.append(banner);
  }

  const list = el('div', { class: 'list' });

  if (!store.state.classes.length) {
    list.append(el('div', { class: 'empty' }, [
      icon('classes'),
      el('div', { text: 'Пока нет ни одного класса.' }),
      el('div', { style: 'margin-top:18px;display:flex;flex-direction:column;gap:8px' }, [
        el('button', {
          class: 'btn primary wide', type: 'button', text: 'Загрузить демо-данные',
          onclick: async () => {
            ui.toast('Готовим демо-данные…', null, 3000);
            const { seedDemo } = await import('../demo.js');
            const res = await seedDemo({});
            ui.toast(`Загружено ${res.students} учеников в ${res.classes} классах`);
            ctx.onChanged?.();
          },
        }),
        el('button', {
          class: 'btn wide', type: 'button', text: 'Настройки → импорт из Excel',
          onclick: () => ctx.onGoSettings?.(),
        }),
      ]),
    ]));
    root.append(list);
    return;
  }

  for (const cls of store.state.classes) {
    const students = store.studentsOfClass(cls.id);
    const lessons = store.lessonsInRange(cls.id, tr.from, tr.to);
    const lastLesson = lessons.length ? lessons[lessons.length - 1] : null;

    // посещаемость за триместр
    let absent = 0;
    const lessonIds = new Set(lessons.map((l) => l.id));
    const studentIds = new Set(students.map((s) => s.id));
    for (const m of store.state.marks) {
      if (m.flag === 'Н' && lessonIds.has(m.lessonId) && studentIds.has(m.studentId)) absent += 1;
    }
    const totalCells = lessons.length * students.length;
    const att = M.attendance(totalCells, absent);

    const card = el('button', { class: 'class-card', type: 'button' }, [
      el('div', { class: 'name', text: cls.name }),
      el('div', { class: 'meta' }, [
        el('span', { text: `${students.length} уч.` }),
        el('span', { class: 'dotsep' }),
        el('span', { text: lastLesson ? `урок ${ui.relativeDate(lastLesson.date, today)}` : 'нет уроков' }),
      ]),
    ]);

    const ring = el('div', {
      class: `ring ${att.pct === null ? 'none' : ''}`,
      style: att.pct === null ? '' : `--ring-pct:${att.pct};--ring-color:${ringColor(att.pct)}`,
    }, [el('span', { text: att.pct === null ? '—' : `${Math.round(att.pct)}%` })]);
    card.append(ring);

    card.addEventListener('click', () => {
      ui.haptic(8);
      store.state.currentClassId = cls.id;
      ctx.onOpenJournal?.(cls.id);
    });

    list.append(card);
  }

  root.append(list);
}

/** Цвет кольца посещаемости по значению. */
function ringColor(pct) {
  if (pct >= 90) return 'var(--mark-5)';
  if (pct >= 75) return 'var(--accent)';
  return 'var(--mark-2)';
}

function needsBackupReminder() {
  const last = store.state.lastBackupAt;
  if (!store.state.students.length) return false;
  if (!last) return true;
  const days = (Date.now() - new Date(last).getTime()) / 86400000;
  return days > 7;
}
