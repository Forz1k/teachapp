import * as C from '../coach.js';
import * as V from '../volleyball.js';
import {openDetailedSetup,openDetailedMatch,six} from './match-protocol.js';
import {todayIso} from '../model.js';
import * as ui from '../ui.js';
const {el,openSheet,toast}=ui;
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
const p=text=>el('p',{text});
const field=(text,input)=>el('label',{class:'field'},[el('span',{text}),input]);
function select(rows,value){const node=el('select',{},rows.map(([value,text])=>el('option',{value:String(value),text})));if(value!=null)node.value=String(value);return node;}
const name=(players,id)=>{const p=players.find(x=>x.id===id);return p?(p.number==null?'':'№'+p.number+' · ')+p.name:'—';};
function court(players,lineup,libero,liberoFor,serve,onPick){
 return el('div',{class:'vb-court','aria-label':'Волейбольная площадка'},[
   el('div',{class:'vb-net',text:'Сетка'}),
   ...[4,3,2,5,6,1].map(z=>{
    const original=lineup[z-1],id=liberoFor===original?libero:original;
    return el('button',{type:'button',class:'vb-zone'+(z===1&&serve==='ours'?' serving':'')+(id===libero?' libero':''),onclick:()=>onPick?.(id),disabled:!onPick},[
      el('strong',{text:'Зона '+z}),el('span',{text:name(players,id)}),id===libero?el('small',{text:'Либеро'}):null,z===1&&serve==='ours'?el('small',{text:'Подача'}):null]);
   })]);
}
function lineupFields(players,initial=[],libero=null,withLibero=true){
 const lib=select([['','Без либеро'],...players.map(p=>[p.id,name(players,p.id)])],libero||'');
 const editor=six(players,initial,()=>lib.value);
 lib.onchange=()=>{if(lib.value&&editor.get().includes(lib.value)){toast('Либеро должен быть вне стартовой шестёрки');lib.value='';}editor.refresh();};
 return {node:el('div',{class:'vb-stack'},[editor.node,withLibero?field('Либеро',lib):null]),values:()=>({lineup:editor.get(),libero:lib.value||null})};
}
export async function openMatchCenter(team,refresh){
 try{
 const data=await C.loadCoach(),players=data.coachPlayers.filter(p=>p.teamId===team.id),active=players.filter(p=>!p.archived);
 const body=el('div',{class:'vb-stack'},[el('h2',{text:'Площадка и матч · '+team.name}),p('Черновик матча сохраняется после каждого действия. Статистика отражает только отмеченные действия.')]);
 const back=()=>openMatchCenter(team,refresh);
 body.append(btn('+ Новый подробный матч',()=>openDetailedSetup(team,active,back,refresh),'primary wide'),btn('Прежний режим матча',()=>setup(team,active,null,refresh),'wide'),btn('+ Сохранить расстановку',()=>setup(team,active,{preset:true},refresh),'wide'));
 for(const x of data.coachLineups.filter(x=>x.teamId===team.id))body.append(el('div',{class:'card-block vb-stack'},[p(x.name+' · '+V.schemes[x.scheme]),court(players,x.lineup,x.libero,null,null,null),
   btn('Начать с этой расстановкой',()=>openDetailedSetup(team,active,back,refresh,x),'wide'),btn('Удалить расстановку',async()=>{if(await ui.confirmDialog({title:'Удалить расстановку?',text:'Матчи не меняются.',ok:'Удалить'})){await C.deleteLineup(x.id);openMatchCenter(team,refresh);}},'wide')]));
 for(const d of data.coachLive.filter(x=>x.teamId===team.id)){
  const s=V.replay(d);body.append(el('div',{class:'card-block vb-stack'},[p(d.date+' · '+d.opponent+' · '+s.ours+':'+s.theirs),btn('Продолжить матч',()=>d.mode==='dual'?openDetailedMatch(d,back,refresh):live(team,players,d,refresh),'primary wide')]));
 }
 body.append(btn('Закрыть',ui.closeSheet,'wide'));openSheet(body);
 }catch(e){toast(e.message);}
}
function setup(team,players,preset,refresh){
 const isPreset=preset?.preset===true;
 if(players.length<6)return toast('Нужно не менее шести действующих игроков');
 const title=el('input',{placeholder:isPreset?'Название расстановки':'Соперник'}),competition=el('input',{placeholder:'Соревнование'}),day=el('input',{type:'date',value:todayIso(),max:todayIso()});
 const scheme=select(Object.entries(V.schemes),preset?.scheme||'5-1'),best=select([[3,'До двух побед'],[5,'До трёх побед']],3),target=select([15,21,25].map(n=>[n,n]),25),decider=select([15,21,25].map(n=>[n,n]),15),serve=select([['ours','Наши'],['theirs','Соперник']],'ours');
 const l=lineupFields(players,preset?.lineup,preset?.libero),roster=players.map(p=>p.id);
 const warnings=el('div',{class:'vb-stack'}),drawWarnings=()=>{
  const m=C.trainingWarnings({date:day.value,roster,exercises:[{name:'Волейбол',activityId:'volley'},{name:'Прыжки',activityId:'jump'},{name:'Соревнование',activityId:'competition'}]},players);
  warnings.replaceChildren(p(m.length?'Проверьте ограничения у '+new Set(m.map(x=>x.player.id)).size+' игроков.':'По выбранным нагрузкам совпадений нет. Это не медицинский допуск.'),...m.map(x=>p(name(players,x.player.id)+' · '+x.exercises.map(e=>e.name).join(', '))));
 };day.onchange=drawWarnings;drawWarnings();
 let busy=false;
 const save=btn(isPreset?'Сохранить':'Начать матч',async()=>{
  if(busy)return;busy=true;save.disabled=true;
  try{
   const values=l.values();
   if(!V.validLineup(values.lineup,roster)||values.lineup.includes(values.libero))throw Error('Выберите шесть разных игроков и отдельного либеро');
   if(isPreset){await C.saveLineup({teamId:team.id,name:title.value,scheme:scheme.value,roster,...values});await openMatchCenter(team,refresh);}
   else{
    if(!await ui.confirmDialog({title:'Начать матч?',text:'Подтвердите фактический состав и допустимость нагрузки. Проверки не заменяют решение тренера.',ok:'Начать'}))return;
    const d=await C.startLiveMatch({teamId:team.id,date:day.value,opponent:title.value,competition:competition.value,scheme:scheme.value,roster,...values,bestOf:Number(best.value),target:Number(target.value),decider:Number(decider.value),firstServe:serve.value});live(team,players,d,refresh);
   }
  }catch(e){toast(e.message);}finally{busy=false;save.disabled=false;}
 },'primary wide');
 openSheet(el('div',{class:'vb-stack'},[el('h2',{text:isPreset?'Расстановка':'Новый матч'}),field(isPreset?'Название':'Соперник',title),field('Схема (подсказка тренера)',scheme),
   p('5–1 и 4–2 — обозначения схемы. Позиции задаются вручную, приложение не проверяет тактические обязанности.'),
   ...(!isPreset?[field('Дата',day),field('Соревнование',competition),field('Формат',best),field('Очков в партии',target),field('Решающая партия',decider),field('Первая подача',serve),warnings]:[]),
   l.node,save,btn('Назад',()=>openMatchCenter(team,refresh),'wide')]));
}
function live(team,players,initial,refresh){
 let d=initial,busy=false,selected=null;
 const body=el('div',{class:'vb-stack'});
 const perform=async ev=>{if(busy)return;busy=true;try{d=await C.changeLiveMatch(d.id,d.revision,ev);draw();}catch(e){toast(e.message);}finally{busy=false;}};
 function draw(){
  const s=V.replay(d),won=s.sets.filter(x=>x.ours>x.theirs).length;
  const ids=s.lineup.map(id=>id===s.liberoFor?d.libero:id);
  if(!ids.includes(selected))selected=null;
  body.replaceChildren(el('h2',{text:team.name+' — '+d.opponent}),p('Партии: '+won+':'+(s.sets.length-won)+' · '+s.sets.map(x=>x.ours+':'+x.theirs).join(' / ')),
   el('div',{class:'vb-score',text:s.ours+' : '+s.theirs}),p('Подача: '+(s.serve==='ours'?'Наши':'Соперник')+' · '+V.schemes[d.scheme]),
   court(players,s.lineup,d.libero,s.liberoFor,s.serve,id=>{selected=id;draw();}),p('Выбран: '+name(players,selected)));
  if(s.finished)body.append(p('Матч завершён'),btn('Сохранить в историю матчей',async()=>{
    if(busy||!await ui.confirmDialog({title:'Сохранить матч?',text:'Счёт и отмеченные действия будут перенесены в историю. Черновик будет закрыт.',ok:'Сохранить'}))return;
    busy=true;try{await C.finishLiveMatch(d.id,d.revision);ui.closeSheet();await refresh();}catch(e){toast(e.message);}finally{busy=false;}
  },'primary wide'));
  else if(s.setEnded){
    const previous=[...d.events].reverse().find(e=>e.type==='next')?.lineup||d.lineup;
    const l=lineupFields(players.filter(p=>d.roster.includes(p.id)&&p.id!==d.libero),previous,null,false),serve=select([['ours','Наши'],['theirs','Соперник']],s.sets.length%2===0?d.firstServe:d.firstServe==='ours'?'theirs':'ours');
    body.append(p('Партия завершена'),l.node,field('Подача в следующей партии',serve),btn('Начать следующую партию',()=>perform({type:'next',lineup:l.values().lineup,serve:serve.value}),'primary wide'));
  }else{
    const rally=(side,kind,player=null)=>perform({type:'rally',side,kind,player});
    body.append(el('div',{class:'vb-actions'},[btn('+ Очко нашим',()=>rally('ours','point'),'primary'),btn('+ Очко сопернику',()=>rally('theirs','point'))]),
      p('Очковые действия уже добавляют очко. Не нажимайте счёт повторно. Подача в игре — только не завершившая розыгрыш эйсом или ошибкой.'),
      el('div',{class:'vb-actions'},[...Object.entries(V.rallyKinds).filter(([k])=>k!=='point').map(([k,t])=>btn(t,()=>rally(k==='serveError'?'theirs':'ours',k,selected))),
       ...Object.entries(V.actionKinds).map(([k,t])=>btn(t,()=>perform({type:'action',kind:k,player:selected})))]),
      el('div',{class:'vb-actions'},[btn('Наш тайм-аут '+s.timeouts.ours+'/2',()=>perform({type:'timeout',side:'ours'})),btn('Тайм-аут соперника '+s.timeouts.theirs+'/2',()=>perform({type:'timeout',side:'theirs'}))]));
    const reserve=select([['','Выберите запасного'],...players.filter(p=>d.roster.includes(p.id)&&!p.archived&&!s.lineup.includes(p.id)&&p.id!==d.libero).map(p=>[p.id,name(players,p.id)])],'');
    body.append(field('Замена выбранного игрока',reserve),btn('Заменить · '+s.subs+'/6',()=>perform({type:'sub',out:selected,in:reserve.value}),'wide'));
    if(d.libero)body.append(btn(s.liberoFor?'Вернуть основного игрока':'Либеро вместо выбранного',()=>perform({type:'libero',for:s.liberoFor?null:selected}),'wide'));
  }
  body.append(p('Отмеченная статистика (не полный протокол):'),...Object.entries(s.stats).map(([id,r])=>p(name(players,id)+' · '+Object.entries(r).map(([k,v])=>C.metrics[k]+': '+v).join(' · '))),
   btn('Отменить последнее действие',()=>{if(d.events.length)perform(null);},'wide'),btn('Сохранить черновик и выйти',()=>openMatchCenter(team,refresh),'wide'),
   btn('Удалить черновик',async()=>{if(busy||!await ui.confirmDialog({title:'Удалить черновик?',text:'Действия этого матча будут удалены.',ok:'Удалить',danger:true}))return;busy=true;try{await C.discardLiveMatch(d.id,d.revision);openMatchCenter(team,refresh);}catch(e){toast(e.message);}finally{busy=false;}},'wide'));
 }
 draw();openSheet(body);
}
