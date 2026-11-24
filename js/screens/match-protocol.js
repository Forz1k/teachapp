import * as C from '../coach.js';
import * as V from '../match-protocol.js';
import {todayIso,uid} from '../model.js';
import * as ui from '../ui.js';
import {lineupPicker} from './lineup-picker.js';
const {el,openSheet,toast}=ui;
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
const p=text=>el('p',{text});
const field=(text,input)=>el('label',{class:'field'},[el('span',{text}),input]);
const input=(value='',type='text',extra={})=>el('input',{type,value,...extra});
const select=(rows,value)=>{const node=el('select',{},rows.map(([v,text])=>el('option',{value:String(v),text})));if(value!=null)node.value=String(value);return node;};
const sideName=(d,side)=>side==='ours'?d.teamName:d.opponent;
const roster=(d,side)=>side==='ours'?d.ourPlayers:d.awayPlayers;
const name=(d,side,id)=>{const r=roster(d,side).find(x=>x.id===id);return r?(r.number==null?'':'#'+r.number+' ')+r.name:'Без автора';};
const seconds=t=>[Math.floor(t/3600),Math.floor(t/60)%60,t%60].map(x=>String(x).padStart(2,'0')).join(':');
const score=x=>x.ours+' : '+x.theirs;
const sides=['ours','theirs'];
const errors=['serveError','attackError','receiveError','otherError'];
function playerLabel(p){return (p.number==null?'':'№'+p.number+' · ')+p.name;}
function six(players,initial=[],options={}){return lineupPicker(players,initial,options);}
function parseAway(text){
 const rows=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
 if(!rows.length)return [];
 if(rows.length<6||rows.length>30)throw Error('У соперника укажите 6–30 игроков или оставьте список пустым');
 const result=rows.map(l=>{
  const m=l.match(/^#?(\d{1,2})\s*(?:[;,]\s*|\s+)(.*)$/);
  if(!m){if(/^\d{1,2}$/.test(l))return {id:uid('opp'),number:Number(l),name:'Игрок '+l};throw Error('Строка соперника: номер и имя, например 7 Иванова');}
  const number=Number(m[1]),name=m[2].trim()||'Игрок '+number;return {id:uid('opp'),number,name};
 });
 if(new Set(result.map(p=>p.number)).size!==result.length)throw Error('Номера соперника не должны повторяться');
 return result;
}
export function openDetailedSetup(team,players,back,refresh,preset=null){
 const date=input(todayIso(),'date',{max:todayIso()}),opp=input('','text',{placeholder:'Название соперника'}),comp=input('','text',{placeholder:'Турнир'}),venue=input('','text',{placeholder:'Спортивный зал'});
 const best=select([[3,'До двух побед'],[5,'До трёх побед']],5),target=select([15,21,25].map(n=>[n,n]),25),decider=select([15,21,25].map(n=>[n,n]),15);
 const serve=select([['ours',team.name],['theirs','Соперник']],'ours'),scheme=select([['5-1','5–1'],['4-2','4–2'],['free','Свободная']],preset?.scheme||'5-1');
 const substitutions=select([['simple','Упрощённые (до 6)'],['paired','Парные (возврат стартового игрока)']],'simple');
 const awayInput=el('textarea',{placeholder:'7 Иванова\n8 Петрова\n9\n10\n11\n12',rows:5});const awayArea=el('div',{class:'vp-stack'}),ownArea=el('div',{class:'vp-stack'});
 let awayPlayers=[],awayFields=six([]),parsedText='',ownFields,eligible=[],libero;
 const checked=new Set(players.map(p=>p.id));
 function refreshOwn(){
  const previous=ownFields?.get()||preset?.lineup||[],previousLib=libero?.value||preset?.libero||'';
  const warnings=C.trainingWarnings({date:date.value,roster:players.map(p=>p.id),exercises:[{name:'Волейбол',activityId:'volley'},{name:'Прыжки',activityId:'jump'},{name:'Соревнование',activityId:'competition'}]},players);
  const restricted=new Set(warnings.map(x=>x.player.id));
  eligible=players.filter(p=>!p.archived&&!restricted.has(p.id)&&checked.has(p.id));
  libero=select([['','Без либеро'],...eligible.map(p=>[p.id,playerLabel(p)])],eligible.some(p=>p.id===previousLib)?previousLib:'');
  ownFields=six(eligible,previous,{excluded:libero.value?[libero.value]:[]});
  libero.onchange=()=>ownFields.setExcluded(libero.value?[libero.value]:[]);
  const rows=players.map(p=>{
   const check=el('input',{type:'checkbox'});check.checked=checked.has(p.id)&&!restricted.has(p.id);check.disabled=restricted.has(p.id);
   check.onchange=()=>{if(check.checked)checked.add(p.id);else checked.delete(p.id);refreshOwn();};
   return field(playerLabel(p)+(restricted.has(p.id)?' · ограничение нагрузки':''),check);
  });
  ownArea.replaceChildren(p('Выберите фактический состав. Совпадения с внесёнными ограничениями исключены; отсутствие совпадений не является допуском.'),el('details',{},[el('summary',{text:'Заявка · '+eligible.length}),...rows]),ownFields.node,field('Либеро нашей команды (не входит в стартовую шестёрку)',libero));
 }
 function parse(){
  awayPlayers=parseAway(awayInput.value);parsedText=awayInput.value;
  awayFields=six(awayPlayers,[],{side:'theirs'});
  awayArea.replaceChildren(awayPlayers.length?awayFields.node:p('Соперник без состава: счёт и причины очков доступны, авторы и расстановка неизвестны.'));
 }
 date.onchange=refreshOwn;refreshOwn();parse();
 const save=btn('Начать матч',async()=>{
  save.disabled=true;
  try{
   if(parsedText!==awayInput.value)parse();
   const line=ownFields.get(),away=awayPlayers.length?awayFields.get():[];
   if(new Set(line).size!==6||line.some(id=>!eligible.some(p=>p.id===id))||line.includes(libero.value))throw Error('Проверьте шесть стартовых игроков и либеро');
   if(awayPlayers.length&&(new Set(away).size!==6||away.some(id=>!awayPlayers.some(p=>p.id===id))))throw Error('Проверьте расстановку соперника');
   if(!opp.value.trim())throw Error('Укажите соперника');
   if(!await ui.confirmDialog({title:'Начать матч?',text:'Подтвердите фактические составы и выбранный регламент.',ok:'Начать'}))return;
   const d=await C.startDetailedMatch({teamId:team.id,teamName:team.name,opponent:opp.value,date:date.value,competition:comp.value,venue:venue.value,
     roster:eligible.map(p=>p.id),ourPlayers:eligible,awayPlayers,awayLineup:away,lineup:line,libero:libero.value||null,bestOf:Number(best.value),target:Number(target.value),decider:Number(decider.value),firstServe:serve.value,scheme:scheme.value,substitutionMode:substitutions.value});
   openDetailedMatch(d,back,refresh);
  }catch(e){toast(e.message);}finally{save.disabled=false;}
 },'primary wide');
 openSheet(el('div',{class:'vp-stack vp-setup'},[el('h2',{text:'Новый подробный матч'}),field('Соперник',opp),field('Дата',date),field('Турнир',comp),field('Место',venue),field('Формат',best),field('Очков в партии',target),field('Решающая партия',decider),field('Первая подача',serve),field('Тактическая схема',scheme),field('Правила замен',substitutions),p('Парные замены: один запасной на стартового игрока, один возврат за партию. Исключительные замены и все судейские правила не реализованы.'),
  el('h3',{text:team.name}),ownArea,el('h3',{text:'Состав соперника (необязательно)'}),p('Один игрок в строке: номер и имя. Если фамилии неизвестны, достаточно номера.'),awayInput,btn('Подготовить расстановку соперника',()=>{try{parse();}catch(e){toast(e.message);}},'wide'),awayArea,save,btn('Назад',back,'wide')]));
}
function court(d,lineups,serve,selected,choose){
 function half(side,zones){
  const ids=lineups[side];
  return el('div',{class:'vp-half '+side},zones.map(z=>{
   const id=ids[z-1],player=roster(d,side).find(p=>p.id===id);
   const active=selected?.side===side&&selected?.id===id;
   return el('button',{type:'button',class:'vp-player'+(active?' selected':'')+(serve===side&&z===1?' serving':''),disabled:!player||!choose,onclick:()=>choose?.(side,id),'aria-label':sideName(d,side)+', зона '+z+', '+(player?playerLabel(player):'нет игрока')},
     [el('small',{text:'P'+z+(serve===side&&z===1?' • подача':'')}),el('strong',{text:player?.number??'—'}),el('span',{text:player?.name||'—'})]);
  }));
 }
 return el('div',{class:'vp-court'},[half('theirs',[1,6,5,2,3,4]),el('div',{class:'vp-net',text:'СЕТКА'}),half('ours',[4,3,2,5,6,1])]);
}
function shown(d,s){return {ours:s.lineup.map(id=>s.liberoFor===id?d.libero:id),theirs:s.awayLineup};}
export function openDetailedMatch(initial,back,refresh){
 let d=initial,busy=false,selected=null,attributing=false,section='match',nextDraft=null,quick=false;
 const body=el('div',{class:'vp-stack vp-live'});
 const perform=async(event,after)=>{
  if(busy)return;busy=true;
  const buttons=[...body.querySelectorAll('button')].filter(x=>!x.disabled);buttons.forEach(x=>x.disabled=true);
  try{d=await C.changeLiveMatch(d.id,d.revision,event);after?.();draw();}
  catch(e){toast(e.message);}finally{busy=false;buttons.forEach(x=>x.disabled=false);}
 };
 function draw(){
  const s=V.replayDetailed(d),last=s.timeline.at(-1),won=s.sets.filter(x=>x.ours>x.theirs).length;
  const set=s.setEnded?s.sets.length:s.sets.length+1;
  const pre=attributing&&d.events.at(-1)?.type==='rally'&&last?.before;
  if(!pre)attributing=false;
  const courtState=pre?last.before.lineups:shown(d,s),serve=pre?last.before.serve:s.serve;
  const displayScore=el('div',{class:'vp-scoreboard'},sides.map(side=>el('div',{class:'vp-score-side '+side+(s.serve===side?' score-serving':'')},[el('span',{text:sideName(d,side)}),el('strong',{text:String(s.score[side])}),el('small',{text:(s.serve===side?'● Подача · ':'')+'Сеты '+(side==='ours'?won:s.sets.length-won)})])));
  body.replaceChildren(el('div',{class:'vp-match-head'},[el('div',{class:'vp-match-title'},[el('span',{class:'match-live-label',text:s.finished?'ЗАВЕРШЁН':s.setEnded?'ПЕРЕРЫВ':'● LIVE'}),el('strong',{text:'Партия '+set})]),displayScore,el('div',{class:'match-sets'},s.sets.length?s.sets.map((x,i)=>el('span',{class:'match-set',text:(i+1)+' · '+score(x)})):[el('span',{text:'Первая партия'})])]),
   el('div',{class:'vp-tabs',role:'group','aria-label':'Раздел матча'},[['match','Матч'],['stats','Статистика'],['events','События']].map(([id,t])=>btn(t,()=>{section=id;draw();},section===id?'primary':''))));
  if(section==='stats'){body.append(...summaryBlocks(d,s));}
  else if(section==='events'){
   body.append(p('Событий: '+d.events.length),...s.timeline.slice().reverse().slice(0,100).map(x=>p('Сет '+x.set+' · '+x.score+' · '+eventText(d,x))));
  }else{
   body.append(el('div',{class:'vp-tabs',role:'group','aria-label':'Режим ввода очков'},[['Стандартный',false],['Быстрый счёт',true]].map(([label,value])=>el('button',{class:'btn '+(quick===value?'primary':''),type:'button','aria-pressed':String(quick===value),text:label,onclick:()=>{quick=value;attributing=false;selected=null;draw();}}))));
   body.append(court(d,courtState,serve,selected,(side,id)=>{selected={side,id};draw();}));
   if(pre){
    const winner=last.side,actor=selected?.side,options=actor===winner?['kill','block','ace']:actor?errors:[];
    body.append(el('div',{class:'vp-attribution match-attribution'},[el('strong',{text:'Очко записано · '+last.score}),p('Выберите игрока на площадке ДО перехода. Можно указать причину без автора или пропустить.'),p(selected?name(d,selected.side,selected.id):'Автор не выбран'),
      el('div',{class:'vp-actions'},options.map(k=>btn(V.reasons[k],()=>perform({type:'attribute',kind:k,player:selected.id},()=>{attributing=false;selected=null;})))),
      field('Причина без автора',select([['point','Без детализации'],...Object.entries(V.reasons).filter(([k])=>k!=='point')],'point'))]));
    const area=body.lastElementChild,reason=area.querySelector('select');
    area.append(btn('Сохранить причину',()=>perform({type:'attribute',kind:reason.value,player:null},()=>{attributing=false;selected=null;}),'wide'),btn('Пропустить / продолжить',()=>{attributing=false;selected=null;draw();},'primary wide'));
   }else if(s.finished){
    body.append(p('Матч завершён'),btn('Сохранить матч и открыть протокол',async()=>{
     if(busy||!await ui.confirmDialog({title:'Завершить матч?',text:'События, счёт и статистика сохранятся в истории.',ok:'Сохранить'}))return;
     busy=true;try{const m=await C.finishLiveMatch(d.id,d.revision);await refresh();openMatchReport(m,back);}catch(e){toast(e.message);}finally{busy=false;}
    },'primary wide'));
   }else if(s.setEnded){
    if(!nextDraft||nextDraft.revision!==d.revision){
     const prev=s.setDetails.at(-1).lineups;
     nextDraft={revision:d.revision,
      own:six(d.ourPlayers.filter(p=>p.id!==d.libero),prev.ours,{previous:prev.ours,final:s.lineup}),
      away:six(d.awayPlayers,prev.theirs,{previous:prev.theirs,final:s.awayLineup,side:'theirs'}),
      first:select(sides.map(side=>[side,sideName(d,side)]),s.sets.length%2?d.firstServe==='ours'?'theirs':'ours':d.firstServe)};
    }
    const {own,away,first}=nextDraft;
    body.append(el('h3',{text:'Старт следующей партии'}),p('Старт предыдущей партии скопирован. Измените нужные зоны или очистите расстановку.'),p(d.teamName),own.node,...(d.awayPlayers.length?[p(d.opponent),away.node]:[]),field('Первая подача',first),btn('Начать партию',()=>perform({type:'next',lineup:own.get(),awayLineup:d.awayPlayers.length?away.get():[],serve:first.value},()=>{selected=null;nextDraft=null;}),'primary wide'));
   }else{
    const add=side=>perform({type:'rally',side,kind:'point',player:null},()=>{selected=null;attributing=!quick;});
    const points=el('div',{class:'vp-actions vp-points'},sides.map(side=>el('button',{type:'button',class:'btn '+(side==='ours'?'vp-ours':'vp-theirs'),onclick:()=>add(side),'aria-label':'Очко '+sideName(d,side)},[el('strong',{text:'+1'}),el('span',{text:' '+sideName(d,side)})])));
    body.insertBefore(points,body.querySelector('.vp-court'));
    body.append(el('div',{class:'vp-actions vp-secondary-actions'},sides.map(side=>btn('Тайм-аут '+sideName(d,side)+' '+s.timeouts[side]+'/2',()=>perform({type:'timeout',side})))));
    if(selected){
     const side=selected.side;
     const candidates=V.legalSubstitutions(d,s,side,selected.id);
     const reserve=select([['','Запасной'],...candidates.map(p=>[p.id,playerLabel(p)])],'');
     body.append(p('Выбран: '+name(d,side,selected.id)),field('Игрок на замену',reserve),candidates.length?btn('Замена · '+s.subCounts[side]+'/6',()=>perform({type:'sub',side,out:selected.id,in:reserve.value},()=>selected=null),'wide'):p('Допустимых обычных замен нет.'));
     if(side==='ours'&&d.libero)body.append(btn(s.liberoFor?'Вернуть основного игрока':'Выход либеро',()=>perform({type:'libero',for:s.liberoFor?null:selected.id},()=>selected=null),'wide'));
    }
   }
   if(!attributing&&d.events.at(-1)?.type==='rally'){
    body.append(btn('Уточнить последнее очко',()=>{attributing=true;selected=null;draw();},'wide'));
    if(last&&['ace','kill'].includes(last.kind)){
      const zone=select([['','Не указана'],...Array.from({length:6},(_,i)=>[String(i+1),'Зона '+(i+1)])],last.placement??'');
      body.append(field('Зона завершения на площадке принимающей команды',zone),btn('Сохранить направление последнего очка',()=>perform({type:'placement',zone:zone.value?Number(zone.value):null}),'wide'));
    }
   }
  }
  body.append(p('Замены: '+(d.substitutionMode==='paired'?'парные':'упрощённые')),p('Записано событий: '+d.events.length+' · локально'),btn('Отменить последнее событие',()=>{if(d.events.length)perform(null,()=>{selected=null;attributing=false;});},'wide'),
   btn('Выйти · черновик сохранён',()=>{if(!busy)back();},'wide'),
   btn('Удалить черновик',async()=>{if(busy||!await ui.confirmDialog({title:'Удалить черновик?',text:'Вся история этого матча будет удалена.',ok:'Удалить',danger:true}))return;busy=true;try{await C.discardLiveMatch(d.id,d.revision);back();}catch(e){toast(e.message);}finally{busy=false;}},'wide'));
 }
 draw();openSheet(body,{fullHeight:true,match:true});
}
function table(headers,rows){
 return el('div',{class:'vp-table'},[el('table',{},[el('thead',{},[el('tr',{},headers.map(t=>el('th',{text:String(t)})))]),el('tbody',{},rows.map(row=>el('tr',{},row.map(t=>el('td',{text:String(t??'—')})))))])]);
}
function section(title,...children){return el('section',{class:'vp-report-section'},[el('h3',{text:title}),...children]);}
function eventText(d,x){
 if(x.type==='rally')return sideName(d,x.side)+' · '+V.reasons[x.kind]+' · '+name(d,x.actor,x.player)+(x.placement?' · зона '+x.placement:'');
 if(x.type==='sub')return sideName(d,x.side)+' · замена '+name(d,x.side,x.out)+' → '+name(d,x.side,x.in)+' · P'+x.zone;
 if(x.type==='timeout')return sideName(d,x.side)+' · тайм-аут '+x.number;
 if(x.type==='libero')return d.teamName+' · '+(x.for?'Выход либеро вместо '+name(d,'ours',x.for):'Возвращение основного игрока');
 return x.type;
}
function placementBlock(d,s,side,kind){
 const a=V.placementSummary(s.timeline,side,kind),max=Math.max(1,...a.zones);
 return section(sideName(d,side)+' · '+(kind==='ace'?'Направления эйсов':'Направления результативных атак'),
   p('Зона на стороне принимающей команды. Указано '+a.known+' из '+a.total+' · без зоны '+a.unknown+'. Не включает подачи или атаки, продолжившие розыгрыш.'),
   el('div',{class:'tactical-grid'},[4,3,2,5,6,1].map(z=>el('div',{class:'tactical-cell'},[el('small',{text:'Зона '+z}),el('strong',{text:a.zones[z-1]}),el('progress',{max,value:a.zones[z-1],'aria-label':'Зона '+z+' · '+a.zones[z-1]})]))));
}
function summaryBlocks(d,s){
 return sides.flatMap(side=>{
  const a=s.sides[side],op=sideName(d,side);
  return [section(op+' · '+a.points+' очков',p('На подаче: '+a.onServe+' · на ошибках соперника: '+a.opponentErrors+' · макс. серия: '+a.maxRun+' · без детализации: '+a.unknown),
    table(['Игрок','Атака','Блок','Эйс','Ошибки'],roster(d,side).map(r=>{const st=a.stats[r.id]||{};return [playerLabel(r),st.attackKills??'—',st.blocks??'—',st.aces??'—',st.errors??'—'];})),
    table(['Причина очка','Количество'],Object.entries(V.reasons).map(([k,t])=>[t,s.timeline.filter(x=>x.type==='rally'&&x.side===side&&x.kind===k).length]))),
    section('Эффективность переходов · '+op,p('P1–P6 — шесть циклов относительно стартовой расстановки партии; первый цикл P1.'),
      table(['Цикл','Розыгрыши','Выиграно','Проиграно','+/−'],a.rotations.map(r=>['P'+r.position,r.rallies,r.won,r.lost,r.won-r.lost]))),
    section('Серии подач · '+op,table(['Сет','Подающая','Очки','Эйсы','Ошибки'],[...a.runs,...(a.activeRun?[a.activeRun]:[])].map(r=>[r.set,name(d,side,r.player),r.won,r.aces,r.errors]))),placementBlock(d,s,side,'ace'),placementBlock(d,s,side,'kill')];
 });
}
export function buildMatchReport(m){
 const d=m.detail,{state:s,sets,duration}=V.reportData(d),wins=s.sets.filter(x=>x.ours>x.theirs).length;
 return el('article',{class:'vp-report'},[el('div',{class:'vp-report-brand'},[el('strong',{text:'TeachApp'}),el('span',{text:'Тренерский протокол'})]),
  el('h1',{text:'Протокол матча'}),el('div',{class:'vp-report-score'},[p(d.teamName),el('strong',{text:wins+' : '+(s.sets.length-wins)}),p(d.opponent)]),
  p('Классический волейбол · до '+d.bestOf+' партий · '+d.date+' · '+(d.competition||'Без турнира')+' · '+(d.venue||'Место не указано')+' · '+seconds(duration)),
  p('Журнал событий: '+d.events.length+' · результат восстановлен из истории. Не официальный судейский бланк. Неуказанная статистика обозначена прочерком.'),
  section('Результаты партий',table(['Сет',d.teamName,d.opponent,'Длительность'],sets.map(x=>[x.set,x.ours,x.theirs,seconds(x.seconds)]))),
  section('Стартовые расстановки',...sets.map(x=>section('Сет '+x.set,table(['Команда','P1','P2','P3','P4','P5','P6'],sides.map(side=>[sideName(d,side),...Array.from({length:6},(_,i)=>x.lineups[side][i]?name(d,side,x.lineups[side][i]):'—')]))))),
  section('Замены и либеро',table(['Сет','Счёт','Действие'],s.timeline.filter(x=>x.type==='sub'||x.type==='libero').map(x=>[x.set,x.score,eventText(d,x)]))),
  section('Тайм-ауты',table(['Сет','Счёт','Команда','№'],s.timeline.filter(x=>x.type==='timeout').map(x=>[x.set,x.score,sideName(d,x.side),x.number]))),
  ...summaryBlocks(d,s),
  section('Детали очка',table(['Сет','Счёт','Команда','Причина','Автор','Зона'],s.timeline.filter(x=>x.type==='rally').map(x=>[x.set,x.score,sideName(d,x.side),V.reasons[x.kind],name(d,x.actor,x.player),x.placement??'—']))),
  section('Подписи',p('Первый судья __________________________'),p('Капитан '+d.teamName+' __________________________'),p('Капитан '+d.opponent+' __________________________'))]);
}
import {openMatchTactics} from './match-tactics.js';
export function openMatchReport(m,back){
 try{
  const report=buildMatchReport(m);
  openSheet(el('div',{class:'vp-stack'},[btn('Печать / сохранить PDF',()=>{
   document.getElementById('teachapp-print-report')?.remove();
   const node=el('div',{id:'teachapp-print-report'},[buildMatchReport(m)]);document.body.append(node);
   const cleanup=()=>node.remove();window.addEventListener('afterprint',cleanup,{once:true});
   try{window.print();}catch{cleanup();toast('Печать недоступна');}
  },'primary wide'),btn('Тактический разбор',()=>openMatchTactics(m,()=>openMatchReport(m,back)),'wide'),report,btn('Назад',back||ui.closeSheet,'wide')]));
 }catch(e){toast(e.message);}
}
