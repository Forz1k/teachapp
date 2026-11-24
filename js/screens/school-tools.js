import {saveStudentGoal} from '../student-goals.js';
import * as S from '../store.js';
import * as W from '../workbench.js';
import * as M from '../model.js';
import {physicalPassport,normChecklist,checklistLabels,scoreRubric,assignmentOverview,lineageOf,schoolDebtRows} from '../school-tools.js';
import {trendChart,metric} from '../dashboard.js';
import {el,openSheet,closeSheet,toast,confirmDialog} from '../ui.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const input=(value='',type='text',props={})=>el('input',{type,value,...props});
const field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]);
const select=(options,value)=>{const n=el('select',{},options.map(([value,text])=>el('option',{value,text})));n.value=value??options[0]?.[0]??'';return n;};
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const stack=children=>el('div',{class:'coach-form'},children);
const number=n=>n.value.trim()===''?null:Number(n.value);
export async function openPassport(id,back=closeSheet){
 try{
  const data=physicalPassport(S.state,await W.listWork('archive'),id);if(!data)return toast('Ученик недоступен');
  const body=stack([el('h2',{text:'Паспорт физической подготовки'}),p(data.pupil.fullName),p('История объединяется только по идентификатору, сохранённому при переводе класса. Архивы до 3.2.0 без подтверждённой связи не объединяются по ФИО. Сравниваются результаты одной записи норматива с одинаковой нагрузкой, единицей и направлением. Изменение методики требует отдельного норматива. Результаты с указанным основанием исключены из рекордов.')]);
  body.append(card('Учебные годы',data.years.map(y=>p(y.year.from+' — '+y.year.to+' · '+y.className+' · результатов '+y.count))));
  for(const g of data.groups)body.append(card(g.name,[el('div',{class:'dashboard-metrics'},[metric('Первый',g.first==null?'—':g.first+' '+g.unit,'chart'),metric('Последний',g.last==null?'—':g.last+' '+g.unit,'check'),metric('Лучший',g.best==null?'—':g.best+' '+g.unit,'trophy')]),trendChart(g.comparable.slice(-30),{unit:g.unit,label:g.name}),el('details',{},[el('summary',{text:'История попыток · '+g.history.length}),...g.history.map(r=>p(M.fmtFull(r.date)+' · '+r.className+' · '+r.value+' '+g.unit+' · оценка '+(r.grade??'—')+(r.basisRecorded?' · вне сравнения':'')))])]));
  if(!data.groups.length)body.append(p('Записанных результатов пока нет.'));
  body.append(btn('Индивидуальные цели и портфолио',()=>openStudentPortfolio(id,()=>openPassport(id,back)),'primary'),btn('Назад',back));openSheet(body);
 }catch(e){toast(e.message);}
}
export function openNormChecklist(norm,back=closeSheet){
 const cls=select(S.state.classes.map(c=>[c.id,c.name]),S.state.currentClassId),period=S.currentTrimester(),from=input(period?.from||S.state.settings.year.from,'date'),to=input(period?.to||M.todayIso(),'date'),target=select([['','Любой зафиксированный результат'],...['1','2','3','4','5'].map(n=>[n,'Оценка не ниже '+n])]),filter=select([['all','Все'],...Object.entries(checklistLabels)]),date=input(M.todayIso(),'date'),body=el('div',{class:'coach-stack'});let rows=[];
 function draw(){try{rows=normChecklist(S.state,{classId:cls.value,normId:norm.id,from:from.value,to:to.value,targetGrade:target.value?Number(target.value):null});body.replaceChildren(p(Object.entries(checklistLabels).map(([id,label])=>label+': '+rows.filter(r=>r.status===id).length).join(' · ')),...rows.filter(r=>filter.value==='all'||r.status===filter.value).map(r=>card(r.student.fullName,[p(checklistLabels[r.status]),p('Попыток: '+r.attempts+(r.last?' · последний результат: '+r.last.value+' '+norm.unit+' · оценка '+(r.last.grade??'—'):'')),r.review?p('Проверьте внесённые сведения перед нагрузкой.'):null])));}catch(e){rows=[];body.replaceChildren(p(e.message));}}
 cls.onchange=from.onchange=to.onchange=target.onchange=filter.onchange=draw;draw();
 const save=btn('Запланировать проверку / пересдачу',async()=>{try{
  if(!rows.length)throw Error('Выберите класс и период');
  const pending=rows.filter(r=>['missing','retake'].includes(r.status)).length;
  if(!pending)throw Error('Нет записей со статусом «нет результата» или «ниже цели»');
  if(date.value<M.todayIso())throw Error('Выберите сегодняшнюю или будущую дату');
  if(!await confirmDialog({title:'Добавить событие в календарь?',text:'Кандидатов для проверки: '+pending+'. Это не назначение нагрузки. Сведения и возможность участия проверьте вручную.',ok:'Добавить'}))return;
  save.disabled=true;await W.saveWork({kind:'event',name:'Проверка норматива · '+S.state.classes.find(c=>c.id===cls.value).name,date:date.value,time:'',minutes:0,eventType:'task',note:'Норматив: '+norm.name.slice(0,160)+'; проверить список и актуальные ограничения.',remind:1440,done:false});toast('Задача добавлена в календарь');
 }catch(e){toast(e.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:'План сдачи · '+norm.name}),p('Выбранный норматив считается целью только после вашего выбора. Отсутствие результата не означает задолженность или оценку. Списки не меняют журнал.'),field('Класс',cls),el('div',{class:'coach-columns'},[field('С',from),field('По',to)]),field('Цель',target),field('Статус',filter),body,field('Дата проверки',date),save,btn('Назад',back)]));
}
function rubricForm(existing,back){
 const r=existing||{name:'',criteria:[{name:'Техника выполнения',max:10,description:''}],thresholds:[0,40,60,75,90]},name=input(r.name),criteria=structuredClone(r.criteria),list=el('div',{class:'coach-stack'}),thresholds=r.thresholds.map(v=>input(v,'number',{min:0,max:100,step:'any'}));
 function draw(){list.replaceChildren(...criteria.map((c,i)=>{const title=input(c.name),max=input(c.max,'number',{min:1,max:100}),desc=el('textarea',{rows:2,maxlength:1000},[c.description]);title.oninput=()=>c.name=title.value;max.oninput=()=>c.max=number(max);desc.oninput=()=>c.description=desc.value;return card('Критерий '+(i+1),[field('Название',title),field('Максимум баллов',max),field('Описание',desc),btn('Убрать',()=>{if(criteria.length>1){criteria.splice(i,1);draw();}})]);}));}
 draw();const save=btn('Сохранить шаблон',async()=>{save.disabled=true;try{await W.saveWork({id:r.id,kind:'rubric',name:name.value.trim(),criteria,thresholds:thresholds.map(number)});await back();}catch(e){toast(e.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:'Критерии оценивания техники'}),field('Название',name),p('Пороги 1–5 задаёт учитель. Начальные значения — пример, а не нормативные требования.'),list,btn('+ Критерий',()=>{if(criteria.length<12){criteria.push({name:'',max:5,description:''});draw();}}),...thresholds.map((n,i)=>field('Оценка '+(i+1)+' от %',n)),save,btn('Назад',back)]));
}
function useRubric(r,back){
 const fields=r.criteria.map(c=>input('','number',{min:0,max:c.max,step:1})),result=el('div',{class:'profile-note',role:'status'});
 function calc(){try{const v=scoreRubric(r,fields.map(number));result.textContent=v.sum+' / '+v.max+' баллов · '+Math.round(v.percent*10)/10+'% · предложение: '+v.grade;}catch{result.textContent='Введите допустимые целые баллы по всем критериям.';}}
 fields.forEach(n=>n.oninput=calc);calc();openSheet(stack([el('h2',{text:r.name}),p('Черновой расчёт. Не сохраняет результат и не выставляет оценку в журнал.'),...r.criteria.map((c,i)=>card(c.name,[p(c.description),field('Баллы из '+c.max,fields[i])])),result,btn('Назад',back)]));
}
export async function openRubrics(){
 async function draw(){try{const rows=await W.listWork('rubric');openSheet(stack([el('h2',{text:'Конструктор оценивания'}),p('Шаблоны критериев техники: собственные баллы и пороги. Оценку после расчёта подтверждает преподаватель в журнале.'),btn('+ Шаблон',()=>rubricForm(null,draw),'primary'),...rows.map(r=>card(r.name,[p('Критериев: '+r.criteria.length),btn('Оценить по критериям',()=>useRubric(r,draw),'primary'),btn('Редактировать',()=>rubricForm(r,draw)),btn('Удалить',async()=>{if(!await confirmDialog({title:'Удалить шаблон?',text:'Оценки журнала не изменятся.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(r.id,'rubric');await draw();}catch(e){toast(e.message);}})])),btn('Закрыть',closeSheet)]));}catch(e){toast(e.message);}}
 await draw();
}

function assignmentForm(existing,back){
 const year=S.state.settings.year,period=S.currentTrimester(),a=existing||{},cls=select(S.state.classes.map(c=>[c.id,c.name]),a.classId||S.state.currentClassId),norm=select(S.state.norms.map(n=>[n.id,n.name]),a.normId),from=input(a.from||period?.from||year.from,'date',{min:year.from,max:year.to}),to=input(a.to||period?.to||year.to,'date',{min:year.from,max:year.to}),target=select([['','Любой зафиксированный результат'],...['1','2','3','4','5'].map(n=>[n,'Оценка не ниже '+n])],a.targetGrade==null?'':String(a.targetGrade));
 const save=btn('Сохранить назначение',async()=>{save.disabled=true;try{const c=S.state.classes.find(x=>x.id===cls.value),n=S.state.norms.find(x=>x.id===norm.value);if(!c||!n)throw Error('Выберите класс и норматив');await W.saveWork({id:a.id,kind:'normAssignment',name:(c.name+' · '+n.name).slice(0,200),classId:c.id,normId:n.id,yearFrom:year.from,yearTo:year.to,from:from.value,to:to.value,targetGrade:target.value?Number(target.value):null});await back();}catch(e){toast(e.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:existing?'Изменить назначение':'Назначить норматив классу'}),p('Назначение задаёт период и критерий учителя. Не изменяет оценки и не отменяет освобождения, ограничения и необходимость допуска. Сдача позже срока учитывается после продления периода.'),field('Класс',cls),field('Норматив',norm),el('div',{class:'coach-columns'},[field('Начало',from),field('Срок',to)]),field('Критерий выполнения',target),save,btn('Назад',back)]));
}
export async function openNormAssignments(back=closeSheet){
 const draw=async()=>{try{
  const assignments=await W.listWork('normAssignment'),year=S.state.settings.year,active=assignments.filter(a=>a.yearFrom===year.from&&a.yearTo===year.to).sort((a,b)=>a.to.localeCompare(b.to));
  const body=stack([el('h2',{text:'Назначения нормативов'}),p('Только явно заданные нормативы входят в этот список. Просрочено — нет результата по выбранному критерию в заданный период; это не автоматически выставленная оценка и не медицинский допуск.'),S.state.classes.length&&S.state.norms.length?btn('+ Назначить норматив',()=>assignmentForm(null,draw),'primary'):p('Сначала добавьте классы и нормативы.')]);
  for(const a of active){const v=assignmentOverview(S.state,a),n=S.state.norms.find(n=>n.id===a.normId),c=S.state.classes.find(c=>c.id===a.classId);const labels={upcoming:'Ещё не начат',active:'В периоде',closed:'Срок завершён',unavailable:'Класс или норматив недоступен'};
   body.append(card(c&&n?c.name+' · '+n.name:a.name,[p(M.fmtFull(a.from)+' — '+M.fmtFull(a.to)+' · '+labels[v.state]),p(a.targetGrade==null?'Любой зафиксированный результат':'Оценка не ниже '+a.targetGrade),v.state!=='unavailable'?el('div',{class:'assignment-meter'},[p('Выполнено '+v.done+' · без результата / ниже цели '+v.pending+' · проверить основания / шкалу '+v.review),v.rows.length?el('progress',{max:v.rows.length,value:v.done,'aria-label':'Выполнено '+v.done+' из '+v.rows.length}):null,v.rows.length?p('Выполнено по критерию: '+v.done+' из '+v.rows.length+' учащихся; остальные статусы не считаются провалом.'):null]):null,v.overdue?p('После срока требуют проверки: '+v.overdue):null,
    v.rows.length?el('details',{},[el('summary',{text:'Список класса · '+v.rows.length}),...v.rows.map(r=>p(r.student.fullName+' · '+checklistLabels[r.status]))]):null,
    v.state!=='unavailable'?btn('Изменить срок / критерий',()=>assignmentForm(a,draw)):null,btn('Удалить назначение',async()=>{if(!await confirmDialog({title:'Удалить назначение?',text:'Результаты нормативов и оценки сохранятся.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(a.id,'normAssignment');await draw();}catch(e){toast(e.message);}})]));
  }
  if(!active.length)body.append(p('В текущем учебном году нет назначений.'));
  if(assignments.length>active.length)body.append(el('details',{},[el('summary',{text:'Назначения других учебных лет · '+(assignments.length-active.length)}),...assignments.filter(a=>!active.includes(a)).map(a=>p(a.name+' · '+a.yearFrom+' — '+a.yearTo))]));
  body.append(btn('Назад',back));openSheet(body);
 }catch(e){toast(e.message);}};await draw();
}

const goalLabels={planned:'Запланирована',inProgress:'В работе',achieved:'Достигнута',cancelled:'Отменена'};
export async function openStudentPortfolio(id,back=closeSheet){
 try{
  const pupil=S.state.students.find(s=>s.id===id);if(!pupil)return toast('Ученик недоступен');
  const [goals,achievements,archives]=await Promise.all(['studentGoal','achievement','archive'].map(W.listWork));const passport=physicalPassport(S.state,archives,id);
  const own=goals.filter(g=>g.studentId===lineageOf(pupil)).sort((a,b)=>b.from.localeCompare(a.from)),awards=achievements.filter(a=>a.subjectType==='student'&&a.subjectId===lineageOf(pupil));
  const reload=()=>openStudentPortfolio(id,back);
  const form=g=>{
   const title=input(g?.name||''),from=input(g?.from||M.todayIso(),'date'),to=input(g?.to||M.todayIso(),'date'),target=input(g?.target||''),status=select(Object.entries(goalLabels),g?.status||'planned'),note=el('textarea',{rows:3,maxlength:2000},[g?.note||'']);
   openSheet(stack([el('h2',{text:g?'Изменить индивидуальную цель':'Новая индивидуальная цель'}),p('Цель не назначает нагрузку и не изменяет оценки. Проверьте ограничения и возможность участия.'),field('Цель',title),field('Начало',from),field('Срок',to),field('Критерий достижения',target),field('Подтверждённый статус',status),field('Заметка учителя',note),btn('Сохранить',async()=>{try{await saveStudentGoal({...(g?{id:g.id}:{}),studentId:lineageOf(pupil),name:title.value.trim(),from:from.value,to:to.value,target:target.value.trim(),status:status.value,note:note.value});reload();}catch(e){toast(e.message);}},'primary'),btn('Назад',reload)]));
  };
  const body=stack([el('h2',{text:'Портфолио · '+pupil.fullName}),p('Приватная сводка: подтверждённые записи, без публичной публикации.'),btn('+ Индивидуальная цель',()=>form(null),'primary'),...own.map(g=>card(g.name,[p(g.from+' — '+g.to+' · '+goalLabels[g.status]),p(g.target),g.note?p(g.note):null,btn('Изменить',()=>form(g)),btn('Удалить',async()=>{if(!await confirmDialog({title:'Удалить цель?',text:'Результаты, оценки и достижения не изменятся.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(g.id,'studentGoal');reload();}catch(e){toast(e.message);}})])),card('Достижения',awards.length?awards.map(a=>p(a.date+' · '+a.title)): [p('Нет записей о достижениях')]),card('Физическая подготовка',passport?.groups?.length?passport.groups.map(g=>p(g.name+' · лучший '+(g.best??'—')+' '+g.unit+' · последний '+(g.last??'—')+' '+g.unit)):[p('Нет результатов')]),btn('Открыть историю подготовки',()=>openPassport(id,back)),btn('Назад',back)]);
  openSheet(body);
 }catch(e){toast(e.message);}
}

export async function openDebtCenter(back=closeSheet){
 try{
  const rows=schoolDebtRows(S.state,await W.listWork('normAssignment'));
  const cls=select([['','Все классы'],...S.state.classes.map(c=>[c.id,c.name])],'');
  const norm=select([['','Все нормативы'],...S.state.norms.map(n=>[n.id,n.name])],'');
  const status=select([['','Все причины'],['overdue','Просроченные (без медицинского заключения)'],...Object.entries(checklistLabels).filter(([k])=>k!=='done')],'');
  const period=select([['','Весь год'],...S.state.settings.trimesters.map(t=>[t.id,t.name||t.kind])],'');
  const result=el('div'),summary=p('');
  const visible=()=>rows.filter(r=>(!cls.value||r.classId===cls.value)&&(!norm.value||r.normId===norm.value)&&(!status.value||(status.value==='overdue'?r.overdue:r.status===status.value))&&(!period.value||S.state.settings.trimesters.some(t=>t.id===period.value&&r.from<=t.to&&r.to>=t.from)));
  const refresh=()=>{const list=visible();summary.textContent='Назначений × учеников: '+list.length+'; просрочено: '+list.filter(r=>r.overdue).length+'; требуют проверки: '+list.filter(r=>r.review||r.status==='noScale').length;result.replaceChildren(...list.slice(0,300).map(r=>card(r.studentName+' · '+r.className,[p(r.normName+' · '+r.from+' — '+r.to),p(checklistLabels[r.status]+(r.overdue?' · срок прошёл':'')),p('Попыток с результатом: '+r.attempts),r.review?p('Есть основание для проверки допустимости нагрузки.'):null])),list.length>300?p('Показаны первые 300 записей. Уточните фильтр или сформируйте полный документ.'):null,list.length?null:p('Нет записей по этим фильтрам.'));};
  for(const n of [cls,norm,status,period])n.onchange=refresh;
  const report=async()=>{const {openDocumentPreview}=await import('./documents.js');openDocumentPreview({title:'Контроль выполнения назначенных нормативов',personal:true,sections:[{heading:'Записи для проверки',paragraphs:['Нет результата не означает автоматически задолженность по медицинским основаниям. Решение о допуске принимает учитель.'],matrix:[['Класс','Ученик','Норматив','Срок','Статус','Попыток'],...visible().map(r=>[r.className,r.studentName,r.normName,r.to,checklistLabels[r.status]+(r.overdue?' · срок прошёл':''),r.attempts])]}]},()=>openDebtCenter(back));};
  openSheet(stack([el('h2',{text:'Центр задолженностей'}),p('Только назначенные нормативы текущего учебного года. Ограничения и отсутствующие шкалы вынесены в отдельные причины; оценка и допуск автоматически не меняются.'),field('Класс',cls),field('Норматив',norm),field('Причина',status),field('Период',period),summary,btn('Предпросмотр ведомости',report,'primary'),result,btn('Назад',back)]),{fullHeight:true});refresh();
 }catch(e){toast(e.message);}
}
