import * as S from '../store.js';
import * as W from '../workbench.js';
import * as M from '../model.js';
import {physicalPassport,normChecklist,checklistLabels,scoreRubric} from '../school-tools.js';
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
  body.append(btn('Назад',back));openSheet(body);
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
