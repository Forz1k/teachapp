import { warning, editTags, prepareTest } from './health.js';
/* screens/lesson.js — редактирование отдельного урока и массовый планировщик дат. */

import * as M from '../model.js';
import * as store from '../store.js';
import * as ui from '../ui.js';

const { el, icon } = ui;

/** Шторка одного урока: дата, тема из КТП, заметка, удаление. */
export function openLessonSheet(lessonId, classId) {
  const lesson = store.state.lessons.find((l) => l.id === lessonId);
  if (!lesson) return;

  // В шторке урока отметок не редактируем — она про расписание.
  const dateInput = el('input', { type: 'date', value: lesson.date });

  const topicSelect = el('select', {});
  topicSelect.append(el('option', { value: '', text: '— без темы —' }));

  // Темы берём только из КТП этого класса (плюс общие без привязки).
  const available = store.topicsForClass(classId);
  const groups = new Map(); // ktpId → темы
  for (const t of available) {
    const key = t.ktpId || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  for (const [ktpId, list] of groups) {
    const ktp = store.state.ktp.find((k) => k.id === ktpId);
    const group = document.createElement('optgroup');
    group.label = ktp ? ktp.name : 'Без КТП';
    for (const t of list) {
      const opt = el('option', { value: t.id, text: `${t.ktpOrder}. ${t.name}` });
      if (t.id === lesson.topicId) opt.selected = true;
      group.append(opt);
    }
    topicSelect.append(group);
  }

  // Если тема урока из другого плана (например, КТП перепривязали) — показываем её отдельно,
  // чтобы при сохранении она не потерялась незаметно.
  if (lesson.topicId && !available.some((t) => t.id === lesson.topicId)) {
    const current = store.state.topics.find((t) => t.id === lesson.topicId);
    if (current) {
      const opt = el('option', { value: current.id, text: `⚠ ${current.name} (не из КТП класса)` });
      opt.selected = true;
      topicSelect.append(opt);
    }
  }

  if (!available.length) {
    topicSelect.append(el('option', { value: '', text: '— тем нет, загрузите КТП —', disabled: true }));
  }

  const held = el('input',{type:'checkbox'}); held.checked = Boolean(lesson.held);
  held.disabled = lesson.date > M.todayIso();
  const noteInput = el('textarea', { placeholder: 'заметка к уроку (необязательно)' });
  noteInput.value = lesson.note || '';

  const sheet = el('div', {}, [
    el('h2', { text: 'Урок' }),
    el('div', { class: 'sub', text: M.fmtFull(lesson.date) }),
    el('label', { class: 'field' }, [el('span', { text: 'Дата' }), dateInput]),
    el('label', { class: 'field' }, [el('span', { text: 'Тема по КТП' }), topicSelect]),
    el('label', { class: 'field' }, [el('span', { text: 'Заметка' }), noteInput]),
    el('label',{class:'field'},[el('span',{text:'Проведение урока подтверждено'}),held]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Сохранить',
        onclick: async () => {
          const newDate = dateInput.value;
          if(!newDate)return ui.toast('Укажите дату урока');
          // Смена даты на уже занятую — конфликт
          const clash = store.lessonsOfClass(classId).find((l) => l.date === newDate && l.id !== lesson.id);
          if (clash) {
            ui.toast('На эту дату уже есть урок');
            return;
          }
          await store.updateLesson(lessonId, {
            date: newDate, held: held.checked && newDate <= M.todayIso(),
            topicId: topicSelect.value || null,
            note: noteInput.value.trim(),
          });
          ui.closeSheet();
          ui.toast('Урок обновлён');
        },
      }),
      el('button', {
        class: 'btn wide danger', type: 'button', text: 'Удалить урок',
        onclick: async () => {
          const marksCount = store.state.marks.filter((m) => m.lessonId === lessonId).length;
          const ok = await ui.confirmDialog({
            title: 'Удалить урок?',
            text: 'Отметки: '+marksCount+'; участие: '+store.state.participation.filter(p=>p.lessonId===lessonId).length+'; нормативы: '+store.state.normResults.filter(r=>r.lessonId===lessonId).length+'. Эти записи и история оценок будут удалены. Остальные темы не изменятся. Это необратимо.',
            ok: 'Удалить', danger: true,
          });
          if (!ok) return;
          await store.deleteLesson(lessonId);
          ui.closeSheet();
          ui.toast('Урок удалён');
        },
      }),
    ]),
  ]);

  const draft = () => ({...lesson,date:dateInput.value,topicId:topicSelect.value || null});
  const checks = el('div');
  const refresh = () => checks.replaceChildren(warning(draft()));
  topicSelect.onchange = () => {
    if (lesson.activityIds != null) ui.toast('У урока вручную заданы теги нагрузки. Они сохранятся при смене темы.');
    refresh();
  };
  dateInput.onchange = () => {
    held.disabled = dateInput.value > M.todayIso();
    if (held.disabled) held.checked = false;
    refresh();
  };
  sheet.insertBefore(checks,sheet.querySelector('.actions'));
  checks.before(el('button',{class:'btn',type:'button',text:'Виды физической нагрузки',onclick:() =>
    editTags(draft(),false,() => { refresh(); ui.openSheet(sheet); })}),
    el('button',{class:'btn',type:'button',text:'Подготовка норматива',onclick:() => prepareTest(draft())}));
  if (lesson.topicId) {
    const target = el('select',{},[el('option',{value:'',text:'Выберите дату переноса'})]);
    for (const l of store.lessonsOfClass(classId).filter(l => l.id !== lesson.id && !store.lessonHeld(l))) {
      const topic = store.state.topics.find(t => t.id === l.topicId);
      target.append(el('option',{value:l.id,text:M.fmtFull(l.date) + ' · ' + (topic?.name || 'без темы')}));
    }
    sheet.append(target,el('button',{type:'button',class:'btn',text:'Перенести тему и теги',onclick:async () => {
      if (!target.value) return ui.toast('Выберите дату переноса');
      if (!window.confirm('Обменять сохранённые темы и теги двух уроков?')) return;
      try { await store.transferTopic(lesson.id,target.value); openLessonSheet(target.value,classId); }
      catch (error) { ui.toast(error.message); }
    }}));
  }
  refresh();
  ui.openSheet(sheet);
}

