import * as S from '../store.js';
import * as M from '../model.js';
import {periodName} from '../assessment.js';
import {workloadReview,periodReview,ktpForecast,ktpRedistribution} from '../school-review.js';
import {listWork} from '../workbench.js';
import {openDocumentPreview} from './documents.js';
import {openLessonPlanner} from './lesson.js';
import {el,openSheet,closeSheet,toast,confirmDialog} from '../ui.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const field=(text,node)=>el('label',{class:'field'},[el('span',{text}),node]);
const select=(rows,value)=>{const n=el('select',{},rows.map(([value,text])=>el('option',{value,text})));if(value!=null)n.value=value;return n;};
const card=(title,...children)=>el('section',{class:'card-block'},[el('h3',{text:title}),...children]);
const matrixTable=matrix=>el('div',{class:'analytics-table'},[el('table',{},[el('thead',{},[el('tr',{},matrix[0].map(v=>el('th',{text:v})))]),el('tbody',{},matrix.slice(1).map(r=>el('tr',{},r.map(v=>el('td',{text:v??'—'})))) )])]);
const report=(title,matrix,paragraphs=[],personal=false)=>({title,personal,sections:[{heading:'Сводка',paragraphs,matrix}]});
const countLabels={template:'По недельному шаблону',planned:'По действующему расписанию',confirmed:'Явно подтверждено',inferred:'Есть фактические записи, нет подтверждения',missing:'Запланировано, нет записи',unconfirmed:'Создано, не проведено / не подтверждено',cancelled:'Отменено / исключено',added:'Добавлено в расписание',substitutions:'Замещения класса',extra:'Проведено вне расписания'};
export async function openSchoolWorkload(){
 try{
 const events=await listWork('event'),today=M.todayIso(),period=S.currentTrimester(),from=el('input',{type:'date',value:period.from}),to=el('input',{type:'date',value:period.to}),view=el('div',{class:'coach-stack'});
 function draw(){try{
  const a=workloadReview(S.state,{from:from.value,to:to.value,today,events}),summary=Object.entries(countLabels).map(([k,label])=>[label,a.total[k]]),matrix=[['Показатель','Уроков'],...summary];
  const days=[['Дата','План','Подтверждено','Есть записи','Без записи','Отменено','Внеплановые'],...a.rows.map(r=>[r.date,r.planned,r.confirmed,r.inferred,r.missing,r.cancelled,r.extra])];
  const extra=[['Дата','Мероприятие','Минуты','Выполнено'],...a.additional.map(r=>[r.date,r.name,r.minutes,r.done?'Да':'Нет'])];
  const r={title:'Учёт педагогической нагрузки · '+from.value+' — '+to.value,personal:false,sections:[{heading:'Итог',paragraphs:['Количество уроков, не табель оплаты. Подтверждение проведения отличается от наличия отметок.'],matrix},{heading:'По дням',paragraphs:[],matrix:days},{heading:'Дополнительные события календаря',paragraphs:['Минуты учитываются отдельно от академических уроков.'],matrix:extra}]};
  view.replaceChildren(card('Итог за период',...summary.map(([label,n])=>p(label+': '+n))),card('По дням',matrixTable(days)),card('Дополнительные мероприятия',matrixTable(extra)),btn('Word / Excel / PDF',()=>openDocumentPreview(r,openSchoolWorkload),'primary'));
 }catch(e){view.replaceChildren(p(e.message));}}
 const presets=el('div',{class:'preset-chips'},[['Неделя',M.addDays(today,-6),today],['Месяц',today.slice(0,7)+'-01',today],['Период',period.from,period.to],['Учебный год',S.state.settings.year.from,S.state.settings.year.to]].map(([label,a,b])=>btn(label,()=>{from.value=a;to.value=b;draw();})));
 from.onchange=to.onchange=draw;draw();openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Педагогическая нагрузка'}),p('Отдельно считаются расписание, подтверждённые уроки, записи без подтверждения и дополнительные события.'),presets,field('С даты',from),field('По дату',to),view,btn('Закрыть',closeSheet)]),{fullHeight:true});
 }catch(e){toast(e.message);}
}
export async function openPeriodReview(initialClass=S.state.currentClassId,initialPeriod=S.currentTrimester()?.id){
 try{
 const assignments=await listWork('normAssignment'),cls=select(S.state.classes.map(c=>[c.id,c.name]),initialClass||S.state.classes[0]?.id),period=select(S.state.settings.trimesters.map(t=>[t.id,periodName(t)]),initialPeriod),view=el('div',{class:'coach-stack'});let busy=false;
 const redraw=()=>{
  try{
   const t=S.state.settings.trimesters.find(x=>x.id===period.value),a=periodReview(S.state,{classId:cls.value,period:t,assignments}),forecast=ktpForecast(S.state,cls.value,S.topicsForClass(cls.value));
   const rows=[['Ученик','Оценок','Вес','Средневзвешенный','Предложение','Без явки','Итог'],...a.results.map(r=>[r.student.fullName,r.count,r.weight,r.mean==null?null:Math.round(r.mean*100)/100,r.suggested,r.unknown,r.final])];
   const tasks=[['Назначение','Выполнено','Ожидают','Проверить'],...a.tasks.map(x=>[x.name,x.done,x.pending,x.review])];
   view.replaceChildren(card('Контроль полноты',p(a.ended?'Период завершён по календарю.':'Период ещё продолжается; итоговые отметки нельзя подтвердить.'),p('Проведено '+a.held+' / '+a.lessons+' · неподтверждённых '+a.unconfirmed+' · будущих '+a.future),p('Не отмечена явка: '+a.unknown+' · без оценок: '+a.withoutGrades+' · без итогов: '+a.withoutFinal)),card('Назначенные нормативы',p('Ограничения и отсутствие шкалы требуют отдельной проверки, а не автоматически считаются задолженностью.'),matrixTable(tasks)),card('Прогноз КТП',p('Тем проведено '+forecast.completed+' / '+forecast.total+' · осталось '+forecast.remaining),p('Оставшиеся уроки по расписанию и журналу: '+forecast.available+' · возможный дефицит '+forecast.shortfall),p('Расчёт предполагает одну тему на занятие; проведённые темы не меняются.'),btn('Предложения распределения тем',()=>openKtpRedistribution(cls.value,()=>openPeriodReview(cls.value,t.id))),btn('Открыть планировщик',()=>openLessonPlanner(cls.value))),card('Итоговые оценки',p('Средневзвешенный балл: сумма оценки × вес / сумма весов (обычная отметка 1, повышенный вес 2). Предложение — не итог. Каждую оценку подтверждает учитель.'),...a.results.map(r=>{
    const chosen=select([['','Не выставлена'],...['1','2','3','4','5'].map(v=>[v,v])],r.final||'');
    const apply=btn('Подтвердить итог',async()=>{if(busy||!a.ended)return;if(!await confirmDialog({title:'Подтвердить итог?',text:r.student.fullName+' · '+(chosen.value||'убрать итоговую оценку'),ok:'Подтвердить'}))return;busy=true;try{await S.saveFinalGrade(r.student.id,t.id,chosen.value||null,true);redraw();}catch(e){toast(e.message);}finally{busy=false;}});
    apply.disabled=!a.ended;return card(r.student.fullName,p('Оценок: '+r.count+' · средневзвешенный: '+(r.mean==null?'нет данных':r.mean.toFixed(2))+' · предложение: '+(r.suggested||'нет')),p('Не отмечена явка: '+r.unknown+' · итог: '+(r.final||'нет')),field('Решение учителя',chosen),apply);
   })),btn('Предпросмотр ведомости',()=>openDocumentPreview(report('Проверка периода · '+periodName(t),rows,['Предложения не являются утверждёнными отметками.'],true),()=>openPeriodReview(cls.value,t.id)),'primary'));
  }catch(e){view.replaceChildren(p(e.message));}
 };
 cls.onchange=period.onchange=redraw;redraw();openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Закрытие учебного периода'}),field('Класс',cls),field('Период',period),view,btn('Закрыть',closeSheet)]),{fullHeight:true});
 }catch(e){toast(e.message);}
}

