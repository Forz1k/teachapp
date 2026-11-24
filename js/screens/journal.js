import {animateOnce} from '../motion.js';
import { openHealth, warning, checkGrade } from './health.js';
/* screens/journal.js — сетка журнала класса: ученики × даты уроков.
   Здесь же шторка отметки с трёхрежимной постановкой ОСВ. */

import * as M from '../model.js';
import {periodName} from '../assessment.js';
import * as store from '../store.js';
import * as ui from '../ui.js';

import {openGradeHistory} from './grade-history.js';
import {openAchievements} from './resources.js';
import {lineageOf} from '../school-tools.js';
import {openPassport} from './school-tools.js';
import {metric,dashboardHeading,trendChart} from '../dashboard.js';
import {schoolAnalytics} from '../analytics.js';
const { el, icon } = ui;

/** Цвет класса бейджа по значению. */
const valueClass = (v) => `v${v}`;

function badgeFor(mark) {
  if (!mark) return el('span', { class: 'cell-empty-dash', text: '·' });
  const wrap = el('span', { class: 'badge-pair' });

  if (mark.value) {
    wrap.append(el('span', { class: `badge ${valueClass(mark.value)}`, text: mark.value }));
    if (mark.flag === 'ОСВ') wrap.append(el('span', { class: 'mini-osv', text: 'ОСВ' }));
  } else if (mark.flag === 'ОСВ') {
    wrap.append(el('span', { class: 'badge osv', text: 'ОСВ' }));
  } else if (mark.flag === 'Н') {
    wrap.append(el('span', { class: 'badge absent', text: M.hasOsv(mark) ? 'Н' : '—' }));
    if (M.hasOsv(mark)) wrap.append(el('span',{class:'mini-osv',text:'ОСВ'}));
  } else {
    wrap.append(el('span', { class: 'cell-empty-dash', text: '·' }));
  }
  return wrap;
}

/** День недели сокращённо. */
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const dowOf = (isoStr) => DOW[M.parseIso(isoStr).getDay()];

/**
 * Рисует экран журнала в контейнер.
 * @param {HTMLElement} root
 * @param {{onOpenClassPicker: Function}} ctx
 */
