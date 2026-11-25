import {openSchoolCompetitions,openTeacherPortfolio} from './teacher-portfolio.js';
import {openAssistant} from './assistant.js';
import {openBriefings,openGymBoards} from './methodical.js';
/* Дневной обзор. Не создаёт записи журнала до явного начала урока. */
import * as M from '../model.js';
import * as S from '../store.js';
import * as ui from '../ui.js';
import { openLessonSession } from './session.js';
import { warning, openHealth, openLessonRestrictions } from './health.js';
import {types} from '../health.js';
import {lessonPreparation} from '../school-review.js';
import { openEditExemption } from './exemptions.js';

import {schoolTasks,commonTasks} from '../attention.js';
import {attentionPanel} from './attention.js';
import {listWork,lessonPlanReview,phases} from '../workbench.js';
import {openWorkCalendar} from './work-calendar.js';
import {showLessonSession} from './session.js';
import {openInventory,openAchievements} from './resources.js';
import {openDocuments} from './documents.js';
import {openTournaments} from './tournaments.js';
import {calendarShortcut} from './work-calendar.js';
import {openLibrary} from './library.js';
import {openSchoolWorkload,openSchoolPeriodCenter} from './school-review.js';
import {openDebtCenter} from './school-tools.js';
import {metric,actionTile,dashboardHeading,personalizedActions,dayReview,dayDataIndex,focusHero,animateDashboard} from '../dashboard.js';
const {el} = ui;

export function todayEntries(date = M.todayIso()) {
  const classes = new Map(S.state.classes.map(c => [c.id,c]));
  const lessons = S.state.lessons.filter(l=>l.date===date);
  const holiday = (S.state.settings.holidays || []).some(h => M.inRange(date,h.from,h.to));
  const schedule = holiday ? [] : S.scheduleForDate(date).filter(r => classes.has(r.classId));
  const mapped=M.matchScheduledLessons(schedule,lessons),scheduled=new Set([...mapped.values()].map(l=>l.id));
  const originallyScheduled = new Set(S.state.schedule.filter(r => r.weekday === M.weekdayOf(date)).map(r => r.classId));
  const rows = schedule.map(r=>({...r,cls:classes.get(r.classId),lesson:mapped.get(r.id)}));
  for(const lesson of lessons){const {classId}=lesson;
    if(classes.has(classId)&&!scheduled.has(lesson.id)&&(S.lessonHeld(lesson)||(!holiday&&(!originallyScheduled.has(classId)||lesson.slot!=null)))){
      rows.push({id:lesson.id,classId,cls:classes.get(classId),lesson,slot:lesson.slot??null,time:lesson.time||''});
    }
  }
  return rows;
}

/** Open a fresh list of the records behind an expiry warning, not a stale snapshot. */
export function openReviewTask(target,date=M.todayIso()) {
  const {classId,reviewType}=target;
  const labels={exemptions:'Освобождения',activityRestrictions:'Ограничения',studentHealthProfiles:'Группы здоровья'};
  const cls=S.state.classes.find(c=>c.id===classId);
  if(!cls||!Object.hasOwn(labels,reviewType))return ui.toast('Задача больше не актуальна');
  const students=new Map(S.studentsOfClass(classId).map(s=>[s.id,s]));
  const until=M.addDays(date,7);
  const rows=(S.state[reviewType]||[]).filter(r=>students.has(reviewType==='studentHealthProfiles'?r.id:r.studentId)&&r.enabled!==false&&r.dateTo&&M.inRange(r.dateTo,date,until)).sort((a,b)=>a.dateTo.localeCompare(b.dateTo));
  const sheet=el('div',{},[el('h2',{text:cls.name+' · '+labels[reviewType]}),el('p',{text:'Сведения с окончанием срока в ближайшие 7 дней. Проверьте основания перед изменением.'})]);
  if(!rows.length)sheet.append(el('p',{class:'empty',text:'Нет актуальных записей для проверки.'}));
  for(const r of rows){
    const id=reviewType==='studentHealthProfiles'?r.id:r.studentId;
    const detail=reviewType==='activityRestrictions'?(S.activities().find(a=>a.id===r.activityId)?.name||'Нагрузка'):reviewType==='studentHealthProfiles'?(r.group||'Группа'):'Освобождение';
    sheet.append(el('button',{type:'button',class:'btn wide',text:students.get(id).fullName+' · '+detail+' · до '+M.fmtFull(r.dateTo),onclick:()=>reviewType==='exemptions'?openEditExemption(r.id,classId):openHealth(id)}));
  }
  ui.openSheet(sheet);
}

/** Private read-only preparation for the selected slot. Keep the target
 * identity, not an old lesson object, so a changed schedule cannot open the
 * wrong lesson. Only the explicit open action may create a journal row. */
