import { openRoster, openLessonRestrictions } from './health.js';
/* screens/classes.js — стартовый экран: 9 карточек классов. */

import * as M from '../model.js';
import {periodName} from '../assessment.js';
import * as store from '../store.js';
import * as ui from '../ui.js';

import {metric,dashboardHeading} from '../dashboard.js';
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
    el('div', { class: 'subtitle', text: `${periodName(tr)} · ${M.fmtFull(tr.from)} – ${M.fmtFull(tr.to)}` }),
    el('div',{class:'segmented class-period-switch',role:'group','aria-label':'Учебный период'},settings.trimesters.map(p=>el('button',{type:'button',class:p.id===tr.id?'active':'','aria-pressed':String(p.id===tr.id),text:periodName(p),onclick:()=>store.selectSchoolPeriod(p.id)}))),
  ]));

  // Баннер о резервной копии: показываем, если копии не было больше 7 дней
  if (needsBackupReminder()) {
    const banner = el('div', { class: 'banner' }, [
      el('div', { class: 'txt', text: 'Давно не сохраняли резервную копию. Данные живут только на этом телефоне.' }),
      el('button', {
        type: 'button', text: 'Сохранить',
        onclick: async () => {
          try { await (await import('../export.js')).exportBackup(); }
          catch (err) { ui.toast('Не удалось подготовить копию: ' + err.message); }
        },
      }),
      el('button', {
        type: 'button', text: 'Позже', style: 'color:var(--text-3)',
        onclick: async () => {
          try {
            await store.saveSettings({ backupReminderAfter: new Date(Date.now() + 86400000).toISOString() });
            banner.remove();
          } catch (err) { ui.toast(err.message); }
        },
      }),
    ]);
    root.append(banner);
  }

  const list = el('div', { class: 'list class-directory' });

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

  const todayClasses = new Set([...store.scheduleForDate(today).map(row => row.classId),
    ...store.state.lessons.filter(l => l.date === today).map(l => l.classId)]);
  const todayList=el('section',{class:'card-block class-today'});
  const holiday=M.isSchoolHoliday(today,settings.holidays||[]);
  if(holiday)todayList.append(el('p',{class:'sub',text:'Каникулы · уроков по расписанию нет'}));
  for(const cls of store.state.classes.filter(c=>todayClasses.has(c.id))){
    const lesson=store.lessonsOfClass(cls.id).find(l=>l.date===today);
    if(holiday&&(!lesson||!store.lessonHeld(lesson)))continue;
    const current=lesson||{classId:cls.id,date:today};
    const topic=store.state.topics.find(t=>t.id===current.topicId);
    const {matches,needsReview}=store.lessonCheck(current);
    const count=new Set(matches.map(m=>m.studentId)).size;
    const full=store.studentsOfClass(cls.id).filter(s=>store.activeExemption(s.id,today)).length;
    const status=count?'Ограничения: '+count+' уч.':!lesson?'Урок не создан':needsReview?'Нагрузки не указаны или не подтверждены':'Совпадений ограничений не найдено';
    const note=(count&&needsReview?' · нужна проверка нагрузки':'')+(full?' · ОСВ: '+full:'');
    todayList.append(el('button',{class:'class-today-row',type:'button','aria-label':M.displayClassName(cls.name)+' · '+status+note,onclick:()=>openLessonRestrictions(current)},[
      el('span',{class:'class-name-pill',text:M.displayClassName(cls.name)}),
      el('span',{class:'class-today-copy'},[el('strong',{text:topic?.name||(lesson?'Тема не указана':'Урок по расписанию')}),el('span',{class:'class-today-status '+(count||full?'has-restrictions':needsReview?'needs-review':'checked'),text:status+note})]),
      el('span',{class:'class-today-arrow','aria-hidden':'true'},[icon('chevron')])
    ]));
  }
  if(todayList.childElementCount){
    todayList.prepend(el('h2',{text:'Сегодня · '+M.fmtFull(today)}));
    list.append(todayList);
  }
  const directory=el('div',{class:'class-grid'}),search=el('input',{type:'search',placeholder:'Найти класс','aria-label':'Найти класс'}),empty=el('p',{class:'empty',text:'Классы не найдены',hidden:true});
  list.append(el('div',{class:'dashboard-metrics'},[metric('Классов',store.state.classes.length,'classes'),metric('Учеников',store.state.students.length,'journal')]),dashboardHeading('Все классы'),search,directory,empty);
  for (const cls of store.state.classes) {
    const students = store.studentsOfClass(cls.id);
    const lessons = store.lessonsInRange(cls.id, tr.from, tr.to);
    const lastLesson = lessons.length ? lessons[lessons.length - 1] : null;

    const att=store.attendanceFor(lessons,students,cls.id);

    const card = el('button', { class: 'class-card', type: 'button' }, [
      el('div', { class: 'name', text: M.displayClassName(cls.name) }),
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
    card.append(ring,el('div',{class:'attendance-details',text:'Проведено: '+att.held+' · будущих: '+att.future+' · не подтверждено: '+att.unconfirmed+' · не отмечено: '+att.unknown+' · Н: '+att.absent+' · ОСВ: '+att.exempt}));

    card.addEventListener('click', () => {
      ui.haptic(8);
      store.state.currentClassId = cls.id;
      ctx.onOpenJournal?.(cls.id);
    });

    const item=el('article',{class:'class-entry','data-name':(cls.name+' '+M.displayClassName(cls.name)).toLocaleLowerCase('ru')},[card,el('button',{class:'btn wide class-roster',type:'button',text:'Состав класса '+M.displayClassName(cls.name),onclick:()=>openRoster(cls.id)})]);directory.append(item);
  }

  search.oninput=()=>{const query=search.value.trim().toLocaleLowerCase('ru');let count=0;for(const item of directory.children){item.hidden=!item.dataset.name.includes(query);if(!item.hidden)count++;}empty.hidden=count!==0;};
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
  if (Date.parse(store.state.settings.backupReminderAfter) > Date.now()) return false;
  if (!store.state.students.length) return false;
  if (!last) return true;
  const days = (Date.now() - new Date(last).getTime()) / 86400000;
  return days > 7;
}