export function renderJournal(root, ctx) {
  const classId = store.state.currentClassId;
  if (!classId) {
    root.append(el('div', { class: 'empty' }, ['Сначала добавьте класс в разделе «Настройки» или загрузите демо-данные.']));
    return;
  }

  const cls = store.state.classes.find((c) => c.id === classId);
  const students = store.studentsOfClass(classId);
  const settings = store.state.settings;
  const tr = store.currentTrimester();
  const lessons = store.lessonsInRange(classId, tr.from, tr.to);
  const markMap = store.markMap(classId);
  const today = M.todayIso();
  const topicsById = new Map(store.state.topics.map(t => [t.id,t]));
  const activeByStudent = new Map();
  for (const e of store.state.exemptions) if (M.exemptionActive(e) && !activeByStudent.has(e.studentId)) activeByStudent.set(e.studentId,e);

  /* ---- шапка ---- */
  const topbar = el('div', { class: 'topbar journal-topbar' });
  const row1 = el('div', { class: 'topbar-row' }, [
    el('button', {
      class: 'chip class-name-pill', type: 'button', text: `${cls ? M.displayClassName(cls.name) : 'Класс'} ▾`,
      onclick: () => ctx.onOpenClassPicker(),
    }),
    el('div', { style: 'flex:1' }),
    el('button',{class:'btn small journal-manage',type:'button',text:'Уроки триместра',onclick:()=>import('./lesson.js').then(m=>m.openTrimesterLessons(classId))}),
    el('button', {
      class: 'icon-btn', type: 'button', title: 'Проведение урока',
      onclick: () => import('./session.js').then(m=>m.openLessonPicker(classId,today)),
    }, [icon('quick')]),
    el('button', {
      class: 'icon-btn', type: 'button', title: 'Освобождения',
      onclick: () => ctx.onOpenExemptions(classId),
    }, [icon('shield')]),
  ]);

  const trChips = el('div', { class: 'segmented', style: 'margin-top:8px' },
    settings.trimesters.map((t) => el('button', {
      type: 'button',
      class: t.id === store.state.currentTrimesterId ? 'active' : '',
      text: periodName(t),
      onclick: () => {
        store.state.currentTrimesterId = t.id;
        store.notify();
      },
    })));

  const search=el('input',{type:'search',placeholder:'Найти ученика','aria-label':'Найти ученика в журнале'});
  topbar.append(row1,trChips,el('div',{class:'journal-tools'},[search,el('span',{class:'journal-count',text:students.length+' учеников · '+lessons.length+' уроков'})]));

  /* ---- сетка ---- */
  const wrap = el('div', { class: 'grid-wrap journal-grid',tabindex:'0','aria-label':'Таблица журнала. Прокрутите для просмотра дат.' });

  if (!lessons.length) {
    wrap.append(el('div', { class: 'empty' }, [
      el('div', { text: `В периоде «${periodName(tr)}» (${M.fmtFull(tr.from)} – ${M.fmtFull(tr.to)}) уроков пока нет.` }),
      el('div', { style: 'margin-top:16px' }, [
        el('button', {
          class: 'btn primary', type: 'button', text: 'Добавить уроки',
          onclick: () => ctx.onOpenLessonPlanner(classId),
        }),
      ]),
    ]));
    root.append(topbar, wrap);
    return;
  }

  if (!students.length) {
    wrap.append(el('div', { class: 'empty' }, ['В классе нет учеников. Добавьте их в настройках класса.']));
    root.append(topbar, wrap);
    return;
  }

  const table = el('table', { class: 'journal',style:'--journal-lessons:'+lessons.length });
  const thead = el('thead');
  const headRow = el('tr');

  headRow.append(el('th', { class: 'col-num', text: '№' }));
  headRow.append(el('th', { class: 'col-name', text: 'Фамилия и имя' }));

  for (const lesson of lessons) {
    const topic = topicsById.get(lesson.topicId);
    headRow.append(el('th', {
      class: 'col-lesson',
      title: topic ? topic.name : 'Тема не указана',
    }, [
      el('button',{type:'button',class:'journal-lesson-head','aria-label':'Изменить урок '+M.fmtFull(lesson.date),title:topic?.name||'Без темы',onclick:()=>import('./lesson.js').then(m=>m.openLessonSheet(lesson.id,classId))},[
        el('span',{class:'date',text:M.fmtShort(lesson.date)}),el('span',{class:'dow',text:dowOf(lesson.date)}),el('span',{class:'topic',text:topic?.name||'Без темы'}),
      ]),
    ]));
  }

  headRow.append(el('th', { class: 'col-sum', text: 'Средн.' }));
  headRow.append(el('th', { class: 'col-sum', text: 'Посещ.' }));

  thead.append(headRow);
  table.append(thead);

  const tbody = el('tbody');

  const rowByStudent = new Map();
  const studentById=new Map(students.map(s=>[s.id,s]));
  const attTitle=a=>'Проведено: '+a.held+'; будущих: '+a.future+'; не подтверждено уроков: '+a.unconfirmed+'; не отмечено: '+a.unknown+'; Н: '+a.absent+'; ОСВ: '+a.exempt;
  for (const st of students) {
    const tr_ = el('tr',{'data-name':st.fullName.toLocaleLowerCase('ru')});
    rowByStudent.set(st.id,tr_);

    tr_.append(el('td', { class: 'col-num', text: st.number ?? '' }));

    const activeEx = activeByStudent.get(st.id);
    const nameCell = el('td', { class: 'col-name' }, [
      el('button', { class:'name-cell',type:'button',text:M.surnameAndName(st.fullName),'aria-label':'Карточка ученика: '+st.fullName,title:st.fullName }),
    ]);
    if (activeEx) nameCell.firstChild.append(el('span', { class: 'ex-dot', title: M.exemptionLabel(activeEx) }));
    nameCell.addEventListener('click', () => openStudentSheet(st.id, classId));
    tr_.append(nameCell);

    let absent = 0;
    const values = [];

    for (const lesson of lessons) {
      const mark = markMap.get(`${lesson.id}|${st.id}`);
      if (mark?.flag === 'Н') absent += 1;
      if (mark?.value) values.push(Number(mark.value));

      const cell = el('td', {
        class: `cell ${mark ? 'filled' : ''}`,
        'data-student': st.id,
        'data-lesson': lesson.id,
        tabindex:'0','aria-label':st.fullName+' · '+M.fmtFull(lesson.date)+' · '+(mark?.value||mark?.flag||'нет отметки'),
      }, [el('div', { class: 'cell-inner' }, [badgeFor(mark)])]);

      cell.addEventListener('click', () => {
        ui.haptic(6);
        openMarkSheet(st.id, lesson.id, classId);
      });
      cell.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openMarkSheet(st.id,lesson.id,classId);}});
      tr_.append(cell);
    }

    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const att = store.attendanceFor(lessons,[st],classId);

    tr_.append(el('td', { class: 'col-sum', text: avg === null ? '—' : M.fmtAvg(avg) }));
    tr_.append(el('td', {
      class: 'col-sum',
      title:attTitle(att),
      text: att.pct === null ? '—' : `${String(att.pct).replace('.', ',')}%`,
      style: att.pct !== null && att.pct < 80 ? `color: var(--mark-2)` : '',
    }));

    tbody.append(tr_);
  }

  table.append(tbody);
  const filterStatus=el('p',{class:'empty',text:'Ученики не найдены',hidden:true});
  search.oninput=()=>{const q=search.value.trim().toLocaleLowerCase('ru');let count=0;for(const row of tbody.rows){row.hidden=!row.dataset.name.includes(q);if(!row.hidden)count++;}filterStatus.hidden=count!==0;};
  wrap.append(table,filterStatus);
  // Horizontal navigation is visible even when native scrollbars are hidden by the OS.
  const range=el('input',{type:'range',min:'0',max:'1000',step:'1',value:'0','aria-label':'Горизонтальная прокрутка журнала'});
  const left=el('button',{class:'icon-btn plain journal-scroll-prev',type:'button',title:'Предыдущие даты','aria-label':'Предыдущие даты'},[icon('back')]);
  const right=el('button',{class:'icon-btn plain journal-scroll-next',type:'button',title:'Следующие даты','aria-label':'Следующие даты'},[icon('chevron')]);
  const end=el('button',{class:'btn small journal-scroll-end',type:'button',text:'Итоги',title:'Показать последние уроки и итоговые колонки'});
  const maxScroll=()=>Math.max(0,wrap.scrollWidth-wrap.clientWidth);
  const syncScroll=()=>{const max=maxScroll();range.value=max?String(Math.round(wrap.scrollLeft/max*1000)):'0';};
  range.addEventListener('input',()=>{wrap.scrollLeft=maxScroll()*Number(range.value)/1000;});
  left.onclick=()=>{wrap.scrollLeft-=Math.max(80,wrap.clientWidth*.65);syncScroll();};
  right.onclick=()=>{wrap.scrollLeft+=Math.max(80,wrap.clientWidth*.65);syncScroll();};
  end.onclick=()=>{wrap.scrollLeft=maxScroll();syncScroll();};
  wrap.addEventListener('scroll',syncScroll,{passive:true});
  const scrollControls=el('div',{class:'journal-scroll-controls',role:'group','aria-label':'Перемещение по датам'},[left,range,right,end]);
  root.append(topbar,scrollControls,wrap);
  syncScroll();
  // Restore the visible slider after app.js restores scroll position on rerender.
  window.requestAnimationFrame?.(()=>{if(wrap.isConnected)syncScroll();});
  // При ручной отметке сохраняем DOM таблицы, прокрутку и остальные строки.
  return changedStudents => {
    const latest = store.markMap(classId);
    for (const id of new Set(changedStudents)) {
      const row = rowByStudent.get(id);
      if (!row) continue;
      let absent = 0, sum = 0, count = 0;
      const cells = row.querySelectorAll('.cell');
      lessons.forEach((lesson,i) => {
        const mark = latest.get(lesson.id + '|' + id);
        if (mark?.flag === 'Н') absent++;
        if (mark?.value) { sum += Number(mark.value); count++; }
        const old=cells[i].getAttribute('aria-label');
        cells[i].classList.toggle('filled',Boolean(mark));
        cells[i].firstChild.replaceChildren(badgeFor(mark));
        cells[i].setAttribute('aria-label',studentById.get(id).fullName+' · '+M.fmtFull(lesson.date)+' · '+(mark?.value||mark?.flag||'нет отметки'));
        if(old!==cells[i].getAttribute('aria-label'))animateOnce(cells[i].firstChild,'pulse',{duration:180});
      });
      const [avg,attendance] = row.querySelectorAll('.col-sum');
      avg.textContent = count ? M.fmtAvg(sum/count) : '—';
      const att = store.attendanceFor(lessons,[studentById.get(id)],classId);
      attendance.title=attTitle(att);
      attendance.textContent = att.pct === null ? '—' : String(att.pct).replace('.',',') + '%';
      attendance.style.color = att.pct !== null && att.pct < 80 ? 'var(--mark-2)' : '';
    }
    for(const st of students){
      if(changedStudents.includes(st.id))continue;
      const attendance=rowByStudent.get(st.id).querySelectorAll('.col-sum')[1];
      const att=store.attendanceFor(lessons,[st],classId);
      attendance.title=attTitle(att);
      attendance.textContent=att.pct===null?'—':String(att.pct).replace('.',',')+'%';
      attendance.style.color=att.pct!==null&&att.pct<80?'var(--mark-2)':'';
    }
  };
}

