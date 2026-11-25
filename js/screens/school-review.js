import * as S from '../store.js';
import * as M from '../model.js';
import {periodName} from '../assessment.js';
import {workloadReview,periodReview,ktpForecast,ktpRedistribution,schoolPeriodOverview,periodMissingLessons,periodIssueLabels} from '../school-review.js';
import {listWork} from '../workbench.js';
import {openDocumentPreview} from './documents.js';
import {openLessonPlanner} from './lesson.js';
import {openLessonSession,showLessonSession} from './session.js';
import {openDebtCenter} from './school-tools.js';
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
const closureStatuses={review:'Требует проверки',ready:'Нет замечаний по проверкам',progress:'Период продолжается',future:'Период ещё не начался',empty:'Нет учеников',noLessons:'Нет проведённых уроков'};
export async function openSchoolPeriodCenter(initialPeriod=S.currentTrimester()?.id,initialFilter='all'){
 try{
  const assignments=await listWork('normAssignment'),period=select(S.state.settings.trimesters.map(t=>[t.id,periodName(t)]),initialPeriod),
   filter=select([['all','Все классы'],['review','Требуют проверки'],['ready','Без замечаний'],['data','Без данных'],['missing','Слоты без записи'],['unconfirmed','Неподтверждённые уроки'],['unknown','Неизвестная явка'],['withoutFinal','Нет итогов'],['norm','Нормативы к сроку']],initialFilter),
   view=el('div',{class:'coach-stack','aria-live':'polite'});
  function draw(){try{
   const t=S.state.settings.trimesters.find(x=>x.id===period.value),overview=schoolPeriodOverview(S.state,{period:t,assignments});
   const back=()=>openSchoolPeriodCenter(t.id,filter.value);
   const show=r=>filter.value==='all'||filter.value==='data'&&['empty','noLessons'].includes(r.status)||['review','ready'].includes(filter.value)&&r.status===filter.value||filter.value==='norm'&&(r.stats.normPending+r.stats.normReview+r.stats.normUnavailable)>0||Object.hasOwn(r.stats,filter.value)&&r.stats[filter.value]>0;
   const visible=overview.rows.filter(show);
   const labels=Object.entries(periodIssueLabels);
   const matrix=[['Класс','Статус','Учеников',...labels.map(([,v])=>v)],...overview.rows.map(r=>[r.name,closureStatuses[r.status],r.pupils,...labels.map(([k])=>r.stats[k])])];
   view.replaceChildren(card('Сводка по всем классам',p(M.fmtFull(t.from)+' — '+M.fmtFull(t.to)),p(overview.ended?'Период завершён по календарю.':overview.started?'Период продолжается. Отсутствие итогов и текущих оценок пока не считается ошибкой.':'Период ещё не начался.'),
    p('Классов: '+overview.rows.length+' · требуют проверки: '+overview.needsReview+' · без замечаний: '+overview.ready+' · без данных: '+overview.withoutData),
    ...labels.map(([k,label])=>p(label+': '+overview.total[k])),
    p('Слоты учитываются по действующему расписанию до сегодняшней даты включительно: уточните, состоялись ли занятия. Нормативы учитываются по наступившим срокам внутри периода.')),
    ...visible.map(r=>el('section',{class:'card-block period-class-summary','data-class-id':r.classId,'data-period-status':r.status},[
     el('h3',{text:r.name+' · '+closureStatuses[r.status]}),p('Ученики: '+r.pupils+' · проведено по данным: '+r.held+' · явно подтверждено: '+r.explicitlyHeld),
     ...labels.filter(([k])=>r.stats[k]>0).map(([k,label])=>p(label+': '+r.stats[k])),
     btn('Проверить класс '+r.name,()=>openPeriodReview(r.classId,t.id,back),'primary')])),
    !visible.length?p('Нет классов по выбранному фильтру.'):null,
    btn('Предпросмотр сводки всех классов',()=>openDocumentPreview(report('Сводка закрытия периода · '+periodName(t),matrix,['Сводка не утверждает отметки и не является официальным табелем. Сведения по всем классам, независимо от фильтра.']),back)));
  }catch(e){view.replaceChildren(p(e.message));}}
  period.onchange=filter.onchange=draw;draw();
  openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Закрытие периода · все классы'}),p('Контроль полноты без автоматического выставления оценок и медицинского допуска.'),field('Учебный период',period),field('Показать классы',filter),view,btn('Закрыть',closeSheet)]),{fullHeight:true});
 }catch(e){toast(e.message);}
}
export async function openPeriodReview(initialClass=S.state.currentClassId,initialPeriod=S.currentTrimester()?.id,back=closeSheet){
 try{
 const assignments=await listWork('normAssignment'),cls=select(S.state.classes.map(c=>[c.id,c.name]),initialClass||S.state.classes[0]?.id),period=select(S.state.settings.trimesters.map(t=>[t.id,periodName(t)]),initialPeriod),view=el('div',{class:'coach-stack'});let busy=false;
 const redraw=()=>{
  try{
   const t=S.state.settings.trimesters.find(x=>x.id===period.value),a=periodReview(S.state,{classId:cls.value,period:t,assignments}),forecast=ktpForecast(S.state,cls.value,S.topicsForClass(cls.value));
   const missing=periodMissingLessons(S.state,t).filter(r=>r.classId===cls.value);
   const returnToClass=()=>openPeriodReview(cls.value,t.id,back);
   const rows=[['Ученик','Оценок','Вес','Средневзвешенный','Предложение','Без явки','Итог'],...a.results.map(r=>[r.student.fullName,r.count,r.weight,r.mean==null?null:Math.round(r.mean*100)/100,r.suggested,r.unknown,r.final])];
   const tasks=[['Назначение','Выполнено','Ожидают','Проверить'],...a.tasks.map(x=>[x.name,x.done,x.pending,x.review])];
   view.replaceChildren(card('Контроль полноты',p(a.ended?'Период завершён по календарю.':'Период ещё продолжается; итоговые отметки нельзя подтвердить.'),p('Проведено по данным '+a.held+' / '+a.lessons+' · явно подтверждено '+a.explicitlyHeld+' · без подтверждения '+a.unconfirmed+' · будущих '+a.future),p('Не отмечена явка: '+a.unknown+' · без оценок: '+a.withoutGrades+' · без итогов: '+a.withoutFinal)),
   card('Проверить уроки',p('Слоты без записи: '+missing.length+' · уроки с замечаниями: '+a.lessonIssues.length+'. Записи не создаются автоматически.'),
    ...missing.map(r=>btn(M.lessonLabel(r)+' · слот без записи',async()=>{
     const fresh=periodMissingLessons(S.state,t).some(x=>x.id===r.id&&x.date===r.date&&x.classId===r.classId&&x.slot===r.slot);
     if(!fresh){toast('Расписание или журнал изменились. Обновите обзор.');redraw();return;}
     if(await confirmDialog({title:'Создать запись урока?',text:M.lessonLabel(r)+' · сначала убедитесь, что занятие состоялось.',ok:'Создать и открыть'}))await openLessonSession(r.classId,r.date,{slot:r.slot,time:r.time});
    })),
    ...a.lessonIssues.map(r=>btn(M.lessonLabel(r.lesson)+(r.unconfirmed?' · без подтверждения':'')+(r.unknown?' · неизвестная явка: '+r.unknown:''),()=>showLessonSession(r.lesson.id)))),
   card('Назначенные нормативы',p('Ограничения и отсутствие шкалы требуют отдельной проверки, а не автоматически считаются задолженностью.'),matrixTable(tasks),btn('Открыть центр задолженностей',()=>openDebtCenter(returnToClass))),card('Прогноз КТП',p('Тем проведено '+forecast.completed+' / '+forecast.total+' · осталось '+forecast.remaining),p('Оставшиеся уроки по расписанию и журналу: '+forecast.available+' · возможный дефицит '+forecast.shortfall),p('Расчёт предполагает одну тему на занятие; проведённые темы не меняются.'),btn('Предложения распределения тем',()=>openKtpRedistribution(cls.value,returnToClass)),btn('Открыть планировщик',()=>openLessonPlanner(cls.value))),card('Итоговые оценки',p('Средневзвешенный балл: сумма оценки × вес / сумма весов (обычная отметка 1, повышенный вес 2). Предложение — не итог. Каждую оценку подтверждает учитель.'),...a.results.map(r=>{
    const chosen=select([['','Не выставлена'],...['1','2','3','4','5'].map(v=>[v,v])],r.final||'');
    const apply=btn('Подтвердить итог',async()=>{if(busy||!a.ended)return;if(!await confirmDialog({title:'Подтвердить итог?',text:r.student.fullName+' · '+(chosen.value||'убрать итоговую оценку'),ok:'Подтвердить'}))return;busy=true;try{await S.saveFinalGrade(r.student.id,t.id,chosen.value||null,true);redraw();}catch(e){toast(e.message);}finally{busy=false;}});
    apply.disabled=!a.ended;return card(r.student.fullName,p('Оценок: '+r.count+' · средневзвешенный: '+(r.mean==null?'нет данных':r.mean.toFixed(2))+' · предложение: '+(r.suggested||'нет')),p('Не отмечена явка: '+r.unknown+' · итог: '+(r.final||'нет')),field('Решение учителя',chosen),apply);
   })),btn('Предпросмотр ведомости',()=>openDocumentPreview(report('Проверка периода · '+periodName(t),rows,['Предложения не являются утверждёнными отметками.'],true),returnToClass),'primary'));
  }catch(e){view.replaceChildren(p(e.message));}
 };
 cls.onchange=period.onchange=redraw;redraw();openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Закрытие учебного периода'}),field('Класс',cls),field('Период',period),view,btn('Все классы',()=>openSchoolPeriodCenter(period.value)),btn(back===closeSheet?'Закрыть':'Назад к сводке',back)]),{fullHeight:true});
 }catch(e){toast(e.message);}
}

