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
  for (const t of store.state.topics) {
    const opt = el('option', { value: t.id, text: `${t.ktpOrder}. ${t.name}` });
    if (t.id === lesson.topicId) opt.selected = true;
    topicSelect.append(opt);
  }

  const noteInput = el('textarea', { placeholder: 'заметка к уроку (необязательно)' });
  noteInput.value = lesson.note || '';

  const sheet = el('div', {}, [
    el('h2', { text: 'Урок' }),
    el('div', { class: 'sub', text: M.fmtFull(lesson.date) }),
    el('label', { class: 'field' }, [el('span', { text: 'Дата' }), dateInput]),
    el('label', { class: 'field' }, [el('span', { text: 'Тема по КТП' }), topicSelect]),
    el('label', { class: 'field' }, [el('span', { text: 'Заметка' }), noteInput]),
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
            date: newDate,
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
  const selectedDays = new Set([2, 4]); // вт, чт
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
    const from = fromInput.value, to = toInput.value;
    if (!from || !to || from > to) return [];
    const out = [];
    const d = M.parseIso(from);
    const end = M.parseIso(to);
    let guard = 0;
    while (d <= end && guard++ < 400) {
      if (selectedDays.has(d.getDay())) out.push(M.iso(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
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

  const sheet = el('div', {}, [
    el('h2', { text: 'Уроки по расписанию' }),
    el('div', { class: 'sub', text: cls ? cls.name : '' }),
    el('label', { class: 'field' }, [el('span', { text: 'С даты' }), fromInput]),
    el('label', { class: 'field' }, [el('span', { text: 'По дату' }), toInput]),
    el('div', { class: 'sub', style: 'margin-bottom:0', text: 'Дни недели' }),
    dayChips,
    el('div', { class: 'row-item', style: 'padding-left:0;padding-right:0;border:0' }, [
      el('div', { class: 'label', text: 'Распределить темы КТП по порядку' }),
      autoTopics,
    ]),
    previewLine,
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Создать',
        onclick: async () => {
          const dates = plannedDates();
          if (!dates.length) { ui.toast('Выберите дни недели'); return; }
          const existing = new Set(store.lessonsOfClass(classId).map((l) => l.date));
          const fresh = dates.filter((d) => !existing.has(d));
          if (!fresh.length) { ui.toast('Все эти уроки уже есть'); return; }

          // Темы: продолжаем нумерацию с того места, где остановились
          const existingLessons = store.lessonsOfClass(classId);
          const usedTopicIds = new Set(existingLessons.map((l) => l.topicId).filter(Boolean));
          let topicCursor = store.state.topics.findIndex((t) => !usedTopicIds.has(t.id));
          if (topicCursor < 0) topicCursor = 0;

          for (const date of fresh) {
            let topicId = null;
            if (withTopics && store.state.topics.length) {
              topicId = store.state.topics[topicCursor % store.state.topics.length].id;
              topicCursor += 1;
            }
            await store.addLesson(classId, date, topicId);
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
