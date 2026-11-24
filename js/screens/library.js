import {exportLocalLibrary,parseLibrary,importLocalLibrary,MAX_LIBRARY_BYTES} from '../portable-library.js';
import {openGymBoards,openGymView} from './methodical.js';
import * as W from '../workbench.js';
import {catalog} from '../health.js';
import {el,openSheet,closeSheet,toast,confirmDialog,downloadBlob} from '../ui.js';
import {equipmentCard} from './resources.js';
import {openBoardView} from './tactics.js';
import {dashboardHeading} from '../dashboard.js';
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
async function planForm(existing,back,context){
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
   body.append(btn('Конструктор спортивного зала',openGymBoards),btn('Импорт / экспорт библиотеки',()=>openPortableLibrary(draw)),btn('Закрыть',closeSheet));openSheet(body);
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
 openSheet(stack([el('h2',{text:'TeachApp Library'}),p('Локальный версионированный JSON. Экспортируются упражнения, конспекты и схемы зала. Списки учеников, оценки, ключи синхронизации, привязки к складу и тактические схемы команд не включаются. Перед отправкой проверьте свободный текст на персональные сведения.'),btn('Экспортировать материалы',async()=>{try{if(!await confirmDialog({title:'Экспорт библиотеки?',text:'Проверьте, что в названиях, заметках и описаниях нет персональных сведений.',ok:'Экспорт'}))return;const b=await exportLocalLibrary();downloadBlob(new Blob([JSON.stringify(b,null,2)],{type:'application/json'}),'teachapp-library-v1.json');}catch(e){toast(e.message);}}),field('Файл материалов',file),preview,save,btn('Назад',back)]),{fullHeight:true});
}
