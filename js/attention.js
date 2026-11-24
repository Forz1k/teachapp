import * as M from './model.js';
import {attendanceDetails} from './assessment.js';
export const taskLabels={lesson:'Уроки и журнал',review:'Проверка сведений',training:'Тренировки',goal:'Индивидуальные цели',match:'Матчи',custom:'Рабочие задачи',backup:'Резервное копирование'};
const item=(id,kind,title,detail,date,priority,target)=>({id,kind,title,detail,date,priority,target});
const dates=(a,b)=>a&&a>=b;
export function orderTasks(tasks){return tasks.slice().sort((a,b)=>b.priority-a.priority||a.date.localeCompare(b.date)||a.title.localeCompare(b.title,'ru')||a.id.localeCompare(b.id));}
export function schoolTasks(s,today=M.todayIso(),days=30){
 const from=M.addDays(today,-Math.min(90,Math.max(1,days))),until=M.addDays(today,7),year=s.settings.year;
 const classes=new Map(s.classes.map(c=>[c.id,c])),students=new Map(),marks=new Map(),parts=new Map(),existing=new Set(),tasks=[];
 for(const p of s.students){if(!students.has(p.classId))students.set(p.classId,[]);students.get(p.classId).push(p);}
 // Index only lessons in the review window, not the whole school year.
 const recent=new Set(s.lessons.filter(l=>M.inRange(l.date,from,today)&&M.inRange(l.date,year.from,year.to)&&classes.has(l.classId)).map(l=>l.id));
 for(const m of s.marks)if(recent.has(m.lessonId))marks.set(m.lessonId+'|'+m.studentId,m);
 for(const p of s.participation)if(recent.has(p.lessonId))parts.set(p.lessonId+'|'+p.studentId,p);
 const overridesByDate=new Map();
 for(const o of s.scheduleOverrides)if(M.inRange(o.date,from,today)){
  if(!overridesByDate.has(o.date))overridesByDate.set(o.date,[]);
  overridesByDate.get(o.date).push(o);
 }
 for(const l of s.lessons){
  existing.add(l.classId+'|'+l.date);
  if(!M.inRange(l.date,from,today)||!M.inRange(l.date,year.from,year.to)||!classes.has(l.classId))continue;
  const pupils=students.get(l.classId)||[];if(!pupils.length)continue;
  const a=attendanceDetails([l],pupils,marks,parts,today);
  if(a.held&&(a.unknown||!l.held))tasks.push(item('lesson-'+l.id,'lesson',classes.get(l.classId).name+' · '+(a.unknown?'не заполнена явка':'проверьте завершение урока'),(a.unknown?'Не отмечено: '+a.unknown+' из '+pupils.length+'. ':'')+(!l.held?'Нет явного подтверждения завершения.':''),l.date,a.unknown?3:2,{lessonId:l.id}));
  else if(!a.held&&l.date<today)tasks.push(item('lesson-'+l.id,'lesson',classes.get(l.classId).name+' · проверьте урок','Нет подтверждения проведения. Возможно, урок отменён.',l.date,2,{lessonId:l.id}));
 }
 // Only past scheduled days, respecting cancellations and holidays.
 for(let date=from;date<today;date=M.addDays(date,1)){
  if(!M.inRange(date,year.from,year.to)||(s.settings.holidays||[]).some(h=>M.inRange(date,h.from,h.to)))continue;
  for(const r of M.scheduleForDate(s.schedule,overridesByDate.get(date)||[],date)){
   const key=r.classId+'|'+date;if(existing.has(key)||!classes.has(r.classId)||!(students.get(r.classId)||[]).length)continue;
   existing.add(key);tasks.push(item('planned-'+key,'lesson',classes.get(r.classId).name+' · урок без записи','Урок был в расписании. Проверьте, состоялся ли он.',date,2,{classId:r.classId,date}));
  }
 }
 const pupilClass=new Map(s.students.map(p=>[p.id,p.classId]));
 const reviews=new Map();
 for(const [key,label] of [['exemptions','Освобождения'],['activityRestrictions','Ограничения'],['studentHealthProfiles','Группы здоровья']]){
  for(const r of s[key]||[]){
   const classId=pupilClass.get(key==='studentHealthProfiles'?r.id:r.studentId);
   if(!classId||!classes.has(classId)||r.enabled===false||!r.dateTo||!M.inRange(r.dateTo,today,until))continue;
   const id=key+'|'+classId,old=reviews.get(id)||{label,classId,count:0,date:r.dateTo};old.count++;if(r.dateTo<old.date)old.date=r.dateTo;reviews.set(id,old);
  }
 }
 for(const [id,r] of reviews)tasks.push(item('review-'+id,'review',classes.get(r.classId).name+' · '+r.label,'Истекают в ближайшие 7 дней: '+r.count,r.date,3,{classId:r.classId}));
 return orderTasks(tasks);
}
export function coachTasks(data,teamId,today=M.todayIso(),days=30){
 const from=M.addDays(today,-days),tasks=[];
 for(const t of data.coachTrainings.filter(t=>t.teamId===teamId&&M.inRange(t.date,from,today))){
  const missing=t.roster.filter(id=>!t.attendance[id]).length;
  if(!t.held&&t.date<today||t.held&&missing)tasks.push(item('training-'+t.id,'training',t.title,t.held?'Не отмечены игроки: '+missing:'Нет подтверждения проведения тренировки',t.date,t.held?3:2,{trainingId:t.id}));
 }
 for(const d of data.coachLive.filter(d=>d.teamId===teamId))tasks.push(item('match-'+d.id,'match','Незавершённый матч','Есть сохранённый черновик. Откройте и проверьте результат.',d.date||today,4,{draftId:d.id}));
 return orderTasks(tasks);
}
export function commonTasks(settings,events,today=M.todayIso()){
 const tasks=[];
 for(const e of events||[])if(!e.done&&e.date<=today)tasks.push(item('event-'+e.id,'custom',e.name,e.date<today?'Просрочено':'Запланировано на сегодня',e.date,e.date<today?3:1,{eventId:e.id,date:e.date}));
 const last=settings.lastBackupAt,postponed=settings.backupReminderAfter;
 const due=last&&Number.isFinite(Date.parse(last))?M.addDays(M.iso(new Date(last)),7):today;
 if(due<=today&&!(postponed&&Number.isFinite(Date.parse(postponed))&&M.iso(new Date(postponed))>today))tasks.push(item('backup','backup','Создать защищённую копию',last?'С последней подтверждённой копии прошло не менее 7 дней':'Копия ещё не подтверждена',today,2,{}));
 return orderTasks(tasks);
}

export function goalTasks(goals,teamId,today=M.todayIso()){
 const until=M.addDays(today,7);
 return orderTasks(goals.filter(g=>g.teamId===teamId&&g.status==='active'&&g.to<=until).map(g=>item('goal-'+g.id,'goal',g.name,g.to<today?'Срок цели истёк. Проверьте прогресс.':'Срок проверки цели в ближайшие 7 дней',g.to,g.to<today?3:2,{playerId:g.playerId})));
}

/** Search only display text; preserve the existing priority order. */
export function filterTasks(tasks,{kind='all',priority='all',query=''}={}){
 const normalize=s=>String(s||'').normalize('NFKC').toLocaleLowerCase('ru').trim().replace(/\s+/g,' ');
 const terms=normalize(query).split(' ').filter(Boolean);
 return tasks.filter(t=>(kind==='all'||t.kind===kind)&&(priority==='all'||t.priority>=Number(priority))&&terms.every(term=>normalize(t.title+' '+t.detail+' '+t.date).includes(term)));
}
