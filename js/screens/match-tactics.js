import {seasonCapture,touchActions} from '../match-capture.js';
import {replayDetailed} from '../match-protocol.js';
import {matchTactics,teamTactics,opponentHistory,matchDebrief,trainingRecommendations,recordedConnections} from '../match-tactics.js';
import {builtinExercises,listWork} from '../workbench.js';
import {fmtFull} from '../model.js';
import {buildDocument} from '../documents.js';
import {openDocumentPreview,matchDebriefInput} from './documents.js';
import {metric} from '../dashboard.js';
import {el,openSheet,closeSheet} from '../ui.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{class:'btn wide '+kind,type:'button',text,onclick});
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const stack=children=>el('div',{class:'coach-form'},children);
const field=(title,n)=>el('label',{class:'field'},[el('span',{text:title}),n]);
const percent=x=>x==null?'—':Math.round(x*10)/10+'%';
const name=(players,id)=>{const a=players.find(p=>p.id===id);return a?(a.number==null?'':'№'+a.number+' ')+a.name:'Игрок из истории';};
function summary(a){
 return el('div',{class:'dashboard-metrics'},[metric('Розыгрышей',a.rallies,'chart'),metric('Выиграно',percent(a.rate),'check'),metric('На своей подаче',percent(a.serveRate),'quick',a.serveWon+'/'+a.serve),metric('На приёме (side-out)',percent(a.receiveRate),'quick',a.receiveWon+'/'+a.receive)]);
}
function rotations(rows){
 return card('Эффективность циклов расстановки',[p('P1–P6 — циклы переходов относительно стартового состава каждой партии, не отдельные зоны площадки. Процент — доля выигранных розыгрышей.'),el('div',{class:'tactical-grid'},rows.map(r=>el('div',{class:'tactical-cell'+(r.eligible===false?' sample-small':'')},[el('small',{text:'P'+r.position}),el('strong',{text:percent(r.rate)}),el('span',{text:r.won+' / '+r.rallies}),r.eligible===false?p('Мало данных'):null]))),...rows.map(r=>p('P'+r.position+' · подача '+percent(r.serveRate)+' ('+r.serve+') · приём '+percent(r.receiveRate)+' ('+r.receive+')'))]);
}
function scoreChart(set){
 const ns='http://www.w3.org/2000/svg',node=(tag,attrs)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
 const max=Math.max(1,...set.score.map(s=>Math.max(s.ours,s.theirs))),n=Math.max(1,set.score.length-1);
 const x=i=>30+276*i/n,y=v=>110-90*v/max;
 const svg=node('svg',{viewBox:'0 0 320 132',role:'img','aria-label':'Партия '+set.set+', итог '+set.score.at(-1).ours+':'+set.score.at(-1).theirs});
 for(const v of [0,Math.ceil(max/2),max]){
  svg.append(node('line',{x1:30,x2:306,y1:y(v),y2:y(v),class:'trend-grid'}));const t=node('text',{x:2,y:y(v)+4,class:'trend-tick'});t.textContent=String(v);svg.append(t);
 }
 for(const side of ['ours','theirs']){
  let d='M'+x(0)+' '+y(0);for(let i=1;i<set.score.length;i++)d+=' H'+x(i)+' V'+y(set.score[i][side]);
  svg.append(node('path',{d,class:'score-trend '+side,fill:'none'}));
 }
 return el('div',{class:'trend-chart'},[svg,el('div',{class:'score-legend'},[el('span',{class:'ours',text:'Наша команда'}),el('span',{class:'theirs',text:'Соперник'})]),p('Розыгрыши 0–'+n)]);
}
function combos(rows,players,title){
 const eligible=rows.filter(r=>r.eligible),small=rows.filter(r=>!r.eligible);
 return card(title,[p('Наблюдаемая доля выигранных розыгрышей в присутствии сочетания, не доказательство индивидуального вклада.'),...eligible.slice(0,15).map(r=>el('div',{class:'profile-result'},[el('strong',{text:r.players.map(id=>name(players,id)).join(' · ')}),p(percent(r.rate)+' · '+r.won+'/'+r.rallies+(r.matches?' · матчей '+r.matches:'')),el('progress',{max:100,value:r.rate||0,'aria-label':'Доля выигранных розыгрышей'})])),!eligible.length?p('Недостаточно розыгрышей для сравнения.'):null,small.length?el('details',{},[el('summary',{text:'Малая выборка · '+small.length}),...small.slice(0,30).map(r=>p(r.players.map(id=>name(players,id)).join(' · ')+' · '+r.won+'/'+r.rallies))]):null]);
}
function seasonCaptureCard(timelines,players){
 const pick=(items,value='')=>{const n=el('select',{},items.map(([value,text])=>el('option',{value:String(value),text})));n.value=value;return n;};
 const side=pick([['ours','Наша команда'],['theirs','Соперники']],'ours'),action=pick(Object.entries(touchActions),'serve'),player=pick([['','Все игроки'],...players.map(p=>[p.id,name(players,p.id)])]),rotation=pick([['','Все циклы'],...Array.from({length:6},(_,i)=>[i,'P'+(i+1)])]),set=pick([['','Все партии'],...Array.from({length:5},(_,i)=>[i+1,'Партия '+(i+1)])]),out=el('div',{class:'coach-stack'});
 function draw(){if(side.value==='theirs')player.value='';player.disabled=side.value==='theirs';const a=seasonCapture(timelines,{side:side.value,action:action.value,player:player.value||null,rotation:rotation.value===''?null:Number(rotation.value),set:Number(set.value)||0}),s=a.summary,z=a.zones,max=Math.max(1,...z.zones.map(x=>x.count));
 const value=m=>m.value==null?'— (выборка '+m.total+')':percent(m.value)+' · '+m.n+'/'+m.total;
 out.replaceChildren(p('Подробных матчей: '+a.matches+' · с выбранным действием: '+a.recordedMatches+' · зоны известны '+z.known+'/'+z.total),el('div',{class:'vp-heat-grid'},[4,3,2,5,6,1].map(i=>{const n=z.zones[i-1];return el('div',{class:'vp-heat-cell',style:'--heat:'+(n.count/max)},[el('small',{text:'P'+i}),el('strong',{text:n.count}),el('small',{text:'Очки '+n.point+' · ошибки '+n.error})]);})),p('Полных розыгрышей: '+s.complete+'/'+s.rallies+'; в проценты попадают только полностью записанные розыгрыши.'),p('Атака: '+value(s.attackEfficiency)),p('Подача: '+value(s.serveEfficiency)),p('Положительный приём: '+value(s.positiveReceive)),p('Идеальный приём: '+value(s.perfectReceive)),p('Конверсия защиты: '+value(s.defenseConversion)));
 }
 for(const n of [side,action,player,rotation,set])n.onchange=draw;draw();
 return card('Сезонная карта действий',[p('Карта показывает направления зарегистрированных действий, включая частичные записи. P1–P6 на карте — зоны; фильтр цикла — относительная расстановка. Неизвестные зоны не распределяются.'),field('Команда',side),field('Игрок',player),field('Элемент карты',action),field('Цикл переходов',rotation),field('Партия',set),out]);
}
function connectionCard(timelines,players,min=10){
 const a=recordedConnections(timelines,{min});
 return card('Передача → атака',[p('Полных розыгрышей '+a.complete+'/'+a.rallies+' · связки в '+a.linkedRallies+'. Только соседние записанные действия разных игроков; не все передачи и не предполагаемые ассисты.'),...a.rows.slice(0,30).map(r=>el('div',{class:'profile-result'},[el('strong',{text:name(players,r.setter)+' → '+name(players,r.attacker)}),p('Попытки '+r.attempts+' · очки '+r.points+' · ошибки '+r.errors+' · мяч в игре '+r.continued),p(r.eligible?'Эффективность '+percent(r.efficiency):'Мало данных (минимум '+min+' попыток)')])),!a.rows.length?p('Нет полностью записанных связок.'):null]);
}
function substitutionsCard(rows,detail){
 return card('До и после замен',[p('Окна до пяти розыгрышей в одной партии. Пересекающиеся окна и другие события не позволяют считать разницу причиной результата.'),...rows.map(r=>el('div',{class:'profile-result'},[el('strong',{text:'Партия '+r.set+' · '+r.score+' · '+(r.side==='ours'?detail.teamName:detail.opponent)}),p(name(r.side==='ours'?detail.ourPlayers:detail.awayPlayers,r.out)+' → '+name(r.side==='ours'?detail.ourPlayers:detail.awayPlayers,r.in)),p('До '+r.before.won+'/'+r.before.total+' · после '+r.after.won+'/'+r.after.total+' · '+(r.delta==null?'неполное окно':Math.round(r.delta)+' п.п.'))])),!rows.length?p('Замен нет в истории.'):null]);
}
function timeoutCards(rows){
 return card('До и после тайм-аутов',[p('До пяти розыгрышей до и после, только в одной партии. Окна могут пересекаться; показатели не доказывают, что тайм-аут вызвал изменение.'),...rows.map(t=>el('div',{class:'profile-result'},[el('strong',{text:(t.date?fmtFull(t.date)+' · ':'')+'Партия '+t.set+' · '+t.score+' · '+(t.side==='ours'?'наш':'соперника')}),p('До: '+t.before.won+'/'+t.before.total+' · после: '+t.after.won+'/'+t.after.total),p(t.delta==null?'Неполное окно':'Разница: '+(t.delta>0?'+':'')+Math.round(t.delta*10)/10+' п.п.')])),!rows.length?p('Тайм-аутов в записанной истории нет.'):null]);
}
export function openMatchTactics(match,back=closeSheet){
 if(!match.detail)return;
 const a=matchTactics(match.detail),players=match.detail.ourPlayers;
 openSheet(stack([el('h2',{text:'Тактический разбор · '+match.opponent}),p(fmtFull(match.date)+' · только зафиксированные события'),summary(a.overall),debriefCard(match.detail),...a.sets.map(s=>card('Партия '+s.set+' · '+s.score.at(-1).ours+':'+s.score.at(-1).theirs,[scoreChart(s),p('Макс. преимущество: '+s.maxLead+' · отставание: '+s.maxDeficit),p('Серии очков: наша '+s.momentum.maxOurRun+' · соперник '+s.momentum.maxTheirRun),p('Равный счёт: '+s.momentum.ties+' · смен лидерства: '+s.momentum.leadChanges),p('Розыгрыши в близкой концовке (до розыгрыша: не более 2 очков разницы, одна команда набрала не менее цели минус 5): '+s.momentum.closeWon+'/'+s.momentum.closeTotal+' · '+percent(s.momentum.closeRate)),summary(s)])),rotations(a.rotations.map(r=>({...r,eligible:r.rallies>=30}))),combos(a.pairs,players,'Сочетания двух игроков'),combos(a.six,players,'Составы на площадке'),connectionCard([replayDetailed(match.detail).timeline],players),substitutionsCard(a.substitutions,match.detail),timeoutCards(a.timeouts),btn('Назад',back)]));
}
export function openTeamTactics(view){
 const from=el('input',{type:'date'}),to=el('input',{type:'date'}),opponent=el('select',{},[el('option',{value:'',text:'Все соперники'}),...opponentHistory(view.matches).map(o=>el('option',{value:o.key,text:o.name}))]),min=el('select',{},[15,30,50,100].map(n=>el('option',{value:String(n),text:String(n)+' розыгрышей'}))),body=el('div',{class:'coach-stack'});min.value='30';
 function draw(){
  if(from.value&&to.value&&from.value>to.value){body.replaceChildren(p('Начало периода позже окончания.'));return;}
  const a=teamTactics(view.matches,{from:from.value,to:to.value,opponent:opponent.value,min:Number(min.value)});
  const timelines=view.matches.filter(m=>m.detail&&(!from.value||m.date>=from.value)&&(!to.value||m.date<=to.value)&&(!opponent.value||String(m.opponent||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru')===opponent.value)).map(m=>replayDetailed(m.detail).timeline);
  body.replaceChildren(p('Подробных матчей: '+a.detailed+' из '+a.total+'. Матчи без полного журнала не включены в тактические проценты.'),summary(a.overall),seasonCaptureCard(timelines,view.players),connectionCard(timelines,view.players,Number(min.value)),rotations(a.rotations),combos(a.pairs,view.players,'Сочетания двух игроков'),combos(a.six,view.players,'Составы на площадке'),timeoutCards(a.timeouts.slice(-30)),card('История соперников',a.opponents.map(r=>p(r.name+' · матчей '+r.matches+' · побед '+r.wins+' · поражений '+r.losses+' · партии '+r.setsWon+':'+r.setsLost+' · подробно '+r.details))));
 }
 from.onchange=to.onchange=opponent.onchange=min.onchange=draw;draw();openSheet(stack([el('h2',{text:'Тактическая аналитика'}),p('Фильтр по точному нормализованному названию соперника. Расстановки сравниваются как циклы, а составы — по фактическим игрокам до розыгрыша.'),el('div',{class:'coach-columns'},[field('С',from),field('По',to)]),field('Соперник',opponent),field('Минимум выборки',min),body,btn('Закрыть',closeSheet)]));
}

export function debriefCard(detail){
 const d=matchDebrief(detail);
 return card('Выводы тренеру',[p('Причины указаны: '+d.detailed+'/'+d.rallies+'. Рекомендации основаны только на внесённых розыгрышах и не заменяют оценку тренера.'),...d.notes.map(n=>el('div',{class:'insight-note '+n.kind},[el('strong',{text:n.title}),p(n.text)])),!d.notes.length?p('Выраженных закономерностей по выбранным порогам не обнаружено.'):null,el('details',{},[el('summary',{text:'Основания выводов'}),...d.errors.map(x=>p('Потеря очка · '+x.label+': '+x.count)),...d.positive.map(x=>p('Наше очко · '+x.label+': '+x.count)),p('Указаны количества зарегистрированных действий, а не полные попытки.')])]);
}
async function openTrainingRecommendations(match,back){
 const body=stack([el('h2',{text:'Подбор упражнений'}),p('Повторяющиеся отмеченные причины потери очков: минимум 3 одинаковые причины и 10 розыгрышей с указанием причины. Подбор по названию и описанию упражнений из библиотеки. Это не оценка всех попыток и не автоматический план тренировки.'),p('Загрузка библиотеки…'),btn('Назад',back)]);
 openSheet(body);
 try{
  const saved=await listWork('exercise'),items=trainingRecommendations(matchDebrief(match.detail),[...builtinExercises,...saved]);
  body.replaceChildren(el('h2',{text:'Подбор упражнений'}),p('Подбор по тексту упражнений. Объём, технику и нагрузку определяет тренер.'),...items.map(r=>card(r.topic,[p('Отмечено причин потери очка: '+r.count+'; всего с указанной причиной '+r.detailed+' из '+r.rallies+' розыгрышей.'),...r.exercises.map(x=>el('div',{class:'insight-note'},[el('strong',{text:x.name}),p(x.minutes+' мин · '+x.description),p(x.equipment||'Инвентарь не указан')])),!r.exercises.length?p('В библиотеке нет упражнения с подходящим описанием. Добавьте своё.'):null])),!items.length?p('Недостаточно зарегистрированных причин для подбора по заданным порогам.'):null,btn('Назад',back));
 }catch{body.replaceChildren(el('h2',{text:'Подбор упражнений'}),p('Не удалось загрузить библиотеку или рассчитать подбор.'),btn('Назад',back));}
}
export function openMatchDebrief(match,back=closeSheet){
 if(!match.detail)return;
 openSheet(stack([el('h2',{text:'Итоги и план работы · '+match.opponent}),p(fmtFull(match.date)),debriefCard(match.detail),btn('Подобрать упражнения',()=>openTrainingRecommendations(match,()=>openMatchDebrief(match,back))),btn('Отчёт Word / Excel / PDF',()=>openDocumentPreview(buildDocument('matchDebrief',matchDebriefInput(match)),()=>openMatchDebrief(match,back))),btn('Подробный тактический разбор',()=>openMatchTactics(match,()=>openMatchDebrief(match,back)),'primary'),btn('Закрыть',back)]));
}
