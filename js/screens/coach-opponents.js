import {openTrainingDynamics} from './training-dynamics.js';
import * as ui from '../ui.js';
import {listWork,saveWork} from '../workbench.js';
import {opponentProfiles,trainingOverview,preMatchDossier} from '../coach-opponents.js';
import {matchScore,loadCoach,teamView} from '../coach.js';
import {catalog,types} from '../health.js';
import {todayIso,fmtFull} from '../model.js';
import {openMatchReport} from './match-protocol.js';
const {el,openSheet,closeSheet,toast,promptDialog}=ui;
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
const card=(title,children)=>el('article',{class:'card-block'},[el('h3',{text:title}),...children]);
export async function openPreMatchDossier(team,back=closeSheet,initialOpponent='',initialDate=todayIso()){
 try{
  const data=await loadCoach(),view=teamView(data,team.id),[notes,goals]=await Promise.all([listWork('opponentNote'),listWork('coachGoal')]),groups=opponentProfiles(team.id,view.matches,notes);
  const opponent=el('input',{type:'text',value:initialOpponent||groups[0]?.name||'',maxlength:200,'aria-label':'Соперник для досье'}),pick=el('select',{},[el('option',{value:'',text:'Известные соперники'}),...groups.map(g=>el('option',{value:g.name,text:g.name}))]),date=el('input',{type:'date',value:initialDate}),limit=el('select',{},[3,5,10].map(n=>el('option',{value:String(n),text:String(n)+' матчей'}))),out=el('div',{class:'vp-stack','aria-live':'polite'});
  limit.value='5';
  const field=(name,n)=>el('label',{class:'field'},[el('span',{text:name}),n]),pct=(n,d)=>d?Math.round(100*n/d)+'% · '+n+'/'+d:'Нет данных',activity=id=>catalog.find(a=>a.id===id)?.name||id;
  const draw=()=>{try{
   if(!opponent.value.trim()){out.replaceChildren(p('Укажите соперника, включая нового без истории.'));return;}
   const a=preMatchDossier(team.id,view,{opponent:opponent.value,date:date.value,limit:Number(limit.value),notes,goals}),t=a.totals,max=Math.max(1,...t.zones);
   out.replaceChildren(card('История встреч',[p('Матчей: '+a.history.length+' · В '+t.wins+' / П '+t.losses+' / Н '+t.draws+' · партии '+t.setsFor+':'+t.setsAgainst),p('История до '+fmtFull(a.asOf)+' включительно; матчи в дату подготовки не предполагаются завершёнными.'),...a.history.map(m=>p(fmtFull(m.date)+' · '+matchScore(m).ours+':'+matchScore(m).theirs+(m.detail?' · подробный протокол':' · без журнала розыгрышей'))),!a.history.length?p('Встреч в этой выборке нет.'):null]),
    card('Игра против соперника',[p('Подробных протоколов: '+t.detailed+' из '+a.history.length+' · розыгрышей: '+t.rallies),p('Выиграно на своей подаче: '+pct(t.serveWon,t.serve)),p('Выиграно на приёме: '+pct(t.receiveWon,t.receive)),p('Зоны соперника при наших отмеченных результативных завершениях: известно '+t.knownZones+' из '+t.zoneTotal+'. Не показатель слабости или всех попыток.'),
     el('div',{class:'vp-heat-grid'},[4,3,2,5,6,1].map(z=>el('div',{class:'vp-heat-cell',style:'--heat:'+(t.zones[z-1]/max)},[el('small',{text:'P'+z}),el('strong',{text:String(t.zones[z-1])})]))),t.rallies<30?p('Малая выборка: не делайте устойчивых тактических выводов.'):null]),
    card('Состав соперника и заметки',[p('Последний записанный состав (не заявка на предстоящий матч): '+(a.latestRoster.map(x=>(x.number??'—')+' '+x.name).join(', ')||'не записан')),p('Текущие приватные заметки: '+(a.note?.notes||'нет')),p('Идентификаторы игроков соперника не объединяются между матчами.')]),
    card('Наша команда · проверить перед матчем',[p('Текущий активный состав; ограничения на дату матча. Явка и фактическая нагрузка за 14 дней до '+fmtFull(a.asOf)+' включительно. Не прогноз готовности и не медицинский допуск.'),
     ...a.roster.map(({player,restrictions,attendance:v,load:l,goals:g})=>card((player.number==null?'':'№'+player.number+' · ')+player.name,[p('Явка: '+(v.present+v.limited)+' посещений · отсутствовала '+v.absent+' · неизвестно '+v.unknown),p('RPE × мин: '+(l.total??'не записано')+' · измерений '+l.known+'/'+l.attended),...restrictions.map(r=>p('Проверить: '+activity(r.activityId)+' · '+(types[r.type]||r.type))),...g.map(({goal,progress})=>p('Цель: '+goal.name+' · срок '+fmtFull(goal.to)+' · '+(progress.enough?progress.met?'порог достигнут по данным':'в работе':'недостаточно данных')))])),
     !a.roster.length?p('Нет активного состава.'):null]));
  }catch(e){out.replaceChildren(p(e.message));}};
  pick.onchange=()=>{if(pick.value)opponent.value=pick.value;draw();};opponent.oninput=date.onchange=limit.onchange=draw;draw();
  openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Предматчевое досье'}),p(team.name+' · приватный обзор. Никакие данные состава, здоровья, целей или заметок не публикуются.'),field('Из истории',pick),field('Соперник',opponent),field('Дата матча',date),field('Глубина истории',limit),out,btn('Назад',back,'wide')]),{fullHeight:true});
 }catch(e){toast(e.message);}
}
export async function openOpponents(team,view){
 const render=async()=>{
  try{
   const groups=opponentProfiles(team.id,view.matches,await listWork('opponentNote'));
   const note=async(name,old)=>{const value=await promptDialog({title:'Приватные заметки · '+name,label:'Тактика, наблюдения, задачи к следующему матчу',value:old?.notes||'',multiline:true});if(value===null||value===undefined)return;try{await saveWork({...(old?{id:old.id}:{}),kind:'opponentNote',teamId:team.id,opponent:name,notes:value,updatedAt:new Date().toISOString()});await render();}catch(e){toast(e.message);}};
   const body=el('div',{class:'vp-stack'},[el('h2',{text:'Соперники'}),p('Приватный скаутинг команды '+team.name+'. Встречи берутся только из сохранённых матчей.'),btn('+ Карточка соперника',async()=>{const name=(await promptDialog({title:'Название соперника',label:'Команда'}))?.trim();if(!name)return;const existing=groups.find(g=>g.key===name.replace(/\s+/g,' ').toLocaleLowerCase('ru'));await note(existing?.name||name,existing?.note);},'primary wide')]);
   if(!groups.length)body.append(p('Пока нет встреч и заметок.'));
   for(const g of groups){const latest=g.matches.find(m=>m.detail?.awayPlayers?.length);const children=[p('Матчей: '+g.matches.length+' · В '+g.wins+' / П '+g.losses+' / Н '+g.draws+' · партии '+g.setsFor+':'+g.setsAgainst),g.note?.notes?p(g.note.notes):p('Нет приватных заметок'),btn('Редактировать заметки',()=>note(g.name,g.note),'wide'),btn('Предматчевое досье',()=>openPreMatchDossier(team,render,g.name),'wide')];
    if(latest)children.push(p('Последний записанный состав: '+latest.detail.awayPlayers.map(x=>(x.number??'—')+' '+x.name).join(', ')));
    for(const m of g.matches){const score=matchScore(m);children.push(p(fmtFull(m.date)+' · '+score.ours+':'+score.theirs+' · '+(m.competition||'Без турнира')));if(m.detail)children.push(btn('Протокол '+fmtFull(m.date),()=>openMatchReport(m,render),'wide'));}
    body.append(card(g.name,children));
   }openSheet(body);
  }catch(e){toast(e.message);}
 };await render();
}
export function openTrainingOverview(team,view){
 const from=el('input',{type:'date'}),to=el('input',{type:'date',value:todayIso()}),content=el('div',{class:'vp-stack'});
 const render=()=>{if(from.value&&to.value&&from.value>to.value){content.replaceChildren(p('Начальная дата позже конечной'));return;}const report=trainingOverview(view,{from:from.value,to:to.value,today:todayIso()});content.replaceChildren(p('Тренировок в выборке: '+report.count+' · проведено: '+report.held),...report.players.map(({player,attendance:a,load:l})=>card(player.name,[p('Явка: '+(a.pct===null?'—':a.pct+'%')+' · присутствие '+a.present+' · ограниченная нагрузка '+a.limited+' · отсутствие '+a.absent+' · неизвестно '+a.unknown),p('Нагрузка RPE × мин: '+(l.total===null?'не записана':l.total)+' · измерений '+l.known+' из '+l.attended),...l.rows.map(r=>p(fmtFull(r.date)+' · '+r.title+' · '+r.minutes+' мин × '+r.rpe+' = '+r.value))])));};
 from.onchange=to.onchange=render;openSheet(el('div',{class:'vp-stack'},[el('h2',{text:'Тренировочная нагрузка · '+team.name}),btn('Недельная динамика подготовки',()=>openTrainingDynamics(view,{back:()=>openTrainingOverview(team,view),initial:{from:from.value,to:to.value}}),'primary wide'),p('Сумма только фактически записанных RPE и минут. Пропуски не заменяются нулями.'),el('label',{},[p('С даты'),from]),el('label',{},[p('По дату'),to]),content]));render();
}