/* ---------- шторка отметки ---------- */

/**
 * Шторка ячейки. Главная логика: выбор значения, затем — при ОСВ — второй шаг со сроком.
 */
export function openMarkSheet(studentId, lessonId, classId) {
  const student = store.state.students.find((s) => s.id === studentId);
  const lesson = store.state.lessons.find((l) => l.id === lessonId);
  if (!student || !lesson) return;

  const existing = store.state.marks.find((m) => m.lessonId === lessonId && m.studentId === studentId) || null;
  const exemption = store.activeExemption(studentId, lesson.date);

  const sheet = el('div');

  const header = el('div', {}, [
    el('h2', { text: M.shortName(student.fullName) }),
    el('div', { class: 'sub', text: `${M.fmtFull(lesson.date)} · ${topicName(lesson.topicId)}` }),
  ]);
  sheet.append(header,warning(lesson,studentId),el('button',{type:'button',class:'btn wide',text:'История изменения оценки',onclick:()=>openGradeHistory(studentId,{lessonId},()=>openMarkSheet(studentId,lessonId,classId))}));

  if (exemption) {
    sheet.append(el('div', {
      class: 'compare-line',
      style: 'margin-top:0;margin-bottom:12px',
      text: `Ученик освобождён: ${M.exemptionLabel(exemption)}${exemption.reason ? ` (${exemption.reason})` : ''}`,
    }));
  }

  sheet.append(el('div', { class: 'sheet-buttons' }, [
    ...[5, 4, 3, 2, 1].map((v) => el('button', {
      type: 'button', class: `v${v} ${existing?.value === String(v) ? 'on' : ''}`, text: String(v),
      onclick: () => applyAndClose({ value: String(v), flag: null }),
    })),
    el('button', {
      type: 'button', class: `osv ${M.hasOsv(existing) && !existing?.value ? 'on' : ''}`, text: 'ОСВ',
      onclick: () => showOsvStep(sheet, student, lesson, existing, exemption),
    }),
    el('button', {
      type: 'button', class: `absent ${existing?.flag === 'Н' ? 'on' : ''}`, text: 'Н',
      onclick: () => handleAbsent(student, lesson, exemption, existing),
    }),
    el('button', {
      type: 'button', class: 'm small-label', text: 'Нагрузка',
      onclick: () => {
        ui.closeSheet();
        import('./participation.js').then(m => m.openParticipation(studentId, lesson.id));
      },
    }),
    el('button', {
      type: 'button', class: 'clear-cell', text: '✕',
      onclick: () => applyAndClose({ value: null, flag: null }),
    }),
  ]));

  // Вес оценки — для режима B «средневзвешенное»
  if (store.state.settings.rules.mode === 'B' && existing?.value) {
    const wRow = el('div', { class: 'preset-chips' }, [
      el('button', {
        type: 'button', class: existing.weight === 2 ? '' : 'active', text: 'обычная',
        onclick: async () => { await store.setMarkWeight(studentId, lessonId, 1); ui.closeSheet(); },
      }),
      el('button', {
        type: 'button', class: existing.weight === 2 ? 'active' : '', text: 'вес 2 (норматив)',
        onclick: async () => { if (!checkGrade(lesson,studentId)) return; await store.setMarkWeight(studentId, lessonId, 2); ui.closeSheet(); },
      }),
    ]);
    sheet.append(el('div', { class: 'sub', style: 'margin-top:14px;margin-bottom:0', text: 'Вес оценки' }), wRow);
  }

  const actions = el('div', { class: 'actions' }, [
    el('button', {
      class: 'btn small', type: 'button', text: 'Изменить дату или тему урока',
      onclick: () => {
        ui.closeSheet();
        import('./lesson.js').then((m) => m.openLessonSheet(lessonId, classId));
      },
    }),
  ]);
  sheet.append(actions);

  ui.openSheet(sheet);

  async function applyAndClose(vals) {
    if (vals.value && !checkGrade(lesson,studentId)) return;
    const { mark, undo } = await store.setMark(studentId, lessonId, vals);
    ui.closeSheet();
    ui.haptic(10);
    if (mark) {
      ui.toast('Сохранено', ui.undoAction({undo}));
    }
  }

  /** Обработка «Н» с учётом освобождения: требуется подтверждение. */
  async function handleAbsent(st, ls, ex, cur) {
    if (M.hasOsv(cur) || M.exemptionCovers(ex, ls.date)) {
      const ok = await ui.confirmDialog({
        title: 'Ученик освобождён',
        text: 'Отметить отсутствие на этом уроке? В журнале сохранятся ОСВ и Н.',
        ok: 'Отметить Н',
        danger: true,
      });
      if (!ok) return;
      const { undo } = await store.setMark(studentId, lessonId, { flag: 'Н' });
      ui.closeSheet();
      ui.toast('Отмечено: ОСВ + Н', ui.undoAction({undo}));
      return;
    }
    await applyAndClose({ value: null, flag: 'Н' });
  }
}

