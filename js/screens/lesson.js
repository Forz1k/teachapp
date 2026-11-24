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
            text: marksCount
              ? `Вместе с уроком удалятся ${marksCount} отметок учеников. Это необратимо.`
              : 'Урок будет удалён. Это необратимо.',
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

  const vacations = el('div',{class:'card-block'});
  const holidayFrom = el('input',{type:'date'}), holidayTo = el('input',{type:'date'});
  function showHolidays() {
    vacations.replaceChildren(el('h3',{text:'Каникулы для всех классов'}));
    for (const h of settings.holidays || []) vacations.append(el('button',{class:'btn',type:'button',
      text:M.fmtFull(h.from) + ' — ' + M.fmtFull(h.to) + ' · удалить',onclick:() => saveHolidays(settings.holidays.filter(x => x !== h))}));
    vacations.append(el('label',{class:'field'},['Начало каникул',holidayFrom]),el('label',{class:'field'},['Окончание каникул',holidayTo]),
      el('button',{type:'button',class:'btn',text:'Добавить каникулы',onclick:() => {
        const from = holidayFrom.value, to = holidayTo.value;
        if (!from || !to || from > to) return ui.toast('Проверьте даты каникул');
        saveHolidays([...(settings.holidays || []),{from,to}]);
      }}));
  }
  async function saveHolidays(holidays) {
    try { await store.saveSettings({holidays}); settings.holidays = holidays; showHolidays(); updatePreview(); }
    catch (error) { ui.toast(error.message); }
  }
  showHolidays();
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
