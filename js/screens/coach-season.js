import * as C from '../coach.js';
import {sourceLabels,matchMetrics,testMetrics,matchComparison,testComparison,testDefinitions,ranked,personalInsights,eligiblePlayers} from '../coach-season.js';
import {todayIso,fmtFull} from '../model.js';
import {el,openSheet,closeSheet} from '../ui.js';
import {trendChart,trendDomain} from '../dashboard.js';
const p=text=>el('p',{text});
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]);
const select=(options,value)=>{const n=el('select',{},options.map(([value,text])=>el('option',{value,text})));n.value=value??options[0]?.[0]??'';return n;};
const label=p=>(p.number==null?'':'№'+p.number+' · ')+p.name+(p.archived?' (архив)':'');
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const format=(v,unit='')=>v==null?'—':String(Math.round(v*100)/100)+(unit?' '+unit:'');
function meter(value,max,title){
 const n=el('progress',{max:Math.max(1,max),value:Math.max(0,value),'aria-label':title});
 n.style.width='100%';n.style.height='12px';return n;
}
export function playerInsightCard(view,id,range){
 const notes=personalInsights(view.tests,id,range);
 return card('Тренерские выводы',[p('По записанным сопоставимым тестам; это подсказки, а не оценка спортсменки или допуск к нагрузке.'),...notes.map(n=>el('div',{class:'insight-note '+n.kind},[el('strong',{text:n.kind==='strength'?'Сильная сторона / рост':'Зона работы'}),p(n.text)])),...(!notes.length?[p('Пока недостаточно данных для выраженного вывода.')]:[])]);
}
export function seasonPanel(view){
 const now=todayIso(),year=Number(now.slice(0,4))-(Number(now.slice(5,7))<9?1:0);
 const from=el('input',{type:'date',value:year+'-09-01'}),to=el('input',{type:'date',value:(year+1)+'-08-31'});
 const position=select([['','Все амплуа'],...Object.entries(C.positions)],''),archived=el('input',{type:'checkbox'});
 const mode=select([['match','Матчи'],['test','Тренировочные тесты']],'match'),source=select(Object.entries(sourceLabels),'all'),definition=select([], ''),metric=select(Object.entries(matchMetrics),'aces');
 const a=select([['','Не выбран']]),b=select([['','Не выбран']]);
 const modeFields=el('div',{class:'coach-stack'}),result=el('div',{class:'coach-stack',role:'status'}),compare=el('div',{class:'coach-stack'});
 let defs=[],rows=[];
 const filter=()=>({from:from.value,to:to.value,position:position.value,archived:archived.checked,source:source.value});
 function setOptions(node,options,fallback){const old=node.value;node.replaceChildren(...options.map(([value,text])=>el('option',{value,text})));node.value=options.some(([v])=>v===old)?old:(fallback??options[0]?.[0]??'');}
 function drawComparison(){
  compare.replaceChildren();const chosen=[a.value,b.value].filter(Boolean);if(!chosen.length)return;
  if(new Set(chosen).size!==chosen.length){compare.append(p('Выберите двух разных игроков.'));return;}
  const selected=rows.filter(r=>chosen.includes(r.player.id));
  if(!selected.length)return;
  compare.append(card('Сравнение игроков',selected.map(r=>el('div',{class:'coach-stack'},[el('strong',{text:label(r.player)}),p(format(r.value,r.unit)+' · '+r.sample+(r.eligible?'':' · вне рейтинга'))]))));
  const domain=trendDomain(selected.flatMap(r=>r.history.map(h=>h.value)));
  for(const r of selected){
   const trend=[p('Показатель отдельных записей, общая шкала для выбранных игроков.')];
   const unit=mode.value==='test'&&r.unit==='п.п.'?'%':r.unit;
   trend.push(trendChart(r.history.slice(-20),{min:domain.low,max:domain.high,unit,label:label(r.player)}));
   const records=el('details',{},[el('summary',{text:'Числовые значения'}),...r.history.slice(-20).map(h=>p(fmtFull(h.date)+' · '+h.label+' · '+format(h.value,unit)))]);trend.push(records);
   if(!r.history.length)trend.push(p('Нет записей.'));
   if(r.history.length>20)trend.push(p('Показаны последние 20 записей периода.'));
   compare.append(card('Динамика · '+label(r.player),trend),playerInsightCard(view,r.player.id,filter()));
  }
 }
 function draw(){
  const f=filter();
  if(f.from&&f.to&&f.from>f.to){result.replaceChildren(p('Начало периода позже окончания'));compare.replaceChildren();return;}
  const isTest=mode.value==='test';
  defs=testDefinitions(view.tests,f);setOptions(definition,defs.map(([k,d])=>[k,d.name+' · '+d.protocol]));
  const def=defs.find(([k])=>k===definition.value)?.[1];
  if(isTest){const keys=def?.kind==='measure'?['latest','best','progress']:['success','errors','target','stability','progress'];setOptions(metric,keys.map(k=>[k,testMetrics[k]]));}
  else setOptions(metric,Object.entries(matchMetrics));
  modeFields.replaceChildren(isTest?field('Методика (только одинаковые тесты)',definition):field('Источник матчей',source),field('Показатель',metric));
  rows=isTest?testComparison(view,definition.value,metric.value,f):matchComparison(view,metric.value,f);
  const leaders=ranked(rows),excluded=rows.filter(r=>!r.eligible);
  const max=Math.max(1,...leaders.map(r=>Math.abs(r.value)));
  const help=isTest?(def?.kind==='measure'?'Физические замеры сравниваются только по одной методике и единице. Прогресс учитывает направление улучшения.':'Для долей: от 30 попыток и 2 тестирований; для стабильности — от 3 тестов по 10 попыток. Стабильность = разброс успешности между тестами (меньше — лучше), не показатель качества. Прогресс: первые и последние два теста, по 20 попыток. Адаптация исключена из сравнения.'):metric.value==='pointsPer10'?'Только измеренные интервалы LIVE и отмеченные личные очки; минимум 10 минут, 10 розыгрышей и 2 матча для рейтинга. График включает матчи, каждый из которых достиг порога 10 минут и 10 розыгрышей. Не все очки могут иметь автора; PDF не включается.':'Считаются только известные показатели. Рейтинг по сумме не учитывает игровое время; для процентов нужны парные числитель/знаменатель в ручных данных, минимум 30 попыток и 2 матча. Подробные и PDF-протоколы не дают всех попыток.';
  result.replaceChildren(p(help));
  if(leaders.length){
   const winners=leaders.filter(r=>r.place===1);
   const meaningful=metric.value!=='progress'||winners[0].value>0;
   if(meaningful)result.append(p((winners.length>1?'Лидеры по показателю: ':'Лидер по показателю: ')+winners.map(r=>label(r.player)).join(', ')+ ' · '+format(winners[0].value,winners[0].unit)));
   else result.append(p('Положительного прогресса по выбранным данным пока нет.'));
   for(const r of leaders)result.append(el('section',{class:'card-block rank-card'},[el('div',{class:'rank-row'},[el('span',{class:'rank-place'+(r.place===1?' first':''),text:String(r.place)}),el('div',{class:'rank-name'},[el('strong',{text:label(r.player)}),p(r.sample)]),el('strong',{class:'rank-value',text:format(r.value,r.unit)})]),meter(Math.abs(r.value),max,label(r.player)+' '+metric.value)]));
  }else result.append(p('Пока недостаточно данных для рейтинга.'));
  if(excluded.length)result.append(card('Вне рейтинга',[...excluded.map(r=>p(label(r.player)+' · '+format(r.value,r.unit)+' · '+r.sample))]));
  const options=[['','Не выбран'],...eligiblePlayers(view.players,f).map(player=>[player.id,label(player)])];setOptions(a,options,'');setOptions(b,options,'');
  drawComparison();
 }
 for(const n of [from,to,position,archived,mode,source,definition,metric])n.onchange=draw;
 a.onchange=b.onchange=drawComparison;
 draw();
 return el('div',{class:'coach-stack season-panel'},[el('h2',{text:'Сезонная аналитика'}),el('div',{class:'coach-columns'},[field('С',from),field('По',to)]),btn('Весь архив',()=>{from.value='';to.value='';draw();}),field('Амплуа',position),field('Включить архивных игроков',archived),field('Данные',mode),modeFields,result,el('h3',{text:'Сравнить двух игроков'}),field('Игрок A',a),field('Игрок B',b),compare]);
}
export function openSeasonAnalytics(view){openSheet(el('div',{class:'coach-form'},[seasonPanel(view),btn('Закрыть',closeSheet)]));}
