import * as S from '../store.js';
import * as C from '../coach.js';
import * as M from '../model.js';
import * as W from '../workbench.js';
import {calendarEntries,dueReminders,timeConflicts,calendarIcs,eventTypes} from '../work-calendar.js';
import {el,openSheet,closeSheet,toast,confirmDialog,downloadBlob} from '../ui.js';
import {calendarMonth,dashboardHeading} from '../dashboard.js';
const p=text=>el('p',{text});
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]);
const inp=(value='',type='text',props={})=>el('input',{type,value,...props});
const select=(opts,value)=>{const n=el('select',{},opts.map(([v,text])=>el('option',{value:v,text})));n.value=value??opts[0]?.[0]??'';return n;};
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const stack=children=>el('div',{class:'coach-form'},children);
async function entries(from,to){const [coach,events,tournaments]=await Promise.all([C.loadCoach(),W.listWork('event'),W.listWork('tournament')]);return calendarEntries(S.state,coach,events,from,to,tournaments);}
function form(existing,date,back){
 const e=existing||{},name=inp(e.name||''),day=inp(e.date||date,'date'),time=inp(e.time||'','time'),duration=inp(e.minutes??0,'number',{min:0,max:600}),type=select(Object.entries(eventTypes),e.eventType||'task'),note=el('textarea',{maxlength:2000,rows:3},[e.note||'']),remind=select([['','Без напоминания'],['0','В момент события'],['15','За 15 минут'],['30','За 30 минут'],['60','За час'],['120','За 2 часа'],['1440','За день']],e.remind==null?'':String(e.remind)),done=el('input',{type:'checkbox'});done.checked=!!e.done;
 const save=btn('Сохранить',async()=>{save.disabled=true;try{await W.saveWork({id:e.id,kind:'event',name:name.value.trim(),date:day.value,time:time.value,minutes:Number(duration.value),eventType:type.value,note:note.value,remind:remind.value===''?null:Number(remind.value),done:done.checked});await back();}catch(err){toast(err.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:'Рабочее событие'}),field('Название',name),field('Дата',day),field('Время (необязательно)',time),field('Минуты (0 — не указаны)',duration),field('Тип',type),field('Примечание (без персональных данных)',note),field('Напомнить',remind),p('Без времени напоминание действует на день события или за день. Для фоновых уведомлений экспортируйте событие в календарь телефона.'),field('Выполнено',done),save,btn('Назад',back)]));
}
export async function openWorkCalendar(){
 const day=inp(M.todayIso(),'date'),span=select([['1','День'],['7','7 дней'],['14','14 дней'],['month','Месяц']],'7'),source=select([['all','Все'],['school','Уроки'],['coach','Волейбол'],['tournament','Турниры'],['custom','Свои события'],['review','Проверки'],['backup','Резервные копии']],'all'),titles=el('input',{type:'checkbox'}),body=el('div',{class:'coach-stack'});
 let sequence=0,visible=[];
 async function draw(){
  const seq=++sequence;try{
   visible=[];body.replaceChildren(p('Загрузка…'));
   const month=span.value==='month'?calendarMonth(day.value):null,from=month?.from||day.value,to=month?.to||M.addDays(from,Number(span.value)-1),all=await entries(from,to);if(seq!==sequence)return;
   visible=all.filter(e=>source.value==='all'||e.source===source.value);
   body.replaceChildren();
   if(month){const counts=new Map();for(const e of visible)counts.set(e.date,(counts.get(e.date)||0)+1);const grid=el('div',{class:'month-grid'},['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(t=>el('span',{class:'month-weekday',text:t})));for(let i=0;i<month.offset;i++)grid.append(el('span',{'aria-hidden':'true'}));for(const d of month.days){const n=counts.get(d)||0;grid.append(el('button',{type:'button',class:'month-day'+(d===M.todayIso()?' current':'')+(d===day.value?' selected':''),'aria-label':M.fmtFull(d)+' · событий '+n,onclick:()=>{day.value=d;span.value='1';draw();}},[el('strong',{text:String(Number(d.slice(-2)))}),el('small',{text:n?String(n):''})]));}body.append(el('div',{class:'card-block month-card'},[dashboardHeading('Месяц','Количество событий в каждом дне'),grid]));}
   const due=dueReminders(visible);if(due.length)body.append(card('Напоминания',due.map(e=>p(M.fmtFull(e.date)+' · '+e.title))));
   const conflicts=timeConflicts(all);if(conflicts.length)body.append(card('Возможные пересечения',conflicts.map(([a,b])=>p(M.fmtFull(a.date)+' · '+a.title+' / '+b.title))));
   let date='';
   for(const e of visible){
    if(date!==e.date){date=e.date;body.append(el('h3',{text:M.fmtFull(date)}));}
    body.append(el('article',{class:'card-block calendar-event event-'+e.source},[el('div',{class:'calendar-event-head'},[el('span',{class:'calendar-event-time',text:e.time||'Весь день'}),el('span',{class:'status-pill',text:e.done?'Выполнено':'Запланировано'})]),el('h3',{text:e.title}),p((e.done?'Выполнено':'Запланировано')+(e.minutes?' · '+e.minutes+' мин':'')+(e.remind===null?'':' · напоминание')),e.record?btn('Открыть / редактировать',()=>form(e.record,e.date,open)):null,e.record?btn(e.done?'Вернуть в задачи':'Отметить выполненным',async()=>{try{await W.saveWork({...e.record,done:!e.done});await draw();}catch(err){toast(err.message);}}):null,e.record?btn('Удалить событие',async()=>{if(!await confirmDialog({title:'Удалить событие?',text:'Удаляется только эта рабочая запись.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(e.id,'event');await draw();}catch(err){toast(err.message);}}):null]));
   }
   if(!visible.length)body.append(p('Событий за период нет.'));
  }catch(e){if(seq===sequence){visible=[];body.replaceChildren(p(e.message));}}
 }
 function move(direction){if(span.value==='month'){const d=M.parseIso(day.value);d.setDate(1);d.setMonth(d.getMonth()+direction);day.value=M.iso(d);}else day.value=M.addDays(day.value,direction*Number(span.value));draw();}
 function open(){openSheet(stack([el('h2',{text:'Рабочий календарь'}),el('div',{class:'coach-columns'},[field('Дата',day),field('Вид',span)]),el('div',{class:'calendar-nav'},[btn('‹ Назад',()=>move(-1)),btn('Сегодня',()=>{day.value=M.todayIso();draw();}),btn('Вперёд ›',()=>move(1))]),field('Источник',source),btn('+ Событие / задача',()=>form(null,day.value,open),'primary'),p('Уведомления TeachApp видны при открытом приложении. iPhone не гарантирует фоновые локальные уведомления от офлайн-PWA.'),field('Включить названия событий в экспорт (проверьте конфиденциальность)',titles),btn('Экспорт видимых событий .ics',()=>{if(!visible.some(e=>!e.done))return toast('Нет будущих или незавершённых событий');try{downloadBlob(new Blob([calendarIcs(visible,{includeTitles:titles.checked})],{type:'text/calendar;charset=utf-8'}),'teachapp-calendar.ics');}catch(e){toast(e.message);}}),body,btn('Закрыть',closeSheet)]));draw();}
 day.onchange=span.onchange=source.onchange=draw;open();
}
export function calendarShortcut(root){
 const node=el('section',{class:'card-block today-card'},[btn('Рабочий календарь и напоминания',openWorkCalendar,'primary')]);root.append(node);
 const today=M.todayIso();entries(M.addDays(today,-30),M.addDays(today,1)).then(all=>{const due=dueReminders(all);if(due.length)node.append(p('Актуальных напоминаний: '+due.length),...due.slice(0,3).map(e=>p(e.title)));}).catch(()=>{});
}
