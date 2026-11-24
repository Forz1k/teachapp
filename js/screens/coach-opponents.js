import * as ui from '../ui.js';
import {listWork,saveWork} from '../workbench.js';
import {opponentProfiles,trainingOverview} from '../coach-opponents.js';
import {matchScore} from '../coach.js';
import {todayIso,fmtFull} from '../model.js';
import {openMatchReport} from './match-protocol.js';
const {el,openSheet,closeSheet,toast,promptDialog}=ui;
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
const card=(title,children)=>el('article',{class:'card-block'},[el('h3',{text:title}),...children]);
export async function openOpponents(team,view){
 const render=async()=>{
  try{
   const groups=opponentProfiles(team.id,view.matches,await listWork('opponentNote'));
   const note=async(name,old)=>{const value=await promptDialog({title:'Приватные заметки · '+name,label:'Тактика, наблюдения, задачи к следующему матчу',value:old?.notes||'',multiline:true});if(value===null||value===undefined)return;try{await saveWork({...(old?{id:old.id}:{}),kind:'opponentNote',teamId:team.id,opponent:name,notes:value,updatedAt:new Date().toISOString()});await render();}catch(e){toast(e.message);}};
   const body=el('div',{class:'vp-stack'},[el('h2',{text:'Соперники'}),p('Приватный скаутинг команды '+team.name+'. Встречи берутся только из сохранённых матчей.'),btn('+ Карточка соперника',async()=>{const name=(await promptDialog({title:'Название соперника',label:'Команда'}))?.trim();if(!name)return;const existing=groups.find(g=>g.key===name.replace(/\s+/g,' ').toLocaleLowerCase('ru'));await note(existing?.name||name,existing?.note);},'primary wide')]);
   if(!groups.length)body.append(p('Пока нет встреч и заметок.'));
   for(const g of groups){const latest=g.matches.find(m=>m.detail?.awayPlayers?.length);const children=[p('Матчей: '+g.matches.length+' · В '+g.wins+' / П '+g.losses+' / Н '+g.draws+' · партии '+g.setsFor+':'+g.setsAgainst),g.note?.notes?p(g.note.notes):p('Нет приватных заметок'),btn('Редактировать заметки',()=>note(g.name,g.note),'wide')];
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
 from.onchange=to.onchange=render;openSheet(el('div',{class:'vp-stack'},[el('h2',{text:'Тренировочная нагрузка · '+team.name}),p('Сумма только фактически записанных RPE и минут. Пропуски не заменяются нулями.'),el('label',{},[p('С даты'),from]),el('label',{},[p('По дату'),to]),content]));render();
}