/**
 * Планировщик: массовое создание уроков по шаблону расписания.
 * Выбор дней недели + диапазон дат = набор уроков. Темы распределяются по порядку КТП.
 */
export function openLessonPlanner(classId) {
  const tr = store.currentTrimester();
  const settings = store.state.settings;
  const cls = store.state.classes.find((c) => c.id === classId);

  const fromInput = el('input', { type: 'date', value: tr.from });
  const toInput = el('input', { type: 'date', value: tr.to });

  const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const hasSchedule = store.state.schedule.some(r => r.classId === classId);
  const selectedDays = new Set(hasSchedule ? [] : [2,4]);
  const dayChips = el('div', { class: 'preset-chips' },
    DOW.map((label, i) => {
      const dow = i + 1;
      const btn = el('button', {
        type: 'button', class: selectedDays.has(dow) ? 'active' : '', text: label,
        onclick: () => {
          if (selectedDays.has(dow)) selectedDays.delete(dow);
          else selectedDays.add(dow);
          btn.classList.toggle('active');
          updatePreview();
        },
      });
      return btn;
    }));

  const autoTopics = el('button', {
    type: 'button', class: 'switch on', role: 'switch', 'aria-checked': 'true',
  });
  let withTopics = true;
  autoTopics.addEventListener('click', () => {
    withTopics = !withTopics;
    autoTopics.classList.toggle('on', withTopics);
    autoTopics.setAttribute('aria-checked', String(withTopics));
  });

  const previewLine = el('div', { class: 'compare-line' });

  function plannedDates() {
    return M.planLessonDates({classId,from:fromInput.value,to:toInput.value,rules:store.state.schedule,
      overrides:store.state.scheduleOverrides,holidays:settings.holidays || [],days:selectedDays});
  }

  function updatePreview() {
    const dates = plannedDates();
    const existing = new Set(store.lessonsOfClass(classId).map((l) => l.date));
    const fresh = dates.filter((d) => !existing.has(d));
    previewLine.innerHTML = '';
    previewLine.append(el('span', {
      html: `Будет создано <b>${fresh.length}</b> уроков${dates.length - fresh.length ? ` · ${dates.length - fresh.length} уже есть` : ''}`,
    }));
  }

  fromInput.addEventListener('change', updatePreview);
  toInput.addEventListener('change', updatePreview);

  const vacations=el('div',{class:'card-block'},[
    el('h3',{text:'Каникулы для всех классов'}),
    el('p',{class:'sub',text:'Общие даты из Настроек → Учебный год и классы → Каникулы.'}),
    ...((store.state.settings.holidays||[]).map(h=>el('div',{text:M.fmtFull(h.from)+' — '+M.fmtFull(h.to)}))),
  ]);
  const sheet = el('div', {}, [
    el('h2', { text: 'Уроки по расписанию' }),
    el('div', { class: 'sub', text: cls ? cls.name : '' }),
    el('label', { class: 'field' }, [el('span', { text: 'С даты' }), fromInput]),
    el('label', { class: 'field' }, [el('span', { text: 'По дату' }), toInput]),
    el('div', { class: 'sub', style: 'margin-bottom:0', text: hasSchedule ? 'Учитывается расписание класса и изменения на дату' : 'Дни недели без недельного расписания' }),
    hasSchedule ? null : dayChips, vacations,
    el('div', { class: 'row-item', style: 'padding-left:0;padding-right:0;border:0' }, [
      el('div', { class: 'label', text: 'Распределить темы КТП по порядку' }),
      autoTopics,
    ]),
    previewLine,
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Создать',
        onclick: async event => {
          const dates = plannedDates();
          if (!dates.length) { ui.toast('Выберите дни недели'); return; }
          const existing = new Set(store.lessonsOfClass(classId).map((l) => l.date));
          const fresh = dates.filter((d) => !existing.has(d));
          if (!fresh.length) { ui.toast('Все эти уроки уже есть'); return; }

          // Темы: берём только те, что относятся к КТП этого класса,
          // и продолжаем нумерацию с того места, где остановились.
          const existingLessons = store.lessonsOfClass(classId);
          const usedTopicIds = new Set(existingLessons.map((l) => l.topicId).filter(Boolean));
          const classTopics = store.topicsForClass(classId);

          const remaining = classTopics.filter(t => !usedTopicIds.has(t.id));
          const button = event.currentTarget; button.disabled = true;
          try {
            for (const [i,date] of fresh.entries()) {
              await store.addLesson(classId,date,withTopics ? remaining[i]?.id || null : null);
            }
          } catch (error) {
            button.disabled = false; updatePreview(); ui.toast(error.message); return;
          }
          ui.closeSheet();
          ui.toast(`Создано ${fresh.length} уроков`);
        },
      }),
    ]),
  ]);

  updatePreview();
  ui.openSheet(sheet);
}


