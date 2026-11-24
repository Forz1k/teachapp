/* Дневной обзор. Не создаёт записи журнала до явного начала урока. */
import * as M from '../model.js';
import * as S from '../store.js';
import * as ui from '../ui.js';
import { openLessonSession } from './session.js';
import { warning } from './health.js';

import {openLibrary} from './library.js';
const {el} = ui;

export function todayEntries(date = M.todayIso()) {
  const classes = new Map(S.state.classes.map(c => [c.id,c]));
  const lessons = new Map(S.state.lessons.filter(l => l.date === date).map(l => [l.classId,l]));
  const holiday = (S.state.settings.holidays || []).some(h => M.inRange(date,h.from,h.to));
  const schedule = holiday ? [] : S.scheduleForDate(date).filter(r => classes.has(r.classId));
  const scheduled = new Set(schedule.map(r => r.classId));
  const originallyScheduled = new Set(S.state.schedule.filter(r => r.weekday === M.weekdayOf(date)).map(r => r.classId));
  const rows = schedule.map(r => ({...r,cls:classes.get(r.classId),lesson:lessons.get(r.classId)}));
  for (const [classId,lesson] of lessons) {
    if (classes.has(classId) && !scheduled.has(classId) &&
        (S.lessonHeld(lesson) || (!holiday && !originallyScheduled.has(classId)))) {
      rows.push({id:lesson.id,classId,cls:classes.get(classId),lesson,slot:null,time:''});
    }
  }
  return rows;
}

export function renderToday(root,ctx = {},date = M.todayIso()) {
  root.append(el('div',{class:'topbar'},[
    el('div',{class:'topbar-row'},[el('h1',{text:'Сегодня'}),ctx.onCoach?el('button',{class:'btn small',type:'button',text:'Волейбол',onclick:ctx.onCoach}):null]),
    el('div',{class:'subtitle',text:M.weekdayFull(M.weekdayOf(date))+' · '+M.fmtFull(date)})
  ]));
  const rows = todayEntries(date);
  const body = el('div',{class:'today-list'});
  if (!rows.length) body.append(el('div',{class:'empty',text:'На сегодня нет запланированных уроков.'}));
  const topics = new Map(S.state.topics.map(t => [t.id,t]));
  const marks = new Map();
  for (const m of S.state.marks) {
    if (!marks.has(m.lessonId)) marks.set(m.lessonId,new Map());
    marks.get(m.lessonId).set(m.studentId,m);
  }
  for (const row of rows) {
    const {cls,lesson,classId} = row;
    const students = S.studentsOfClass(classId);
    const byStudent = marks.get(lesson?.id) || new Map();
    const filled = students.filter(s => byStudent.has(s.id)).length;
    const exempt = students.filter(s => M.hasOsv(byStudent.get(s.id)) || S.activeExemption(s.id,date)).length;
    const planned = lesson || {classId,date};
    const button = el('button',{type:'button',class:'btn primary wide',text:'Начать урок',onclick:async () => {
      button.disabled = true;
      try {
        if (!todayEntries(date).some(r => r.id === row.id && r.classId === classId)) return ui.toast('Расписание изменилось. Проверьте урок.');
        S.state.currentClassId = classId;
        await openLessonSession(classId,date);
      } finally { button.disabled = false; }
    }});
    body.append(el('article',{class:'card-block today-card'},[
      el('div',{class:'today-meta',text:row.slot ? 'Урок '+row.slot+' · '+(row.time || 'время не указано') : 'Вне расписания'}),
      el('h2',{text:cls.name}),
      el('div',{text:topics.get(lesson?.topicId)?.name || 'Тема КТП не указана'}),
      el('div',{class:'today-meta',text:'Отметки: '+filled+' из '+students.length+' · ОСВ: '+exempt}),
      warning(planned),
      button
    ]));
  }
  if (ctx.onSchedule) body.append(el('button',{type:'button',class:'btn wide',text:'Открыть расписание',onclick:ctx.onSchedule}));
  body.append(el('button',{type:'button',class:'btn wide',text:'Библиотека и конспекты',onclick:()=>openLibrary('school')}));
  root.append(body);
}
