import {filterHistory,historySummary,compareHistory} from '../match-history.js';
import {el,openSheet,closeSheet} from '../ui.js';
import {fmtFull} from '../model.js';
const p=text=>el('p',{text}),btn=(text,onclick)=>el('button',{type:'button',class:'btn wide',text,onclick});
const select=(label,rows)=>el('select',{'aria-label':label},rows.map(([value,text])=>el('option',{value,text})));
const field=(text,n)=>el('label',{class:'field'},[el('span',{text}),n]);
const percent=(v,n)=>v===null?'Нет данных':Math.round(v*10)/10+'% · '+n+' роз.';
function openCompare(matches){
 const opts=[['','Выбрать матч'],...matches.map(m=>[m.id,fmtFull(m.date)+' · '+m.opponent])];
 const a=select('Первый матч',opts),b=select('Второй матч',opts),body=el('div',{class:'coach-stack'});
 function draw(){const rows=compareHistory(matches.find(m=>m.id===a.value),matches.find(m=>m.id===b.value));body.replaceChildren(...(rows?[el('div',{class:'history-compare'},rows.map(r=>el('section',{class:'card-block coach-card'},[el('h3',{text:r.opponent}),p(fmtFull(r.date)),p('Партии: '+r.sets),p('Сумма очков: '+r.points),p('На подаче: '+percent(r.serve,r.serveSample)),p('На приёме: '+percent(r.receive,r.receiveSample)),p('Подробных розыгрышей: '+(r.rallies??'нет данных'))]))),p('Суммы очков зависят от числа партий; проценты доступны только для подробного журнала. Сравнение не доказывает причин изменения результата.')]:[p('Выберите два разных матча.')]));}
 a.onchange=b.onchange=draw;draw();openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Сравнение матчей'}),field('Матч A',a),field('Матч B',b),body,btn('Закрыть',closeSheet)]));
}
export function historyPanel(matches,renderMatch){
 const query=el('input',{type:'search',placeholder:'Соперник или соревнование','aria-label':'Поиск матчей'}),from=el('input',{type:'date'}),to=el('input',{type:'date'}),outcome=select('Результат',[['','Все результаты'],['win','Победы'],['loss','Поражения'],['draw','Равный счёт']]),source=select('Источник',[['','Все источники'],['live','Подробные'],['imported','VolleyPoint'],['manual','Ручные']]),rows=el('div',{class:'coach-stack'}),status=el('p',{class:'profile-note','aria-live':'polite'}),more=btn('Показать ещё',()=>{limit+=20;draw();});let limit=20;
 function draw(){const chosen=filterHistory(matches,{query:query.value,from:from.value,to:to.value,outcome:outcome.value,source:source.value}),s=historySummary(chosen);status.textContent=from.value&&to.value&&from.value>to.value?'Начало периода позже окончания.':'Матчей: '+s.matches+' · побед '+s.wins+' · поражений '+s.losses+' · партии '+s.setsWon+':'+s.setsLost+' · показано '+Math.min(limit,s.matches);rows.replaceChildren(...chosen.slice(0,limit).map(renderMatch));if(!chosen.length)rows.append(p('Нет матчей по выбранным условиям.'));more.hidden=chosen.length<=limit;more.style.display=more.hidden?'none':'';}
 function reset(){limit=20;draw();}
 query.oninput=reset;from.onchange=to.onchange=outcome.onchange=source.onchange=reset;draw();
 return el('section',{class:'coach-stack match-history'},[el('h2',{text:'История матчей'}),query,el('details',{class:'card-block'},[el('summary',{text:'Фильтры истории'}),el('div',{class:'coach-columns'},[field('С',from),field('По',to)]),field('Результат',outcome),field('Источник',source),btn('Сбросить фильтры',()=>{query.value=from.value=to.value=outcome.value=source.value='';reset();})]),status,matches.length>=2?btn('Сравнить два матча',()=>openCompare(matches)):null,rows,more]);
}