function topicName(topicId) {
  const t = store.state.topics.find((x) => x.id === topicId);
  return t ? t.name : 'тема не указана';
}

/* ---------- второй шаг ОСВ: срок освобождения ---------- */

/**
 * Второй экран шторки: «На какой срок?».
 * Режимы: только этот урок / до даты / бессрочно.
 */
function showOsvStep(sheet, student, lesson, existing, activeEx) {
  sheet.innerHTML = '';
  sheet.append(
    el('h2', { text: 'ОСВ — на какой срок?' }),
    el('div', { class: 'sub', text: `${M.shortName(student.fullName)} · урок ${M.fmtFull(lesson.date)}` }),
  );

  const modeRow = el('div', { class: 'actions', style: 'margin-top:0' });
  const step2 = el('div');
  sheet.append(modeRow, step2);

  if (activeEx) {
    sheet.insertBefore(el('div', {
      class: 'compare-line',
      text: `Уже есть освобождение: ${M.exemptionLabel(activeEx)}. Новое заменит его для этого периода.`,
    }), modeRow);
  }

  /** Вариант 1: только этот урок — запись mark, exemption не создаётся. */
  modeRow.append(el('button', {
    class: 'btn wide', type: 'button', text: 'Только этот урок',
    onclick: async () => {
      const { mark, undo } = await store.setMark(student.id, lesson.id, { value: null, flag: 'ОСВ' });
      ui.closeSheet();
      ui.toast('ОСВ на один урок', ui.undoAction({undo}));
    },
  }));

  /** Вариант 3: бессрочно. */
  modeRow.append(el('button', {
    class: 'btn wide', type: 'button', text: 'Бессрочно (до конца года)',
    onclick: () => applyExemption(lesson.date, null),
  }));

  /** Вариант 2: до даты — раскрываем пикер с пресетами. */
  const toDateBtn = el('button', {
    class: 'btn wide primary', type: 'button', text: 'До даты…',
    onclick: () => buildDateStep(),
  });
  modeRow.append(toDateBtn);

  function buildDateStep() {
    step2.innerHTML = '';
    const tr = store.currentTrimester();
    const presets = [
      { label: '1 урок', days: null, date: nextLessonDate(lesson.date) },
      { label: '1 неделя', days: 7, date: M.addDays(lesson.date, 7) },
      { label: '2 недели', days: 14, date: M.addDays(lesson.date, 14) },
      { label: 'до конца триместра', days: null, date: tr.to },
      { label: 'до конца года', days: null, date: store.state.settings.year.to },
      { label: 'выбрать дату', days: null, date: null },
    ];

    let chosen = M.addDays(lesson.date, 7);
    const dateInput = el('input', { type: 'date', value: chosen, min: lesson.date });

    const chips = el('div', { class: 'preset-chips' },
      presets.map((p) => el('button', {
        type: 'button',
        class: p.date === chosen ? 'active' : '',
        text: p.label,
        onclick: (e) => {
          if (p.label === 'выбрать дату') {
            chips.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            dateInput.focus();
            try { dateInput.showPicker?.(); } catch { /* необязательно */ }
            return;
          }
          chosen = p.date;
          dateInput.value = p.date;
          chips.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
      })));

    step2.append(
      el('div', { class: 'sub', style: 'margin-top:16px;margin-bottom:0', text: 'Освобождение до:' }),
      chips,
      el('label', { class: 'field', style: 'margin-top:12px' }, [dateInput]),
      el('div', { class: 'actions' }, [
        el('button', {
          class: 'btn primary wide', type: 'button', text: 'Поставить освобождение',
          onclick: () => applyExemption(lesson.date, dateInput.value || chosen),
        }),
        el('button', {
          class: 'btn wide', type: 'button', text: 'Назад',
          onclick: () => showOsvStep(sheet, student, lesson, existing, activeEx),
        }),
      ]),
    );
    setTimeout(() => { try { dateInput.showPicker?.(); } catch { /* Safari может не дать */ } }, 220);
  }

  async function applyExemption(from, to) {
    const affected = store.countOsvAffected(student.id, from, to, activeEx?.id);
    if (affected > 0 && activeEx) {
      const ok = await ui.confirmDialog({
        title: 'Сократить освобождение?',
        text: `Будет удалено ${affected} отметок ОСВ за период. Продолжить?`,
        ok: 'Продолжить',
      });
      if (!ok) return;
    }

    try {
      let result;
      if (activeEx) {
        result = await store.updateExemption(activeEx.id, { dateFrom: from, dateTo: to });
      } else {
        result = await store.addExemption({ studentId: student.id, dateFrom: from, dateTo: to, reason: '' });
      }
      ui.closeSheet();
      ui.haptic(12);
      ui.toast(to === null ? 'Освобождение до конца года' : `Освобождение до ${M.fmtFull(to)}`, ui.undoAction(result));
    } catch (err) {
      ui.toast('Не удалось сохранить: ' + err.message);
    }
  }
}

/** Ближайшая дата урока после указанной (для пресета «1 урок»). */
function nextLessonDate(afterIso) {
  const lessons = store.lessonsOfClass(store.state.currentClassId).filter((l) => l.date > afterIso);
  return lessons.length ? lessons[0].date : afterIso;
}

/* ---------- шторка ученика ---------- */

export async function openStudentSheet(studentId, classId, periodId) {
  const student = store.state.students.find((s) => s.id === studentId);
  if (!student || student.classId!==classId) return;
  const exs = store.exemptionsOfStudent(studentId).sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

  const period=store.state.settings.trimesters.find(t=>t.id===periodId)||store.currentTrimester();
  const today=M.todayIso();
  const analytics=schoolAnalytics(classId,period.from,period.to,studentId,today);
  const row=analytics.rows[0],att=row.att;
  const results=store.state.normResults.filter(r=>r.studentId===studentId&&M.inRange(r.date,period.from,period.to)&&r.date<=today);
  const completed=results.filter(r=>r.status==='done'),restricted=results.filter(r=>r.status==='restricted');
  const changePeriod=el('select',{'aria-label':'Учебный период ученика'},store.state.settings.trimesters.map(t=>el('option',{value:t.id,text:periodName(t)+' · '+M.fmtFull(t.from)+' — '+M.fmtFull(t.to)})));
  changePeriod.value=period.id;
  changePeriod.onchange=()=>openStudentSheet(studentId,classId,changePeriod.value);
  const back=()=>openStudentSheet(studentId,classId,period.id);
  const cls=store.state.classes.find(c=>c.id===classId);
  const sheet = el('div', {class:'student-profile coach-stack'}, [
    el('div',{class:'profile-avatar',text:student.number??'—','aria-hidden':'true'}),
    el('h2', { text: student.fullName }),
    el('div', { class: 'sub', text: (cls?.name||'')+' · № '+(student.number??'—')+' в списке' }),
    el('label',{class:'field'},[el('span',{text:'Учебный период'}),changePeriod]),
  ]);

  sheet.append(dashboardHeading(periodName(period)),
    el('div',{class:'dashboard-metrics'},[
      metric('Средняя оценка',row.mean==null?'—':M.fmtAvg(row.mean),'journal'),
      metric('Посещаемость',att.pct==null?'—':att.pct+'%','check'),
      metric('Оценок',row.count,'chart'),
      metric('Попыток нормативов',completed.length,'quick'),
      metric('Итоговая оценка',row.final??'—','journal')]),
    el('div',{class:'profile-note',text:'Проведено уроков: '+att.held+' · не отмечено: '+att.unknown+' · отсутствия: '+att.absent+' · ОСВ: '+att.exempt}),
    dashboardHeading('Динамика оценок','Среднее по месяцам; месяцы без оценок не считаются нулём.'),
    trendChart(analytics.trend.map(r=>({date:r.month,value:r.mean})),{min:1,max:5,label:'Средняя оценка',unit:'балл'}),
    ...analytics.trend.filter(r=>r.count>0).map(r=>el('p',{class:'profile-note',text:r.month+' · '+M.fmtAvg(r.mean)+' · оценок '+r.count})),
    dashboardHeading('Нормативы за период','Записанные попытки, не список обязательных нормативов.'),
    el('p',{class:'profile-note',text:'Выполненных попыток: '+completed.length+' · не выполнялись по ограничениям: '+restricted.length}));
  const normRows=results.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(r=>el('div',{class:'profile-result'},[
    el('strong',{text:r.definition?.name||'Норматив'}),
    el('span',{text:M.fmtFull(r.date)+' · '+(r.status==='restricted'?'Не выполнялся по ограничению':(r.value??'—')+' '+(r.definition?.unit||'')+' · оценка '+(r.grade??'—'))})]));
  sheet.append(...normRows.slice(0,10));
  if(normRows.length>10)sheet.append(el('details',{},[el('summary',{text:'Ещё попыток: '+(normRows.length-10)}),...normRows.slice(10)]));
  if(!normRows.length)sheet.append(el('p',{text:'Нет результатов за выбранный период.'}));
  sheet.append(dashboardHeading('Участие и ограничения'));
  sheet.append(el('button',{class:'btn wide',type:'button',text:'История оценок',onclick:()=>openGradeHistory(studentId,{},back)}));
  sheet.append(el('button',{class:'btn wide',type:'button',text:'Паспорт физической подготовки',onclick:()=>openPassport(studentId,back)}));
  sheet.append(el('button',{class:'btn wide',type:'button',text:'Спортивные достижения',onclick:()=>openAchievements({area:'school',subjectType:'student',subjectId:lineageOf(student)},back)}));
  sheet.append(el('button',{class:'btn',type:'button',text:'Группа здоровья и ограничения',onclick:() => openHealth(studentId)}));
  if (exs.length) {
    const block = el('div', { class: 'card-block', style: 'margin-top:8px' }, [
      el('div', { class: 'head', text: 'Освобождения' }),
    ]);
    for (const ex of exs) {
      block.append(el('div', { class: 'row-item' }, [
        el('div', { class: 'label' }, [
          el('div', { text: M.exemptionLabel(ex), style: 'font-size:14px' }),
          el('div', { text: ex.reason || 'без причины', style: 'font-size:12px;color:var(--text-3)' }),
        ]),
        el('button', {
          class: 'btn small danger', type: 'button', text: 'Снять',
          onclick: async () => {
            const n = store.countOsvAffected(studentId,null,null,ex.id);
            const ok = await ui.confirmDialog({
              title: 'Снять освобождение?',
              text: n ? `Будет удалено ${n} отметок ОСВ, проставленных автоматически. Оценки не пострадают.` : 'Автоматических отметок ОСВ нет.',
              ok: 'Снять', danger: true,
            });
            if (!ok) return;
            const result = await store.removeExemption(ex.id);
            ui.closeSheet();
            ui.toast('Освобождение снято', ui.undoAction(result));
          },
        }),
      ]));
    }
    sheet.append(block);
  }

  sheet.append(el('div', { class: 'actions' }, [
    el('button', {
      class: 'btn wide', type: 'button', text: 'Добавить освобождение',
      onclick: () => openAddExemptionSheet(studentId),
    }),
    el('button', {
      class: 'btn wide', type: 'button', text: 'Переименовать / изменить №',
      onclick: async () => {
        const name = await ui.promptDialog({ title: 'ФИО', value: student.fullName, ok: 'Сохранить' });
        if (name === null) return;
        const num = await ui.promptDialog({
          title: 'Номер в списке', value: String(student.number ?? ''),
          ok: 'Сохранить',
        });
        if (num === null) return;
        await store.updateStudent(studentId, {
          fullName: name.trim() || student.fullName,
          number: Number(num) || student.number,
        });
        ui.closeSheet();
        ui.toast('Данные ученика обновлены');
      },
    }),
    el('button', {
      class: 'btn wide danger', type: 'button', text: 'Удалить ученика',
      onclick: async () => {
        const ok = await ui.confirmDialog({
          title: `Удалить ${M.shortName(student.fullName)}?`,
          text: 'Вместе с учеником удалятся все его оценки, отметки посещаемости, освобождения и месячные отметки. Действие необратимо.',
          ok: 'Удалить', danger: true,
        });
        if (!ok) return;
        await store.deleteStudent(studentId);
        ui.closeSheet();
        ui.toast('Ученик удалён');
      },
    }),
  ]));

  ui.openSheet(sheet);
}

/** Шторка добавления освобождения для ученика (когда урок не выбран). */
export function openAddExemptionSheet(studentId) {
  const student = store.state.students.find((s) => s.id === studentId);
  if (!student) return;
  const today = M.todayIso();
  const fromInput = el('input', { type: 'date', value: today });
  const toInput = el('input', { type: 'date', value: M.addDays(today, 14), min: today });
  const reasonInput = el('input', { type: 'text', placeholder: 'например: справка после ОРВИ' });

  const sheet = el('div', {}, [
    el('h2', { text: 'Освобождение' }),
    el('div', { class: 'sub', text: student.fullName }),
    el('label', { class: 'field' }, [el('span', { text: 'С даты' }), fromInput]),
    el('label', { class: 'field' }, [el('span', { text: 'По дату (оставьте пустым — бессрочно)' }), toInput]),
    el('label', { class: 'field' }, [el('span', { text: 'Причина' }), reasonInput]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Сохранить',
        onclick: async () => {
          const to = toInput.value || null;
          if (to && to < fromInput.value) { ui.toast('Дата окончания раньше начала'); return; }
          const { changed } = await store.addExemption({
            studentId, dateFrom: fromInput.value, dateTo: to, reason: reasonInput.value.trim(),
          });
          ui.closeSheet();
          ui.toast(changed ? `Готово: отмечено ${changed} уроков` : 'Освобождение сохранено');
        },
      }),
      el('button', {
        class: 'btn wide', type: 'button', text: 'Сделать бессрочным',
        onclick: async () => {
          await store.addExemption({ studentId, dateFrom: fromInput.value, dateTo: null, reason: reasonInput.value.trim() });
          ui.closeSheet();
          ui.toast('Освобождение до конца года');
        },
      }),
    ]),
  ]);

  ui.openSheet(sheet);
}

