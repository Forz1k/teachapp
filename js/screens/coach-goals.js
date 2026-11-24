import * as W from '../workbench.js';
import * as C from '../coach.js';
import {testPresets,definitionKey} from '../coach-tests.js';
import {goalMetrics,goalStatuses,saveGoal,goalProgress} from '../coach-goals.js';
import {todayIso,addDays,fmtFull} from '../model.js';
import {trendChart} from '../dashboard.js';
import {el,openSheet,closeSheet,toast,confirmDialog} from '../ui.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const inp=(value='',type='text',props={})=>el('input',{value,type,...props});
const area=(value='',max=2000)=>el('textarea',{rows:3,maxlength:max},[value]);
const field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]);
const select=(rows,value)=>{const n=el('select',{},rows.map(([value,text])=>el('option',{value,text})));n.value=value??rows[0]?.[0]??'';return n;};
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const stack=children=>el('div',{class:'coach-form'},children);
const number=n=>n.value.trim()===''?null:Number(n.value);
const fmt=(n,unit)=>n==null?'—':Math.round(n*100)/100+' '+unit;
async function goalForm(team,player,existing,back){
 const data=await C.loadCoach(),sessions=data.coachTests.filter(t=>t.teamId===team.id),defs=new Map();
 for(const d of [...Object.values(testPresets),...sessions.map(t=>t.definition),...(existing?[existing.definition]:[])])defs.set(definitionKey(d),d);
 const g=existing||{},name=inp(g.name||''),from=inp(g.from||todayIso(),'date'),to=inp(g.to||addDays(todayIso(),30),'date'),def=select([...defs.entries()].map(([k,d])=>[k,d.name+' · '+d.protocol]),g.definition?definitionKey(g.definition):undefined),metric=select([]),baseline=inp(g.baseline??'','number',{min:0,step:'any'}),target=inp(g.target??'','number',{min:0,step:'any'}),status=select(Object.entries(goalStatuses),g.status||'active'),actions=area(g.actions||''),exercises=structuredClone(g.exercises||[]),observations=structuredClone(g.observations||[]);
 const all=[...W.builtinExercises,...await W.listWork('exercise')],choose=select(all.map(e=>[e.id,e.name])),list=el('div',{class:'coach-stack'}),obs=el('div',{class:'coach-stack'}),note=area('',1000),noteDate=inp(todayIso(),'date',{max:todayIso()});
 function metrics(){const d=defs.get(def.value),old=metric.value,keys=d.kind==='skill'?['success','target','errors']:['measure'];metric.replaceChildren(...keys.map(k=>el('option',{value:k,text:goalMetrics[k]})));metric.value=keys.includes(old)?old:keys.includes(g.metric)?g.metric:keys[0];}
 def.onchange=metrics;metrics();
 function draw(){list.replaceChildren(...exercises.map((e,i)=>card(e.name,[p(e.minutes+' мин · проверить нагрузку перед занятием'),btn('Убрать',()=>{exercises.splice(i,1);draw();})])));obs.replaceChildren(...observations.map((o,i)=>card(fmtFull(o.date),[p(o.text),btn('Убрать наблюдение',()=>{observations.splice(i,1);draw();})])));}
 draw();
 const save=btn('Сохранить цель',async()=>{save.disabled=true;try{
  if(note.value.trim())throw Error('Сначала добавьте набранное наблюдение в черновик');
  await saveGoal({id:g.id,kind:'coachGoal',teamId:team.id,playerId:player.id,name:name.value.trim(),from:from.value,to:to.value,definition:defs.get(def.value),metric:metric.value,baseline:number(baseline),target:number(target),status:status.value,actions:actions.value.trim(),exercises,observations,revision:g.revision??0});
  await back();
 }catch(e){toast(e.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:existing?'Редактировать цель':'Новая цель'}),field('Название',name),el('div',{class:'coach-columns'},[field('Начало',from),field('Срок',to)]),field('Методика',def),field('Показатель',metric),p('Начальное значение — введённая вами точка отсчёта. Проценты цели и исходного уровня задаются от 0 до 100. Оценка прогресса не является допуском к нагрузке.'),field('Начальное значение (необязательно)',baseline),field('Цель',target),field('Статус',status),field('Индивидуальные задачи',actions),field('Упражнение из библиотеки',choose),btn('+ В план',()=>{const e=all.find(e=>e.id===choose.value);if(e&&exercises.length<30){exercises.push({name:e.name,activityId:e.activityId,minutes:e.minutes});draw();}}),list,field('Дата наблюдения',noteDate),field('Наблюдение (без медицинских сведений)',note),btn('+ Добавить наблюдение',()=>{if(note.value.trim()&&noteDate.value&&noteDate.value<=todayIso()&&observations.length<200){observations.push({date:noteDate.value,text:note.value.trim()});note.value='';draw();}}),obs,save,btn('Назад',back)]));
}
export async function openPlayerGoals(team,player,back=closeSheet){
 async function draw(){try{
  const data=await C.loadCoach(),goals=(await W.listWork('coachGoal')).filter(g=>g.teamId===team.id&&g.playerId===player.id);
  const body=stack([el('h2',{text:'Индивидуальный план · '+player.name}),p('Прогресс считается по той же методике. Для долей — два последних сопоставимых теста, не менее 20 попыток. Для замера — последний сопоставимый результат. Выполнение подтверждает тренер.')]);
  if(!team.archived&&!player.archived)body.append(btn('+ Новая цель',()=>goalForm(team,player,null,draw).catch(e=>toast(e.message)),'primary'));
  for(const g of goals.sort((a,b)=>a.status.localeCompare(b.status)||a.to.localeCompare(b.to))){
   const v=goalProgress(g,data.coachTests),indicator=v.progress==null?null:el('progress',{max:100,value:Math.max(0,Math.min(100,v.progress)),'aria-label':'Прогресс к цели'});
   body.append(card(g.name,[p(goalStatuses[g.status]+(v.overdue?' · срок истёк':'')+' · до '+fmtFull(g.to)),p(g.definition.name+' · '+goalMetrics[g.metric]),el('div',{class:'goal-values'},[el('div',{},[el('small',{text:'Начало (вручную)'}),el('strong',{text:fmt(g.baseline,v.unit)})]),el('div',{},[el('small',{text:'Факт'}),el('strong',{text:fmt(v.current,v.unit)})]),el('div',{},[el('small',{text:'Цель'}),el('strong',{text:fmt(g.target,v.unit)})])]),indicator,p(v.enough?v.met?'Порог достигнут по записанным данным':'Порог пока не достигнут':'Недостаточно сопоставимых данных для подтверждения'),v.attempts===null?null:p('Попыток '+v.attempts+' · тестов '+v.recorded),trendChart(v.rows.slice(-20),{unit:v.unit,label:g.name}),p(g.actions),...g.exercises.map(e=>p(e.name+' · '+e.minutes+' мин')),el('details',{},[el('summary',{text:'Наблюдения · '+g.observations.length}),...g.observations.map(o=>p(fmtFull(o.date)+' · '+o.text))]),btn('Редактировать',()=>goalForm(team,player,g,draw).catch(e=>toast(e.message))),btn('Удалить',async()=>{if(!await confirmDialog({title:'Удалить цель?',text:'Тесты, матчи и результаты сохранятся.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(g.id,'coachGoal');await draw();}catch(e){toast(e.message);}})]));
  }
  if(!goals.length)body.append(p('Индивидуальных целей пока нет.'));
  body.append(btn('Назад',back));openSheet(body);
 }catch(e){toast(e.message);}}
 await draw();
}
