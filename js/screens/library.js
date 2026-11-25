import {materialKinds,ktpMaterial,tacticMaterial,documentMaterial,saveMaterial,instantiateMaterial} from '../library-materials.js';
import {readPresets} from '../document-presets.js';
import {documentTypes} from '../documents.js';
import {exportLocalLibrary,parseLibrary,importLocalLibrary,MAX_LIBRARY_BYTES} from '../portable-library.js';
import {openGymBoards,openGymView} from './methodical.js';
import * as W from '../workbench.js';
import {catalog,validPeriod} from '../health.js';
import {el,openSheet,closeSheet,toast,confirmDialog,downloadBlob,promptDialog} from '../ui.js';
import {equipmentCard} from './resources.js';
import {openBoardView} from './tactics.js';
import {dashboardHeading} from '../dashboard.js';
import * as S from '../store.js';
import * as M from '../model.js';
const p=text=>el('p',{text});
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const inp=(value='',type='text',props={})=>el('input',{value,type,...props});
const area=(value='',max=4000)=>el('textarea',{maxlength:max,rows:3},[value]);
const field=(name,n)=>el('label',{class:'field'},[el('span',{text:name}),n]);
const select=(opts,value)=>{const n=el('select',{},opts.map(([v,text])=>el('option',{value:v,text})));n.value=value??opts[0]?.[0]??'';return n;};
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const stack=children=>el('div',{class:'coach-form'},children);
const num=n=>n.value.trim()===''?null:Number(n.value);
function exerciseForm(existing,back){
 const e=existing||{},name=inp(e.name||''),category=select(Object.entries(W.exerciseCategories),e.category||'other'),activity=select(catalog.map(a=>[a.id,a.name]),e.activityId||'other'),minutes=inp(e.minutes||5,'number',{min:1,max:600}),description=area(e.description||''),equipment=inp(e.equipment||''),level=select([['all','Любой'],['beginner','Начальный'],['advanced','Подготовленный']],e.level||'all');
 const save=btn('Сохранить',async()=>{save.disabled=true;try{await W.saveWork({id:e.id?.startsWith('builtin-')?undefined:e.id,kind:'exercise',name:name.value.trim(),category:category.value,activityId:activity.value,minutes:num(minutes),description:description.value.trim(),equipment:equipment.value.trim(),level:level.value});await back();}catch(err){toast(err.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:'Упражнение'}),field('Название',name),field('Категория',category),field('Вид нагрузки',activity),field('Минуты',minutes),field('Описание и методика',description),field('Инвентарь',equipment),field('Подготовленность',level),save,btn('Назад',back)]));
}
function exportPlan(plan){
 const text=[plan.name,W.contexts[plan.context]+' · '+plan.minutes+' мин', 'Группа: '+plan.audience,'Цель: '+plan.goal,'Инвентарь: '+plan.equipment,'',...plan.items.flatMap(i=>[W.phases[i.phase]+' · '+i.minutes+' мин · '+i.exercise.name,i.exercise.description,'Инвентарь: '+i.exercise.equipment,'Методические указания: '+i.notes,'']),...(plan.resources||[]).map(r=>'Инвентарь: '+r.name+' · '+r.qty+' '+r.unit),...(plan.tactics||[]).map(b=>'Тактическая схема: '+b.name+' · '+b.note),'Всего: '+plan.items.reduce((n,i)=>n+i.minutes,0)+' мин.'].join('\n');
 downloadBlob(new Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'}),'plan.txt');
}
export async function planForm(existing,back,context){
 const e=existing||{},exercises=[...W.builtinExercises,...await W.listWork('exercise')],name=inp(e.name||''),mode=select(Object.entries(W.contexts),e.context||context||'school'),minutes=inp(e.minutes||45,'number',{min:1,max:600}),goal=area(e.goal||''),equipment=inp(e.equipment||''),audience=inp(e.audience||''),items=structuredClone(e.items||[]);
 const resources=structuredClone(e.resources||[]),stock=await W.listWork('inventory'),stockPick=select([['','Выберите инвентарь'],...stock.filter(r=>!r.archived).map(r=>[r.id,r.name])]),resourceQty=inp(1,'number',{min:1,step:1}),resourceList=el('div',{class:'coach-stack'});
 function drawResources(){resourceList.replaceChildren(equipmentCard(resources,stock),...resources.map((r,i)=>btn('Убрать '+r.name,()=>{resources.splice(i,1);drawResources();})));}drawResources();
 const resourceBox=card('Потребность в инвентаре',[field('Инвентарь',stockPick),field('Количество',resourceQty),btn('+ Добавить потребность',()=>{const r=stock.find(x=>x.id===stockPick.value),q=num(resourceQty);if(!r||!Number.isInteger(q)||q<1||q>1000000)return toast('Выберите инвентарь и количество');const old=resources.find(x=>x.itemId===r.id);if(old){old.qty=q;old.name=r.name;old.unit=r.unit;}else if(resources.length<50)resources.push({itemId:r.id,name:r.name,unit:r.unit,qty:q});drawResources();}),resourceList,p('Проверка не резервирует и не списывает инвентарь.')]);
 const tactics=structuredClone(e.tactics||[]),boards=await W.listWork('tacticBoard'),boardPick=select([['','Выберите схему'],...boards.map(b=>[b.id,b.name])]),boardList=el('div',{class:'coach-stack'});
 const boardBox=card('Тактические схемы',[field('Схема',boardPick),btn('+ Прикрепить снимок',()=>{const b=boards.find(b=>b.id===boardPick.value);if(b&&tactics.length<10){tactics.push(structuredClone(b));drawBoards();}}),boardList]);
 function drawBoards(){boardBox.hidden=mode.value!=='coach';boardList.replaceChildren(...tactics.map((b,i)=>el('div',{class:'profile-result'},[el('strong',{text:b.name}),btn('Убрать',()=>{tactics.splice(i,1);drawBoards();})])));}mode.onchange=drawBoards;drawBoards();
 const gyms=structuredClone(e.gymBoards||[]),availableGyms=await W.listWork('gymBoard'),gymPick=select([['','Выберите схему'],...availableGyms.map(g=>[g.id,g.name])]),gymList=el('div',{class:'coach-stack'});
 const drawGyms=()=>gymList.replaceChildren(...gyms.map((g,i)=>el('div',{class:'profile-result'},[p(g.name),btn('Убрать',()=>{gyms.splice(i,1);drawGyms();})])));drawGyms();const gymBox=card('Схемы занятия',[field('Схема зала',gymPick),btn('+ Прикрепить снимок',()=>{const g=availableGyms.find(g=>g.id===gymPick.value);if(g&&gyms.length<10){gyms.push(structuredClone(g));drawGyms();}}),gymList]);
 const list=el('div',{class:'coach-stack plan-items'}),total=el('div',{class:'plan-duration',role:'status'}),pick=select(exercises.map(x=>[x.id,x.name])),phase=select(Object.entries(W.phases),'main');
 const draw=()=>{list.replaceChildren();let sum=0;for(const [index,i] of items.entries()){sum+=Number(i.minutes)||0;const duration=inp(i.minutes,'number',{min:1,max:600}),notes=area(i.notes,2000);duration.oninput=()=>{i.minutes=num(duration);update();};notes.oninput=()=>i.notes=notes.value;list.append(card(W.phases[i.phase]+' · '+i.exercise.name,[p(i.exercise.description),field('Минуты',duration),field('Методические указания',notes),btn('Выше',()=>{if(index&&items[index-1].phase===i.phase){[items[index-1],items[index]]=[items[index],items[index-1]];draw();}}),btn('Убрать',()=>{items.splice(index,1);draw();})]));}update();};
 function update(){
 const sum=items.reduce((n,i)=>n+(Number(i.minutes)||0),0),limit=Number(minutes.value)||0;
 total.classList.toggle('over',sum>limit);
 total.replaceChildren(el('strong',{text:'Запланировано '+sum+' / '+limit+' мин'}),el('progress',{max:Math.max(1,limit,sum),value:sum,'aria-label':'Запланированные минуты'}),el('div',{class:'phase-summary'},Object.entries(W.phases).map(([id,label])=>el('div',{},[el('small',{text:label}),el('strong',{text:items.filter(i=>i.phase===id).reduce((n,i)=>n+(Number(i.minutes)||0),0)+' мин'})]))));
}
 minutes.oninput=update;draw();
 const save=btn('Сохранить конспект',async()=>{save.disabled=true;try{await W.saveWork({id:e.id,kind:'plan',name:name.value.trim(),context:mode.value,minutes:num(minutes),goal:goal.value.trim(),equipment:equipment.value.trim(),audience:audience.value.trim(),items,resources,gymBoards:gyms,...(mode.value==='coach'?{tactics}:{})});await back();}catch(err){toast(err.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:'Конспект занятия'}),field('Название',name),field('Тип',mode),field('Класс / группа (без ФИО)',audience),field('Длительность',minutes),field('Цель и задачи',goal),field('Инвентарь',equipment),field('Этап',phase),field('Упражнение',pick),btn('+ Добавить упражнение',()=>{const ex=exercises.find(x=>x.id===pick.value);if(!ex)return;items.push({phase:phase.value,exercise:structuredClone(ex),minutes:ex.minutes,notes:''});items.sort((a,b)=>Object.keys(W.phases).indexOf(a.phase)-Object.keys(W.phases).indexOf(b.phase));draw();}),total,list,resourceBox,boardBox,gymBox,save,btn('Назад',back)]));
}
/** Reserve plans are independent ordinary school plans, not automatic substitutions. */
export async function openFallbackBuilder(back=closeSheet,initialSource){
 try{
  const plans=(await W.listWork('plan')).filter(r=>r.context==='school');
  const source=select([['','Выберите конспект'],...plans.map(r=>[r.id,r.name])],initialSource||''),reason=select(Object.entries(W.fallbackReasons)),preview=el('div',{class:'coach-stack'});
  const draw=()=>{const plan=plans.find(r=>r.id===source.value);preview.replaceChildren(plan?card('Исходный конспект',[p(plan.name+' · '+plan.minutes+' мин'),...plan.items.map(i=>p(W.phases[i.phase]+' · '+i.exercise.name+' · '+i.minutes+' мин')),p('В копии будут очищены потребность в инвентаре и схемы зала. Перепроверьте все упражнения и заполните реальные условия.')]):p('Выберите сохранённый школьный конспект.'));};
  source.onchange=reason.onchange=draw;draw();
  openSheet(stack([el('h2',{text:'Резервный сценарий урока'}),p('Причина помогает различать версии. Исходный конспект и журнал не изменяются.'),field('Исходный конспект',source),field('Причина',reason),preview,btn('Создать черновик резервного конспекта',async()=>{
   try{const fresh=(await W.listWork('plan')).find(r=>r.id===source.value);if(!fresh)return toast('Выберите доступный школьный конспект');await planForm(W.fallbackPlanDraft(fresh,reason.value),back,'school');}catch(e){toast(e.message);}
  },'primary'),btn('Назад',back)]),{fullHeight:true});
 }catch(e){toast(e.message);}
}
export async function openCircuitBuilder(back=closeSheet,initialClass=S.state.currentClassId,initialDate=M.todayIso()){
 try{
  const exercises=[...W.builtinExercises,...await W.listWork('exercise')],stock=await W.listWork('inventory'),templates=await W.listWork('stationTemplate'),snapshots=new Map(),byExercise=id=>snapshots.get(id)||exercises.find(e=>e.id===id);
  const exerciseSelect=(value)=>select([...exercises.map(e=>[e.id,e.name]),...[...snapshots].map(([id,e])=>[id,e.name+' · сохранённый снимок'])],value);
  const name=inp('Круговая тренировка'),duration=inp(45,'number',{min:1,max:600}),rounds=inp(2,'number',{min:1,max:8}),work=inp(3,'number',{min:1,max:600}),transition=inp(1,'number',{min:0,max:15});
  const cls=select([['','Без класса'],...S.state.classes.map(c=>[c.id,c.name])],initialClass||''),date=inp(initialDate,'date');
  const warmup=exerciseSelect('builtin-warmup'),warmMinutes=inp(5,'number',{min:1,max:600}),cooldown=exerciseSelect('builtin-cool'),coolMinutes=inp(5,'number',{min:1,max:600});
  const stations=[{exerciseId:'builtin-pass',capacity:8,notes:'',resources:[]},{exerciseId:'builtin-serve',capacity:8,notes:'',resources:[]}];
  const templatePicker=select([]),templateControls=el('div',{class:'coach-stack'}),list=el('div',{class:'coach-stack circuit-stations'}),result=el('div',{class:'coach-stack','aria-live':'polite'});let draft=null;
  function draw(){
   const previous=templatePicker.value;templatePicker.replaceChildren(el('option',{value:'',text:'Выберите сохранённую станцию'}),...templates.map(t=>el('option',{value:t.id,text:t.name})));if(templates.some(t=>t.id===previous))templatePicker.value=previous;
   list.replaceChildren(...stations.map((station,index)=>{
    const pick=exerciseSelect(station.exerciseId),capacity=inp(station.capacity,'number',{min:1,max:1000}),notes=area(station.notes,500),resource=select([['','Выберите инвентарь'],...stock.filter(r=>!r.archived).map(r=>[r.id,r.name])]),qty=inp(1,'number',{min:1,max:1000000});
    pick.onchange=()=>{station.exerciseId=pick.value;refresh();};capacity.oninput=()=>{station.capacity=num(capacity);refresh();};notes.oninput=()=>{station.notes=notes.value;refresh();};
    return card('Станция '+(index+1),[field('Упражнение',pick),field('Вместимость группы',capacity),field('Указания',notes),
     field('Инвентарь станции',resource),field('Количество на всю станцию',qty),
     btn('+ Добавить инвентарь',()=>{const item=stock.find(r=>r.id===resource.value),q=num(qty);if(!item||!Number.isInteger(q)||q<1||q>1000000)return toast('Выберите инвентарь и количество');const value={itemId:item.id,name:item.name,unit:item.unit,qty:q};const at=station.resources.findIndex(r=>r.itemId===item.id);if(at>=0)station.resources[at]=value;else if(station.resources.length<10)station.resources.push(value);else return toast('Не более 10 видов на станцию');draw();}),
     ...station.resources.map((r,i)=>btn('Убрать '+r.name+' · '+r.qty+' '+r.unit,()=>{station.resources.splice(i,1);draw();})),
     btn('Сохранить станцию в библиотеку',async()=>{try{const label=await promptDialog({title:'Название шаблона станции',value:(byExercise(station.exerciseId)?.name||'Станция').slice(0,200)});if(!label?.trim())return;const saved=await W.saveStationTemplate({name:label.trim(),exercise:byExercise(station.exerciseId),capacity:station.capacity,notes:station.notes,resources:station.resources});templates.push(saved);draw();toast('Шаблон сохранён');}catch(e){toast(e.message);}}),btn('Удалить станцию',()=>{if(stations.length<=2)return toast('Нужно минимум две станции');stations.splice(index,1);draw();})]);
   }));refresh();
  }
  const save=btn('Открыть черновик конспекта',async()=>{if(!draft||save.disabled)return;save.disabled=true;try{const candidate=draft.plan,fresh=await W.listWork('inventory');if(JSON.stringify(fresh)!==JSON.stringify(stock)){toast('Остатки инвентаря изменились. Откройте конструктор заново.');return;}await planForm(candidate,back,'school');}catch(e){toast(e.message);}finally{save.disabled=!draft;}},'primary');
  function refresh(){try{
   const pupils=cls.value?S.studentsOfClass(cls.value):[],lesson={classId:cls.value,date:date.value};
   if(cls.value&&!S.state.classes.some(c=>c.id===cls.value))throw Error('Класс недоступен');
   if(!validPeriod(date.value,null))throw Error('Укажите дату проверки');
   draft=W.circuitDraft({name:name.value.trim(),minutes:num(duration),rounds:num(rounds),work:num(work),transition:num(transition),warmup:{exercise:byExercise(warmup.value),minutes:num(warmMinutes)},cooldown:{exercise:byExercise(cooldown.value),minutes:num(coolMinutes)},stations:stations.map(s=>({...s,exercise:byExercise(s.exerciseId)})),pupilCount:pupils.length,inventory:stock});
   const review=cls.value?W.lessonPlanReview(draft.plan,lesson,{students:pupils,activities:S.activities(),restrictions:S.state.activityRestrictions,exemptions:S.state.exemptions}):null;
   const rows=review?review.items.slice(0,stations.length+1).concat(review.items.slice(-1)):[];
   result.replaceChildren(card('Расчёт кругов',[p(draft.total+' / '+duration.value+' мин · '+draft.groups+' групп'),p(cls.value?'Максимум '+draft.groupSize+' человек в группе (весь состав класса, без автоматического распределения).':'Выберите класс для оценки вместимости и ограничений.'),...draft.capacityIssues.map(x=>p('Станция '+x.station+': вместимость '+x.capacity+', требуется '+x.required+' — пересмотрите группы.')),p('Время: разминка + круги × станции × (работа + переход) + завершение.')]),
    card('Схема переходов одного круга',[p('Номер в ячейке — станция, на которой работает условная группа. Схема повторяется в каждом круге.'),el('div',{class:'analytics-table'},[el('table',{},[el('thead',{},[el('tr',{},[el('th',{text:'Слот'}),...Array.from({length:draft.groups},(_,i)=>el('th',{text:'Гр. '+(i+1)}))])]),el('tbody',{},draft.rotation.map((row,i)=>el('tr',{},[el('th',{text:String(i+1)}),...row.map(n=>el('td',{text:String(n)}))])))])])]),
    equipmentCard(draft.plan.resources,stock),
    card('Проверка нагрузки',[p(review?'ОСВ: '+review.full.length+' · проверка по внесённым сведениям на '+M.fmtFull(date.value)+'.':'Без класса ограничения не проверены.'),...rows.map(({item,matches,potentialMatches,needsReview})=>p(item.exercise.name+' · совпадения: '+new Set(matches.map(m=>m.studentId)).size+' · возможные: '+new Set(potentialMatches.map(m=>m.studentId)).size+(needsReview?' · уточнить нагрузку':''))),p('Ни отсутствие совпадений, ни расчёт вместимости не означают допуск. Индивидуальные задания и группы определяет учитель.')]));
   save.disabled=false;
  }catch(e){draft=null;save.disabled=true;result.replaceChildren(p(e.message));}}
  for(const n of [name,duration,rounds,work,transition,warmMinutes,coolMinutes,date])n.oninput=refresh;
  for(const n of [cls,warmup,cooldown,date])n.onchange=refresh;
  templateControls.append(field('Библиотека станций',templatePicker),btn('Добавить станцию из библиотеки',()=>{try{const t=templates.find(x=>x.id===templatePicker.value);if(!t)throw Error('Выберите шаблон');if(stations.length>=10)throw Error('Не более 10 станций');const s=W.stationFromTemplate(t),id='template:'+M.uid('snapshot');snapshots.set(id,s.exercise);stations.push({exerciseId:id,capacity:s.capacity,notes:s.notes,resources:s.resources});draw();}catch(e){toast(e.message);}}),btn('Удалить шаблон из библиотеки',async()=>{const t=templates.find(x=>x.id===templatePicker.value);if(!t)return toast('Выберите шаблон');if(!await confirmDialog({title:'Удалить шаблон?',text:'Станции, уже добавленные в конструктор и сохранённые конспекты, не изменятся.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(t.id,'stationTemplate');templates.splice(templates.indexOf(t),1);draw();}catch(e){toast(e.message);}}));
  draw();
  openSheet(stack([el('h2',{text:'Конструктор круговой тренировки'}),p('Станции работают одновременно; каждый круг содержит один временной слот на станцию. Это планирование, не таймер.'),field('Название',name),field('Класс',cls),field('Дата проверки',date),field('Длительность занятия',duration),field('Кругов',rounds),field('Работа на станции (мин)',work),field('Переход / организация (мин)',transition),field('Разминка',warmup),field('Минуты разминки',warmMinutes),field('Завершение',cooldown),field('Минуты завершения',coolMinutes),templateControls,list,btn('+ Станция',()=>{if(stations.length>=10)return toast('Не более 10 станций');stations.push({exerciseId:exercises[0].id,capacity:8,notes:'',resources:[]});draw();}),result,save,btn('Назад',back)]),{fullHeight:true});
 }catch(e){toast(e.message);}
}
export async function openLibrary(context='school'){
 let mode='exercise',query='',category='';
 async function draw(){
  try{
   const body=stack([el('h2',{text:'Библиотека и конспекты'}),el('div',{class:'segmented library-tabs'},[el('button',{type:'button',class:mode==='exercise'?'active':'',text:'Упражнения',onclick:()=>{mode='exercise';draw();}}),el('button',{type:'button',class:mode==='plan'?'active':'',text:'Конспекты',onclick:()=>{mode='plan';draw();}})])]);
   const remove=async r=>{if(await confirmDialog({title:'Удалить запись?',text:'Копии упражнения в сохранённых конспектах останутся.',ok:'Удалить',danger:true})){try{await W.deleteWork(r.id,r.kind);await draw();}catch(e){toast(e.message);}}};
   if(mode==='exercise'){
    const all=[...W.builtinExercises,...await W.listWork('exercise')],search=inp(query,'search',{placeholder:'Поиск'}),cat=select([['','Все категории'],...Object.entries(W.exerciseCategories)],category),list=el('div',{class:'coach-stack'});
    const filter=()=>{query=search.value;category=cat.value;list.replaceChildren(...W.librarySearch(all,query,category).map(e=>card(e.name,[el('div',{class:'work-tags'},[el('span',{class:'status-pill',text:W.exerciseCategories[e.category]}),el('span',{class:'status-pill',text:e.minutes+' мин'})]),p(e.description),p('Инвентарь: '+(e.equipment||'не указан')),btn(e.id.startsWith('builtin-')?'Создать свою копию':'Редактировать',()=>exerciseForm(e,draw)),e.id.startsWith('builtin-')?null:btn('Удалить',()=>remove(e))])));};
    search.oninput=filter;cat.onchange=filter;filter();body.append(btn('+ Упражнение',()=>exerciseForm(null,draw),'primary'),field('Поиск',search),field('Категория',cat),list);
   }else{
    const plans=await W.listWork('plan');body.append(btn('+ Конспект',()=>planForm(null,draw,context),'primary'),...plans.map(r=>card(r.name,[el('div',{class:'work-tags'},[el('span',{class:'status-pill',text:W.contexts[r.context]}),el('span',{class:'status-pill',text:r.minutes+' мин'}),el('span',{class:'status-pill',text:r.items.length+' упражнений'})]),p(r.goal),el('div',{class:'phase-summary'},Object.entries(W.phases).map(([id,label])=>el('div',{},[el('small',{text:label}),el('strong',{text:r.items.filter(i=>i.phase===id).reduce((n,i)=>n+i.minutes,0)+' мин'})]))),btn('Открыть / редактировать',()=>planForm(r,draw,context)),btn('Копировать',()=>planForm({...r,id:undefined,name:r.name+' (копия)'},draw,context)),...(r.tactics||[]).map(b=>btn('Схема · '+b.name,()=>openBoardView(b,draw))),...(r.gymBoards||[]).map(b=>btn('Схема зала · '+b.name,()=>openGymView(b,draw))),btn('Экспорт текста',()=>exportPlan(r)),btn('Удалить',()=>remove(r))])));
   }
   if(context==='school')body.append(btn('Резервные сценарии уроков',()=>openFallbackBuilder(draw)),btn('Конструктор круговой тренировки',()=>openCircuitBuilder(draw)));
   body.append(btn('Конструктор спортивного зала',openGymBoards),btn('КТП, тактика и шаблоны документов',()=>openMaterials(draw)),btn('Импорт / экспорт библиотеки',()=>openPortableLibrary(draw)),btn('Закрыть',closeSheet));openSheet(body);
  }catch(e){toast(e.message);}
 }
 await draw();
}
export async function chooseTrainingPlan(onChoose){
 try{const plans=(await W.listWork('plan')).filter(p=>p.context==='coach');openSheet(stack([el('h2',{text:'Шаблон тренировки'}),...plans.map(p=>btn(p.name+' · '+p.minutes+' мин',()=>onChoose(p,W.planExercises(p)))),!plans.length?p('Создайте конспект тренировки в библиотеке.'):null,btn('Закрыть',closeSheet)]));}catch(e){toast(e.message);}
}

async function openPortableLibrary(back){
 const file=el('input',{type:'file',accept:'.json,application/json'}),preview=el('div',{class:'coach-stack'});let raw=null;
 const save=btn('Импортировать копии',async()=>{if(!raw)return;save.disabled=true;try{if(!await confirmDialog({title:'Импортировать материалы?',text:'Добавятся новые независимые копии. Существующие записи не изменятся.',ok:'Импортировать'}))return;const r=await importLocalLibrary(raw,true);toast('Импортировано: '+r.count);back();}catch(e){toast(e.message);}finally{save.disabled=!raw;}},'primary');save.disabled=true;
 file.onchange=async()=>{raw=null;save.disabled=true;preview.replaceChildren();try{const f=file.files?.[0];if(!f)return;if(f.size>MAX_LIBRARY_BYTES)throw Error('Файл больше 2 МБ');const input=await f.text(),b=parseLibrary(input);raw=input;preview.replaceChildren(p('Версия '+b.version+' · материалов '+b.records.length),...b.records.slice(0,80).map(r=>p(r.kind+' · '+r.name)),b.records.length>80?p('Ещё '+(b.records.length-80)+' материалов'):null);save.disabled=!b.records.length;}catch(e){preview.replaceChildren(p(e.message));}};
 openSheet(stack([el('h2',{text:'TeachApp Library'}),p('Локальный версионированный JSON. Экспортируются упражнения, конспекты, схемы зала и отдельно подготовленные материалы КТП, тактики и шаблонов. Списки учеников, оценки, ключи синхронизации и привязки к классам или командам не включаются. Перед отправкой проверьте свободный текст на персональные сведения.'),btn('Экспортировать материалы',async()=>{try{if(!await confirmDialog({title:'Экспорт библиотеки?',text:'Проверьте, что в названиях, заметках и описаниях нет персональных сведений.',ok:'Экспорт'}))return;const b=await exportLocalLibrary();downloadBlob(new Blob([JSON.stringify(b,null,2)],{type:'application/json'}),'teachapp-library-v1.json');}catch(e){toast(e.message);}}),field('Файл материалов',file),preview,save,btn('Назад',back)]),{fullHeight:true});
}

async function openMaterials(back){
 try{
  const S=await import('../store.js'),C=await import('../coach.js'),data=await C.loadCoach();
  const rows=(await Promise.all(materialKinds.map(W.listWork))).flat();
  const kinds={ktpMaterial:'КТП · версия',tacticMaterial:'Тактический шаблон',documentMaterial:'Реквизиты документа'};
  const choose=async()=>{
   const list=stack([el('h2',{text:'Добавить материал'}),p('Создаётся независимый снимок. Проверьте названия и реквизиты на отсутствие персональных данных. Пользовательские категории нагрузок из КТП не переносятся; нагрузки требуют повторной проверки.'),...S.state.ktp.map(k=>btn('КТП · '+k.name,async()=>{try{await saveMaterial(ktpMaterial(k,S.state.topics));await openMaterials(back);}catch(e){toast(e.message);}})),...(await W.listWork('tacticBoard')).map(b=>btn('Тактика · '+b.name,async()=>{try{await saveMaterial(tacticMaterial(b));await openMaterials(back);}catch(e){toast(e.message);}})),...Object.entries(readPresets()).map(([type,preset])=>btn('Документ · '+documentTypes[type],async()=>{try{await saveMaterial(documentMaterial(type,preset));await openMaterials(back);}catch(e){toast(e.message);}})),btn('Назад',()=>openMaterials(back))]);openSheet(list);
  };
  const apply=async r=>{
   const target=r.kind==='tacticMaterial'?select(data.coachTeams.filter(t=>!t.archived).map(t=>[t.id,t.name])):null,name=inp(r.name);
   const body=stack([el('h2',{text:r.name}),p(kinds[r.kind]+' · версия '+r.version),r.kind==='ktpMaterial'?p(r.topics.length+' тем. Новый план не привязан к классам.'):r.kind==='tacticMaterial'?p('Новая схема, без персональных заметок.'):p('Реквизиты заменят только шаблон выбранного типа на этом устройстве, не готовые документы.'),r.kind!=='documentMaterial'?field('Название копии',name):null,target?field('Команда',target):null,...(r.topics||[]).slice(0,40).map(t=>p(t.name)),btn('Применить',async()=>{if(!await confirmDialog({title:'Применить материал?',text:r.kind==='documentMaterial'?'Заменить локальные реквизиты этого типа документа?':'Создать независимую копию, не изменяя исходные записи.',ok:'Применить'}))return;try{await instantiateMaterial(r,{name:name.value.trim(),teamId:target?.value,confirmed:true});if(r.kind==='ktpMaterial')await S.load();toast('Материал применён');await openMaterials(back);}catch(e){toast(e.message);}},'primary'),btn('Назад',()=>openMaterials(back))]);openSheet(body);
  };
  openSheet(stack([el('h2',{text:'Шаблоны и версии материалов'}),btn('+ Сохранить материал',choose,'primary'),...rows.map(r=>card(r.name,[p(kinds[r.kind]+' · v'+r.version),btn('Предпросмотр и применение',()=>apply(r)),btn('Удалить копию материала',async()=>{if(!await confirmDialog({title:'Удалить материал?',text:'Уже созданные КТП, схемы и документы сохранятся.',ok:'Удалить',danger:true}))return;await W.deleteWork(r.id,r.kind);await openMaterials(back);})])),!rows.length?p('Нет сохранённых версий и шаблонов.'):null,btn('Назад',back)]));
 }catch(e){toast(e.message);}
}
