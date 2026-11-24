import * as C from '../coach.js';
import * as W from '../workbench.js';
import {saveSeasonPlan,seasonPlanProgress,phaseKinds} from '../season-plan.js';
import {todayIso,fmtFull,addDays} from '../model.js';
import {el,openSheet,closeSheet,toast,confirmDialog} from '../ui.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const field=(name,n)=>el('label',{class:'field'},[el('span',{text:name}),n]);
const inp=(value='',type='text',props={})=>el('input',{type,value,...props});
const card=(name,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:name}),...children]);
const select=(entries,value)=>{const n=el('select',{},entries.map(([value,text])=>el('option',{value,text})));n.value=value;return n;};
const number=n=>n.value.trim()===''?null:Number(n.value);
function form(team,plan,back){
 const now=todayIso(),name=inp(plan?.name||'План сезона'),from=inp(plan?.from||now,'date'),to=inp(plan?.to||addDays(now,179),'date');
 const phases=structuredClone(plan?.phases||[{name:'Общая подготовка',kind:'general',from:now,to:addDays(now,27),goal:'',sessions:0,minutes:0}]);
 const list=el('div',{class:'coach-stack'});
 function draw(){
  list.replaceChildren();
  phases.forEach((phase,i)=>{
   const title=inp(phase.name),kind=select(Object.entries(phaseKinds),phase.kind),a=inp(phase.from,'date'),b=inp(phase.to,'date'),goal=el('textarea',{rows:2,maxlength:2000},[phase.goal]),sessions=inp(phase.sessions??'','number',{min:0,max:2000,step:1}),minutes=inp(phase.minutes??'','number',{min:0,max:1200000,step:1});
   const update=()=>Object.assign(phase,{name:title.value,kind:kind.value,from:a.value,to:b.value,goal:goal.value,sessions:number(sessions),minutes:number(minutes)});
   for(const n of [title,kind,a,b,goal,sessions,minutes]){n.oninput=update;n.onchange=update;}
   list.append(card('Этап '+(i+1),[field('Название',title),field('Тип',kind),field('Начало',a),field('Окончание',b),field('Цель / задачи',goal),field('Целевое число тренировок',sessions),field('Целевой объём, мин',minutes),btn('Убрать этап',()=>{if(phases.length>1){phases.splice(i,1);draw();}})]));
  });
 }
 draw();
 const save=btn('Сохранить план',async()=>{save.disabled=true;try{await saveSeasonPlan({id:plan?.id,teamId:team.id,name:name.value.trim(),from:from.value,to:to.value,phases:phases.map(x=>({...x,name:x.name.trim()})),revision:plan?.revision??0});await back();}catch(e){toast(e.message);}finally{save.disabled=false;}},'primary');
 openSheet(el('div',{class:'coach-form'},[el('h2',{text:'План подготовки сезона'}),field('Название',name),field('С',from),field('По',to),p('Этапы идут по датам без пересечений. Цели по тренировкам и минутам задаёт тренер.'),list,btn('+ Этап',()=>{if(phases.length>=24)return toast('До 24 этапов');const next=addDays(phases.at(-1).to||from.value,1);phases.push({name:'',kind:'technical',from:next,to:addDays(next,27),goal:'',sessions:0,minutes:0});draw();}),save,btn('Назад',back)]));
}
function summary(x){return 'Проведено '+x.held+' · в расписании '+x.scheduled+' · без подтверждения '+x.unconfirmed+' · впереди '+x.future+' · длительность проведённых по карточкам '+x.recordedMinutes+' мин · матчей '+x.matches;}
export async function openSeasonPlans(team){
 async function draw(){try{
  const plans=(await W.listWork('seasonPlan')).filter(r=>r.teamId===team.id),data=await C.loadCoach(),view=C.teamView(data,team.id);
  const body=el('div',{class:'coach-form'},[el('h2',{text:'Планирование сезона · '+team.name}),p('Факт: проведённые тренировки по отметке тренера; длительность из карточки тренировки, а не фактическая нагрузка спортсменки.'),team.archived?null:btn('+ План сезона',()=>form(team,null,draw),'primary')]);
  for(const plan of plans){
   const a=seasonPlanProgress(plan,view.trainings,view.matches);
   body.append(card(plan.name,[p(fmtFull(plan.from)+' — '+fmtFull(plan.to)),p(summary(a.total)),...a.phases.map(x=>card(x.name,[p(phaseKinds[x.kind]+' · '+fmtFull(x.from)+' — '+fmtFull(x.to)),p(x.goal),p('Цель: '+x.sessions+' тренировок · '+x.minutes+' мин'),p(summary(x))])),el('details',{},[el('summary',{text:'Недельные циклы · '+a.weeks.length}),...a.weeks.map(x=>p(fmtFull(x.from)+' — '+fmtFull(x.to)+' · '+summary(x)))]),btn('Редактировать',()=>form(team,plan,draw)),btn('Удалить план',async()=>{if(!await confirmDialog({title:'Удалить план сезона?',text:'Тренировки и матчи сохранятся.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(plan.id,'seasonPlan');await draw();}catch(e){toast(e.message);}})]));
  }
  if(!plans.length)body.append(p('Нет планов сезона.'));
  body.append(btn('Закрыть',closeSheet));openSheet(body);
 }catch(e){toast(e.message);}}
 await draw();
}