/* ---------- быстрый ввод на один урок ---------- */

/**
 * Режим «на один урок»: список всех учеников класса крупными строками
 * с сегмент-контролом 1–5 / ОСВ / М / Н. Для ввода прямо в спортзале.
 */
export function openQuickEntrySheet(classId, initialDate) {
  const students = store.studentsOfClass(classId);
  const cls = store.state.classes.find((c) => c.id === classId);
  if (!students.length) { ui.toast('В классе нет учеников'); return; }

  const classLessons = store.lessonsOfClass(classId);
  let currentDate = initialDate || (classLessons.length ? classLessons[classLessons.length - 1].date : M.todayIso());

  const sheet = el('div');
  const headerWrap = el('div');
  const listWrap = el('div', { class: 'quick-list' });
  const search = el('input',{type:'search',placeholder:'Найти ученика','aria-label':'Найти ученика'});
  const status = el('div',{class:'quick-status',role:'status','aria-live':'polite'});
  const topicLine = el('div',{class:'quick-topic'});
  sheet.append(headerWrap,topicLine,search,status,listWrap);
  const filter = () => {
    const query = search.value.trim().toLocaleLowerCase('ru');
    for (const row of listWrap.querySelectorAll('.quick-row')) row.hidden = !row.dataset.name.includes(query);
  };
  search.addEventListener('input',filter);

  async function ensureLesson() {
    let lesson = store.lessonsOfClass(classId).find((l) => l.date === currentDate);
    if (!lesson) {
      lesson = await store.addLesson(classId, currentDate);
      classLessons.push(lesson);
      classLessons.sort((a, b) => a.date.localeCompare(b.date));
    }
    return lesson;
  }

  let lesson = classLessons.find((l) => l.date === currentDate) || null;

  function drawHeader() {
    headerWrap.innerHTML = '';
    const input = el('input', { type: 'date', value: currentDate, max: store.state.settings.year.to });
    input.addEventListener('change', async () => {
      if (!input.value || input.value > store.state.settings.year.to) { input.value = currentDate; return; }
      const previous = currentDate;
      currentDate = input.value;
      input.disabled = true;
      try { lesson = await ensureLesson(); draw(); }
      catch { currentDate = previous; input.value = previous; ui.toast('Не удалось открыть урок'); }
      finally { input.disabled = false; }
    });

    headerWrap.append(
      el('h2', { text: 'Быстрый ввод' }),
      el('div', { class: 'sub', text: `${cls ? cls.name : ''} · ${students.length} учеников` }),
      el('label', { class: 'field' }, [el('span', { text: 'Дата урока' }), input]),
    );
  }

  function draw() {
    const topic = store.state.topics.find(t => t.id === lesson?.topicId);
    topicLine.textContent = topic ? topic.name : 'Тема КТП не указана';
    listWrap.replaceChildren(warning(lesson || {classId,date:currentDate},null,() => { draw(); ui.openSheet(sheet); }));
    const markMap = store.markMap(classId);
    for (const st of students) listWrap.append(buildRow(st,markMap));
    filter();
  }

  function buildRow(st,markMap) {
      const key = lesson ? `${lesson.id}|${st.id}` : null;
      const mark = key ? markMap.get(key) : null;
      const ex = lesson ? store.activeExemption(st.id, lesson.date) : null;

      const row = el('div', { class: 'quick-row', 'data-name':st.fullName.toLocaleLowerCase('ru') });
      row.append(el('div', { class: 'who' }, [
        el('span', { class: 'n', text: st.number ?? '' }),
        el('span', { class: 'fio', text: M.shortName(st.fullName) }),
      ]));

      if (ex && !mark) {
        row.append(el('span', { class: 'hint', text: `освобождён: ${M.exemptionLabel(ex)}` }));
      }

      const btns = el('div', { class: 'mark-buttons' });
      const set = async (value, flag) => {
        if (!lesson) lesson = await ensureLesson();
        if (value && !checkGrade(lesson,st.id)) return;
        if (flag === 'Н' && (M.hasOsv(mark) || ex) && !window.confirm('Отметить отсутствие вместе с ОСВ?')) return;
        for (const button of btns.querySelectorAll('button')) button.disabled = true;
        status.textContent = 'Сохранение…';
        try {
          await store.setMark(st.id, lesson.id, { value, flag });
          ui.haptic(8);
          row.replaceWith(buildRow(st,store.markMap(classId)));
          filter();
          status.textContent = 'Сохранено';
        } catch { status.textContent = 'Не удалось сохранить отметку'; }
        finally { for (const button of btns.querySelectorAll('button')) button.disabled = false; }
      };

      [5, 4, 3, 2, 1].forEach((v) => {
        btns.append(el('button', {
          type: 'button',
          class: `v${v} ${mark?.value === String(v) && !mark.flag ? 'on' : ''}`,
          text: String(v),
          onclick: () => set(String(v), null),
        }));
      });
      btns.append(el('button', {
        type: 'button', class: `osv small-label ${M.hasOsv(mark) ? 'on' : ''}`, text: 'ОСВ',
        onclick: () => set(null, 'ОСВ'),
      }));
      btns.append(el('button', {
        type: 'button', class: 'm small-label', text: 'Нагрузка',
        onclick: async () => {
          try {
            if (!lesson) lesson = await ensureLesson();
            const m = await import('./participation.js');
            m.openParticipation(st.id, lesson.id);
          } catch { ui.toast('Не удалось открыть урок'); }
        },
      }));
      btns.append(el('button', {
        type: 'button', class: `absent ${mark?.flag === 'Н' ? 'on' : ''}`, text: 'Н',
        onclick: () => set(null, 'Н'),
      }));

      row.append(btns);
      return row;
  }

  return (async () => {
    try {
      lesson = await ensureLesson();
      drawHeader();
      draw();
      ui.openSheet(sheet);
    } catch { ui.toast('Не удалось открыть урок'); }
  })();
}