export async function openDayPreparation(target,date=M.todayIso()){
 try{
  const [assignments,allPlans]=await Promise.all([listWork('normAssignment'),listWork('plan')]);
  const plans=allPlans.filter(p=>p.context==='school').sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  const getRow=()=>todayEntries(date).find(r=>r.id===target.id&&r.classId===target.classId&&r.slot===target.slot);
  const row=getRow();if(!row)return ui.toast('Расписание изменилось. Выберите урок заново.');
  const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
  const p=text=>el('p',{text});
  const card=(title,...children)=>el('section',{class:'card-block'},[el('h3',{text:title}),...children]);
  const select=el('select',{'aria-label':'Конспект для подготовки'},[['','Без конспекта'],...plans.map(p=>[p.id,p.name+' · '+p.minutes+' мин'])].map(([value,text])=>el('option',{value,text})));
  const view=el('div',{class:'coach-stack','aria-live':'polite'}),back=()=>openDayPreparation(target,date);
  const open=btn('Открыть урок',async()=>{
   const r=getRow();if(!r)return ui.toast('Расписание изменилось. Выберите урок заново.');
   if(r.lesson)return showLessonSession(r.lesson.id);
   await openLessonSession(r.classId,date,{slot:r.slot??null,time:r.time||''});
  },'primary');
  const draw=()=>{try{
   const r=getRow();if(!r){open.disabled=true;view.replaceChildren(p('Расписание изменилось. Выберите урок заново.'));return;}
   const lesson=r.lesson||{classId:r.classId,date,slot:r.slot??null,time:r.time||''};
   const prep=lessonPreparation(S.state,lesson,{assignments}),names=new Map(prep.pupils.map(p=>[p.id,p.fullName])),activity=new Map(prep.activities.map(a=>[a.id,a.name]));
   const name=id=>names.get(id)||'Ученик',tag=id=>activity.get(id)||'Неизвестная категория';
   const restriction=(r,prefix='')=>p(prefix+name(r.studentId)+' · '+tag(r.activityId)+' · '+(types[r.type]||'Проверить'));
   const unique=rows=>[...new Set(rows.map(m=>m.studentId))].length;
   const selected=plans.find(p=>p.id===select.value);
   const plan=selected?lessonPlanReview(selected,lesson,{students:prep.pupils,activities:prep.activities,restrictions:S.state.activityRestrictions,exemptions:S.state.exemptions}):null;
   view.replaceChildren(card('Урок и состав',p(prep.cls.name+' · '+M.lessonLabel(lesson)),p(prep.topic?.name||'Тема КТП не назначена'),p('Ученики: '+prep.pupils.length+' · '+(r.lesson?'запись урока существует':'запись урока ещё не создана')),p('Подтверждённые категории урока: '+(!prep.needsReview||lesson.activitiesConfirmed!==false&&prep.lesson.activityIds?.length?((prep.lesson.activityIds||[]).map(tag).join(', ')||'нет'):'не указаны'))),
    card('Нагрузки и ограничения',p('ОСВ: '+prep.full.length+' · совпадения: '+unique(prep.matches)+' · возможные: '+unique(prep.potentialMatches)),
     p('Проверка только по внесённым сведениям на дату урока. Отсутствие совпадений не означает допуск.'),
     ...prep.reviewReasons.map(p),...prep.full.map(id=>p(name(id)+' · документальное освобождение')),
     ...prep.profiles.map(r=>p(name(r.id)+' · группа: '+r.group)),
     ...prep.matches.map(m=>restriction(m.restriction,'Совпадение: ')),
     ...prep.potentialMatches.map(m=>restriction(m.restriction,'Возможное ограничение: ')),
     prep.otherRestrictions.length?p('Другие действующие ограничения (не сопоставлены с выбранными категориями):'):null,...prep.otherRestrictions.map(r=>restriction(r)),
     btn('Проверить ограничения подробно',()=>{const fresh=getRow();if(!fresh)return ui.toast('Расписание изменилось');openLessonRestrictions(fresh.lesson||{classId:fresh.classId,date,slot:fresh.slot??null,time:fresh.time||''},undefined,back);})),
    card('Назначенные нормативы',p('Только назначения текущего учебного года, без автоматического назначения нормативов или освобождений.'),
     ...prep.norms.map(n=>p(n.name+' · срок '+M.fmtFull(n.to)+' · '+(n.state==='unavailable'?'назначение недоступно':(n.due?'срок наступил':'ещё выполняется')+' · ожидают: '+n.pending+' · проверить основания: '+n.review))),
     !prep.norms.length?p('Нет открытых замечаний по назначенным нормативам.'):null,btn('Центр задолженностей',()=>openDebtCenter(back))),
    card('Выбранный конспект',plan?p('Цель: '+(selected.goal||'не указана')+' · упражнения: '+plan.minutes+' / '+selected.minutes+' мин'):p('Выберите конспект выше для проверки упражнений.'),
     plan?p('Инвентарь по конспекту: '+(selected.equipment||'не указан')+'; фактическую доступность проверьте отдельно.'):null,
     ...(plan?(selected.resources||[]).map(r=>p(r.name+' · '+r.qty+' '+r.unit)):[]),
     ...(plan?plan.items.map(({item,matches,potentialMatches,needsReview})=>card(phases[item.phase]+' · '+item.exercise.name+' · '+item.minutes+' мин',
      p(item.exercise.description||''),needsReview?p('Уточнить нагрузку'):null,...matches.map(m=>restriction(m.restriction,'Совпадение: ')),...potentialMatches.map(m=>restriction(m.restriction,'Возможное ограничение: ')),
      !needsReview&&!matches.length?p('По внесённым категориям совпадений не найдено.'):null)):[]),
     plan?p('Конспект не назначен уроку автоматически; проверьте его самостоятельно.'):null));
   open.disabled=date>M.todayIso()||!prep.pupils.length;
  }catch(e){open.disabled=true;view.replaceChildren(p(e.message));}};
  select.onchange=draw;draw();
  ui.openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Подготовка к уроку'}),p('Просмотр не создаёт запись в журнале и не изменяет оценки, нагрузку или конспекты.'),el('label',{class:'field'},[el('span',{text:'Конспект для просмотра'}),select]),view,open,btn('Закрыть',ui.closeSheet)]),{fullHeight:true});
 }catch(e){ui.toast(e.message);}
}

