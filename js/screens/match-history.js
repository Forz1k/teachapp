import {prepareHistory,selectHistory,compareHistory} from '../match-history.js';
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
 const index=prepareHistory(matches);
 const query=el('input',{type:'search',placeholder:'Соперник или соревнование','aria-label':'Поиск матчей'}),from=el('input',{type:'date'}),to=el('input',{type:'date'}),outcome=select('Результат',[['','Все результаты'],['win','Победы'],['loss','Поражения'],['draw','Равный счёт']]),source=select('Источник',[['','Все источники'],['live','Подробные'],['imported','VolleyPoint'],['manual','Ручные']]),rows=el('div',{class:'coach-stack'}),status=el('p',{class:'profile-note','aria-live':'polite'}),more=btn('Показать ещё',()=>appendPage());
 let chosen=[],summary=null,shown=0;
 function appendPage(){
  const next=chosen.slice(shown,shown+20);
  rows.append(...next.map(e=>renderMatch(e.match,e)));
  shown+=next.length;
  status.textContent=from.value&&to.value&&from.value>to.value?'Начало периода позже окончания.':'Матчей: '+summary.matches+' · побед '+summary.wins+' · поражений '+summary.losses+' · партии '+summary.setsWon+':'+summary.setsLost+' · показано '+shown;
  more.hidden=shown>=chosen.length;more.style.display=more.hidden?'none':'';
 }
 function reset(){
  const selected=selectHistory(index,{query:query.value,from:from.value,to:to.value,outcome:outcome.value,source:source.value});
  chosen=selected.entries;summary=selected.summary;shown=0;rows.replaceChildren();
  appendPage();if(!chosen.length)rows.append(p('Нет матчей по выбранным условиям.'));
 }
 query.oninput=reset;from.onchange=to.onchange=outcome.onchange=source.onchange=reset;reset();
 return el('section',{class:'coach-stack match-history'},[el('h2',{text:'История матчей'}),query,el('details',{class:'card-block'},[el('summary',{text:'Фильтры истории'}),el('div',{class:'coach-columns'},[field('С',from),field('По',to)]),field('Результат',outcome),field('Источник',source),btn('Сбросить фильтры',()=>{query.value=from.value=to.value=outcome.value=source.value='';reset();})]),status,matches.length>=2?btn('Сравнить два матча',()=>openCompare(matches)):null,rows,more]);
}
