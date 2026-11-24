import {matchTactics,teamTactics,opponentHistory} from '../match-tactics.js';
import {fmtFull} from '../model.js';
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
function timeoutCards(rows){
 return card('До и после тайм-аутов',[p('До пяти розыгрышей до и после, только в одной партии. Окна могут пересекаться; показатели не доказывают, что тайм-аут вызвал изменение.'),...rows.map(t=>el('div',{class:'profile-result'},[el('strong',{text:(t.date?fmtFull(t.date)+' · ':'')+'Партия '+t.set+' · '+t.score+' · '+(t.side==='ours'?'наш':'соперника')}),p('До: '+t.before.won+'/'+t.before.total+' · после: '+t.after.won+'/'+t.after.total),p(t.delta==null?'Неполное окно':'Разница: '+(t.delta>0?'+':'')+Math.round(t.delta*10)/10+' п.п.')])),!rows.length?p('Тайм-аутов в записанной истории нет.'):null]);
}
export function openMatchTactics(match,back=closeSheet){
 if(!match.detail)return;
 const a=matchTactics(match.detail),players=match.detail.ourPlayers;
 openSheet(stack([el('h2',{text:'Тактический разбор · '+match.opponent}),p(fmtFull(match.date)+' · только зафиксированные события'),summary(a.overall),...a.sets.map(s=>card('Партия '+s.set+' · '+s.score.at(-1).ours+':'+s.score.at(-1).theirs,[scoreChart(s),p('Макс. преимущество: '+s.maxLead+' · отставание: '+s.maxDeficit),p('Серии очков: наша '+s.momentum.maxOurRun+' · соперник '+s.momentum.maxTheirRun),p('Равный счёт: '+s.momentum.ties+' · смен лидерства: '+s.momentum.leadChanges),p('Розыгрыши в близкой концовке (до розыгрыша: не более 2 очков разницы, одна команда набрала не менее цели минус 5): '+s.momentum.closeWon+'/'+s.momentum.closeTotal+' · '+percent(s.momentum.closeRate)),summary(s)])),rotations(a.rotations.map(r=>({...r,eligible:r.rallies>=30}))),combos(a.pairs,players,'Сочетания двух игроков'),combos(a.six,players,'Составы на площадке'),timeoutCards(a.timeouts),btn('Назад',back)]));
}
export function openTeamTactics(view){
 const from=el('input',{type:'date'}),to=el('input',{type:'date'}),opponent=el('select',{},[el('option',{value:'',text:'Все соперники'}),...opponentHistory(view.matches).map(o=>el('option',{value:o.key,text:o.name}))]),min=el('select',{},[15,30,50,100].map(n=>el('option',{value:String(n),text:String(n)+' розыгрышей'}))),body=el('div',{class:'coach-stack'});min.value='30';
 function draw(){
  if(from.value&&to.value&&from.value>to.value){body.replaceChildren(p('Начало периода позже окончания.'));return;}
  const a=teamTactics(view.matches,{from:from.value,to:to.value,opponent:opponent.value,min:Number(min.value)});
  body.replaceChildren(p('Подробных матчей: '+a.detailed+' из '+a.total+'. Матчи без полного журнала не включены в тактические проценты.'),summary(a.overall),rotations(a.rotations),combos(a.pairs,view.players,'Сочетания двух игроков'),combos(a.six,view.players,'Составы на площадке'),timeoutCards(a.timeouts.slice(-30)),card('История соперников',a.opponents.map(r=>p(r.name+' · матчей '+r.matches+' · побед '+r.wins+' · поражений '+r.losses+' · партии '+r.setsWon+':'+r.setsLost+' · подробно '+r.details))));
 }
 from.onchange=to.onchange=opponent.onchange=min.onchange=draw;draw();openSheet(stack([el('h2',{text:'Тактическая аналитика'}),p('Фильтр по точному нормализованному названию соперника. Расстановки сравниваются как циклы, а составы — по фактическим игрокам до розыгрыша.'),el('div',{class:'coach-columns'},[field('С',from),field('По',to)]),field('Соперник',opponent),field('Минимум выборки',min),body,btn('Закрыть',closeSheet)]));
}