export function openTrimesterLessons(classId) {
  const period=store.currentTrimester(), cls=store.state.classes.find(c=>c.id===classId);
  if(!period||!cls)return;
  const lessons=store.lessonsInRange(classId,period.from,period.to), topics=store.topicsForClass(classId);
  const title=id=>store.state.topics.find(t=>t.id===id)?.name||'Без темы';
  const date=el('input',{type:'date',min:period.from,max:period.to,value:period.from});
  const topic=el('select',{},[el('option',{value:'',text:'Без темы (назначить позже)'})]);
  for(const t of topics)topic.append(el('option',{value:t.id,text:t.ktpOrder+'. '+t.name}));
  const sheet=el('div',{class:'trimester-editor'},[
    el('h2',{text:'Уроки триместра'}),
    el('div',{class:'sub',text:M.displayClassName(cls.name)+' · '+M.fmtFull(period.from)+' — '+M.fmtFull(period.to)+' · '+lessons.length+' уроков'}),
    el('div',{class:'card-block'},[
      el('h3',{text:'Добавить пропущенный урок'}),
      el('label',{class:'field'},['Дата',date]),el('label',{class:'field'},['Тема КТП',topic]),
      el('button',{class:'btn primary wide',type:'button',text:'+ Добавить урок',onclick:async e=>{
        const value=date.value;
        if(!value||value<period.from||value>period.to)return ui.toast('Выберите дату внутри триместра');
        if(store.lessonsOfClass(classId).some(l=>l.date===value))return ui.toast('На эту дату урок уже существует');
        const button=e.currentTarget;button.disabled=true;
        try{await store.addLesson(classId,value,topic.value||null);ui.toast('Урок добавлен');openTrimesterLessons(classId);}
        catch(err){button.disabled=false;ui.toast(err.message);}
      }}),
    ]),
    el('button',{class:'btn wide',type:'button',text:'Создать уроки по расписанию',onclick:()=>openLessonPlanner(classId)}),
    el('button',{class:'btn wide',type:'button',text:'Исправить последовательность тем КТП',onclick:()=>openTopicRepair(classId,period)}),
    el('p',{class:'sub',text:'Измените дату или тему отдельного урока. При удалении темы остальных уроков не сдвигаются.'}),
  ]);
  const list=el('div',{class:'trimester-lesson-list'});
  for(const lesson of lessons){
    const count=store.state.marks.filter(m=>m.lessonId===lesson.id).length;
    list.append(el('div',{class:'trimester-lesson-row'},[
      el('span',{class:'class-name-pill',text:M.fmtShort(lesson.date)}),
      el('div',{class:'trimester-lesson-copy'},[el('strong',{text:title(lesson.topicId)}),el('small',{text:store.lessonHeld(lesson)?'Проведён · '+count+' отметок':count?count+' отметок':'Запланирован'})]),
      el('button',{class:'icon-btn plain',type:'button','aria-label':'Изменить урок '+M.fmtFull(lesson.date),title:'Изменить урок',onclick:()=>openLessonSheet(lesson.id,classId)},[icon('chevron')]),
      el('button',{class:'icon-btn plain',type:'button','aria-label':'Удалить урок '+M.fmtFull(lesson.date),title:'Удалить урок',onclick:async e=>{
        const button=e.currentTarget, marks=store.state.marks.filter(m=>m.lessonId===lesson.id).length, parts=store.state.participation.filter(p=>p.lessonId===lesson.id).length, results=store.state.normResults.filter(r=>r.lessonId===lesson.id).length;
        if(!await ui.confirmDialog({title:'Удалить урок '+M.fmtFull(lesson.date)+'?',text:'Отметки: '+marks+'; участие: '+parts+'; нормативы: '+results+'. Эти записи и история оценок будут удалены. Остальные темы останутся прежними.',ok:'Удалить',danger:true}))return;
        button.disabled=true;
        try{await store.deleteLesson(lesson.id);ui.toast('Урок удалён');openTrimesterLessons(classId);}
        catch(err){button.disabled=false;ui.toast(err.message);}
      }},[icon('trash')]),
    ]));
  }
  sheet.append(list);ui.openSheet(sheet);
}
function openTopicRepair(classId,period){
  const topics=store.topicsForClass(classId), planIds=new Set(topics.map(t=>t.ktpId||''));
  const start=el('input',{type:'date',min:period.from,max:period.to,value:period.from});
  const preview=el('div',{class:'trimester-lesson-list'});
  const apply=el('button',{type:'button',class:'btn primary wide',text:'Применить изменения',disabled:true});
  let changes=[];
  const title=id=>store.state.topics.find(t=>t.id===id)?.name||'Без темы';
  const refresh=()=>{
    preview.replaceChildren();changes=[];apply.disabled=true;
    if(!start.value||start.value<period.from||start.value>period.to)return;
    if(!topics.length||planIds.size!==1){preview.append(el('p',{text:'Для автоматической правки нужен один однозначный набор тем КТП. Измените темы вручную.'}));return;}
    const all=store.lessonsOfClass(classId);
    const eligible=all.filter(l=>l.date>=start.value&&l.date<=period.to&&M.canRepairLessonTopic(l,store.state.marks,store.state.participation,store.state.normResults));
    changes=M.planLessonTopicRepair(all,topics,eligible.map(l=>l.id));
    preview.append(el('p',{class:'sub',text:changes.length?'Изменится тем: '+changes.length+'. Заполненные уроки и ручные теги не изменятся.':'Нет тем, требующих изменения.'}));
    for(const c of changes)preview.append(el('div',{class:'trimester-lesson-row'},[
      el('span',{class:'class-name-pill',text:M.fmtShort(c.date)}),el('div',{class:'trimester-lesson-copy'},[el('small',{text:title(c.previous)}),el('strong',{text:'→ '+title(c.topicId)})]),
    ]));
    apply.disabled=!changes.length;
  };
  start.onchange=refresh;
  apply.onclick=async()=>{if(!changes.length)return;apply.disabled=true;try{await store.repairLessonTopics(classId,changes);ui.toast('Темы КТП обновлены');openTrimesterLessons(classId);}catch(err){ui.toast(err.message);refresh();}};
  const sheet=el('div',{class:'trimester-editor'},[
    el('h2',{text:'Исправление последовательности КТП'}),
    el('div',{class:'sub',text:'Выберите первую ошибочную дату. Свободные темы КТП распределятся по незаполненным урокам до конца триместра. Проверьте каждую строку.'}),
    el('label',{class:'field'},['Начать с даты',start]),preview,apply,
    el('button',{class:'btn wide',type:'button',text:'Назад без изменений',onclick:()=>openTrimesterLessons(classId)}),
  ]);
  refresh();ui.openSheet(sheet);
}