export function renderToday(root,ctx = {},date = M.todayIso()) {
  root.append(el('div',{class:'topbar'},[
    el('div',{class:'topbar-row'},[el('h1',{text:'Сегодня'}),ctx.onCoach?el('button',{class:'btn small',type:'button',text:'Волейбол',onclick:ctx.onCoach}):null]),
    el('div',{class:'subtitle',text:M.weekdayFull(M.weekdayOf(date))+' · '+M.fmtFull(date)})
  ]));
  const rows = todayEntries(date);
  const body = el('div',{class:'today-list dashboard'});
  const index=dayDataIndex(S.state,rows,date),review=dayReview(rows,index.attendance),summary={total:rows.length};
  body.append(el('div',{class:'dashboard-metrics day-metrics'},[metric('Уроков в плане',summary.total,'calendar'),metric('Подтверждено',review.confirmed+' / '+summary.total,'check'),metric('Проверить явку',review.review,'journal')]));
  const taskHolder=el('div',{class:'attention-holder'});
  const onTask=task=>{
    const t=task.target;
    if(task.kind==='lesson'){if(t.lessonId)showLessonSession(t.lessonId);else openLessonSession(t.classId,t.date,{slot:t.slot??null,time:t.time||''});}
    else if(task.kind==='review'){openReviewTask(t,date);}
    else if(task.kind==='backup'){ui.closeSheet();ctx.onSettings?.();}
    else openWorkCalendar({date:t.date,source:'custom',span:'1'});
  };
  body.append(el('button',{type:'button',class:'btn wide',text:'TeachApp Assistant',onclick:()=>openAssistant({area:'school',state:S.state,onTask,date})}));
  const tasks=schoolTasks(S.state,date);
  taskHolder.append(attentionPanel(tasks.concat(commonTasks(S.state.settings,[],date)),onTask));body.append(taskHolder);
  listWork('event').then(events=>{if(taskHolder.isConnected)taskHolder.replaceChildren(attentionPanel(tasks.concat(commonTasks(S.state.settings,events,date)),onTask));}).catch(()=>{});
  const next=review.next?.row;
  const openRow=async row=>{const current=todayEntries(date).find(r=>r.id===row.id&&r.classId===row.classId);if(!current)return ui.toast('Расписание изменилось. Проверьте урок.');S.state.currentClassId=row.classId;if(current.lesson)return showLessonSession(current.lesson.id);await openLessonSession(row.classId,date,{slot:row.slot??null,time:row.time||''});};
  const hero=focusHero({eyebrow:next?'Следующий урок к работе':'Рабочий день',title:next?next.cls.name:summary.total?'Уроки подтверждены':'Нет уроков в расписании',subtitle:next?(next.time||'Без времени')+' · '+(S.state.topics.find(t=>t.id===next.lesson?.topicId)?.name||'Тема КТП не указана'):review.review?'Проверьте неизвестную явку':summary.total?'Все занятия подтверждены':'На выбранную дату',glyph:'calendar',progress:{label:'Подтверждено уроков',done:review.confirmed,total:summary.total},action:next?el('button',{type:'button',class:'btn wide focus-action',text:next.lesson?'Продолжить урок':'Открыть урок',onclick:()=>openRow(next)}):null});
  body.prepend(hero);
  if(next)hero.after(el('button',{type:'button',class:'btn wide',text:'Подготовить следующий урок',onclick:()=>openDayPreparation(next,date)}));
  body.append(dashboardHeading('Уроки дня','Подтверждение проведения и фактические отметки учитываются отдельно'));
  const filter=el('select',{'aria-label':'Статус уроков'},[['all','Все уроки'],['work','Не завершены'],['review','Проверить явку'],['done','Завершены']].map(([value,text])=>el('option',{value,text})));
  const list=el('div',{class:'day-lesson-list'}),empty=el('p',{class:'profile-note',text:'Нет уроков по выбранному статусу.'});body.append(filter,list,empty);
  filter.onchange=()=>{let count=0;for(const n of list.children){const status=n.dataset.dayStatus;n.hidden=filter.value!=='all'&&(filter.value==='work'?!['planned','unfinished'].includes(status):status!==filter.value);if(!n.hidden)count++;}empty.hidden=count>0;};
  if (!rows.length) empty.textContent='На выбранный день нет запланированных уроков.';
  const topics = new Map(S.state.topics.map(t => [t.id,t]));
  const marks = index.byLesson;
  for (const item of review.items) {
    const {row,status,attendance}=item,{cls,lesson,classId} = row;
    const students = index.students.get(classId)||[];
    const byStudent = marks.get(lesson?.id) || new Map();
    const filled = students.filter(s => byStudent.has(s.id)).length;
    const exempt = students.filter(s => M.hasOsv(byStudent.get(s.id)) || index.exempt.has(s.id)).length;
    const planned = lesson || {classId,date,slot:row.slot??null,time:row.time||''};
    const button = el('button',{type:'button',class:'btn primary wide',text:lesson?(lesson.held?'Открыть урок':'Продолжить урок'):'Начать урок',onclick:async () => {
      button.disabled = true;
      try {
        await openRow(row);
      } finally { button.disabled = false; }
    }});
    list.append(el('article',{class:'card-block today-card lesson-card'+(row===next?' lesson-card-next':'')+(status==='done'?' lesson-card-done':''),'data-day-status':status},[
      el('div',{class:'lesson-card-meta'},[el('span',{text:row.slot?'Урок '+row.slot+' · '+(row.time||'без времени'):'Вне расписания'}),el('span',{class:'status-pill',text:({planned:'Запланирован',unfinished:'Не подтверждён',review:'Проверить явку',done:'Проведён'})[status]})]),
      el('h2',{text:cls.name}),
      el('div',{text:topics.get(lesson?.topicId)?.name || 'Тема КТП не указана'}),
      el('div',{class:'today-meta',text:'Отметки: '+filled+' из '+students.length+' · ОСВ: '+exempt+(lesson&&attendance.held?' · явка неизвестна: '+attendance.unknown:'')}),
      warning(planned),
      el('button',{type:'button',class:'btn wide',text:'Подготовка к уроку',onclick:()=>openDayPreparation(row,date)}),
      button
    ]));
  }
  filter.onchange();
  body.append(dashboardHeading('Быстрые действия'),personalizedActions('school',[
    ctx.onSchedule?actionTile('Расписание','calendar',ctx.onSchedule):null,
    ctx.onJournal?actionTile('Журнал','journal',ctx.onJournal):null,
    ctx.onNorms?actionTile('Нормативы','quick',ctx.onNorms):null,
    actionTile('Конспекты','classes',()=>openLibrary('school')),actionTile('Документы','journal',()=>openDocuments()),actionTile('Инвентарь','classes',openInventory),actionTile('Достижения','trophy',()=>openAchievements({area:'school'})),
    actionTile('Соревнования','trophy',openTournaments),actionTile('Олимпиады','trophy',()=>openSchoolCompetitions()),actionTile('Портфолио учителя','journal',()=>openTeacherPortfolio()),actionTile('Инструктажи','journal',openBriefings),actionTile('Схемы зала','classes',openGymBoards),actionTile('Педагогическая нагрузка','calendar',openSchoolWorkload),actionTile('Закрытие периода','journal',()=>openSchoolPeriodCenter()),actionTile('Центр задолженностей','journal',()=>openDebtCenter()),
    ctx.onAnalytics?actionTile('Аналитика','chart',ctx.onAnalytics):null
  ]));
  calendarShortcut(body);
  root.append(body);if(root.classList.contains('route-enter'))requestAnimationFrame(()=>animateDashboard(body));
}
