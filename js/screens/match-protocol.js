import * as C from '../coach.js';
import * as V from '../match-protocol.js';
import {matchTactics} from '../match-tactics.js';
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
function playerLabel(p){return (p.number==null?'':'№'+p.number+' · ')+p.name;}
function six(players,initial=[],options={}){return lineupPicker(players,initial,options);}
function colorFields(initial=V.defaultBoardColors){
 const rows=Object.entries(V.boardPalette).map(([id,c])=>[id,c.label]);
 const ours=select(rows,initial.ours),theirs=select(rows,initial.theirs);
 const preview=el('div',{class:'vp-color-preview'});
 function draw(){preview.replaceChildren(...[ours,theirs].map((n,i)=>{const c=V.boardPalette[n.value];return el('span',{style:'background:'+c.end,text:i?'Соперник':'Наши'});}));}
 ours.addEventListener('change',draw);theirs.addEventListener('change',draw);draw();
 return {node:el('div',{class:'vp-stack'},[preview,field('Цвет нашей команды',ours),field('Цвет соперника',theirs)]),get:()=>({ours:ours.value,theirs:theirs.value})};
}
// Wake lock is opt-in, scoped to this mounted match and released on navigation.
export function matchWakeLock(doc=document,api=globalThis.navigator?.wakeLock){
 let enabled=false,closed=false,lock=null,pending=false;
 const release=()=>{const old=lock;lock=null;if(old)Promise.resolve(old.release()).catch(()=>{});};
 const acquire=async()=>{if(!enabled||closed||pending||lock&&!lock.released||doc.visibilityState!=='visible')return false;
  pending=true;try{const next=await api.request('screen');if(!enabled||closed||doc.visibilityState!=='visible'){await next.release();return false;}lock=next;next.addEventListener?.('release',()=>{if(lock===next)lock=null;});return true;}catch{return false;}finally{pending=false;}};
 const visibility=()=>{if(doc.visibilityState==='visible')void acquire();else release();};
 doc.addEventListener('visibilitychange',visibility);
 return {supported:typeof api?.request==='function',get enabled(){return enabled;},async toggle(){if(closed||!api?.request)return false;enabled=!enabled;if(!enabled){release();return false;}const ok=await acquire();if(!ok&&doc.visibilityState==='visible')enabled=false;return enabled;},stop(){closed=true;enabled=false;release();doc.removeEventListener('visibilitychange',visibility);}};
}
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
export function openDetailedSetup(team,players,back,refresh,preset=null,{matches=[],presets=[]}={}){
 const date=input(todayIso(),'date',{max:todayIso()}),opp=input('','text',{placeholder:'Название соперника'}),comp=input('','text',{placeholder:'Турнир'}),venue=input('','text',{placeholder:'Спортивный зал'});
 const best=select([[3,'До двух побед'],[5,'До трёх побед']],5),target=select([15,21,25].map(n=>[n,n]),25),decider=select([15,21,25].map(n=>[n,n]),15);
 const serve=select([['ours',team.name],['theirs','Соперник']],'ours'),scheme=select([['5-1','5–1'],['4-2','4–2'],['free','Свободная']],preset?.scheme||'5-1');
 const substitutions=select([['simple','Упрощённые (до 6)'],['paired','Парные (возврат стартового игрока)']],'simple');
 const colors=colorFields();
 const previousMatches=matches.filter(m=>m.teamId===team.id&&m.detail?.mode==='dual').sort((a,b)=>b.date.localeCompare(a.date)||b.detail.startedAt.localeCompare(a.detail.startedAt));
 const previous=previousMatches[0]?.detail;
 const templates=presets.filter(x=>x.teamId===team.id);
 const history=V.opponentHistory(matches,team.id);
 const awayInput=el('textarea',{placeholder:'7 Иванова\n8 Петрова\n9\n10\n11\n12',rows:5});const awayArea=el('div',{class:'vp-stack'}),ownArea=el('div',{class:'vp-stack'});
 let awayPlayers=[],awayFields=six([]),parsedText='',ownFields,eligible=[],libero;
 const checked=new Set(players.map(p=>p.id));
 const template=select([['','Выберите шаблон'],...templates.map(x=>[x.id,x.name])],'');
 const loadOwn=(line,lib)=>{libero.value=eligible.some(p=>p.id===lib)?lib:'';ownFields.setExcluded(libero.value?[libero.value]:[]);ownFields.set(line);};
 const shortcuts=el('div',{class:'vp-stack'},[templates.length?field('Сохранённая шестёрка',template):null,templates.length?btn('Применить шаблон',()=>{const t=templates.find(x=>x.id===template.value);if(!t)return;scheme.value=t.scheme;loadOwn(t.lineup,t.libero);},'wide'):null,previous?btn('Старт последнего матча',()=>{scheme.value=previous.scheme;loadOwn(previous.lineup,previous.libero);},'wide'):null]);
 const opponentPick=select([['','Выберите соперника'],...history.map(m=>[m.id,m.opponent+' · '+m.date])],'');
 const loadOpponent=()=>{const m=history.find(x=>x.id===opponentPick.value);if(!m)return;opp.value=m.opponent;awayInput.value=m.detail.awayPlayers.map(p=>p.number+' '+p.name).join('\n');parse();const numbers=new Map(m.detail.awayPlayers.map(p=>[p.id,p.number]));awayFields.set(m.detail.awayLineup.map(id=>awayPlayers.find(p=>p.number===numbers.get(id))?.id));};
 function refreshOwn(){
  const previous=ownFields?.get()||preset?.lineup||[],previousLib=libero?.value??preset?.libero??'';
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
  ownArea.replaceChildren(p('Выберите фактический состав. Совпадения с внесёнными ограничениями исключены; отсутствие совпадений не является допуском.'),el('details',{},[el('summary',{text:'Заявка · '+eligible.length}),...rows]),shortcuts,ownFields.node,field('Либеро нашей команды (не входит в стартовую шестёрку)',libero));
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
   if(!V.validBoardColors(colors.get()))throw Error('Выберите два разных цвета команд');
   if(!await ui.confirmDialog({title:'Начать матч?',text:'Подтвердите фактические составы и выбранный регламент.',ok:'Начать'}))return;
   const d=await C.startDetailedMatch({teamId:team.id,teamName:team.name,opponent:opp.value,date:date.value,competition:comp.value,venue:venue.value,
     roster:eligible.map(p=>p.id),ourPlayers:eligible,awayPlayers,awayLineup:away,lineup:line,libero:libero.value||null,bestOf:Number(best.value),target:Number(target.value),decider:Number(decider.value),firstServe:serve.value,scheme:scheme.value,substitutionMode:substitutions.value,boardColors:colors.get()});
   openDetailedMatch(d,back,refresh);
  }catch(e){toast(e.message);}finally{save.disabled=false;}
 },'primary wide');
 openSheet(el('div',{class:'vp-stack vp-setup'},[el('h2',{text:'Новый подробный матч'}),field('Соперник',opp),field('Дата',date),field('Турнир',comp),field('Место',venue),field('Формат',best),field('Очков в партии',target),field('Решающая партия',decider),field('Первая подача',serve),field('Тактическая схема',scheme),field('Правила замен',substitutions),el('details',{class:'vp-match-more'},[el('summary',{text:'Цвета табло'}),colors.node]),p('Парные замены: один запасной на стартового игрока, один возврат за партию. Исключительные замены и все судейские правила не реализованы.'),
  el('h3',{text:team.name}),ownArea,el('h3',{text:'Состав соперника (необязательно)'}),p('Один игрок в строке: номер и имя. Если фамилии неизвестны, достаточно номера.'),history.length?field('Состав из истории',opponentPick):null,history.length?btn('Загрузить состав соперника',loadOpponent,'wide'):null,awayInput,btn('Подготовить расстановку соперника',()=>{try{parse();}catch(e){toast(e.message);}},'wide'),awayArea,save,btn('Назад',back,'wide')]));
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
 let d=initial,busy=false,selected=null,pointDraft=null,section='match',nextDraft=null,quick=false,swapped=false,scoutOpen=false,scoutSide='theirs',scoutKind='all',scoutSet=0,scoutEntry=false;
 const body=el('div',{class:'vp-stack vp-live'});
 const wake=matchWakeLock();let observer=null;
 const stop=()=>{wake.stop();observer?.disconnect();};
 const perform=async(event,after)=>{
  if(busy)return;busy=true;
  const buttons=[...body.querySelectorAll('button')].filter(x=>!x.disabled);buttons.forEach(x=>x.disabled=true);
  try{d=await C.changeLiveMatch(d.id,d.revision,event);after?.();draw();}
  catch(e){toast(e.message);}finally{busy=false;buttons.forEach(x=>x.disabled=false);}
 };
 function draw(){
  const s=V.replayDetailed(d),last=s.timeline.at(-1),won=s.sets.filter(x=>x.ours>x.theirs).length;
  const set=s.setEnded?s.sets.length:s.sets.length+1;
  const pre=pointDraft?.editing&&last?.before;
  const begin=(side,editing=false)=>{pointDraft={side,editing,kind:null};selected=null;draw();if(body.closest('.sheet'))body.closest('.sheet').scrollTop=0;};
  const cancel=()=>{pointDraft=null;selected=null;scoutOpen=false;draw();};
  const courtState=pre?last.before.lineups:shown(d,s),serve=pre?last.before.serve:s.serve;
  const active=section==='match'&&!s.setEnded&&!s.finished;
  const palette=d.boardColors||V.defaultBoardColors;
  for(const side of sides){const c=V.boardPalette[palette[side]];body.style.setProperty('--vp-'+side+'-start',c.start);body.style.setProperty('--vp-'+side+'-end',c.end);}
  body.classList.toggle('vp-live-board',active);
  const order=swapped?[...sides].reverse():sides;
  const choose=(side,id)=>{if(!busy){selected={side,id};draw();}};
  const displayScore=el('div',{class:'vp-scoreboard'+(active?' vp-board-score':'')},order.map((side,index)=>{
   const ids=shown(d,s)[side],serving=s.serve===side,server=ids[0];
   const player=roster(d,side).find(p=>p.id===server);
   const zones=index===0?[5,4,6,3,1,2]:[2,1,3,6,4,5];
   const mini=active?el('div',{class:'vp-court vp-mini-court','aria-label':'Расстановка '+sideName(d,side)},zones.map(z=>{
    const id=ids[z-1],pl=roster(d,side).find(p=>p.id===id);
    return el('button',{type:'button',class:'vp-mini-player'+(z===1&&serving?' serving':'')+(side==='ours'&&id===d.libero?' libero':''),disabled:!pl||!!pointDraft,onclick:()=>choose(side,id),'aria-label':sideName(d,side)+', зона '+z+', '+(pl?playerLabel(pl):'нет игрока')},[
     el('span',{class:'vp-mini-number',text:pl?.number??(pl?'•':'—')}),el('small',{text:'P'+z})]);
   })):null;
   return el('div',{class:'vp-score-side '+side+(serving?' score-serving':'')},[
    el('span',{text:sideName(d,side)}),el('strong',{class:'vp-score-number',text:String(s.score[side])}),
    el('small',{text:'Партии '+(side==='ours'?won:s.sets.length-won)}),mini,
    active?el('div',{class:'vp-board-indicators'},[
     el('div',{class:'vp-pips','aria-label':'Замены '+s.subCounts[side]+' из 6'},[el('span',{text:'Замены'}),...Array.from({length:6},(_,i)=>el('i',{class:i<s.subCounts[side]?'used':''}))]),
     el('button',{type:'button',class:'vp-timeout-button',disabled:s.timeouts[side]>=2||!!pointDraft,onclick:()=>perform({type:'timeout',side},()=>{selected=null;}),'aria-label':'Тайм-аут '+sideName(d,side)},[el('span',{text:'Тайм-аут'}),...Array.from({length:2},(_,i)=>el('i',{class:i<s.timeouts[side]?'used':''}))]),
     el('small',{class:'vp-board-serving',text:serving?'● Подаёт '+(player?.number!=null?'№'+player.number:player?.name||'команда'):'Приём'})]):null]);
  }));
  body.replaceChildren(el('div',{class:'vp-match-head'},[el('div',{class:'vp-match-title'},[el('span',{class:'match-live-label',text:s.finished?'ЗАВЕРШЁН':s.setEnded?'ПЕРЕРЫВ':'● LIVE'}),el('strong',{text:'Партия '+set})]),displayScore,el('div',{class:'match-sets'},s.sets.length?s.sets.map((x,i)=>el('span',{class:'match-set',text:(i+1)+' · '+score(x)})):[el('span',{text:'Первая партия'})])]),
   el('div',{class:'vp-tabs',role:'group','aria-label':'Раздел матча'},[['match','Матч'],['stats','Статистика'],['events','События']].map(([id,t])=>btn(t,()=>{section=id;draw();},section===id?'primary':''))));
  if(section==='stats'){body.append(momentumBlock(d,s),liveAnalysis(d,s));}
  else if(section==='events'){
   body.append(p('Событий: '+d.events.length),...s.timeline.slice().reverse().slice(0,100).map(x=>p('Сет '+x.set+' · '+x.score+' · '+eventText(d,x))));
  }else{
   const controls=el('div',{class:'vp-board-controls'},[
    btn(quick?'Режим: быстрый':'Режим: подробный',()=>{quick=!quick;selected=null;draw();}),
    btn('↔ Сменить стороны',()=>{swapped=!swapped;selected=null;draw();})]);
   if(!pointDraft)body.append(controls);
   if(!active&&!pointDraft)body.append(court(d,courtState,serve,selected,choose));
   const showOverlay=area=>{
    for(const child of [...body.children]){child.inert=true;child.setAttribute('inert','');}
    const overlay=el('div',{class:'vp-rally-overlay',onkeydown:e=>{if(e.key==='Escape'&&!busy){e.stopPropagation();cancel();}}},[area]);
    body.append(overlay);
    area.setAttribute('tabindex','-1');area.setAttribute('role','dialog');area.setAttribute('aria-modal','true');area.focus({preventScroll:true});
   };
   if(scoutOpen){
    const area=scoutPanel(d,s,{side:scoutSide,kind:scoutKind,set:scoutSet,entry:scoutEntry},patch=>{if(Object.hasOwn(patch,'side'))scoutSide=patch.side;if(Object.hasOwn(patch,'kind'))scoutKind=patch.kind;if(Object.hasOwn(patch,'set'))scoutSet=patch.set;if(Object.hasOwn(patch,'entry')){scoutEntry=patch.entry;if(scoutEntry)quick=false;}draw();},cancel);
    showOverlay(area);return;
   }
   if(pointDraft){
    const {side:winner,editing,kind}=pointDraft;
    const submit=(k,player=null,extra={})=>perform(editing?{type:'attribute',kind:k,player}:{type:'rally',side:winner,kind:k,player,...extra},()=>{pointDraft=null;selected=null;});
    const afterAuthor=(k,player=null)=>{if(!editing&&scoutEntry&&V.canPlace(k)){pointDraft={...pointDraft,author:player,extra:true,defender:null,zone:null};draw();}else submit(k,player);};
    const options=V.rallyReasonOptions(winner,serve).filter(k=>k!=='point');
    const area=el('section',{class:'vp-attribution match-attribution','aria-label':editing?'Уточнение очка':'Новое очко'},[
      el('div',{class:'vp-rally-heading'},[el('strong',{text:(editing?'Уточнить очко · ':'+1 · ')+sideName(d,winner)}),el('small',{text:pointDraft.extra?'Доп. данные · защита':kind?'2 · Игрок':'1 · Причина'})]),
      p(editing?'Счёт не изменится.': 'Очко ещё не начислено.')]);
    if(pointDraft.extra){
      const losing=winner==='ours'?'theirs':'ours',secondary=V.secondaryKind(kind),defenders=roster(d,losing).filter(p=>courtState[losing].includes(p.id));
      const patch=x=>{pointDraft={...pointDraft,...x};draw();};
      area.append(p('Необязательно. Укажите только наблюдаемую ошибку и фактическую зону завершения.'));
      if(secondary&&defenders.length)area.append(el('strong',{text:'Кто допустил ошибку · '+sideName(d,losing)}),el('div',{class:'vp-actions vp-author-grid'},defenders.map(p=>el('button',{type:'button',class:'btn'+(pointDraft.defender===p.id?' primary':''),'data-defender':p.id,'aria-pressed':String(pointDraft.defender===p.id),onclick:()=>patch({defender:pointDraft.defender===p.id?null:p.id})},[el('strong',{text:p.number==null?'—':'№'+p.number}),el('span',{text:p.name})]))));
      area.append(el('strong',{text:'Зона завершения'}),el('div',{class:'vp-heat-net',text:'СЕТКА'}),el('div',{class:'vp-heat-grid'},[4,3,2,5,6,1].map(z=>el('button',{type:'button',class:'btn vp-heat-entry'+(pointDraft.zone===z?' primary':''),'data-scout-zone':z,'aria-pressed':String(pointDraft.zone===z),text:'P'+z,onclick:()=>patch({zone:pointDraft.zone===z?null:z})}))),
       btn('Начислить очко',()=>submit(kind,pointDraft.author,{...(pointDraft.zone?{placement:pointDraft.zone}:{}),...(secondary&&pointDraft.defender?{secondary:{kind:secondary,player:pointDraft.defender}}:{})}),'primary wide'),btn('Пропустить уточнение',()=>submit(kind,pointDraft.author),'wide'),btn('Назад к игрокам',()=>{pointDraft={side:winner,editing,kind};draw();},'wide'));
    }else if(!kind){
      for(const [title,group] of [['Результативное действие',options.filter(k=>!V.isError(k))],['Ошибка соперника',options.filter(V.isError)]]){
        if(group.length)area.append(el('strong',{class:'vp-rally-label',text:title}),el('div',{class:'vp-actions vp-reason-grid'},group.map(k=>el('button',{type:'button',class:'btn','data-reason':k,text:V.reasons[k],onclick:()=>{pointDraft={...pointDraft,kind:k};draw();}}))));
      }
      area.append(btn('Без детализации',()=>submit('point'),'wide'));
    }else{
      const actor=V.rallyActor(winner,kind),players=V.rallyCandidates(d,courtState,serve,winner,kind);
      area.append(el('strong',{text:V.reasons[kind]+' · '+sideName(d,actor)}),
        p(players.length?'Выберите игрока, находившегося на площадке до розыгрыша.':'Нет доступных игроков. Можно сохранить причину без автора.'),
        el('div',{class:'vp-actions vp-author-grid'},players.map(player=>el('button',{type:'button',class:'btn','data-player':player.id,onclick:()=>afterAuthor(kind,player.id)},[el('strong',{text:player.number==null?'—':'№'+player.number}),el('span',{text:player.name}),el('small',{text:'P'+player.zone})]))),
        btn('Сохранить без автора',()=>afterAuthor(kind),'wide'),btn('Назад к причинам',()=>{pointDraft={...pointDraft,kind:null};draw();},'wide'));
    }
    area.append(btn('Отмена',cancel,'wide'));showOverlay(area);
   }else if(s.finished){
    body.append(p('Матч завершён'),btn('Сохранить матч и открыть протокол',async()=>{
     if(busy||!await ui.confirmDialog({title:'Завершить матч?',text:'События, счёт и статистика сохранятся в истории.',ok:'Сохранить'}))return;
     busy=true;try{const m=await C.finishLiveMatch(d.id,d.revision);stop();await refresh();openMatchReport(m,back);}catch(e){toast(e.message);}finally{busy=false;}
    },'primary wide'));
   }else if(s.setEnded){
    body.append(btn('◎ Тактическая разведка',()=>{scoutOpen=true;draw();if(body.closest('.sheet'))body.closest('.sheet').scrollTop=0;},'wide vp-scout-open'));
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
    const add=side=>quick?perform({type:'rally',side,kind:'point',player:null},()=>{selected=null;}):begin(side);
    const pointButton=side=>el('button',{type:'button',class:'btn '+(side==='ours'?'vp-ours':'vp-theirs'),onclick:()=>add(side),'aria-label':'Очко '+sideName(d,side)},[el('strong',{text:'+1'}),el('span',{text:sideName(d,side)})]);
    const undo=el('button',{type:'button',class:'btn vp-undo',text:'↶','aria-label':'Отменить последнее событие',disabled:!d.events.length,onclick:()=>perform(null,()=>{selected=null;pointDraft=null;})});
    const points=el('div',{class:'vp-actions vp-points vp-board-points'},[pointButton(order[0]),undo,pointButton(order[1])]);
    body.append(points,el('button',{type:'button',class:'btn wide vp-scout-open',onclick:()=>{if(busy)return;selected=null;scoutOpen=true;draw();if(body.closest('.sheet'))body.closest('.sheet').scrollTop=0;},text:'◎ Тактическая разведка'}));
    if(last)body.append(el('div',{class:'vp-last-event',role:'status',text:'Последнее: '+eventText(d,last)}));
    const momentum=V.setMomentum(s.timeline,set);
    if(momentum.run>=4&&momentum.runSide==='theirs')body.append(el('div',{class:'vp-run-note',role:'status',text:'Соперник выиграл '+momentum.run+' розыгрыша подряд. '+(s.timeouts.ours<2?'Можно рассмотреть тайм-аут.':'Лимит тайм-аутов исчерпан.')}));
    if(selected){
     const side=selected.side;
     const candidates=V.legalSubstitutions(d,s,side,selected.id);
     const reserve=select([['','Запасной'],...candidates.map(p=>[p.id,playerLabel(p)])],'');
     const playerStats=s.sides[side].stats[selected.id]||{};
     const area=el('section',{class:'vp-attribution vp-player-overlay','aria-label':'Действия игрока'},[
      el('h3',{text:name(d,side,selected.id)}),
      p('Очки: '+(playerStats.points||0)+' · Ошибки: '+(playerStats.errors||0)),
      p('Атаки: '+(playerStats.attackKills||0)+' · Скидки: '+(playerStats.tipKills||0)+' · Блоки: '+(playerStats.blocks||0)+' · Эйсы: '+(playerStats.aces||0)),
      field('Игрок на замену',reserve),candidates.length?btn('Замена · '+s.subCounts[side]+'/6',()=>{if(!reserve.value)return toast('Выберите запасного');perform({type:'sub',side,out:selected.id,in:reserve.value},()=>selected=null);},'primary wide'):p('Допустимых обычных замен нет.')]);
     if(side==='ours'&&d.libero&&(s.liberoFor===null?[1,5,6].includes(s.lineup.indexOf(selected.id)+1)&&!(s.serve==='ours'&&s.lineup[0]===selected.id):selected.id===d.libero))area.append(btn(s.liberoFor?'Вернуть основного игрока':'Выход либеро',()=>perform({type:'libero',for:s.liberoFor?null:selected.id},()=>selected=null),'wide'));
     area.append(btn('Отмена',()=>{selected=null;draw();},'wide'));showOverlay(area);return;
    }
   }
   if(!pointDraft&&d.events.at(-1)?.type==='rally'){
    const details=el('details',{class:'vp-match-more'},[el('summary',{text:'Детали последнего очка'}),btn('Уточнить последнее очко',()=>begin(last.side,true),'wide')]);body.append(details);
    if(last&&V.secondaryKind(last.kind)){
     const losing=last.side==='ours'?'theirs':'ours',kind=V.secondaryKind(last.kind),players=roster(d,losing).filter(p=>last.before.lineups[losing].includes(p.id));
     const extra=select([['','Не указана'],...players.map(p=>[p.id,playerLabel(p)])],last.secondary?.player||'');
     details.append(field(V.reasons[kind]+' · '+sideName(d,losing),extra),btn('Сохранить дополнительную ошибку',()=>perform({type:'secondary',player:extra.value||null}),'wide'),p('Не меняет счёт и не дублирует причину очка. Указывайте только явно замеченную ошибку.'));
    }
    if(last&&V.canPlace(last.kind)){
      details.append(p('Зона завершения на площадке принимающей команды'),el('div',{class:'vp-heat-net',text:'СЕТКА'}),el('div',{class:'vp-heat-grid'},[4,3,2,5,6,1].map(z=>el('button',{type:'button',class:'btn vp-heat-entry'+(last.placement===z?' primary':''),'aria-pressed':String(last.placement===z),'data-zone':z,text:'P'+z,onclick:()=>perform({type:'placement',zone:z})}))),btn('Убрать зону',()=>perform({type:'placement',zone:null}),'wide'));
    }
   }
  }
  if(pointDraft)return;
  const undo=btn('Отменить последнее событие',()=>{if(d.events.length)perform(null,()=>{selected=null;pointDraft=null;});},'wide');undo.disabled=!d.events.length;
  if(!active){if(section==='match')body.querySelector('.vp-match-head').append(undo);else body.append(undo);}
  const liveColors=colorFields(palette);
  const saveColors=btn('Сохранить цвета',async()=>{if(busy)return;busy=true;saveColors.disabled=true;try{d=await C.changeLiveColors(d.id,d.revision,liveColors.get());draw();}catch(e){toast(e.message);}finally{busy=false;saveColors.disabled=false;}},'wide');
  const wakeBtn=btn(wake.enabled?'Экран: не выключать':'Экран: обычный режим',async()=>{if(busy)return;wakeBtn.disabled=true;const requested=!wake.enabled;const enabled=await wake.toggle();wakeBtn.textContent=enabled?'Экран: не выключать':'Экран: обычный режим';wakeBtn.setAttribute('aria-pressed',String(enabled));wakeBtn.disabled=false;if(requested&&!enabled)toast('Не удалось удерживать экран. Проверьте настройки браузера или энергосбережение.');},'wide');wakeBtn.setAttribute('aria-pressed',String(wake.enabled));
  const menu=el('details',{class:'vp-match-more'},[el('summary',{text:'Управление матчем · черновик сохранён'}),
   wake.supported?wakeBtn:p('Удержание экрана недоступно в этом браузере.'),liveColors.node,saveColors,
   p('Замены: '+(d.substitutionMode==='paired'?'парные':'упрощённые')+' · Событий: '+d.events.length),
   btn('Выйти · черновик сохранён',()=>{if(!busy){stop();back();}},'wide'),
   btn('Удалить черновик',async()=>{if(busy||!await ui.confirmDialog({title:'Удалить черновик?',text:'Вся история этого матча будет удалена.',ok:'Удалить',danger:true}))return;busy=true;try{await C.discardLiveMatch(d.id,d.revision);stop();back();}catch(e){toast(e.message);}finally{busy=false;}},'wide')]);
  body.append(menu);
 }
 draw();const sheet=openSheet(body,{fullHeight:true,match:true,onClose:stop});
 if(typeof MutationObserver==='function'){observer=new MutationObserver(()=>{if(!body.isConnected||!sheet.classList.contains('show'))stop();});observer.observe(sheet,{childList:true,attributes:true,attributeFilter:['class']});}
}
function table(headers,rows){
 return el('div',{class:'vp-table'},[el('table',{},[el('thead',{},[el('tr',{},headers.map(t=>el('th',{text:String(t)})))]),el('tbody',{},rows.map(row=>el('tr',{},row.map(t=>el('td',{text:String(t??'—')})))))])]);
}
function section(title,...children){return el('section',{class:'vp-report-section'},[el('h3',{text:title}),...children]);}
function eventText(d,x){
 if(x.type==='rally')return sideName(d,x.side)+' · '+V.reasons[x.kind]+' · '+name(d,x.actor,x.player)+(x.placement?' · зона '+x.placement:'')+(x.secondary?' · '+V.reasons[x.secondary.kind]+': '+name(d,x.side==='ours'?'theirs':'ours',x.secondary.player):'');
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
function scoutPanel(d,s,options,change,close){
 const side=options.side,kind=options.kind,active=shown(d,s)[side],current=s.setEnded?s.sets.length:s.sets.length+1;
 const a=V.scoutSummary(s.timeline,side,{kind,set:options.set,active});
 const types=select(Object.entries(V.scoutTypes),kind),period=select([[0,'Весь матч'],...Array.from({length:current},(_,i)=>[i+1,'Партия '+(i+1)])],options.set);
 types.onchange=()=>change({kind:types.value});period.onchange=()=>change({set:Number(period.value)});
 const top=a.ranked[0],zone=a.topZones[0],hint=side==='theirs'?'Проверить игрока соперника':'Обратить внимание на нашу защиту';
 const ranked=top&&top.misses>=2?el('div',{class:'vp-scout-tip'},[el('strong',{text:hint+': '+name(d,side,top.id)+' · P'+top.zone}),p('Отмечено '+top.misses+' ошибок выбранного типа за период. Это наблюдение, не вероятность ошибки. '+(a.ranked.filter(x=>x.misses===top.misses).length>1?'Есть другие игроки с таким же количеством.':''))]):p('Пока нет повторяющихся персональных ошибок выбранного типа.');
 const zoneTip=zone&&zone.count>=2?el('div',{class:'vp-scout-tip'},[el('strong',{text:(side==='theirs'?'Проверить зону соперника P':'Прикрыть нашу зону P')+zone.zone}),p('Зафиксировано завершений: '+zone.count+'. '+(a.topZones.filter(x=>x.count===zone.count).length>1?'Есть зоны с таким же количеством.':''))]):p('Пока нет повторяющихся завершений в известной зоне.');
 const byZone=new Map(a.rows.map(x=>[x.zone,x])),maxPlayer=Math.max(1,...a.rows.map(x=>x.misses)),maxZone=Math.max(1,...a.zones);
 const grid=(isPlayer)=>el('div',{class:'vp-heat-grid'},[4,3,2,5,6,1].map(z=>{
  const r=byZone.get(z),pl=roster(d,side).find(p=>p.id===r?.id),count=isPlayer?r?.misses||0:a.zones[z-1];
  return el('div',{class:'vp-heat-cell vp-scout-cell',style:'--heat:'+count/(isPlayer?maxPlayer:maxZone)},[el('small',{text:'P'+z}),el('strong',{text:isPlayer?(pl?.number!=null?'№'+pl.number:pl?'•':'—'):String(count)}),el('small',{text:isPlayer?(pl?pl.name+' · '+count+' ошибок':'Нет состава'):'завершений'})]);
 }));
 return el('section',{class:'vp-attribution vp-scout-panel','aria-label':'Тактическая разведка'},[
  el('h3',{text:'Тактическая разведка'}),el('div',{class:'vp-tabs'},[['theirs','Соперник'],['ours','Наша команда']].map(([id,label])=>btn(label,()=>change({side:id}),side===id?'primary':''))),field('Период',period),field('Тип действия',types),
  p('Розыгрышей: '+a.rallies+' · завершений выбранного типа: '+a.total),p('С автором ошибки: '+a.knownPlayers+' из '+a.total+' · с зоной: '+a.knownZones+' из '+a.total),
  ranked,zoneTip,el('strong',{text:'Игроки в текущей расстановке'}),el('div',{class:'vp-heat-net',text:'СЕТКА'}),grid(true),p('P1–P6 — текущие позиции по расстановке, не фактическое место игрока в розыгрыше. Цвет показывает число отмеченных ошибок, а не качество игры.'),
  el('strong',{text:'Карта пропущенных завершений'}),el('div',{class:'vp-heat-net',text:'СЕТКА'}),grid(false),
  table(['Игрок на площадке','Подача/приём','Атака','Скидка','Защита*','Всего'],a.ranked.map(r=>[name(d,side,r.id),r.serve,r.attack,r.tip,r.defense,r.misses])),
  a.former.length?el('details',{},[el('summary',{text:'Игроки вне площадки · '+a.former.length}),...a.former.map(r=>p(name(d,side,r.id)+' · '+r.misses+' отмеченных ошибок'))]):null,
  p('* Ошибка защиты без указанного типа атаки. Учитываются только терминальные действия и явно отмеченные ошибки; полное число направленных мячей неизвестно.'),
  el('button',{type:'button',class:'btn wide'+(options.entry?' primary':''),'aria-pressed':String(options.entry),'data-scout-entry':'true',text:options.entry?'Уточнение очка: включено':'Уточнение очка: выключено',onclick:()=>change({entry:!options.entry})}),
  p('При включении после выбора автора атаки, скидки, эйса или ошибки приёма/защиты появится необязательный шаг для отметки зоны и ошибки соперника.'),
  btn('Вернуться к матчу',close,'primary wide')]);
}
function liveAnalysis(d,s){
 const current=s.setEnded?s.sets.length:s.sets.length+1;
 const period=select([[0,'Весь матч'],...Array.from({length:current},(_,i)=>[i+1,'Партия '+(i+1)])],0);
 const mode=select([['kill','Все результативные атаки'],['power','Атаки без скидок'],['tip','Скидки'],['ace','Эйсы']],'kill');
 const sidePicker=select(sides.map(x=>[x,sideName(d,x)]),'ours');
 const player=select([['','Все игроки']],'');
 const sample=select([[10,'10 розыгрышей'],[20,'20 розыгрышей'],[30,'30 розыгрышей']],10);
 const output=el('div',{class:'vp-stack'});
 function playerOptions(){const old=player.value;player.replaceChildren(el('option',{value:'',text:'Все игроки'}),...roster(d,sidePicker.value).map(p=>el('option',{value:p.id,text:playerLabel(p)})));if([...player.options].some(o=>o.value===old))player.value=old;}
 function draw(){
  const set=Number(period.value),data=V.rallySummary(s.timeline,set),side=sidePicker.value,kind=mode.value==='power'?'kill':mode.value;
  const a=V.placementSummary(s.timeline,side,kind,{set,player:player.value||null,includeTips:mode.value!=='power'});
  const max=Math.max(1,...a.zones),pct=(n,total)=>total?Math.round(n*100/total)+'%':'—';
  const heat=section('Карта завершений',p('Зоны на стороне принимающей команды. Указано '+a.known+' из '+a.total+' · неизвестно '+a.unknown+'.'),el('div',{class:'vp-heat-net',text:'СЕТКА'}),el('div',{class:'vp-heat-grid'},[4,3,2,5,6,1].map(z=>{
   const n=a.zones[z-1],intensity=n/max;
   return el('div',{class:'vp-heat-cell',style:'--heat:'+intensity,'aria-label':'Зона '+z+': '+n},[el('small',{text:'P'+z}),el('strong',{text:String(n)}),el('small',{text:pct(n,a.known)})]);
  })),p('Доли рассчитаны среди завершений с известной зоной, а не среди всех атак. Без отмеченной зоны точка не предполагается.'));
  const rows=sides.flatMap(side=>{
   const r=data[side];return [section(sideName(d,side)+' · '+r.points+' очков',p('На подаче: '+r.onServe+'/'+r.serve+' ('+pct(r.onServe,r.serve)+') · на приёме: '+r.receiveWon+'/'+r.receive+' ('+pct(r.receiveWon,r.receive)+')'),
    table(['Игрок','Атаки*','Скидки','Блок','Эйс','Ошибки','Очки'],roster(d,side).map(p=>{const x=r.stats[p.id]||{};return [playerLabel(p),x.attackKills??'—',x.tipKills??'—',x.blocks??'—',x.aces??'—',x.errors??'—',x.points??'—'];})),
    p('* Результативные атаки включают скидки. Процент успешности всех атак не рассчитывается без записи всех попыток.'),
    table(['Причина очка','Количество'],Object.entries(V.reasons).map(([k,t])=>[t,r.reasons[k]||0])))];
  });
  const tactical=matchTactics(d,5,{set,min:Number(sample.value)});
  const combo=(title,items)=>section(title,p('Выигранные розыгрыши в присутствии игроков. Сочетание не доказывает индивидуальный вклад.'),table(['Игроки','Розыгрыши','Победы','+/−','Доля'],items.slice(0,20).map(x=>[x.players.map(id=>name(d,'ours',id)).join(' · '),x.rallies,x.won,x.plusMinus,x.eligible?pct(x.won,x.rallies):'Мало данных'])),!items.length?p('Нет записанных сочетаний.'):null);
  const rotationRows=sides.flatMap(side=>{
   const r=Array.from({length:6},(_,i)=>({position:i+1,won:0,lost:0}));
   for(const e of s.timeline)if(e.type==='rally'&&(!set||e.set===set))r[e.rotation[side]][e.side===side?'won':'lost']++;
   const runs=[...s.sides[side].runs,...(s.sides[side].activeRun?[s.sides[side].activeRun]:[])].filter(x=>!set||x.set===set);
   return [section('Переходы · '+sideName(d,side),p('P1–P6 — циклы относительно стартового состава партии.'),table(['Цикл','Розыгрыши','Выиграно','Проиграно','+/−'],r.map(x=>['P'+x.position,x.won+x.lost,x.won,x.lost,x.won-x.lost]))),
    section('Серии подач · '+sideName(d,side),table(['Сет','Подающая','Очки','Эйсы','Ошибки'],runs.map(x=>[x.set,name(d,side,x.player),x.won,x.aces,x.errors])))];
  });
  output.replaceChildren(...rows,heat,...rotationRows,combo('Сочетания двух игроков',tactical.pairs),combo('Фактические шестёрки',tactical.six));
 }
 playerOptions();sidePicker.addEventListener('change',()=>{playerOptions();draw();});for(const control of [period,mode,player,sample])control.addEventListener('change',draw);draw();
 return section('Аналитика розыгрышей',field('Период',period),field('Команда для карты',sidePicker),field('Вид завершения',mode),field('Игрок для карты',player),field('Минимум для сравнения сочетаний',sample),output);
}
function momentumBlock(d,s){
 const current=s.setEnded?s.sets.length:s.sets.length+1;
 const picker=select(Array.from({length:current},(_,i)=>[i+1,'Партия '+(i+1)]),current);
 const chart=el('div',{class:'vp-momentum-content'});
 function draw(){
  const a=V.setMomentum(s.timeline,Number(picker.value)),max=Math.max(1,...a.points.map(x=>Math.max(x.ours,x.theirs)));
  const svg=(tag,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
  const plot=svg('svg',{viewBox:'0 0 320 150',role:'img','aria-label':'График набранных очков по розыгрышам',class:'vp-momentum-chart'});
  for(let i=0;i<=4;i++){const y=10+i*30;plot.append(svg('line',{x1:22,y1:y,x2:308,y2:y,stroke:'currentColor','stroke-opacity':.15}));}
  for(const side of sides){const coords=a.points.map((x,i)=>(22+286*i/Math.max(1,a.points.length-1))+','+(130-120*x[side]/max)).join(' ');plot.append(svg('polyline',{points:coords,fill:'none',stroke:V.boardPalette[(d.boardColors||V.defaultBoardColors)[side]].start,'stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round'}));}
  const end=a.points.at(-1);
  chart.replaceChildren(el('div',{class:'vp-momentum-legend'},[el('span',{class:'ours',style:'color:'+V.boardPalette[(d.boardColors||V.defaultBoardColors).ours].start,text:d.teamName+' · '+end.ours}),el('span',{class:'theirs',style:'color:'+V.boardPalette[(d.boardColors||V.defaultBoardColors).theirs].start,text:d.opponent+' · '+end.theirs})]),plot,
   p('Розыгрышей: '+(a.points.length-1)+' · смен лидера: '+a.changes+' · равный счёт: '+a.ties),
   table(['Показатель',d.teamName,d.opponent],[['Макс. серия',a.maxRun.ours,a.maxRun.theirs],['Макс. преимущество',a.maxLead.ours,a.maxLead.theirs]]));
 }
 picker.addEventListener('change',draw);draw();return section('Ход партии',field('Партия',picker),chart);
}
function summaryBlocks(d,s){
 return sides.flatMap(side=>{
  const a=s.sides[side],op=sideName(d,side);
  return [section(op+' · '+a.points+' очков',p('На подаче: '+a.onServe+' · на ошибках соперника: '+a.opponentErrors+' · макс. серия: '+a.maxRun+' · без детализации: '+a.unknown),
    table(['Игрок','Атака (вкл. скидки)','Скидки','Блок','Эйс','Ошибки','Защита: ошибки'],roster(d,side).map(r=>{const st=a.stats[r.id]||{};return [playerLabel(r),st.attackKills??'—',st.tipKills??'—',st.blocks??'—',st.aces??'—',st.errors??'—',st.defenseErrors??'—'];})),
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
  section('Детали очка',table(['Сет','Счёт','Команда','Причина','Автор','Зона','Доп. ошибка'],s.timeline.filter(x=>x.type==='rally').map(x=>[x.set,x.score,sideName(d,x.side),V.reasons[x.kind],name(d,x.actor,x.player),x.placement??'—',x.secondary?V.reasons[x.secondary.kind]+' · '+name(d,x.side==='ours'?'theirs':'ours',x.secondary.player):'—']))),
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
