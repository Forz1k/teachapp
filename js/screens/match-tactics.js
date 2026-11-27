import {openLineupAnalysis} from './lineup-analysis.js';
import {seasonCapture,touchActions} from '../match-capture.js';
import {replayDetailed} from '../match-protocol.js';
import {matchTactics,teamTactics,opponentHistory,matchDebrief,trainingRecommendations,recordedConnections,setterAnalysis,orderedLineups,opponentComparison,rallyStreaks} from '../match-tactics.js';
import {builtinExercises,listWork,matchTrainingDraft} from '../workbench.js';
import {loadCoach,teamView,trainingWarnings} from '../coach.js';
import {todayIso} from '../model.js';
import {validPeriod} from '../health.js';
import {planForm} from './library.js';
import {fmtFull} from '../model.js';
import {buildDocument} from '../documents.js';
import {openDocumentPreview,matchDebriefInput} from './documents.js';
import {metric} from '../dashboard.js';
import {el,openSheet,closeSheet,toast} from '../ui.js';
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
function setterCard(timelines,players,min=10){
 const a=setterAnalysis(timelines,{min}),filter=el('select',{},[el('option',{value:'',text:'Все передающие'}),...players.map(p=>el('option',{value:p.id,text:name(players,p.id)}))]),out=el('div',{class:'coach-stack'});
 function draw(){const rows=a.rows.filter(r=>!filter.value||r.id===filter.value),pairs=a.pairs.filter(r=>!filter.value||r.setter===filter.value);
  out.replaceChildren(...rows.map(r=>el('div',{class:'profile-result'},[el('strong',{text:name(players,r.id)}),p('Ассисты: '+(r.assists||'—')+' · матчей с ассистом '+r.assistMatches+' · передач PRO '+(r.attempts||'—')),p('Положительные: '+(r.positiveEligible?percent(r.positiveRate):r.positiveRate==null?'—':'мало данных')+' · ошибки: '+(r.eligible?percent(r.errorRate):r.errorRate==null?'—':'мало данных'))])),...(!rows.length?[p('Нет записанных передач.')]:[]),el('h4',{text:'Результативные связки (ассисты)'}),...pairs.slice(0,30).map(r=>p(name(players,r.setter)+' → '+name(players,r.attacker)+' · '+r.assists+' · матчей '+r.matches)),...(!pairs.length?[p('Нет отмеченных связок.')]:[]),pairs.length>30?p('Первые 30 связок из '+pairs.length+'. Выберите передающую для уточнения.'):null);
 }filter.onchange=draw;draw();return card('Связующие и ассисты',[p('Матчей с подробным журналом: '+a.matches+' · ассисты '+a.assists+' из '+a.kills+' результативных атак/скидок. Это полнота записи, не эффективность. PRO: '+a.complete+'/'+a.rallies+' полных розыгрышей. Не суммируем попытки PRO и ассисты.'),field('Передающая',filter),out]);
}
function orderedCard(timelines,players,min){const rows=orderedLineups(timelines,{min});return card('Фактические расстановки P1–P6',[p('Порядок игроков по зонам до розыгрыша; либеро учитывается вместо основного. Минимум '+min+' розыгрышей на долю.'),...rows.slice(0,20).map(r=>el('div',{class:'profile-result'},[el('strong',{text:r.players.map((id,i)=>'P'+(i+1)+' '+name(players,id)).join(' · ')}),p('Матчей '+r.matches+' · розыгрышей '+r.rallies+' · '+r.won+'/'+r.rallies+' · '+(r.eligible?percent(r.rate):'мало данных')),p('Подача '+r.serveWon+'/'+r.serve+' · '+(r.serveEligible?percent(r.serveRate):'мало данных')+' · приём '+r.receiveWon+'/'+r.receive+' · '+(r.receiveEligible?percent(r.receiveRate):'мало данных'))])),!rows.length?p('Нет данных о составе.'):null,rows.length>20?p('Показано 20 из '+rows.length+' расстановок.'):null]);}
function opponentsCard(matches,options){
 const rows=opponentComparison(matches,options),pick=()=>el('select',{},[el('option',{value:'',text:'Выберите соперника'}),...rows.map(r=>el('option',{value:r.key,text:r.name}))]),a=pick(),b=pick(),out=el('div',{class:'coach-stack'});
 if(rows.length)a.value=rows[0].key;if(rows.length>1)b.value=rows[1].key;
 const cell=(r,k,n,eligible)=>r[n]?r[k]+'/'+r[n]+' · '+(r[eligible]?percent(100*r[k]/r[n]):'мало данных'):'—';
 function draw(){out.replaceChildren();if(a.value&&a.value===b.value){out.append(p('Выберите разных соперников.'));return;}
  const chosen=[a.value,b.value].filter(Boolean).map(k=>rows.find(r=>r.key===k));for(const r of chosen)out.append(el('div',{class:'profile-result'},[el('strong',{text:r.name}),p('Матчей '+r.matches+' · побед '+r.wins+' · поражений '+r.losses+' · ничьих '+r.draws+' · партии '+r.setsWon+':'+r.setsLost),p('Подробных '+r.detailed+'/'+r.matches+' · розыгрыши '+cell(r,'won','rallies','eligible')),p('На подаче '+cell(r,'serveWon','serve','serveEligible')+' · на приёме '+cell(r,'receiveWon','receive','receiveEligible'))]));if(!chosen.length)out.append(p('Нет матчей в периоде.'));
 }a.onchange=b.onchange=draw;draw();return card('Сравнение соперников',[p('Сравниваем результаты своей команды против разных соперников. Результаты партий — все источники; доли розыгрышей — только подробные журналы. Не рейтинг силы соперников.'),field('Соперник A',a),field('Соперник B',b),out]);
}
function substitutionsCard(rows,detail){
 return card('До и после замен',[p('Окна до пяти розыгрышей в одной партии. Пересекающиеся окна и другие события не позволяют считать разницу причиной результата.'),...rows.map(r=>el('div',{class:'profile-result'},[el('strong',{text:'Партия '+r.set+' · '+r.score+' · '+(r.side==='ours'?detail.teamName:detail.opponent)}),p(name(r.side==='ours'?detail.ourPlayers:detail.awayPlayers,r.out)+' → '+name(r.side==='ours'?detail.ourPlayers:detail.awayPlayers,r.in)),p('До '+r.before.won+'/'+r.before.total+' · после '+r.after.won+'/'+r.after.total+' · '+(r.delta==null?'неполное окно':Math.round(r.delta)+' п.п.'))])),!rows.length?p('Замен нет в истории.'):null]);
}
function timeoutCards(rows){
 return card('До и после тайм-аутов',[p('До пяти розыгрышей до и после, только в одной партии. Окна могут пересекаться; показатели не доказывают, что тайм-аут вызвал изменение.'),...rows.map(t=>el('div',{class:'profile-result'},[el('strong',{text:(t.date?fmtFull(t.date)+' · ':'')+'Партия '+t.set+' · '+t.score+' · '+(t.side==='ours'?'наш':'соперника')}),p('До: '+t.before.won+'/'+t.before.total+' · после: '+t.after.won+'/'+t.after.total),p(t.delta==null?'Неполное окно':'Разница: '+(t.delta>0?'+':'')+Math.round(t.delta*10)/10+' п.п.')])),!rows.length?p('Тайм-аутов в записанной истории нет.'):null]);
}
export function openMatchTactics(match,back=closeSheet){
 if(!match.detail)return;
 const a=matchTactics(match.detail),players=match.detail.ourPlayers,timeline=replayDetailed(match.detail).timeline,streaks=rallyStreaks(timeline);
 openSheet(stack([el('h2',{text:'Тактический разбор · '+match.opponent}),p(fmtFull(match.date)+' · только зафиксированные события'),summary(a.overall),debriefCard(match.detail),...a.sets.map(s=>card('Партия '+s.set+' · '+s.score.at(-1).ours+':'+s.score.at(-1).theirs,[scoreChart(s),p('Макс. преимущество: '+s.maxLead+' · отставание: '+s.maxDeficit),p('Серии очков: наша '+s.momentum.maxOurRun+' · соперник '+s.momentum.maxTheirRun),p('Равный счёт: '+s.momentum.ties+' · смен лидерства: '+s.momentum.leadChanges),p('Розыгрыши в близкой концовке (до розыгрыша: не более 2 очков разницы, одна команда набрала не менее цели минус 5): '+s.momentum.closeWon+'/'+s.momentum.closeTotal+' · '+percent(s.momentum.closeRate)),summary(s)])),rotations(a.rotations.map(r=>({...r,eligible:r.rallies>=30}))),card('Составы и совместное время',[p('Стартовые шестёрки, фактические составы, пары и время на площадке.'),btn('Аналитика игровых составов',()=>openLineupAnalysis({matches:[match],players},{match,back:()=>openMatchTactics(match,back)}),'primary')]),setterCard([timeline],players),connectionCard([timeline],players),orderedCard([timeline],players,10),card('Серии очков',[p('Серии от трёх: наша команда '+streaks.summary.ours.long+' · соперник '+streaks.summary.theirs.long),...streaks.rows.slice(-40).map(r=>p('Партия '+r.set+' · '+(r.side==='ours'?match.detail.teamName:match.detail.opponent)+' · '+r.start+' → '+r.end+' · '+r.length))]),substitutionsCard(a.substitutions,match.detail),timeoutCards(a.timeouts),btn('Назад',back)]));
}
export function openTeamTactics(view){
 const from=el('input',{type:'date'}),to=el('input',{type:'date'}),opponent=el('select',{},[el('option',{value:'',text:'Все соперники'}),...opponentHistory(view.matches).map(o=>el('option',{value:o.key,text:o.name}))]),min=el('select',{},[15,30,50,100].map(n=>el('option',{value:String(n),text:String(n)+' розыгрышей'}))),body=el('div',{class:'coach-stack'});min.value='30';
 function draw(){
  if(from.value&&to.value&&from.value>to.value){body.replaceChildren(p('Начало периода позже окончания.'));return;}
  const a=teamTactics(view.matches,{from:from.value,to:to.value,opponent:opponent.value,min:Number(min.value)});
  const timelines=view.matches.filter(m=>m.detail&&(!from.value||m.date>=from.value)&&(!to.value||m.date<=to.value)&&(!opponent.value||String(m.opponent||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru')===opponent.value)).map(m=>replayDetailed(m.detail).timeline);
  body.replaceChildren(p('Подробных матчей: '+a.detailed+' из '+a.total+'. Матчи без полного журнала не включены в тактические проценты.'),summary(a.overall),seasonCaptureCard(timelines,view.players),setterCard(timelines,view.players,Number(min.value)),connectionCard(timelines,view.players,Number(min.value)),rotations(a.rotations),orderedCard(timelines,view.players,Number(min.value)),opponentsCard(view.matches,{from:from.value,to:to.value,min:Number(min.value)}),card('Составы и совместное время',[p('Отдельный анализ LIVE и исторических PDF, стартовых позиций, совместного времени и фактических розыгрышей.'),btn('Аналитика игровых составов',()=>openLineupAnalysis(view,{initial:{from:from.value,to:to.value,opponent:opponent.value,min:Number(min.value)},back:()=>openTeamTactics(view)}),'primary')]),timeoutCards(a.timeouts.slice(-30)),card('История соперников',a.opponents.map(r=>p(r.name+' · матчей '+r.matches+' · побед '+r.wins+' · поражений '+r.losses+' · партии '+r.setsWon+':'+r.setsLost+' · подробно '+r.details))));
 }
 from.onchange=to.onchange=opponent.onchange=min.onchange=draw;draw();openSheet(stack([el('h2',{text:'Тактическая аналитика'}),p('Фильтр по точному нормализованному названию соперника. Расстановки сравниваются как циклы, а составы — по фактическим игрокам до розыгрыша.'),el('div',{class:'coach-columns'},[field('С',from),field('По',to)]),field('Соперник',opponent),field('Минимум выборки',min),body,btn('Закрыть',closeSheet)]));
}

export function debriefCard(detail){
 const d=matchDebrief(detail);
 return card('Выводы тренеру',[p('Причины указаны: '+d.detailed+'/'+d.rallies+'. Рекомендации основаны только на внесённых розыгрышах и не заменяют оценку тренера.'),...d.notes.map(n=>el('div',{class:'insight-note '+n.kind},[el('strong',{text:n.title}),p(n.text)])),!d.notes.length?p('Выраженных закономерностей по выбранным порогам не обнаружено.'):null,el('details',{},[el('summary',{text:'Основания выводов'}),...d.errors.map(x=>p('Потеря очка · '+x.label+': '+x.count)),...d.positive.map(x=>p('Наше очко · '+x.label+': '+x.count)),p('Указаны количества зарегистрированных действий, а не полные попытки.')])]);
}
export async function openTrainingDraft(match,back=closeSheet){
 try{
  const [data,saved,goals]=await Promise.all([loadCoach(),listWork('exercise'),listWork('coachGoal')]),team=data.coachTeams.find(t=>t.id===match.teamId);
  if(!team||team.archived||!match.detail)throw Error('Выберите подробный матч действующей команды');
  const view=teamView(data,team.id),players=view.players.filter(p=>!p.archived),exercises=[...builtinExercises,...saved],recommendations=trainingRecommendations(matchDebrief(match.detail),exercises);
  const candidates=new Map(),add=(ex,label)=>{if(!ex||['warmup','cooldown'].includes(ex.category))return;if(!candidates.has(ex.id))candidates.set(ex.id,{exercise:ex,labels:new Set()});candidates.get(ex.id).labels.add(label);};
  for(const r of recommendations)for(const x of r.exercises)add(exercises.find(e=>e.id===x.id),r.topic+' · '+r.count+' отмеченных потерь');
  const day=el('input',{type:'date',value:todayIso()}),duration=el('input',{type:'number',min:1,max:600,value:90}),selection=new Set(),out=el('div',{class:'coach-stack','aria-live':'polite'}),choices=el('div',{class:'coach-stack'}),goalInfo=el('div',{class:'coach-stack'});
  const pick=el('select',{},[el('option',{value:'',text:'Выберите упражнение'}),...exercises.filter(e=>!['warmup','cooldown'].includes(e.category)).map(e=>el('option',{value:e.id,text:e.name}))]);
  let draft=null;
  const save=btn('Открыть редактируемый конспект',async()=>{if(!draft)return;try{await planForm(draft.plan,back,'coach');}catch(e){toast(e.message);}},'primary');
  function refresh(){
   try{
    if(!validPeriod(day.value,null))throw Error('Укажите дату тренировки');
    draft=matchTrainingDraft({exercises,selectedIds:[...selection],minutes:Number(duration.value)});
    const warnings=trainingWarnings({date:day.value,roster:players.map(p=>p.id),exercises:draft.plan.items.map(i=>({...i.exercise,minutes:i.minutes}))},players);
    out.replaceChildren(p('Запланировано '+draft.total+' / '+duration.value+' мин. Разминка и завершение по 5 мин.'),card('Проверка нагрузки на выбранную дату',[...warnings.map(w=>p(name(players,w.player.id)+' · '+w.exercises.map(e=>e.name).join(', ')+' · '+(w.potential?'возможное ограничение, уточнить':'сопоставленное ограничение, проверить'))),!warnings.length?p('По внесённым категориям совпадений не найдено. Это не допуск.'):null,p('Проверка для текущего активного состава, без автоматического назначения игрокам.')]));save.disabled=false;
   }catch(e){draft=null;save.disabled=true;out.replaceChildren(p(e.message));}
  }
  function draw(){
   // Goal candidates are recomputed on date change; selection remains explicit.
   for(const c of candidates.values())for(const tag of [...c.labels])if(tag==='Из действующей индивидуальной цели')c.labels.delete(tag);
   const relevant=goals.filter(g=>g.teamId===team.id&&g.status==='active'&&g.from<=day.value&&players.some(p=>p.id===g.playerId));
   goalInfo.replaceChildren(...relevant.map(g=>{const missing=g.exercises.filter(x=>!exercises.some(e=>e.name===x.name&&e.activityId===x.activityId));for(const x of g.exercises){const matches=exercises.filter(e=>e.name===x.name&&e.activityId===x.activityId);if(matches.length===1)add(matches[0],'Из действующей индивидуальной цели');}return p(name(players,g.playerId)+' · '+g.name+' · срок '+fmtFull(g.to)+(missing.length?' · нет в библиотеке: '+missing.map(x=>x.name).join(', '):''));}),!relevant.length?p('Нет действующих целей на выбранную дату.'):null);
   choices.replaceChildren(...[...candidates.values()].filter(c=>c.labels.size||selection.has(c.exercise.id)).map(c=>{
    const check=el('input',{type:'checkbox'});check.checked=selection.has(c.exercise.id);check.onchange=()=>{if(check.checked)selection.add(c.exercise.id);else selection.delete(c.exercise.id);refresh();};
    return card(c.exercise.name,[field('Включить в черновик · '+c.exercise.minutes+' мин',check),p([...c.labels].join(' · ')||'Выбрано тренером'),p(c.exercise.description)]);
   }),!candidates.size?p('Недостаточно записанных причин или совпадений с библиотекой. Выберите упражнение вручную.'):null);
   refresh();
  }
  day.onchange=draw;duration.oninput=refresh;draw();
  openSheet(stack([el('h2',{text:'Черновик тренировки по матчу'}),p('Соперник: '+match.opponent+' · '+fmtFull(match.date)+'. Подбор по записанным причинам и точным совпадениям упражнений из целей. Личные цели и ФИО остаются только в этом приватном обзоре.'),field('Дата проверки',day),field('Длительность тренировки',duration),card('Действующие цели (для просмотра)',[goalInfo]),field('Добавить из библиотеки',pick),btn('+ Вариант упражнения',()=>{const ex=exercises.find(e=>e.id===pick.value);if(!ex)return;add(ex,'Выбрано тренером');selection.add(ex.id);draw();}),choices,out,save,btn('Назад',back)]),{fullHeight:true});
 }catch(e){toast(e.message);}
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
 openSheet(stack([el('h2',{text:'Итоги и план работы · '+match.opponent}),p(fmtFull(match.date)),debriefCard(match.detail),btn('Подобрать упражнения',()=>openTrainingRecommendations(match,()=>openMatchDebrief(match,back))),btn('Черновик тренировки по матчу',()=>openTrainingDraft(match,()=>openMatchDebrief(match,back)),'primary'),btn('Отчёт Word / Excel / PDF',()=>openDocumentPreview(buildDocument('matchDebrief',matchDebriefInput(match)),()=>openMatchDebrief(match,back))),btn('Подробный тактический разбор',()=>openMatchTactics(match,()=>openMatchDebrief(match,back)),'primary'),btn('Закрыть',back)]));
}
