import * as W from '../workbench.js';
import {catalog} from '../health.js';
import {el,openSheet,closeSheet,toast,confirmDialog,downloadBlob} from '../ui.js';
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
 const text=[plan.name,W.contexts[plan.context]+' · '+plan.minutes+' мин', 'Группа: '+plan.audience,'Цель: '+plan.goal,'Инвентарь: '+plan.equipment,'',...plan.items.flatMap(i=>[W.phases[i.phase]+' · '+i.minutes+' мин · '+i.exercise.name,i.exercise.description,'Инвентарь: '+i.exercise.equipment,'Методические указания: '+i.notes,'']),'Всего: '+plan.items.reduce((n,i)=>n+i.minutes,0)+' мин.'].join('\n');
 downloadBlob(new Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'}),'plan.txt');
}
async function planForm(existing,back,context){
 const e=existing||{},exercises=[...W.builtinExercises,...await W.listWork('exercise')],name=inp(e.name||''),mode=select(Object.entries(W.contexts),e.context||context||'school'),minutes=inp(e.minutes||45,'number',{min:1,max:600}),goal=area(e.goal||''),equipment=inp(e.equipment||''),audience=inp(e.audience||''),items=structuredClone(e.items||[]);
 const list=el('div',{class:'coach-stack plan-items'}),total=el('div',{class:'plan-duration',role:'status'}),pick=select(exercises.map(x=>[x.id,x.name])),phase=select(Object.entries(W.phases),'main');
 const draw=()=>{list.replaceChildren();let sum=0;for(const [index,i] of items.entries()){sum+=Number(i.minutes)||0;const duration=inp(i.minutes,'number',{min:1,max:600}),notes=area(i.notes,2000);duration.oninput=()=>{i.minutes=num(duration);update();};notes.oninput=()=>i.notes=notes.value;list.append(card(W.phases[i.phase]+' · '+i.exercise.name,[p(i.exercise.description),field('Минуты',duration),field('Методические указания',notes),btn('Выше',()=>{if(index&&items[index-1].phase===i.phase){[items[index-1],items[index]]=[items[index],items[index-1]];draw();}}),btn('Убрать',()=>{items.splice(index,1);draw();})]));}update();};
 function update(){
 const sum=items.reduce((n,i)=>n+(Number(i.minutes)||0),0),limit=Number(minutes.value)||0;
 total.classList.toggle('over',sum>limit);
 total.replaceChildren(el('strong',{text:'Запланировано '+sum+' / '+limit+' мин'}),el('progress',{max:Math.max(1,limit,sum),value:sum,'aria-label':'Запланированные минуты'}),el('div',{class:'phase-summary'},Object.entries(W.phases).map(([id,label])=>el('div',{},[el('small',{text:label}),el('strong',{text:items.filter(i=>i.phase===id).reduce((n,i)=>n+(Number(i.minutes)||0),0)+' мин'})]))));
}
 minutes.oninput=update;draw();
 const save=btn('Сохранить конспект',async()=>{save.disabled=true;try{await W.saveWork({id:e.id,kind:'plan',name:name.value.trim(),context:mode.value,minutes:num(minutes),goal:goal.value.trim(),equipment:equipment.value.trim(),audience:audience.value.trim(),items});await back();}catch(err){toast(err.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:'Конспект занятия'}),field('Название',name),field('Тип',mode),field('Класс / группа (без ФИО)',audience),field('Длительность',minutes),field('Цель и задачи',goal),field('Инвентарь',equipment),field('Этап',phase),field('Упражнение',pick),btn('+ Добавить упражнение',()=>{const ex=exercises.find(x=>x.id===pick.value);if(!ex)return;items.push({phase:phase.value,exercise:structuredClone(ex),minutes:ex.minutes,notes:''});items.sort((a,b)=>Object.keys(W.phases).indexOf(a.phase)-Object.keys(W.phases).indexOf(b.phase));draw();}),total,list,save,btn('Назад',back)]));
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
    const plans=await W.listWork('plan');body.append(btn('+ Конспект',()=>planForm(null,draw,context),'primary'),...plans.map(r=>card(r.name,[el('div',{class:'work-tags'},[el('span',{class:'status-pill',text:W.contexts[r.context]}),el('span',{class:'status-pill',text:r.minutes+' мин'}),el('span',{class:'status-pill',text:r.items.length+' упражнений'})]),p(r.goal),el('div',{class:'phase-summary'},Object.entries(W.phases).map(([id,label])=>el('div',{},[el('small',{text:label}),el('strong',{text:r.items.filter(i=>i.phase===id).reduce((n,i)=>n+i.minutes,0)+' мин'})]))),btn('Открыть / редактировать',()=>planForm(r,draw,context)),btn('Копировать',()=>planForm({...r,id:undefined,name:r.name+' (копия)'},draw,context)),btn('Экспорт текста',()=>exportPlan(r)),btn('Удалить',()=>remove(r))])));
   }
   body.append(btn('Закрыть',closeSheet));openSheet(body);
  }catch(e){toast(e.message);}
 }
 await draw();
}
export async function chooseTrainingPlan(onChoose){
 try{const plans=(await W.listWork('plan')).filter(p=>p.context==='coach');openSheet(stack([el('h2',{text:'Шаблон тренировки'}),...plans.map(p=>btn(p.name+' · '+p.minutes+' мин',()=>onChoose(p,W.planExercises(p)))),!plans.length?p('Создайте конспект тренировки в библиотеке.'):null,btn('Закрыть',closeSheet)]));}catch(e){toast(e.message);}
}
