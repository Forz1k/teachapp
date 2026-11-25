import {trainingDynamics,trainingDynamicsCsv} from '../training-dynamics.js';
import {todayIso,addDays,fmtFull} from '../model.js';
import {courtTimeLabel} from '../court-time.js';
import {volleyTimeLabel} from '../volleypoint-time.js';
import {el,openSheet,closeSheet,downloadBlob} from '../ui.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const field=(title,n)=>el('label',{class:'field'},[el('span',{text:title}),n]);
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const pct=x=>x===null?'—':Math.round(x*10)/10+'%';
const fmt=x=>x===null?'—':String(Math.round(x*10)/10);
export function openTrainingDynamics(view,{playerId='',back=closeSheet,initial=null}={}){
 const now=todayIso(),from=el('input',{type:'date',value:initial?.from||addDays(now,-55),'aria-label':'Начало нагрузки'}),to=el('input',{type:'date',value:initial?.to||now,'aria-label':'Конец нагрузки'}),player=el('select',{'aria-label':'Спортсменка для нагрузки'},[el('option',{value:'',text:'Вся команда'}),...view.players.map(p=>el('option',{value:p.id,text:p.name+(p.archived?' · архив':'')}))]);
 player.value=playerId;const content=el('div',{class:'coach-stack'});let current=null,limit=12;
 const exportCsv=btn('Выгрузить недели CSV',()=>{if(current)downloadBlob(new Blob([trainingDynamicsCsv(current)],{type:'text/csv;charset=utf-8'}),'teachapp-training-weeks.csv');});
 function details(w){
  return [p('Проведено '+w.held+'/'+w.scheduled+' · минуты по карточкам '+w.cardMinutes),p('Явка: '+pct(w.attendanceRate)+' · '+w.attended+'/'+w.attendanceKnown+' известных · без отметки '+w.unknown+' · с ограничением '+w.limited),p('Фактические замеры: '+w.effortKnown+'/'+w.attended+' · покрытие '+pct(w.effortCoverage)+' · минут '+(w.effortKnown?w.actualMinutes:'—')),p('sRPE: '+(w.load??'—')+' усл. ед. · средняя взвешенная RPE '+fmt(w.avgRpe)+' · средняя нагрузка за записанное занятие '+fmt(w.avgLoad)),p('Матчи '+w.matches+' · LIVE '+(w.measuredMatches?courtTimeLabel(w.measuredMs):'—')+' ('+w.measuredMatches+'; частично '+w.partialMeasuredMatches+') · PDF '+(w.pdfMatches?volleyTimeLabel({minMs:w.pdfMinMs,maxMs:w.pdfMaxMs}):'—')+' ('+w.pdfMatches+'; диапазон/частично '+w.partialPdfMatches+') · без времени '+w.unknownMatchTime),w.delta?p('К предыдущей полной неделе: '+(w.delta.load>0?'+':'')+w.delta.load+' усл. ед. · '+(w.delta.pct>0?'+':'')+pct(w.delta.pct)):null];
 }
 function draw(recompute=true){try{
  if(recompute||!current)current=trainingDynamics(view,{from:from.value,to:to.value,today:now,playerId:player.value});
  const a=current,visible=[...a.weeks].reverse().slice(0,limit),max=Math.max(1,...a.weeks.map(w=>w.load||0));
  exportCsv.disabled=!a.weeks.length;
  content.replaceChildren(card('За период',[p(player.value?'Личные показатели по выбранной спортсменке.':'Командный sRPE и фактические минуты — сумма записей спортсменка × занятие, не нагрузка одного человека.'),...details(a.total),p('Незаписанные минуты/RPE не заменяются нулями. Недельное сравнение показывается только для одной спортсменки, двух полных соседних недель и полностью записанной явки/нагрузки. Изменения не являются диагнозом или рекомендацией увеличить нагрузку.')]),el('h3',{text:'Недельная динамика'}),...visible.map(w=>card(fmtFull(w.from)+' — '+fmtFull(w.to)+(w.partial?' · неполная неделя':''),[w.load!==null?el('progress',{max,value:w.load,'aria-label':'sRPE '+w.load}):p('Нет измерений sRPE'),...details(w)])),!visible.length?p('Нет прошедших недель в выбранном периоде.'):null,a.weeks.length>limit?btn('Показать ещё',()=>{limit+=12;draw(false);}):null);
 }catch(e){current=null;exportCsv.disabled=true;content.replaceChildren(p(e.message));}}
 const change=()=>{limit=12;draw();};from.onchange=to.onchange=player.onchange=change;draw();
 openSheet(el('div',{class:'coach-form training-dynamics'},[el('h2',{text:'Недельная динамика подготовки'}),p('Календарные недели понедельник–воскресенье; текущая и обрезанная фильтром недели помечаются отдельно. Время матча не включается в тренировочный sRPE.'),el('div',{class:'coach-columns'},[field('С',from),field('По',to)]),field('Спортсменка',player),btn('Последние 8 недель',()=>{from.value=addDays(now,-55);to.value=now;change();}),exportCsv,content,btn('Назад',back)]));
}