export function openKtpRedistribution(classId,back=closeSheet){
 try{const cls=S.state.classes.find(c=>c.id===classId);if(!cls)return toast('Класс недоступен');const result=ktpRedistribution(S.state,classId,S.topicsForClass(classId));
 const rows=[['Дата','Номер','Тема','Основание'],...result.rows.map(r=>[M.fmtFull(r.date),r.slot??'—',r.topic,r.lessonId?'Свободный урок журнала':'Свободный слот расписания'])];
 const report={title:'Предложения КТП · '+cls.name,personal:false,sections:[{heading:'Черновик распределения',paragraphs:['Не изменяет журнал. Проверить доступность оборудования и допустимость нагрузки. Существующие темы и занятия с записями не перераспределяются.'],matrix:rows},{heading:'Без свободного слота',paragraphs:result.unplaced.map(t=>t.name),matrix:[]}]};
 openSheet(el('div',{class:'coach-form'},[el('h2',{text:report.title}),p('Только предложения. Ничего не будет автоматически записано: подтвердите темы и нагрузку в планировщике.'),p('Тем уже закреплено или проведено: '+result.covered+' · предложено '+result.rows.length+' · без свободного слота '+result.unplaced.length),matrixTable(rows),card('Темы без слота',...result.unplaced.map(t=>p(t.name))),btn('Предпросмотр / экспорт',()=>openDocumentPreview(report,()=>openKtpRedistribution(classId,back)),'primary'),btn('Открыть планировщик',()=>openLessonPlanner(classId)),btn('Назад',back)]),{fullHeight:true});
 }catch(e){toast(e.message);}
}