export function openKtpRedistribution(classId,back=closeSheet){
 try{const cls=S.state.classes.find(c=>c.id===classId);if(!cls)return toast('Класс недоступен');const result=ktpRedistribution(S.state,classId,S.topicsForClass(classId));
 const rows=[['Дата','Номер','Тема','Основание'],...result.rows.map(r=>[M.fmtFull(r.date),r.slot??'—',r.topic,r.lessonId?'Свободный урок журнала':'Свободный слот расписания'])];
 const report={title:'Предложения КТП · '+cls.name,personal:false,sections:[{heading:'Черновик распределения',paragraphs:['Не изменяет журнал. Проверить доступность оборудования и допустимость нагрузки. Существующие темы и занятия с записями не перераспределяются.'],matrix:rows},{heading:'Без свободного слота',paragraphs:[],matrix:[['Тема'],...result.unplaced.map(t=>[t.name])]}]};
 openSheet(el('div',{class:'coach-form'},[el('h2',{text:report.title}),p('Только предложения. Ничего не будет автоматически записано: подтвердите темы и нагрузку в планировщике.'),p('Тем уже закреплено или проведено: '+result.covered+' · предложено '+result.rows.length+' · без свободного слота '+result.unplaced.length),matrixTable(rows),card('Темы без слота',...result.unplaced.map(t=>p(t.name))),btn('Предпросмотр / экспорт',()=>openDocumentPreview(report,()=>openKtpRedistribution(classId,back)),'primary'),btn('Открыть планировщик',()=>openLessonPlanner(classId)),btn('Назад',back)]),{fullHeight:true});
 }catch(e){toast(e.message);}
}
