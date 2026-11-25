import {lineupAnalysis} from '../lineup-analysis.js';
import {courtTimeLabel} from '../court-time.js';
import {el,openSheet,closeSheet} from '../ui.js';
import {todayIso} from '../model.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{class:'btn wide '+kind,type:'button',text,onclick});
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const field=(title,node)=>el('label',{class:'field'},[el('span',{text:title}),node]);
const select=(name,options,value)=>{const n=el('select',{'aria-label':name},options.map(([v,t])=>el('option',{value:String(v),text:t})));n.value=String(value??options[0][0]);return n;};
const percent=x=>x==null?'—':Math.round(x*10)/10+'%';
const sign=x=>(x>0?'+':'')+x;
const name=(players,id)=>{const a=players.find(p=>p.id===id);return a?(a.number==null?'':'№'+a.number+' ')+a.name:'Игрок из истории';};
const count=(n,total)=>total?n+'/'+total+' · '+percent(100*n/total):'—';
const phase=(r,k)=>r[k]?count(r[k+'Won'],r[k])+(r[k+'Eligible']?'':' · мало данных'):'нет данных';
const modes=[['six','Фактические шестёрки'],['pairs','Сочетания двух игроков'],['starts','Стартовые шестёрки (состав)'],['orderedStarts','Стартовые шестёрки (P1–P6)']];
export function openLineupAnalysis(view,{match=null,back=closeSheet,initial=null}={}){
 const matches=match?[match]:view.matches,players=view.players;
 const now=todayIso(),year=Number(now.slice(0,4))-(Number(now.slice(5,7))<9?1:0);
 const from=el('input',{type:'date',value:match?'':(initial?.from??year+'-09-01')}),to=el('input',{type:'date',value:match?'':(initial?.to??(year+1)+'-08-31')});
 const norm=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
 const opponents=new Map(matches.map(m=>[norm(m.opponent),m.opponent]));
 const opponent=select('Соперник',[['','Все соперники'],...[...opponents].map(([v,t])=>[v,t])],initial?.opponent??'');
 const source=select('Источник составов',[['all','LIVE + PDF'],['live','Только TeachApp LIVE'],['imported','Только VolleyPoint PDF']]);
 const mode=select('Вид состава',modes),player=select('Игрок в составе',[['','Все игроки'],...players.map(a=>[a.id,name(players,a.id)])]);
 const set=select('Партия составов',[['0','Все партии'],...Array.from({length:5},(_,i)=>[i+1,'Партия '+(i+1)])]);
 const min=select('Минимум розыгрышей',[10,15,30,50,100].map(n=>[n,n+' розыгрышей']),initial?.min??30);
 const order=select('Сортировка составов',[['rallies','Объём выборки'],['rate','Доля побед'],['time','Измеренное время LIVE'],['plusMinus','Разница очков']]);
 const body=el('div',{class:'coach-stack'});let limit=15,cached=null;
 const options=()=>({from:from.value,to:to.value,opponent:opponent.value,source:source.value,set:Number(set.value),min:Number(min.value),phaseMin:10});
 function draw(recompute=false){
  if(from.value&&to.value&&from.value>to.value){body.replaceChildren(p('Начало периода позже окончания'));return;}
  if(recompute||!cached)cached=lineupAnalysis(matches,options());const a=cached;
  const start=mode.value==='starts'||mode.value==='orderedStarts';min.disabled=start;
  order.disabled=start;const rows=a[mode.value].filter(r=>!player.value||r.players.includes(player.value));
  if(!start)rows.sort((x,y)=>{
   if(order.value==='rate')return Number(y.eligible)-Number(x.eligible)||(y.rate??-1)-(x.rate??-1)||y.rallies-x.rallies||x.key.localeCompare(y.key);
   if(order.value==='time')return y.measuredMs-x.measuredMs||y.rallies-x.rallies||x.key.localeCompare(y.key);
   if(order.value==='plusMinus')return Number(y.eligible)-Number(x.eligible)||y.plusMinus-x.plusMinus||y.rallies-x.rallies||x.key.localeCompare(y.key);
   return y.rallies-x.rallies||y.measuredMs-x.measuredMs||x.key.localeCompare(y.key);
  });
  const note=start?'Итог всей партии относится к её стартовой шестёрке, даже если позже состав менялся. P1–P6 сохраняют исходные позиции; режим «состав» объединяет перестановки тех же игроков.':'Розыгрыши относятся к фактическим игрокам до начисления очка. PDF учитывается только там, где полный состав или присутствие обоих игроков подтверждено на всю партию. Проценты фаз — исключительно LIVE.';
  body.replaceChildren(card('Покрытие данных',[p('Матчей '+a.total+' · подробных LIVE '+a.liveMatches+' · VolleyPoint '+a.pdfMatches+' (без стартовых составов '+a.pdfWithoutStarts+') · ручных/прежних '+a.unknownMatches),p('Стартовые составы: '+a.knownStarts+'/'+a.completedSets+' партий · PDF: '+a.pdfKnownStarts+'/'+a.pdfSetCount),p('LIVE-розыгрыши: '+a.liveRallies+' · PDF-розыгрыши с известной шестёркой: '+a.pdfSixRallies+'/'+a.pdfRallies+' · с хотя бы одной известной парой: '+a.pdfPairRallies+'/'+a.pdfRallies),p('Измеренное LIVE-время команды: '+courtTimeLabel(a.measuredMs)),p(note),p('Различия не доказывают влияние состава: соперники, фазы, уровень турнира и замены меняются. Небольшая выборка помечается; историческое время PDF не складывается с LIVE.')]),p('Найдено сочетаний: '+rows.length+' · показано '+Math.min(limit,rows.length)));
  for(const r of rows.slice(0,limit)){
   const title=r.players.map((id,i)=>(mode.value==='orderedStarts'?'P'+(i+1)+' ':'')+name(players,id)).join(' · ');
   if(start){
    body.append(card(title,[el('strong',{text:'Выиграно партий '+count(r.wins,r.sets)}),p('Матчей '+r.matches+' · LIVE '+r.liveSets+' партий · PDF '+r.pdfSets+' партий'),p('Суммарные очки '+r.pointsFor+':'+r.pointsAgainst+' · разница '+sign(r.plusMinus)),p('Без смен состава '+r.stableSets+'/'+r.stabilityKnown+' партий с известными заменами'),p(r.eligible?'Есть минимум для предварительного сравнения.':'Мало данных: менее 3 партий или 2 матчей.')]));
   }else{
    body.append(card(title,[el('strong',{text:'Выиграно '+count(r.won,r.rallies)}),r.rate!==null?el('progress',{max:100,value:r.rate,'aria-label':'Доля выигранных розыгрышей'}):null,p('Матчей '+r.matches+' · LIVE '+r.liveRallies+' · PDF '+r.pdfRallies+' розыгрышей · разница '+sign(r.plusMinus)),p('На подаче (break-point): '+phase(r,'serve')),p('На приёме (side-out): '+phase(r,'receive')),p('Совместное время LIVE: '+(r.timedMatches?courtTimeLabel(r.measuredMs):'—')+' · матчей с замером '+r.timedMatches),p('Розыгрыши при включённом учёте: '+r.timedRallies+'/'+r.liveRallies+' · выиграно '+r.timedWon),p('Длительность подтверждённых полных партий PDF: '+(r.pdfSets?courtTimeLabel(r.pdfMs):'—')+' · партий '+r.pdfSets),p(r.eligible?'Достаточно розыгрышей для предварительного сравнения.':'Мало данных: меньше '+min.value+' розыгрышей.')]));
   }
  }
  if(!rows.length)body.append(p('Нет сочетаний по выбранным фильтрам.'));
  if(rows.length>limit)body.append(btn('Показать ещё',()=>{limit+=15;draw();}));
 }
 const change=()=>{limit=15;draw(true);};for(const n of [from,to,opponent,source,set,min])n.onchange=change;
 for(const n of [mode,player,order])n.onchange=()=>{limit=15;draw();};
 draw(true);
 openSheet(el('div',{class:'coach-form lineup-analysis'},[el('h2',{text:'Аналитика игровых составов'}),match?p(match.date+' · '+match.opponent):el('div',{class:'coach-columns'},[field('С',from),field('По',to)]),match?null:btn('Весь архив',()=>{from.value='';to.value='';change();}),match?null:field('Соперник',opponent),field('Источник',source),field('Вид состава',mode),field('Партия',set),field('Игрок в составе',player),field('Минимальная выборка',min),field('Сортировка',order),body,btn('Назад',back)]));
}
