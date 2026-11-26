import {openRetakePlans} from './school-tools.js';
import {openSchoolCompetitions} from './teacher-portfolio.js';
import {enterGroup} from '../motion.js';
import * as S from '../store.js';
import * as C from '../coach.js';
import * as M from '../model.js';
import * as W from '../workbench.js';
import {calendarEntries,dueReminders,timeConflicts,calendarIcs,eventTypes} from '../work-calendar.js';
import {portalInfo} from '../public-publisher.js';
import {el,openSheet,closeSheet,toast,confirmDialog,downloadBlob} from '../ui.js';
import {calendarMonth,dashboardHeading} from '../dashboard.js';
import {readReminderPreferences,saveReminderPreferences,reminderSources} from '../reminder-controller.js';
const p=text=>el('p',{text});
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]);
const inp=(value='',type='text',props={})=>el('input',{type,value,...props});
const select=(opts,value)=>{const n=el('select',{},opts.map(([v,text])=>el('option',{value:v,text})));n.value=value??opts[0]?.[0]??'';return n;};
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const stack=children=>el('div',{class:'coach-form'},children);
export async function calendarReminderEntries(from,to){const [coach,events,tournaments,competitions,retakes]=await Promise.all([C.loadCoach(),W.listWork('event'),W.listWork('tournament'),W.listWork('schoolCompetition'),W.listWork('normRetake')]);return calendarEntries(S.state,coach,events,from,to,tournaments,Object.fromEntries(coach.coachTeams.filter(t=>!t.archived).map(t=>[t.id,portalInfo(t.id).data])),competitions,retakes);}
function form(existing,date,back){
 const e=existing||{},name=inp(e.name||''),day=inp(e.date||date,'date'),time=inp(e.time||'','time'),duration=inp(e.minutes??0,'number',{min:0,max:600}),type=select(Object.entries(eventTypes),e.eventType||'task'),note=el('textarea',{maxlength:2000,rows:3},[e.note||'']),remind=select([['','Без напоминания'],['0','В момент события'],['15','За 15 минут'],['30','За 30 минут'],['60','За час'],['120','За 2 часа'],['1440','За день']],e.remind==null?'':String(e.remind)),done=el('input',{type:'checkbox'});done.checked=!!e.done;
 const save=btn('Сохранить',async()=>{save.disabled=true;try{await W.saveWork({id:e.id,kind:'event',name:name.value.trim(),date:day.value,time:time.value,minutes:Number(duration.value),eventType:type.value,note:note.value,remind:remind.value===''?null:Number(remind.value),done:done.checked});await back();}catch(err){toast(err.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:'Рабочее событие'}),field('Название',name),field('Дата',day),field('Время (необязательно)',time),field('Минуты (0 — не указаны)',duration),field('Тип',type),field('Примечание (без персональных данных)',note),field('Напомнить',remind),p('Без времени напоминание действует на день события или за день. Для фоновых уведомлений экспортируйте событие в календарь телефона.'),field('Выполнено',done),save,btn('Назад',back)]));
}
export async function openWorkCalendar(options={}){
 const day=inp(options.date||M.todayIso(),'date'),span=select([['1','День'],['7','7 дней'],['14','14 дней'],['month','Месяц']],['1','7','14','month'].includes(options.span)?options.span:'7'),source=select([['all','Все'],['school','Уроки'],['coach','Волейбол'],['tournament','Турниры'],['schoolCompetition','Олимпиады и соревнования'],['normRetake','Пересдачи'],['custom','Свои события'],['review','Проверки'],['backup','Резервные копии']],options.source||'all'),titles=el('input',{type:'checkbox'}),body=el('div',{class:'coach-stack'});
 let sequence=0,visible=[];
 let paintedRange='';
 let reminderPrompt=false;
 const reminderStatus=p(''),reminderOptions=el('div',{class:'coach-stack'}),reminderChecks=new Map();
 for(const [key,label] of Object.entries(reminderSources)){const n=el('input',{type:'checkbox','aria-label':'Напоминания: '+label});reminderChecks.set(key,n);reminderOptions.append(field(label,n));}
 const reminderOpen=()=>!!reminderStatus.closest('.sheet.show');
 const selectedSources=()=>[...reminderChecks].filter(([,n])=>n.checked).map(([k])=>k);
 function refreshReminderSettings(){const prefs=readReminderPreferences();for(const [key,n] of reminderChecks)n.checked=prefs.sources.includes(key);reminderStatus.textContent=prefs.enabled?(globalThis.Notification?.permission==='granted'?'Включены в открытом TeachApp.':'Включены в настройках, но разрешение браузера отсутствует.'):'Системные уведомления выключены.';}
 async function toggleReminders(){
  if(reminderPrompt||!reminderOpen())return;
  try{
   const prefs=readReminderPreferences();
   if(prefs.enabled){saveReminderPreferences({...prefs,enabled:false});refreshReminderSettings();return;}
   const sources=selectedSources();if(!sources.length)throw Error('Выберите хотя бы один источник');
   if(!globalThis.Notification?.requestPermission){reminderStatus.textContent='Браузер не поддерживает уведомления. Используйте экспорт .ics.';return;}
   reminderPrompt=true;const permission=await Notification.requestPermission();if(!reminderOpen())return;
   if(permission!=='granted'){reminderStatus.textContent='Разрешение не выдано. Экспорт .ics доступен.';return;}
   saveReminderPreferences({enabled:true,sources});refreshReminderSettings();
  }catch(e){reminderStatus.textContent=e.message;}finally{reminderPrompt=false;}
 }
 function saveSources(){try{const prefs=readReminderPreferences();saveReminderPreferences({enabled:prefs.enabled,sources:selectedSources()});refreshReminderSettings();}catch(e){reminderStatus.textContent=e.message;}}
 async function draw(){
  const seq=++sequence;try{
   visible=[];body.replaceChildren(p('Загрузка…'));
   const month=span.value==='month'?calendarMonth(day.value):null,from=month?.from||day.value,to=month?.to||M.addDays(from,Number(span.value)-1),all=await calendarReminderEntries(from,to);if(seq!==sequence)return;
   visible=all.filter(e=>source.value==='all'||e.source===source.value);
   body.replaceChildren();
   if(month){const counts=new Map();for(const e of visible)counts.set(e.date,(counts.get(e.date)||0)+1);const grid=el('div',{class:'month-grid'},['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(t=>el('span',{class:'month-weekday',text:t})));for(let i=0;i<month.offset;i++)grid.append(el('span',{'aria-hidden':'true'}));for(const d of month.days){const n=counts.get(d)||0;grid.append(el('button',{type:'button',class:'month-day'+(d===M.todayIso()?' current':'')+(d===day.value?' selected':''),'aria-label':M.fmtFull(d)+' · событий '+n,onclick:()=>{day.value=d;span.value='1';draw();}},[el('strong',{text:String(Number(d.slice(-2)))}),el('small',{text:n?String(n):''})]));}body.append(el('div',{class:'card-block month-card'},[dashboardHeading('Месяц','Количество событий в каждом дне'),grid]));}
   const due=dueReminders(visible);if(due.length)body.append(card('Напоминания',due.map(e=>p(M.fmtFull(e.date)+' · '+e.title))));
   const conflicts=timeConflicts(all);if(conflicts.length)body.append(card('Возможные пересечения',conflicts.map(([a,b])=>p(M.fmtFull(a.date)+' · '+a.title+' / '+b.title))));
   let date='';
   for(const e of visible){
    if(date!==e.date){date=e.date;body.append(el('h3',{text:M.fmtFull(date)}));}
    body.append(el('article',{class:'card-block calendar-event event-'+e.source},[el('div',{class:'calendar-event-head'},[el('span',{class:'calendar-event-time',text:e.time||'Весь день'}),el('span',{class:'status-pill',text:e.done?'Выполнено':'Запланировано'})]),el('h3',{text:e.title}),p((e.done?'Выполнено':'Запланировано')+(e.minutes?' · '+e.minutes+' мин':'')+(e.remind===null?'':' · напоминание')),e.competitionId?btn('Открыть мероприятия',()=>openSchoolCompetitions(open)):null,e.retakeId?btn('Открыть планы пересдач',()=>openRetakePlans(open)):null,e.record?btn('Открыть / редактировать',()=>form(e.record,e.date,open)):null,e.record?btn(e.done?'Вернуть в задачи':'Отметить выполненным',async()=>{try{await W.saveWork({...e.record,done:!e.done});await draw();}catch(err){toast(err.message);}}):null,e.record?btn('Удалить событие',async()=>{if(!await confirmDialog({title:'Удалить событие?',text:'Удаляется только эта рабочая запись.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(e.id,'event');await draw();}catch(err){toast(err.message);}}):null]));
   }
   if(!visible.length)body.append(p('Событий за период нет.'));
   const range=from+'|'+to+'|'+source.value;if(range!==paintedRange){paintedRange=range;enterGroup([...body.children].filter(n=>n.matches('.month-card,.calendar-event')));}
  }catch(e){if(seq===sequence){visible=[];body.replaceChildren(p(e.message));}}
 }
 function move(direction){if(span.value==='month'){const d=M.parseIso(day.value);d.setDate(1);d.setMonth(d.getMonth()+direction);day.value=M.iso(d);}else day.value=M.addDays(day.value,direction*Number(span.value));draw();}
 function open(){refreshReminderSettings();openSheet(stack([el('h2',{text:'Рабочий календарь'}),el('div',{class:'coach-columns'},[field('Дата',day),field('Вид',span)]),el('div',{class:'calendar-nav'},[btn('‹ Назад',()=>move(-1)),btn('Сегодня',()=>{day.value=M.todayIso();draw();}),btn('Вперёд ›',()=>move(1))]),field('Источник',source),btn('+ Событие / задача',()=>form(null,day.value,open),'primary'),p('Уведомления работают во всём открытом TeachApp, даже вне календаря. При скрытии данных или переходе в фон проверка приостанавливается. Фоновые уведомления не гарантируются: используйте .ics.'),btn('Включить / выключить системные напоминания',toggleReminders),reminderStatus,el('details',{},[el('summary',{text:'Источники уведомлений'}),reminderOptions,btn('Сохранить источники',saveSources)]),field('Включить названия событий в экспорт (проверьте конфиденциальность)',titles),btn('Экспорт видимых событий .ics',()=>{if(!visible.some(e=>!e.done))return toast('Нет будущих или незавершённых событий');try{downloadBlob(new Blob([calendarIcs(visible,{includeTitles:titles.checked})],{type:'text/calendar;charset=utf-8'}),'teachapp-calendar.ics');}catch(e){toast(e.message);}}),body,btn('Закрыть',closeSheet)]));draw();}
 day.onchange=span.onchange=source.onchange=draw;open();
}
export function calendarShortcut(root){
 const node=el('section',{class:'card-block today-card'},[btn('Рабочий календарь и напоминания',openWorkCalendar,'primary')]);root.append(node);
 const today=M.todayIso();calendarReminderEntries(M.addDays(today,-30),M.addDays(today,1)).then(all=>{const due=dueReminders(all);if(due.length)node.append(p('Актуальных напоминаний: '+due.length),...due.slice(0,3).map(e=>p(e.title)));}).catch(()=>{});
}
