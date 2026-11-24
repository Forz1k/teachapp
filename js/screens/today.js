/* Дневной обзор. Не создаёт записи журнала до явного начала урока. */
import * as M from '../model.js';
import * as S from '../store.js';
import * as ui from '../ui.js';
import { openLessonSession } from './session.js';
import { warning } from './health.js';

import {schoolTasks,commonTasks} from '../attention.js';
import {attentionPanel} from './attention.js';
import {listWork} from '../workbench.js';
import {openWorkCalendar} from './work-calendar.js';
import {showLessonSession} from './session.js';
import {openInventory,openAchievements} from './resources.js';
import {openDocuments} from './documents.js';
import {openTournaments} from './tournaments.js';
import {calendarShortcut} from './work-calendar.js';
import {openLibrary} from './library.js';
import {metric,actionTile,dashboardHeading,lessonOverview} from '../dashboard.js';
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
  const body = el('div',{class:'today-list dashboard'});
  const summary=lessonOverview(rows,S.lessonHeld);
  body.append(el('div',{class:'dashboard-metrics'},[metric('Уроков в плане',summary.total,'calendar'),metric('Проведено',summary.done+' / '+summary.total,'check')]));
  const taskHolder=el('div',{class:'attention-holder'});
  const onTask=task=>{
    const t=task.target;
    if(task.kind==='lesson'){if(t.lessonId)showLessonSession(t.lessonId);else openLessonSession(t.classId,t.date);}
    else if(task.kind==='review'){S.state.currentClassId=t.classId;ui.closeSheet();ctx.onAnalytics?.();}
    else if(task.kind==='backup'){ui.closeSheet();ctx.onSettings?.();}
    else openWorkCalendar({date:t.date,source:'custom',span:'1'});
  };
  const tasks=schoolTasks(S.state,date);
  taskHolder.append(attentionPanel(tasks.concat(commonTasks(S.state.settings,[],date)),onTask));body.append(taskHolder);
  listWork('event').then(events=>{if(taskHolder.isConnected)taskHolder.replaceChildren(attentionPanel(tasks.concat(commonTasks(S.state.settings,events,date)),onTask));}).catch(()=>{});
  body.append(dashboardHeading('Уроки дня',summary.next?'Первый незавершённый урок выделен':'Все уроки завершены или нет расписания'));
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
    body.append(el('article',{class:'card-block today-card lesson-card'+(row===summary.next?' lesson-card-next':'')+(lesson&&S.lessonHeld(lesson)?' lesson-card-done':'')},[
      el('div',{class:'lesson-card-meta'},[el('span',{text:row.slot?'Урок '+row.slot+' · '+(row.time||'без времени'):'Вне расписания'}),el('span',{class:'status-pill',text:lesson&&S.lessonHeld(lesson)?'Проведён':row===summary.next?'К работе':'Запланирован'})]),
      el('h2',{text:cls.name}),
      el('div',{text:topics.get(lesson?.topicId)?.name || 'Тема КТП не указана'}),
      el('div',{class:'today-meta',text:'Отметки: '+filled+' из '+students.length+' · ОСВ: '+exempt}),
      warning(planned),
      button
    ]));
  }
  body.append(dashboardHeading('Быстрые действия'),el('div',{class:'dashboard-actions'},[
    ctx.onSchedule?actionTile('Расписание','calendar',ctx.onSchedule):null,
    ctx.onJournal?actionTile('Журнал','journal',ctx.onJournal):null,
    ctx.onNorms?actionTile('Нормативы','quick',ctx.onNorms):null,
    actionTile('Конспекты','classes',()=>openLibrary('school')),actionTile('Документы','journal',()=>openDocuments()),actionTile('Инвентарь','classes',openInventory),actionTile('Достижения','trophy',()=>openAchievements({area:'school'})),
    actionTile('Соревнования','trophy',openTournaments),
    ctx.onAnalytics?actionTile('Аналитика','chart',ctx.onAnalytics):null
  ]));
  calendarShortcut(body);
  root.append(body);
}
