import {courtTimeLabel} from '../court-time.js';
import {defaultRegulation,regulationOf,validMatchFormat,saveMatchRegulation} from '../match-rules.js';
import {listWork,deleteWork} from '../workbench.js';
import {captureModes,touchActions,touchQuality,touchResults,captureSummary,captureZoneSummary} from '../match-capture.js';
import {animateOnce,scoreChanges,recentRallies,rallyStreak,capturePositions,animatePositions} from '../motion.js';
import * as C from '../coach.js';
import {rehearsalStore,rememberLive,clearLiveResume} from '../volleyball.js';
import * as V from '../match-protocol.js';
import {matchTactics,rotationPerformance,recordedConnections,substitutionWindows,setterAnalysis,orderedLineups,rallyStreaks} from '../match-tactics.js';
import * as Portal from '../public-publisher.js';
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
function teamEmblem(d,side){const src=d.boardLogos?.[side];return src?el('img',{class:'vp-team-emblem',src,alt:'Эмблема '+sideName(d,side)}):null;}
function colorFields(initial=V.defaultBoardColors,initialLogos={ours:null,theirs:null}){
 const rows=Object.entries(V.boardPalette).map(([id,c])=>[id,c.label]);
 const ours=select(rows,initial.ours),theirs=select(rows,initial.theirs);
 const logos={...initialLogos},preview=el('div',{class:'vp-color-preview'}),logoRows=[];
 function draw(){preview.replaceChildren(...[ours,theirs].map((n,i)=>{const c=V.boardPalette[n.value];return el('span',{style:'background:'+c.end},[logos[sides[i]]?el('img',{class:'vp-team-emblem',src:logos[sides[i]],alt:'Эмблема'}):null,el('span',{text:i?'Соперник':'Наши'})]);}));}
 for(const side of sides){
  const file=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp'});let revision=0;
  file.onchange=async()=>{const current=++revision;try{const data=await V.prepareLogo(file.files[0]);if(current===revision){logos[side]=data;draw();}}catch(e){if(current===revision)toast(e.message);}finally{file.value='';}};
  logoRows.push(field(side==='ours'?'Эмблема нашей команды':'Эмблема соперника',file),btn('Убрать эмблему '+(side==='ours'?'нашей команды':'соперника'),()=>{revision++;logos[side]=null;draw();},'wide'));
 }
 ours.addEventListener('change',draw);theirs.addEventListener('change',draw);draw();
 return {node:el('div',{class:'vp-stack'},[preview,field('Цвет нашей команды',ours),field('Цвет соперника',theirs),...logoRows]),get:()=>({ours:ours.value,theirs:theirs.value}),getLogos:()=>({...logos})};
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
export function openDetailedSetup(team,players,back,refresh,preset=null,{matches=[],presets=[],fixture=null}={}){
 const date=input(todayIso(),'date',{max:todayIso()}),opp=input(fixture?.opponent||'','text',{placeholder:'Название соперника'}),comp=input('','text',{placeholder:'Турнир'}),venue=input('','text',{placeholder:'Спортивный зал'});
 const best=select([[1,'Одна партия'],[3,'До двух побед'],[5,'До трёх побед']],5),target=input('25','number',{min:1,max:99,step:1}),decider=input('15','number',{min:1,max:99,step:1});
 const serve=select([['ours',team.name],['theirs','Соперник']],'ours'),scheme=select([['5-1','5–1'],['4-2','4–2'],['free','Свободная']],preset?.scheme||'5-1');
 const substitutions=select([['simple','Упрощённые'],['paired','Парные (возврат стартового игрока)']],'simple');
 const subLimit=el('input',{type:'number',min:0,max:20,step:1,value:6}),timeoutLimit=el('input',{type:'number',min:0,max:5,step:1,value:2});
 const colors=colorFields(V.defaultBoardColors,fixture?.logos||{ours:null,theirs:null});
 const ruleName=input(defaultRegulation.name,'text',{maxlength:100}),winBy=select([[2,'2 очка'],[1,'1 очко']],2),cap=input('','number',{min:1,max:999,step:1,placeholder:'Без потолка'}),interval=select([['manual','Решение тренера / судьи'],['oneRally','Один завершённый розыгрыш между записанными сменами']],'manual'),ends=select([['manual','Без напоминаний'],['betweenSets','После партии'],['betweenSetsDecider','После партии и в решающей']],'manual'),switchAt=input('8','number',{min:1,max:98,step:1}),rulePick=select([['','Выберите сохранённый регламент']],'');
 const currentRules=()=>({bestOf:Number(best.value),target:Number(target.value),decider:Number(decider.value),substitutionMode:substitutions.value,limits:{substitutions:Number(subLimit.value),timeouts:Number(timeoutLimit.value)},regulation:{name:ruleName.value.trim(),winBy:Number(winBy.value),pointCap:cap.value.trim()===''?null:Number(cap.value),liberoInterval:interval.value,ends:ends.value,deciderSwitchAt:Number(switchAt.value)}});
 const applyRules=r=>{best.value=String(r.bestOf);target.value=String(r.target);decider.value=String(r.decider);substitutions.value=r.substitutionMode;subLimit.value=String(r.limits.substitutions);timeoutLimit.value=String(r.limits.timeouts);ruleName.value=r.regulation.name;winBy.value=String(r.regulation.winBy);cap.value=r.regulation.pointCap??'';interval.value=r.regulation.liberoInterval;ends.value=r.regulation.ends;switchAt.value=String(r.regulation.deciderSwitchAt);};
 let rules=[];const refreshRules=async()=>{rules=(await listWork('matchRegulation')).sort((a,b)=>a.regulation.name.localeCompare(b.regulation.name,'ru'));rulePick.replaceChildren(el('option',{value:'',text:'Выберите сохранённый регламент'}),...rules.map(r=>el('option',{value:r.id,text:r.regulation.name})));};
 void refreshRules().catch(e=>toast(e.message));const ruleFields=el('details',{class:'vp-match-more'},[el('summary',{text:'Пользовательский регламент'}),p('Настройки применяются только к этому матчу и сохраняются в его истории. Это не официальный регламент федерации.'),field('Шаблон',rulePick),btn('Применить регламент',()=>{const r=rules.find(x=>x.id===rulePick.value);if(r)applyRules(r);},'wide'),field('Название регламента',ruleName),field('Разница для победы',winBy),field('Потолок очков (пусто — без потолка)',cap),field('Интервал смены либеро',interval),field('Напоминания смены сторон',ends),field('Очко смены сторон в решающей партии',switchAt),btn('Сохранить как новый регламент',async()=>{try{const r=await saveMatchRegulation(currentRules());await refreshRules();rulePick.value=r.id;toast('Регламент сохранён');}catch(e){toast(e.message);}},'wide'),btn('Удалить выбранный регламент',async()=>{const r=rules.find(x=>x.id===rulePick.value);if(!r)return;if(!await ui.confirmDialog({title:'Удалить шаблон?',text:'Уже начатые матчи сохранят свой регламент.',ok:'Удалить',danger:true}))return;try{await deleteWork(r.id,r.kind);await refreshRules();}catch(e){toast(e.message);}},'wide')]);
 const previousMatches=matches.filter(m=>m.teamId===team.id&&m.detail?.mode==='dual').sort((a,b)=>b.date.localeCompare(a.date)||b.detail.startedAt.localeCompare(a.detail.startedAt));
 const previous=previousMatches[0]?.detail;
 const templates=presets.filter(x=>x.teamId===team.id);
 const history=V.opponentHistory(matches,team.id);
 const awayInput=el('textarea',{placeholder:'7 Иванова\n8 Петрова\n9\n10\n11\n12',rows:5});const awayArea=el('div',{class:'vp-stack'}),ownArea=el('div',{class:'vp-stack'});
 let awayPlayers=[],awayFields=six([]),parsedText='',ownFields,eligible=[],libero,libero2;
 const checked=new Set(players.map(p=>p.id));
 const template=select([['','Выберите шаблон'],...templates.map(x=>[x.id,x.name])],'');
 const loadOwn=(line,lib,second=null)=>{libero.value=eligible.some(p=>p.id===lib)?lib:'';libero2.value=eligible.some(p=>p.id===second)?second:'';ownFields.setExcluded([libero.value,libero2.value].filter(Boolean));ownFields.set(line);};
 const shortcuts=el('div',{class:'vp-stack'},[templates.length?field('Сохранённая шестёрка',template):null,templates.length?btn('Применить шаблон',()=>{const t=templates.find(x=>x.id===template.value);if(!t)return;scheme.value=t.scheme;loadOwn(t.lineup,t.libero);},'wide'):null,previous?btn('Старт последнего матча',()=>{scheme.value=previous.scheme;loadOwn(previous.lineup,previous.libero,previous.libero2);},'wide'):null]);
 const opponentPick=select([['','Выберите соперника'],...history.map(m=>[m.id,m.opponent+' · '+m.date])],'');
 const loadOpponent=()=>{const m=history.find(x=>x.id===opponentPick.value);if(!m)return;opp.value=m.opponent;awayInput.value=m.detail.awayPlayers.map(p=>p.number+' '+p.name).join('\n');parse();const numbers=new Map(m.detail.awayPlayers.map(p=>[p.id,p.number]));awayFields.set(m.detail.awayLineup.map(id=>awayPlayers.find(p=>p.number===numbers.get(id))?.id));};
 function refreshOwn(){
  const previous=ownFields?.get()||preset?.lineup||[],previousLib=libero?.value??preset?.libero??'',previousLib2=libero2?.value??'';
  const warnings=C.trainingWarnings({date:date.value,roster:players.map(p=>p.id),exercises:[{name:'Волейбол',activityId:'volley'},{name:'Прыжки',activityId:'jump'},{name:'Соревнование',activityId:'competition'}]},players);
  const restricted=new Set(warnings.map(x=>x.player.id));
  eligible=players.filter(p=>!p.archived&&!restricted.has(p.id)&&checked.has(p.id));
  libero=select([['','Без либеро'],...eligible.map(p=>[p.id,playerLabel(p)])],eligible.some(p=>p.id===previousLib)?previousLib:'');
  libero2=select([['','Без второго либеро'],...eligible.map(p=>[p.id,playerLabel(p)])],eligible.some(p=>p.id===previousLib2)?previousLib2:'');
  ownFields=six(eligible,previous,{excluded:[libero.value,libero2.value].filter(Boolean)});
  const updateLibero=()=>{if(libero2.value===libero.value)libero2.value='';ownFields.setExcluded([libero.value,libero2.value].filter(Boolean));};libero.onchange=libero2.onchange=updateLibero;
  const rows=players.map(p=>{
   const check=el('input',{type:'checkbox'});check.checked=checked.has(p.id)&&!restricted.has(p.id);check.disabled=restricted.has(p.id);
   check.onchange=()=>{if(check.checked)checked.add(p.id);else checked.delete(p.id);refreshOwn();};
   return field(playerLabel(p)+(restricted.has(p.id)?' · ограничение нагрузки':''),check);
  });
  ownArea.replaceChildren(p('Выберите фактический состав. Совпадения с внесёнными ограничениями исключены; отсутствие совпадений не является допуском.'),el('details',{},[el('summary',{text:'Заявка · '+eligible.length}),...rows]),shortcuts,ownFields.node,field('Либеро нашей команды (не входит в стартовую шестёрку)',libero),field('Второй либеро (необязательно)',libero2),p('Поддерживается один либеро на площадке. Это упрощённый регламент: интервалы между заменами либеро и исключительные судейские решения контролирует тренер.'));
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
   if(new Set(line).size!==6||line.some(id=>!eligible.some(p=>p.id===id))||line.includes(libero.value)||line.includes(libero2.value)||libero2.value&&(!libero.value||libero2.value===libero.value))throw Error('Проверьте шесть стартовых игроков и либеро');
   if(awayPlayers.length&&(new Set(away).size!==6||away.some(id=>!awayPlayers.some(p=>p.id===id))))throw Error('Проверьте расстановку соперника');
   if(!opp.value.trim())throw Error('Укажите соперника');
   if(!V.validBoardColors(colors.get()))throw Error('Выберите два разных цвета команд');
   const rules=currentRules();if(!validMatchFormat(rules)||!V.validMatchLimits(rules.limits))throw Error('Проверьте формат и пользовательский регламент');
   await C.probeLiveStorage();
   const readiness=Portal.portalInfo(team.id),existing=(await C.listLiveMatches()).filter(x=>x.teamId===team.id);
   const check='Локальная запись проверена. Заявка: '+eligible.length+' · старт: 6 · соперник: '+(awayPlayers.length||'без состава')+' · '+(navigator.onLine===false?'нет сети, счёт доступен офлайн':'сеть доступна по данным браузера')+'. '+(readiness.data.enabled?(readiness.conflict||readiness.data.publisherPaused?'Публичная отправка требует разрешения конфликта или возобновления.':readiness.connected?'Публичная страница подключена; отправка зависит от сети.':'Для публикации нужно войти в Firebase.'):'Публичная страница выключена.')+(existing.length?' Внимание: уже есть черновики ('+existing.length+').':'');
   if(!await ui.confirmDialog({title:'Начать матч?',text:check+' Подтвердите фактические составы и регламент.',ok:'Начать'}))return;
   const d=await C.startDetailedMatch({teamId:team.id,teamName:team.name,opponent:opp.value,date:date.value,competition:comp.value,venue:venue.value,
     roster:eligible.map(p=>p.id),ourPlayers:eligible,awayPlayers,awayLineup:away,lineup:line,libero:libero.value||null,libero2:libero2.value||null,...rules,firstServe:serve.value,scheme:scheme.value,boardColors:colors.get(),boardLogos:colors.getLogos()});
   openDetailedMatch(d,back,refresh);
  }catch(e){toast(e.message);}finally{save.disabled=false;}
 },'primary wide');
 openSheet(el('div',{class:'vp-stack vp-setup'},[el('h2',{text:'Новый подробный матч'}),field('Соперник',opp),field('Дата',date),field('Турнир',comp),field('Место',venue),field('Формат',best),field('Очков в партии',target),field('Решающая партия',decider),field('Первая подача',serve),field('Тактическая схема',scheme),field('Правила замен',substitutions),field('Лимит замен на команду за партию',subLimit),field('Лимит тайм-аутов на команду за партию',timeoutLimit),ruleFields,el('details',{class:'vp-match-more'},[el('summary',{text:'Цвета табло'}),colors.node]),p('Парные замены: один запасной на стартового игрока, один возврат за партию. Исключительные замены и полный судейский регламент не моделируются автоматически.'),
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
function shown(d,s){return {ours:s.lineup.map(id=>s.liberoFor===id?s.liberoId:id),theirs:s.awayLineup};}
// A local, read-only scoreboard in a separate same-device window. No network or player data.
export function renderSpectatorBoard(doc,snapshot,connected=true){
 const make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
 if(!doc.head.querySelector('#teachapp-score-style')){
  const style=make('style');style.id='teachapp-score-style';style.textContent='*{box-sizing:border-box}body{margin:0;background:#111827;color:white;font:600 clamp(14px,2vw,24px)/1.3 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:3vw}main{width:100%;max-width:1600px;text-align:center}header{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:2vw}.boards{display:grid;grid-template-columns:1fr 1fr;gap:2vw}.side{border-radius:24px;padding:3vw 2vw;min-width:0;display:grid;gap:1vw}.team{font-size:clamp(20px,4vw,60px);overflow-wrap:anywhere}.score{font-size:clamp(68px,15vw,230px);line-height:1;font-variant-numeric:tabular-nums}.sets{font-size:clamp(18px,3vw,40px)}footer{padding:2vw;color:#cbd5e1}.set-list{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:2vw}.set-list span{background:#253248;padding:8px 14px;border-radius:10px}button{font:inherit;color:white;background:#374151;border:0;border-radius:10px;padding:10px 14px}.obs-toolbar{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:12px}.obs-compact body{place-items:start center;background:#111827;padding:8px}.obs-compact main{max-width:1050px}.obs-compact header{margin-bottom:5px;font-size:14px}.obs-compact .boards{gap:6px}.obs-compact .side{padding:8px;border-radius:8px;grid-template-columns:1fr auto;align-items:center;gap:8px}.obs-compact .team{font-size:clamp(16px,3vw,32px)}.obs-compact .score{font-size:clamp(36px,7vw,84px)}.obs-compact .sets{font-size:16px}.obs-compact .emblem{display:none}.obs-compact footer,.obs-compact .set-list{display:none}';
  doc.head.append(style);doc.title='TeachApp · Табло';const meta=make('meta');meta.name='viewport';meta.content='width=device-width,initial-scale=1';doc.head.append(meta);
 }
 const status=snapshot.status==='finished'?'МАТЧ ЗАВЕРШЁН · итоговый счёт':connected?(snapshot.status==='break'?'ПЕРЕРЫВ':'● LIVE'):'НЕТ СВЯЗИ С ТРЕНЕРОМ · последний счёт';
 const main=make('main'),head=make('header');head.append(make('span','',status),make('span','','Партия '+snapshot.set));
 const full=make('button','','На весь экран');full.type='button';full.onclick=()=>{try{const p=doc.documentElement.requestFullscreen?.();p?.catch?.(()=>{});}catch{}};head.append(full);const compact=make('button','','Компактное табло');compact.type='button';compact.setAttribute('aria-pressed',String(doc.documentElement.classList.contains('obs-compact')));compact.onclick=()=>{const on=doc.documentElement.classList.toggle('obs-compact');compact.textContent=on?'Полное табло':'Компактное табло';compact.setAttribute('aria-pressed',String(on));};if(doc.documentElement.classList.contains('obs-compact'))compact.textContent='Полное табло';head.append(compact);main.append(head);
 const boards=make('div','boards');
 for(const side of sides){const n=make('div','side'),c=V.boardPalette[snapshot.colors[side]];n.style.background=c.end;if(snapshot.logos?.[side]){const img=make('img','emblem');img.src=snapshot.logos[side];img.alt='Эмблема';img.style.cssText='width:clamp(36px,7vw,100px);height:clamp(36px,7vw,100px);object-fit:contain;margin:auto';n.append(img);}n.append(make('div','team',side==='ours'?snapshot.teamName:snapshot.opponent),make('strong','score',snapshot.score[side]),make('span','sets','Партии: '+snapshot.setsWon[side]),make('span','',snapshot.status==='live'?(snapshot.serve===side?'● Подача':'Приём'):' '));boards.append(n);}
 main.append(boards);const sets=make('div','set-list');snapshot.sets.forEach((s,i)=>sets.append(make('span','',(i+1)+' · '+s.ours+' : '+s.theirs)));main.append(sets,make('footer','','TeachApp · Зрительское табло'));doc.body.replaceChildren(main);
}

export function openRehearsal(){
 try{
  const store=rehearsalStore(),draft=store.read();
  const body=el('div',{class:'vp-stack'},[el('h2',{text:'Тестовый LIVE-матч'}),p('ТЕСТ · Только на этом устройстве. Вымышленные команды: по 10 игроков, готовые шестёрки, запасные и два наших либеро. Реальные команды, история, синхронизация и публичная страница не изменяются.')]);
  let busy=false;
  const run=async fn=>{if(busy)return;busy=true;try{await fn();}catch(e){toast(e.message);}finally{busy=false;}};
  const enter=d=>openDetailedMatch(d,openRehearsal,()=>{},store);
  if(draft){
   const state=V.replayDetailed(draft);
   body.append(p((state.finished?'Тест завершён':'Тестовый черновик')+' · '+state.score.ours+':'+state.score.theirs+' · событий '+draft.events.length),
    btn('Продолжить / открыть тест',()=>enter(draft),'primary wide'),
    btn('Удалить тест и начать заново',()=>run(async()=>{if(!await ui.confirmDialog({title:'Удалить тест?',text:'Удалится только тренировочный матч.',ok:'Удалить',danger:true}))return;await store.discard(draft.id,draft.revision);openRehearsal();}),'wide'));
  }else{
   body.append(btn('Начать тест · до 25 очков',()=>run(async()=>enter(await store.start({short:false}))),'primary wide'),
    btn('Быстрый тест · до 5 очков',()=>run(async()=>enter(await store.start({short:true}))),'wide'));
  }
  body.append(btn('Закрыть',ui.closeSheet,'wide'));openSheet(body);
 }catch(e){toast(e.message);}
}
export function openDetailedMatch(initial,back,refresh,rehearsal=null){
 if(initial.teamId==='test-rehearsal'&&!rehearsal)throw Error('Откройте матч в тестовом режиме');
 let d=initial,busy=false,selected=null,pointDraft=null,section='match',nextDraft=null,quick=false,captureMode='standard',swapped=false,scoutOpen=false,scoutSide='theirs',scoutKind='all',scoutSet=0,scoutEntry=false,historySet=0,historyEdit=null,historyLimit=80,historyType='all',historyQuery='',benchOpen=false,detailOpen=false,observationOpen=false;
 const body=el('div',{class:'vp-stack vp-live'});
 const wake=matchWakeLock();let observer=null,spectator=null,clockState=null,marker=null,renderEpoch=0,lastQuickAt=-Infinity,blocked=false;
 const tickClock=()=>{if(!clockState||!body.isConnected)return;const t=V.courtTime(clockState,Date.now());for(const n of body.querySelectorAll('[data-court-time]')){const id=n.dataset.courtTime,side=n.dataset.courtSide||'ours',set=n.dataset.courtSet?t.sets[Number(n.dataset.courtSet)-1]:null;n.textContent=courtTimeLabel(set?(set.started?(id?set.players[side][id]||0:set.elapsedMs):null):id?(t.measured?t.players[side][id]||0:null):(t.measured?t.elapsedMs:null));}};
 const clockTicker=window.setInterval(tickClock,1000);
 const publish=(options={})=>{if(rehearsal)return false;try{return Portal.syncPortalMatch(d,options);}catch(e){toast('Публикация: '+e.message);return false;}};
 publish();const heartbeat=rehearsal?null:window.setInterval(()=>{if(!blocked&&!stopped)Portal.heartbeatPortal(d.teamId,d.id);},30000);
 const unwatch=rehearsal?()=>{}:Portal.watchPortal(d.teamId,()=>{for(const n of body.querySelectorAll('.vp-portal-live-status'))n.textContent=Portal.portalInfo(d.teamId).status;});
 let saving=false,saveFailure='',savedScreenFailure=false;
 const updateSaveStatus=()=>{
  const n=body.querySelector('[data-live-save-status]');if(n)n.textContent=saving?'Сохранение события…':saveFailure?(savedScreenFailure?'Ввод остановлен: ':blocked?'Запись не подтверждена; ввод остановлен: ':'Действие отклонено: ')+saveFailure:'Сохранено на устройстве · событий '+d.events.length+' · рев. '+d.revision;
  const recovery=body.querySelector('[data-live-recovery]');if(recovery)recovery.hidden=!saveFailure;
  if(blocked)for(const b of body.querySelectorAll('.vp-points button,.vp-timeout-button,.vp-author-grid button'))b.disabled=true;
  const net=body.querySelector('[data-live-network]');if(net)net.textContent=navigator.onLine===false?'Нет сети по данным браузера · локальная запись доступна':'Сеть доступна по данным браузера';
 };
 const refreshNetwork=()=>updateSaveStatus();
 const online=()=>{refreshNetwork();if(!rehearsal&&!stopped&&!blocked)Portal.heartbeatPortal(d.teamId,d.id);};
 window.addEventListener('online',online);window.addEventListener('offline',refreshNetwork);
 const liberoChange=async event=>{if(busy||blocked||stopped)return;const revision=d.revision,s=V.replayDetailed(d);if(V.liberoIntervalPending(d,s)){const reason=await ui.promptDialog({title:'Судейское исключение?',text:'Между записанными сменами либеро ещё не было розыгрыша. Только по фактическому решению судьи укажите причину (до 200 символов).',ok:'Записать исключение'});if(!reason)return;event={...event,exception:reason.trim()};}if(busy||blocked||stopped||d.revision!==revision)return;await perform(event,()=>{selected=null;benchOpen=false;});};
 const spectatorUpdate=(s,connected=true)=>{try{if(spectator&&!spectator.closed)renderSpectatorBoard(spectator.document,V.spectatorSnapshot(d,s),connected);else spectator=null;}catch{spectator=null;}};
 const spectatorOpen=()=>{try{if(!spectator||spectator.closed)spectator=window.open('','teachapp-score-'+d.id,'popup,width=1000,height=600');if(!spectator)return toast('Разрешите открытие отдельного окна');spectatorUpdate(V.replayDetailed(d));spectator?.focus?.();}catch{toast('Отдельное окно недоступно');}};
 let stopped=false;
 const stop=(preserve=false)=>{if(stopped)return;stopped=true;if(!preserve)clearLiveResume(marker);window.clearInterval(heartbeat);window.clearInterval(clockTicker);unwatch();if(spectator&&!spectator.closed)spectatorUpdate(V.replayDetailed(d),false);spectator=null;wake.stop();observer?.disconnect();window.removeEventListener('pagehide',pagehide);window.removeEventListener('online',online);window.removeEventListener('offline',refreshNetwork);};
 const pagehide=()=>stop(true);window.addEventListener('pagehide',pagehide);
 const readCurrent=async()=>rehearsal?rehearsal.read():C.readLiveMatch(d.id);
 const recover=async()=>{if(busy||stopped)return;busy=true;try{const current=await readCurrent();if(!current||current.id!==d.id){stop();await back();toast('Черновик отсутствует: возможно, матч уже завершён на другом экране.');return;}V.replayDetailed(current);d=current;blocked=false;saveFailure='';savedScreenFailure=false;pointDraft=null;selected=null;nextDraft=null;historyEdit=null;benchOpen=false;section='match';publish();draw();toast('Восстановлена сохранённая ревизия '+d.revision);}catch(e){blocked=true;saveFailure=e.message||'Не удалось прочитать черновик';updateSaveStatus();toast(saveFailure);}finally{busy=false;}};
 const perform=async(event,after)=>{
  if(busy||stopped||blocked)return;busy=true;saving=true;saveFailure='';savedScreenFailure=false;updateSaveStatus();
  const buttons=[...body.querySelectorAll('button')].filter(x=>!x.disabled);buttons.forEach(x=>x.disabled=true);
  try{
   let next;try{next=await (rehearsal?rehearsal.change(d.id,d.revision,event):C.changeLiveMatch(d.id,d.revision,event));}
   catch(e){saveFailure=e.message||'Неизвестная ошибка';try{const current=await readCurrent();blocked=!current||current.id!==d.id||current.revision!==d.revision;}catch{blocked=true;}if(blocked){pointDraft=null;selected=null;scoutOpen=false;benchOpen=false;historyEdit=null;draw();}toast(saveFailure);return;}
   d=next;saving=false;if(stopped)return;
   try{if(event?.type!=='clock')publish();after?.();draw();}catch(e){blocked=true;savedScreenFailure=true;saveFailure='Событие сохранено (рев. '+d.revision+'), но экран не обновился: '+e.message;toast(saveFailure);}
  }finally{saving=false;busy=false;buttons.forEach(x=>x.disabled=false);updateSaveStatus();}
 };
 let previousBoard=null,previousOverlay='';
 function draw(){
  const drawEpoch=++renderEpoch,oldPositions=capturePositions(body),s=V.replayDetailed(d),last=s.timeline.at(-1),won=s.sets.filter(x=>x.ours>x.theirs).length;
  spectatorUpdate(s);clockState=s;
  const set=s.setEnded?s.sets.length:s.sets.length+1;
  const displaySwapped=Boolean(s.endsSwapped)!==swapped,snapshot={id:d.id,set,score:{...s.score},ended:s.setEnded,finished:s.finished,order:displaySwapped,section};
  const changes=scoreChanges(previousBoard,snapshot),newSetEnd=previousBoard&&(!previousBoard.ended&&s.setEnded||!previousBoard.finished&&s.finished),rotation=previousBoard&&previousBoard.set===set&&previousBoard.order===displaySwapped&&previousBoard.section==='match'&&section==='match'&&Object.keys(changes).length>0;
  previousBoard=snapshot;
  const pre=pointDraft?.editing&&last?.before;
  const begin=(side,editing=false)=>{if(busy||stopped||blocked||drawEpoch!==renderEpoch)return;pointDraft={side,editing,kind:null};selected=null;draw();if(body.closest('.sheet'))body.closest('.sheet').scrollTop=0;};
  const cancel=()=>{pointDraft=null;selected=null;scoutOpen=false;benchOpen=false;draw();};
  const courtState=pre?last.before.lineups:shown(d,s),serve=pre?last.before.serve:s.serve;
  const active=section==='match'&&!s.setEnded&&!s.finished;
  const palette=d.boardColors||V.defaultBoardColors;
  for(const side of sides){const c=V.boardPalette[palette[side]];body.style.setProperty('--vp-'+side+'-start',c.start);body.style.setProperty('--vp-'+side+'-end',c.end);}
  body.classList.toggle('vp-live-board',active);
  const order=displaySwapped?[...sides].reverse():sides;
  const choose=(side,id)=>{if(!busy&&!blocked&&!stopped&&drawEpoch===renderEpoch){benchOpen=false;selected={side,id};draw();}};
  const displayScore=el('div',{class:'vp-scoreboard'+(active?' vp-board-score':'')},order.map((side,index)=>{
   const ids=shown(d,s)[side],serving=s.serve===side,server=ids[0];
   const player=roster(d,side).find(p=>p.id===server);
   const zones=index===0?[5,4,6,3,1,2]:[2,1,3,6,4,5];
   const mini=active?el('div',{class:'vp-court vp-mini-court','aria-label':'Расстановка '+sideName(d,side)},zones.map(z=>{
    const id=ids[z-1],pl=roster(d,side).find(p=>p.id===id);
    return el('button',{type:'button',class:'vp-mini-player'+(z===1&&serving?' serving':'')+(side==='ours'&&V.liberoIds(d).includes(id)?' libero':''),'data-motion-player':pl?side+':'+pl.id:null,disabled:!pl||!!pointDraft,onclick:()=>choose(side,id),'aria-label':sideName(d,side)+', зона '+z+', '+(pl?playerLabel(pl):'нет игрока')},[
     el('span',{class:'vp-mini-number',text:pl?.number??(pl?'•':'—')}),el('small',{text:'P'+z})]);
   })):null;
   return el('div',{class:'vp-score-side '+side+(serving?' score-serving':'')},[
    teamEmblem(d,side),el('span',{text:sideName(d,side)}),el('strong',{class:'vp-score-number','data-score-side':side,text:String(s.score[side])}),
    el('small',{text:'Партии '+(side==='ours'?won:s.sets.length-won)}),mini,
    active?el('div',{class:'vp-board-indicators'},[
     el('div',{class:'vp-pips','aria-label':'Замены '+s.subCounts[side]+' из '+V.matchLimits(d).substitutions},[el('span',{text:'Замены'}),...Array.from({length:V.matchLimits(d).substitutions},(_,i)=>el('i',{class:i<s.subCounts[side]?'used':''}))]),
     el('button',{type:'button',class:'vp-timeout-button',disabled:s.timeouts[side]>=V.matchLimits(d).timeouts||!!pointDraft,onclick:()=>perform({type:'timeout',side},()=>{selected=null;}),'aria-label':'Тайм-аут '+sideName(d,side)},[el('span',{text:'Тайм-аут'}),...Array.from({length:V.matchLimits(d).timeouts},(_,i)=>el('i',{class:i<s.timeouts[side]?'used':''}))]),
     el('small',{class:'vp-board-serving',text:serving?'● Подаёт '+(player?.number!=null?'№'+player.number:player?.name||'команда'):'Приём'})]):null]);
  }));
  body.replaceChildren(el('div',{class:'vp-match-head'},[el('div',{class:'vp-match-title'},[el('span',{class:'match-live-label',text:(rehearsal?'ТЕСТ · ':'')+(s.finished?'ЗАВЕРШЁН':s.setEnded?'ПЕРЕРЫВ':'● LIVE')}),el('strong',{text:'Партия '+set})]),displayScore,el('div',{class:'match-sets'},s.sets.length?s.sets.map((x,i)=>el('span',{class:'match-set',text:(i+1)+' · '+score(x)})):[el('span',{text:'Первая партия'})])]),
   el('div',{class:'vp-tabs',role:'group','aria-label':'Раздел матча'},[['match','Матч'],['stats','Статистика'],['events','События']].map(([id,t])=>btn(t,()=>{if(busy||pointDraft)return;section=id;historyEdit=null;benchOpen=false;selected=null;draw();},section===id?'primary':''))));
  const liveStatus=el('div',{class:'vp-stack','aria-label':'Состояние записи матча'},[
   el('small',{'data-live-save-status':'',role:'status'}),el('small',{'data-live-network':''}),
   !rehearsal&&Portal.portalInfo(d.teamId).data.enabled?el('small',{class:'vp-portal-live-status',role:'status',text:Portal.portalInfo(d.teamId).status}):null,
   el('button',{type:'button',class:'btn wide','data-live-recovery':'',hidden:true,text:'Восстановить сохранённый черновик',onclick:async()=>{if(busy)return;if(pointDraft&&!await ui.confirmDialog({title:'Восстановить черновик?',text:'Незаписанное уточнение очка будет закрыто. Сохранённые события останутся.',ok:'Восстановить'}))return;await recover();}})
  ]);body.insertBefore(liveStatus,body.children[1]);updateSaveStatus();
  for(const [side,kind] of Object.entries(changes)){const n=displayScore.querySelector('[data-score-side="'+side+'"]');if(n){animateOnce(n,kind,{duration:280});if(kind==='score')animateOnce(n.parentElement,'pulse',{duration:210});}}
  if(rotation&&!pointDraft&&!scoutOpen)animatePositions(displayScore,oldPositions);
  if(newSetEnd)animateOnce(body.querySelector('.vp-match-title'),'enter',{duration:360});
  if(section==='match'&&!s.finished&&!pointDraft&&!scoutOpen){const change=btn('Зафиксировать смену сторон',()=>perform({type:'changeEnds'},()=>{selected=null;swapped=false;}),'wide');body.append(el('div',{class:'card-block vp-stack'},[p(s.changeDue?'По выбранному регламенту пора проверить смену сторон. Подтвердите только фактическую смену.':'Фактическая смена сторон записывается в историю. Переворот табло не меняет счёт.'),change]));}
  if(!pointDraft&&!scoutOpen)previousOverlay='';
  if(section==='match'&&!pointDraft&&!scoutOpen){const t=V.courtTime(s,Date.now());body.append(el('section',{class:'card-block vp-stack court-time-panel','aria-label':'Игровое время'},[el('div',{class:'court-time-head'},[el('div',{},[el('small',{text:s.setEnded?'Измерено за матч':t.running?'Идёт учёт · время матча':'Учёт игрового времени'}),el('strong',{'data-court-time':'',text:courtTimeLabel(t.measured?t.elapsedMs:null)}),el('span',{class:'court-time-set'},['Партия '+set+': ',el('span',{'data-court-time':'','data-court-set':set,text:courtTimeLabel(t.sets[set-1]?.started?t.sets[set-1].elapsedMs:null)})])]),!s.setEnded&&!s.finished?btn(t.running?'Пауза времени':t.measured?'Возобновить время':'Запустить время',()=>perform({type:'clock',running:!t.running}),'primary'):null]),p(s.setEnded?'Время остановлено до запуска следующей партии.':t.running?'Тайм-аут и смена сторон остановят учёт. Время продолжается при блокировке экрана.':'Запустите по свистку. После тайм-аута, смены сторон и начала следующей партии возобновите вручную.'),t.untrackedRallies?p((t.measured?'Частичный замер: ':'Учёт ещё не запускался: ')+'розыгрышей вне измерения '+t.untrackedRallies+'.'):null]));}
  if(active&&!pointDraft&&!scoutOpen){const rows=recentRallies(s.timeline,set),streak=rallyStreak(recentRallies(s.timeline,set,s.timeline.length));if(rows.length){const meter=el('div',{class:'vp-rally-meter'},[el('div',{class:'vp-rally-meter-head'},[el('small',{text:'Последние '+rows.length+' розыгрышей'}),el('strong',{text:streak.count>=2?'Серия '+sideName(d,streak.side)+' · '+streak.count:'Последнее очко · '+sideName(d,streak.side)})]),el('div',{class:'vp-rally-strip','aria-label':rows.map(x=>x.score+' '+sideName(d,x.side)).join(', ')},rows.map(x=>el('span',{class:x.side,title:x.score}))) ]);body.insertBefore(meter,body.children[1]);if(Object.keys(changes).length)animateOnce(meter.querySelector('.vp-rally-strip span:last-child'),'enter',{duration:180});}}
  if(active&&!pointDraft&&!scoutOpen&&section==='match'){
   const current=rotationPerformance(s.timeline,{set,min:5}).ours.rows[s.rotations.ours],phase=s.serve==='ours'?'serve':'receive';
   if(current[phase])body.append(el('details',{class:'vp-match-more'},[el('summary',{text:'Текущий цикл P'+current.position+' · '+(phase==='serve'?'подача':'приём')+' '+current[phase+'Won']+'/'+current[phase]}),p(current[phase+'Eligible']?'Зафиксированная доля выигранных розыгрышей: '+Math.round(current[phase+'Rate'])+'%.':'Малая выборка — пока менее 5 розыгрышей в этой фазе.'),p('Только текущая партия и цикл относительно стартового состава. Это не прогноз и не автоматическая рекомендация замены.')]));
  }
  if(section==='stats'){body.append(courtTimeBlock(d,s,true),momentumBlock(d,s),liveAnalysis(d,s),captureBlock(d,s));}
  else if(section==='events'){
   const rawRallies=d.events.flatMap((e,i)=>e.type==='rally'?[i]:[]);let ri=0;
   const entries=s.timeline.map(x=>({x,index:x.type==='rally'?rawRallies[ri++]:null}));
   const filter=select([[0,'Все партии'],...Array.from({length:set},(_,i)=>[i+1,'Партия '+(i+1)])],historySet);filter.onchange=()=>{historySet=Number(filter.value);historyEdit=null;historyLimit=80;draw();};
   const types=select([['all','Все действия'],['rally','Розыгрыши'],['sub','Замены'],['libero','Либеро'],['timeout','Тайм-ауты'],['other','Прочее']],historyType);types.onchange=()=>{historyType=types.value;historyEdit=null;historyLimit=80;draw();};
   const query=el('input',{type:'search',value:historyQuery,placeholder:'Счёт, игрок, причина','aria-label':'Поиск события'});
   body.append(p('Событий: '+d.events.length),field('Партия',filter),field('Тип события',types),query,btn('Найти события',()=>{historyQuery=query.value.trim();historyEdit=null;historyLimit=80;draw();},'wide'));query.onkeydown=e=>{if(e.key==='Enter'){historyQuery=query.value.trim();historyEdit=null;historyLimit=80;draw();}};
   if(historyEdit!==null){const e=entries.find(r=>r.index===historyEdit);if(e)body.append(historyRallyEditor(d,e.x,e.index,patch=>perform({type:'editRally',index:e.index,patch},()=>{historyEdit=null;}),()=>{historyEdit=null;draw();},side=>{if(drawEpoch!==renderEpoch)return;perform({type:'correctRally',index:e.index,side},()=>{historyEdit=null;});}));}
   else {const visible=entries.filter(r=>(!historySet||r.x.set===historySet)&&(historyType==='all'||historyType===r.x.type||historyType==='other'&&!['rally','sub','libero','timeout'].includes(r.x.type))&&(!historyQuery||(r.x.score+' '+eventText(d,r.x)).toLocaleLowerCase('ru').includes(historyQuery.toLocaleLowerCase('ru')))).reverse();if(!visible.length)body.append(p('Нет подходящих событий'));for(const {x,index} of visible.slice(0,historyLimit))body.append(el('div',{class:'vp-history-row','data-event-index':index},[p('Сет '+x.set+' · '+x.score+' · '+eventText(d,x)),index!==null?btn('Уточнить',()=>{historyEdit=index;draw();if(body.closest('.sheet'))body.closest('.sheet').scrollTop=0;}):null]));if(visible.length>historyLimit)body.append(btn('Показать ещё события · '+(visible.length-historyLimit),()=>{historyLimit+=80;draw();},'wide'));}
  }else{
   const controls=el('div',{class:'vp-board-controls'},[
    ...Object.entries(captureModes).map(([id,label])=>btn(label,()=>{captureMode=id;quick=id==='quick';if(quick)scoutEntry=false;selected=null;draw();},captureMode===id?'primary':'')),
    btn('↔ Сменить стороны',()=>{swapped=!swapped;selected=null;draw();})]);
   if(!pointDraft)body.append(controls);
   if(!active&&!pointDraft)body.append(court(d,courtState,serve,selected,choose));
   const showOverlay=area=>{
    for(const child of [...body.children]){child.inert=true;child.setAttribute('inert','');}
    const overlay=el('div',{class:'vp-rally-overlay',onkeydown:e=>{if(e.key==='Escape'&&!busy){e.stopPropagation();cancel();}}},[area]);
    body.append(overlay);
    const key=benchOpen?'bench':scoutOpen?'scout':pointDraft?'point:'+String(pointDraft.kind)+':'+String(!!pointDraft.extra):'player';if(previousOverlay!==key){animateOnce(area,'enter',{duration:180});previousOverlay=key;}
    area.setAttribute('tabindex','-1');area.setAttribute('role','dialog');area.setAttribute('aria-modal','true');area.focus({preventScroll:true});
   };
   if(scoutOpen){
    const area=scoutPanel(d,s,{side:scoutSide,kind:scoutKind,set:scoutSet,entry:scoutEntry},patch=>{if(Object.hasOwn(patch,'side'))scoutSide=patch.side;if(Object.hasOwn(patch,'kind'))scoutKind=patch.kind;if(Object.hasOwn(patch,'set'))scoutSet=patch.set;if(Object.hasOwn(patch,'entry')){scoutEntry=patch.entry;if(scoutEntry){quick=false;if(captureMode==='quick')captureMode='standard';}}draw();},cancel);
    showOverlay(area);return;
   }
   if(pointDraft){
    const {side:winner,editing,kind}=pointDraft;
    const submit=(k,player=null,extra={})=>{const assist=V.canAssist(k)&&player&&pointDraft.assist&&player!==pointDraft.assist?pointDraft.assist:null;return perform(editing?{type:'attribute',kind:k,player,assist}:{type:'rally',side:winner,kind:k,player,captureMode,...(assist?{assist}:{}),...extra},()=>{pointDraft=null;selected=null;});};
    const afterAuthor=(k,player=null)=>{if(player&&pointDraft.assist===player){toast('Автор атаки и передачи должны быть разными игроками');return;}if(!editing&&captureMode==='pro'){pointDraft={...pointDraft,author:player,touchEntry:true};draw();return;}if(!editing&&scoutEntry&&V.canPlace(k)){pointDraft={...pointDraft,author:player,extra:true,defender:null,zone:null};draw();}else submit(k,player);};
    const options=V.rallyReasonOptions(winner,serve).filter(k=>k!=='point');
    const area=el('section',{class:'vp-attribution match-attribution','aria-label':editing?'Уточнение очка':'Новое очко'},[
      el('div',{class:'vp-rally-heading'},[el('strong',{text:(editing?'Уточнить очко · ':'+1 · ')+sideName(d,winner)}),el('small',{text:pointDraft.extra?'Доп. данные · защита':kind?'2 · Игрок':'1 · Причина'})]),
      p(editing?'Счёт не изменится.': 'Очко ещё не начислено.')]);
    if(pointDraft.touchEntry){
      const draft={...pointDraft};area.append(touchEditor(d,{side:winner,before:{lineups:courtState,serve},touches:draft.touches||[],captureComplete:false},(items,complete)=>submit(kind,draft.author,{touches:items,captureComplete:complete})),btn('Сохранить только причину и автора',()=>submit(kind,draft.author),'wide'),btn('Назад к игрокам',()=>{pointDraft={side:winner,editing,kind};draw();},'wide'));
    }else if(pointDraft.extra){
      const losing=winner==='ours'?'theirs':'ours',secondary=V.secondaryKind(kind),defenders=roster(d,losing).filter(p=>courtState[losing].includes(p.id));
      const patch=x=>{pointDraft={...pointDraft,...x};draw();};
      area.append(p('Необязательно. Укажите только наблюдаемую ошибку и фактическую зону завершения.'));
      if(secondary&&defenders.length)area.append(el('strong',{text:'Кто допустил ошибку · '+sideName(d,losing)}),el('div',{class:'vp-actions vp-author-grid'},defenders.map(p=>el('button',{type:'button',class:'btn'+(pointDraft.defender===p.id?' primary':''),'data-defender':p.id,'aria-pressed':String(pointDraft.defender===p.id),onclick:()=>patch({defender:pointDraft.defender===p.id?null:p.id})},[el('strong',{text:p.number==null?'—':'№'+p.number}),el('span',{text:p.name})]))));
      area.append(el('strong',{text:'Зона завершения'}),el('div',{class:'vp-heat-net',text:'СЕТКА'}),el('div',{class:'vp-heat-grid'},[4,3,2,5,6,1].map(z=>el('button',{type:'button',class:'btn vp-heat-entry'+(pointDraft.zone===z?' primary':''),'data-scout-zone':z,'aria-pressed':String(pointDraft.zone===z),text:'P'+z,onclick:()=>patch({zone:pointDraft.zone===z?null:z})}))),
       btn('Начислить очко',()=>submit(kind,pointDraft.author,{...(pointDraft.zone?{placement:pointDraft.zone}:{}),...(secondary&&pointDraft.defender?{secondary:{kind:secondary,player:pointDraft.defender}}:{})}),'primary wide'),btn('Пропустить уточнение',()=>submit(kind,pointDraft.author),'wide'),btn('Назад к игрокам',()=>{pointDraft={side:winner,editing,kind};draw();},'wide'));
    }else if(!kind){
      for(const [title,group] of [['Результативное действие',options.filter(k=>!V.isError(k))],['Ошибка соперника',options.filter(V.isError)]]){
        if(group.length)area.append(el('strong',{class:'vp-rally-label',text:title}),el('div',{class:'vp-actions vp-reason-grid'},group.map(k=>el('button',{type:'button',class:'btn','data-reason':k,text:V.reasons[k],onclick:()=>{pointDraft={...pointDraft,kind:k,assist:editing&&last?.kind===k?last.assist||null:null};draw();}}))));
      }
      area.append(btn('Без детализации',()=>submit('point'),'wide'));
    }else{
      const actor=V.rallyActor(winner,kind),players=V.rallyCandidates(d,courtState,serve,winner,kind);
      if(V.canAssist(kind)){
       const choices=roster(d,winner).filter(p=>courtState[winner].includes(p.id));
       const assist=select([['','Без отметки'],...choices.map(p=>[p.id,playerLabel(p)])],pointDraft.assist||'');
       assist.setAttribute('aria-label','Автор результативной передачи');assist.onchange=()=>{pointDraft.assist=assist.value||null;};
       area.append(field('Ассист · автор передачи (необязательно)',assist),p('Если известна передача, выберите её автора перед атакующей. Счёт команды увеличится только на 1.'));
      }
      area.append(el('strong',{text:V.reasons[kind]+' · '+sideName(d,actor)}),
        p(players.length?'Выберите игрока, находившегося на площадке до розыгрыша.':'Нет доступных игроков. Можно сохранить причину без автора.'),
        el('div',{class:'vp-actions vp-author-grid'},players.map(player=>el('button',{type:'button',class:'btn','data-player':player.id,onclick:()=>afterAuthor(kind,player.id)},[el('strong',{text:player.number==null?'—':'№'+player.number}),el('span',{text:player.name}),el('small',{text:'P'+player.zone})]))),
        btn('Сохранить без автора',()=>afterAuthor(kind),'wide'),btn('Назад к причинам',()=>{pointDraft={...pointDraft,kind:null};draw();},'wide'));
    }
    area.append(btn('Отмена',cancel,'wide'));showOverlay(area);
   }else if(s.finished){
    body.append(p('Матч завершён'),btn(rehearsal?'Открыть тестовый протокол':'Сохранить матч и открыть протокол',async()=>{
     if(busy||blocked||stopped||!await ui.confirmDialog({title:'Завершить матч?',text:rehearsal?'Тестовый протокол не попадёт в историю реальных матчей.':'События, счёт и статистика сохранятся в истории.',ok:'Сохранить'}))return;
     if(busy||blocked||stopped)return;busy=true;try{const m=await (rehearsal?rehearsal.finish(d.id,d.revision):C.finishLiveMatch(d.id,d.revision));publish({finish:true});stop();await refresh();openMatchReport(m,back,!!rehearsal);}catch(e){toast(e.message);}finally{busy=false;}
    },'primary wide'));
   }else if(s.setEnded){
    body.append(btn('◎ Тактическая разведка',()=>{scoutOpen=true;draw();if(body.closest('.sheet'))body.closest('.sheet').scrollTop=0;},'wide vp-scout-open'));
    if(!nextDraft||nextDraft.revision!==d.revision){
     const prev=s.setDetails.at(-1).lineups;
     nextDraft={revision:d.revision,
      own:six(d.ourPlayers.filter(p=>!V.liberoIds(d).includes(p.id)),prev.ours,{previous:prev.ours,final:s.lineup}),
      away:six(d.awayPlayers,prev.theirs,{previous:prev.theirs,final:s.awayLineup,side:'theirs'}),
      first:select(sides.map(side=>[side,sideName(d,side)]),s.sets.length%2?d.firstServe==='ours'?'theirs':'ours':d.firstServe)};
    }
    const {own,away,first}=nextDraft;
    body.append(el('h3',{text:'Старт следующей партии'}),p('Старт предыдущей партии скопирован. Измените нужные зоны или очистите расстановку.'),p(d.teamName),own.node,...(d.awayPlayers.length?[p(d.opponent),away.node]:[]),field('Первая подача',first),btn('Начать партию',()=>perform({type:'next',lineup:own.get(),awayLineup:d.awayPlayers.length?away.get():[],serve:first.value},()=>{selected=null;nextDraft=null;}),'primary wide'));
   }else{
    const add=side=>{if(busy||stopped||blocked||drawEpoch!==renderEpoch)return;detailOpen=false;observationOpen=false;if(!quick)return begin(side);const now=performance.now();if(now-lastQuickAt<350)return;lastQuickAt=now;return perform({type:'rally',side,kind:'point',player:null,captureMode:'quick'},()=>{selected=null;});};
    const pointButton=side=>el('button',{type:'button',class:'btn '+(side==='ours'?'vp-ours':'vp-theirs'),onclick:()=>add(side),'aria-label':'Очко '+sideName(d,side)},[el('strong',{text:'+1'}),el('span',{text:sideName(d,side)})]);
    const undo=el('button',{type:'button',class:'btn vp-undo',text:'↶','aria-label':'Отменить последнее событие',disabled:!d.events.length,onclick:()=>perform(null,()=>{selected=null;pointDraft=null;})});
    const points=el('div',{class:'vp-actions vp-points vp-board-points'},[pointButton(order[0]),undo,pointButton(order[1])]);
    const sanctions=el('details',{class:'vp-match-more'},[el('summary',{text:'Судейские санкции'})]);const sanctionSide=select(sides.map(x=>[x,sideName(d,x)]),'ours'),sanctionPlayer=select([],''),sanctionType=select(Object.entries(V.sanctionTypes),'warning'),sanctionNote=el('input',{maxlength:500,placeholder:'Причина / решение судьи'});const fillSanctions=()=>sanctionPlayer.replaceChildren(el('option',{value:'',text:'Команда / без указания игрока'}),...roster(d,sanctionSide.value).map(p=>el('option',{value:p.id,text:playerLabel(p)})));sanctionSide.onchange=fillSanctions;fillSanctions();sanctions.append(field('Команда',sanctionSide),field('Игрок',sanctionPlayer),field('Санкция',sanctionType),field('Примечание',sanctionNote),p('Запись не начисляет очко, не меняет расстановку и не определяет последствия санкции. Внесите фактическое изменение счёта или состава отдельно согласно решению судьи.'),btn('Записать санкцию',()=>perform({type:'sanction',side:sanctionSide.value,category:sanctionType.value,player:sanctionPlayer.value||null,note:sanctionNote.value.trim()},()=>selected=null),'wide'));
    body.append(points,sanctions,el('button',{type:'button',class:'btn wide vp-scout-open',onclick:()=>{if(busy)return;selected=null;scoutOpen=true;draw();if(body.closest('.sheet'))body.closest('.sheet').scrollTop=0;},text:'◎ Тактическая разведка'}));
    if(last)body.append(el('div',{class:'vp-last-event',role:'status',text:'Последнее: '+eventText(d,last)}));
    const libre=V.legalLiberoActions(d,s);
    body.append(btn('Замены / либеро · '+s.subCounts.ours+'/'+V.matchLimits(d).substitutions,()=>{if(busy||blocked)return;benchOpen=true;selected=null;draw();if(body.closest('.sheet'))body.closest('.sheet').scrollTop=0;},'wide vp-bench-open'));
    if(benchOpen){
     const area=el('section',{class:'vp-attribution vp-player-overlay','aria-label':'Замены и либеро'},[el('h3',{text:'Замены и либеро'}),p('Выберите уходящего игрока, затем допустимого запасного. Счёт не меняется.')]);
     for(const side of sides){const line=side==='ours'?s.lineup:s.awayLineup;const choices=line.map((id,i)=>({id,zone:i+1,n:V.legalSubstitutions(d,s,side,id).length})).filter(x=>x.n);area.append(el('strong',{text:sideName(d,side)+' · '+s.subCounts[side]+'/'+V.matchLimits(d).substitutions}),choices.length?el('div',{class:'vp-actions vp-author-grid'},choices.map(x=>el('button',{type:'button',class:'btn','data-sub-out':x.id,onclick:()=>choose(side,x.id)},[el('strong',{text:name(d,side,x.id)}),el('small',{text:'P'+x.zone+' · '+x.n+' вариант(а)'})]))):p('Допустимых обычных замен нет.'));}
     if(V.liberoIds(d).length){area.append(el('strong',{text:s.liberoId?'На площадке: '+name(d,'ours',s.liberoId)+' вместо '+name(d,'ours',s.liberoFor):'Либеро вне площадки'}));if(V.liberoIntervalPending(d,s))area.append(p('До следующего розыгрыша требуется судейское исключение.'));for(const action of libre)area.append(liberoActionButton(d,s,action,liberoChange));}
     area.append(btn('Отмена',cancel,'wide'));showOverlay(area);return;
    }
    const momentum=V.setMomentum(s.timeline,set);
    if(momentum.run>=4&&momentum.runSide==='theirs')body.append(el('div',{class:'vp-run-note',role:'status',text:'Соперник выиграл '+momentum.run+' розыгрыша подряд. '+(s.timeouts.ours<V.matchLimits(d).timeouts?'Можно рассмотреть тайм-аут.':'Лимит тайм-аутов исчерпан.')}));
    if(selected){
     const side=selected.side;
     const candidates=V.legalSubstitutions(d,s,side,selected.id);
     const pair=d.substitutionMode==='paired'?s.substitutionState[side].pairs.find(p=>p.reserve===selected.id&&!p.returned):null;
     const playerStats=s.sides[side].stats[selected.id]||{};
     const area=el('section',{class:'vp-attribution vp-player-overlay','aria-label':'Действия игрока'},[
      el('h3',{text:name(d,side,selected.id)}),
      p('Очки: '+(playerStats.points||0)+' · Ассисты: '+(playerStats.assists??'—')+' · Баллы: '+((playerStats.points||0)+(playerStats.assists||0))+' · Ошибки: '+(playerStats.errors||0)),el('p',{},['На площадке: ',el('strong',{'data-court-time':selected.id,'data-court-side':side,text:courtTimeLabel(V.courtTime(s,Date.now()).measured?V.courtTime(s,Date.now()).players[side][selected.id]||0:null)})]),
      p('Атаки: '+(playerStats.attackKills||0)+' · Скидки: '+(playerStats.tipKills||0)+' · Блоки: '+(playerStats.blocks||0)+' · Эйсы: '+(playerStats.aces||0)),
      p('Обычные замены: '+s.subCounts[side]+'/'+V.matchLimits(d).substitutions),candidates.length?el('div',{class:'vp-actions vp-author-grid vp-sub-grid'},candidates.map(p=>el('button',{type:'button',class:'btn','data-sub-in':p.id,onclick:()=>{if(drawEpoch!==renderEpoch)return;perform({type:'sub',side,out:selected.id,in:p.id},()=>{selected=null;benchOpen=false;});}},[el('strong',{text:p.number==null?'—':'№'+p.number}),el('span',{text:p.name}),el('small',{text:pair?'Вернуть стартового':'Выпустить'})]))):p('Допустимых обычных замен нет.')]);
     if(side==='ours'&&V.liberoIds(d).length){
      const actions=libre.filter(a=>selected.id===s.liberoId||a.event.for===selected.id&&s.liberoFor===null);
      if(actions.length&&V.liberoIntervalPending(d,s))area.append(p('До следующего розыгрыша требуется судейское исключение.'));
      for(const action of actions)area.append(liberoActionButton(d,s,action,liberoChange));
     }
     area.append(btn('Отмена',()=>{selected=null;draw();},'wide'));showOverlay(area);return;
    }
   }
   if(!pointDraft&&d.events.at(-1)?.type==='rally'){
    const details=el('details',{class:'vp-match-more'},[el('summary',{text:'Детали последнего очка'}),btn('Уточнить последнее очко',()=>begin(last.side,true),'wide')]);body.append(details);details.open=detailOpen;details.ontoggle=()=>{detailOpen=details.open;};
    if(last?.type==='rally'){const editor=observationEditor(d,last,items=>perform({type:'observations',observations:items},()=>{detailOpen=true;observationOpen=true;}));editor.open=observationOpen;editor.ontoggle=()=>{observationOpen=editor.open;};details.append(editor);}
    if(last&&V.canAssist(last.kind)&&last.player){
     const assistant=select([['','Без отметки'],...roster(d,last.side).filter(p=>last.before.lineups[last.side].includes(p.id)&&p.id!==last.player).map(p=>[p.id,playerLabel(p)])],last.assist||'');
     details.append(field('Ассист · автор передачи',assistant),btn('Сохранить ассист',()=>perform({type:'editRally',index:d.events.length-1,patch:{assist:assistant.value||null}},()=>{detailOpen=true;}),'wide'));
    }
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
  const liveColors=colorFields(palette,d.boardLogos);
  const saveColors=btn('Сохранить оформление',async()=>{if(busy||blocked||stopped)return;busy=true;saveColors.disabled=true;try{d=await (rehearsal?rehearsal.colors(d.id,d.revision,liveColors.get(),liveColors.getLogos()):C.changeLiveColors(d.id,d.revision,liveColors.get(),liveColors.getLogos()));publish();draw();}catch(e){toast(e.message);}finally{busy=false;saveColors.disabled=false;}},'wide');
  const wakeBtn=btn(wake.enabled?'Экран: не выключать':'Экран: обычный режим',async()=>{if(busy)return;wakeBtn.disabled=true;const requested=!wake.enabled;const enabled=await wake.toggle();wakeBtn.textContent=enabled?'Экран: не выключать':'Экран: обычный режим';wakeBtn.setAttribute('aria-pressed',String(enabled));wakeBtn.disabled=false;if(requested&&!enabled)toast('Не удалось удерживать экран. Проверьте настройки браузера или энергосбережение.');},'wide');wakeBtn.setAttribute('aria-pressed',String(wake.enabled));
  const publicInfo=rehearsal?{data:{enabled:false}}:Portal.portalInfo(d.teamId),paused=publicInfo.data.publisherPaused||publicInfo.conflict,publicActive=!paused&&publicInfo.data.activeId===d.id;
  const serverCheck=el('div',{class:'vp-stack','aria-live':'polite'}),verify=btn('Сверить счёт с сайтом',async()=>{if(busy||stopped)return;verify.disabled=true;try{const info=await Portal.inspectPortal(d.teamId,d);serverCheck.replaceChildren(p(info.match?'Сайт: партия '+info.match.set+' · '+info.match.score.ours+':'+info.match.score.theirs+' · '+info.match.opponent:'На сайте нет матча'),p(info.matches===true?'Публичный счёт и доступные события совпадают.':info.matches===false?'Опубликованный счёт или доступные события отличаются.':'Сравнение активного матча недоступно.'),p('Обновлено: '+(info.updatedAt==null?'—':new Date(info.updatedAt).toLocaleTimeString('ru-RU'))+' · '+(info.pending?'есть ожидающая отправка':'нет ожидающих изменений')));}catch(e){serverCheck.replaceChildren(p(e.message));}finally{verify.disabled=false;}},'wide');
  const menu=el('details',{class:'vp-match-more'},[el('summary',{text:'Управление матчем · черновик сохранён'}),
   publicInfo.data.enabled?el('div',{class:'vb-stack'},[p(paused?'Отправка счёта остановлена или конфликтует':publicActive?'Трансляция этого матча включена':'Этот матч не опубликован'),el('p',{class:'vp-portal-live-status',role:'status',text:publicInfo.status}),publicInfo.connected?verify:null,serverCheck,publicInfo.connected&&!paused?btn('Повторить ожидающую отправку',()=>{if(busy||blocked||stopped)return;try{if(!Portal.retryPortal(d.teamId))toast('Нет ожидающей отправки или обмен уже выполняется');}catch(e){toast(e.message);}},'wide'):null,paused?btn('Принять управление LIVE',async()=>{if(busy||blocked||stopped)return;busy=true;try{const current=await readCurrent();if(!current||current.revision!==d.revision)throw Error('Черновик изменился. Восстановите матч.');const preview=await Portal.previewPortalHandoff(d.teamId,d);if(!await ui.confirmDialog({title:'Продолжить LIVE на этом устройстве?',text:preview.opponent+' · партия '+preview.set+' · '+preview.score.ours+':'+preview.score.theirs+'. Совпадает публичный счёт и доступные '+preview.events+' розыгрышей. Убедитесь, что предыдущее устройство остановило отправку, другие вкладки закрыты и у вас полный локальный черновик. Это не блокировка другого устройства.',ok:'Принять'}))return;const latest=await readCurrent();if(stopped||!latest||latest.revision!==d.revision)throw Error('Черновик изменился. Повторите передачу управления.');await Portal.continuePortalHandoff(d.teamId,d,preview.etag,{confirmed:true});draw();}catch(e){toast(e.message);}finally{busy=false;}},'primary wide'):btn(publicActive?'Остановить публичную трансляцию':'Начать публичную трансляцию',async()=>{if(busy)return;if(!await ui.confirmDialog({title:publicActive?'Остановить трансляцию?':'Начать публичную трансляцию?',text:publicActive?'Счёт останется в локальном журнале.':'Публичная страница покажет счёт и разрешённые события этого матча.',ok:publicActive?'Остановить':'Начать'}))return;try{if(publicActive)Portal.stopPortalMatch(d.teamId);else publish({start:true});draw();}catch(e){toast(e.message);}},'wide'),publicActive?btn('Передать управление · остановить отправку',async()=>{if(busy)return;if(!await ui.confirmDialog({title:'Приостановить отправку счёта?',text:'Последний счёт останется на сайте. На этом устройстве все публичные записи будут заблокированы до явного возобновления. Локальный матч сохранится. Закройте другие вкладки TeachApp на этом устройстве. На другом устройстве требуется тот же полный черновик.',ok:'Остановить отправку'}))return;try{Portal.pausePortalPublisher(d.teamId);draw();}catch(e){toast(e.message);}},'wide'):null]):p(rehearsal?'ТЕСТ: публичная отправка полностью отключена. Отдельное локальное табло доступно.':'Публичная страница выключена. Настройте её в центре матчей.'),
   wake.supported?wakeBtn:p('Удержание экрана недоступно в этом браузере.'),btn('Зрительское табло · отдельное окно',spectatorOpen,'wide'),p('Только счёт и команды. При выходе показывается последний счёт.'),liveColors.node,saveColors,
   p('Замены: '+(d.substitutionMode==='paired'?'парные':'упрощённые')+' · Событий: '+d.events.length),
   btn('Выйти · черновик сохранён',async()=>{if(busy)return;if(s.courtClock.running&&!await ui.confirmDialog({title:'Учёт времени продолжается',text:'Время продолжит начисляться текущему составу и после выхода. Чтобы остановить его, вернитесь и нажмите «Пауза времени».',ok:'Выйти'}))return;stop();back();},'wide'),
   btn('Удалить черновик',async()=>{if(busy||blocked||stopped||!await ui.confirmDialog({title:'Удалить черновик?',text:'Вся история этого матча будет удалена.',ok:'Удалить',danger:true}))return;if(busy||blocked||stopped)return;busy=true;try{await (rehearsal?rehearsal.discard(d.id,d.revision):C.discardLiveMatch(d.id,d.revision));publish({discard:true});stop();back();}catch(e){toast(e.message);}finally{busy=false;}},'wide')]);
  body.append(menu);
 }
 draw();const sheet=openSheet(body,{fullHeight:true,match:true,onClose:()=>stop()});marker=rememberLive(d,!!rehearsal);
 if(typeof MutationObserver==='function'){observer=new MutationObserver(()=>{if(!body.isConnected||!sheet.classList.contains('show'))stop();});observer.observe(sheet,{childList:true,attributes:true,attributeFilter:['class']});}
}
function liberoActionButton(d,s,action,change){
 const e=action.event,label=e.for===null?'Вернуть основного · '+name(d,'ours',s.liberoFor):s.liberoFor!==null?'Сменить либеро · '+name(d,'ours',e.player):'P'+action.zone+' · '+name(d,'ours',e.player)+' вместо '+name(d,'ours',e.for);
 return el('button',{type:'button',class:'btn wide','data-libero-action':e.for===null?'return':e.player,'data-libero-for':e.for||'',text:label+(action.exception?' · исключение':''),onclick:()=>change(e)});
}
function table(headers,rows){
 return el('div',{class:'vp-table'},[el('table',{},[el('thead',{},[el('tr',{},headers.map(t=>el('th',{text:String(t)})))]),el('tbody',{},rows.map(row=>el('tr',{},row.map(t=>el('td',{text:String(t??'—')})))))])]);
}
function section(title,...children){return el('section',{class:'vp-report-section'},[el('h3',{text:title}),...children]);}
function eventText(d,x){
 if(x.type==='clock')return x.running?'Запуск / возобновление времени':'Пауза игрового времени';
 if(x.type==='rally')return sideName(d,x.side)+' · '+V.reasons[x.kind]+' · '+name(d,x.actor,x.player)+(x.assist?' · ассист: '+name(d,x.side,x.assist):'')+(x.placement?' · зона '+x.placement:'')+(x.secondary?' · '+V.reasons[x.secondary.kind]+': '+name(d,x.side==='ours'?'theirs':'ours',x.secondary.player):'')+(x.observations?.length?' · успешных действий: '+x.observations.length:'');
 if(x.type==='sub')return sideName(d,x.side)+' · замена '+name(d,x.side,x.out)+' → '+name(d,x.side,x.in)+' · P'+x.zone;
 if(x.type==='timeout')return sideName(d,x.side)+' · тайм-аут '+x.number;
 if(x.type==='libero')return d.teamName+' · '+(x.for?'Либеро '+name(d,'ours',x.player||d.libero)+' вместо '+name(d,'ours',x.for):'Возвращение основного игрока')+(x.exception?' · исключение: '+x.exception:'');
 if(x.type==='changeEnds')return 'Фактическая смена сторон';
 if(x.type==='sanction')return sideName(d,x.side)+' · '+V.sanctionTypes[x.category]+(x.player?' · '+name(d,x.side,x.player):'')+(x.note?' · '+x.note:'');
 return x.type;
}
function placementBlock(d,s,side,kind){
 const a=V.placementSummary(s.timeline,side,kind),max=Math.max(1,...a.zones);
 return section(sideName(d,side)+' · '+(kind==='ace'?'Направления эйсов':'Направления результативных атак'),
   p('Зона на стороне принимающей команды. Указано '+a.known+' из '+a.total+' · без зоны '+a.unknown+'. Не включает подачи или атаки, продолжившие розыгрыш.'),
   el('div',{class:'tactical-grid'},[4,3,2,5,6,1].map(z=>el('div',{class:'tactical-cell'},[el('small',{text:'Зона '+z}),el('strong',{text:a.zones[z-1]}),el('progress',{max,value:a.zones[z-1],'aria-label':'Зона '+z+' · '+a.zones[z-1]})]))));
}
function historyRallyEditor(d,event,index,save,close,correct){
 const kinds=V.rallyReasonOptions(event.side,event.before.serve);
 if(!kinds.includes(event.kind))kinds.push(event.kind);
 const reason=select(kinds.map(k=>[k,V.reasons[k]]),event.kind),player=select([],''),zone=select([['','Не указана'],...Array.from({length:6},(_,i)=>[i+1,'P'+(i+1)])],event.placement??''),defender=select([],''),assist=select([],'');
 const losing=event.side==='ours'?'theirs':'ours';
 function fill(){
  const k=reason.value,changed=k!==event.kind;
  player.replaceChildren(el('option',{value:'',text:'Без автора'}),...V.rallyCandidates(d,event.before.lineups,event.before.serve,event.side,k).map(p=>el('option',{value:p.id,text:playerLabel(p)})));
  if(!changed&&event.player&&[...player.options].some(o=>o.value===event.player))player.value=event.player;
  zone.disabled=!V.canPlace(k);zone.value=changed?'':String(event.placement??'');
  defender.replaceChildren(el('option',{value:'',text:'Не указана'}),...roster(d,losing).filter(p=>event.before.lineups[losing].includes(p.id)).map(p=>el('option',{value:p.id,text:playerLabel(p)})));
  defender.disabled=!V.secondaryKind(k);defender.value=changed?'':event.secondary?.player||'';
  fillAssist(changed?'':event.assist||'');
 }
 function fillAssist(value=''){const old=value;assist.replaceChildren(el('option',{value:'',text:'Без отметки'}),...roster(d,event.side).filter(p=>event.before.lineups[event.side].includes(p.id)&&p.id!==player.value).map(p=>el('option',{value:p.id,text:playerLabel(p)})));assist.disabled=!V.canAssist(reason.value)||!player.value;assist.value=!assist.disabled&&[...assist.options].some(o=>o.value===old)?old:'';}
 player.onchange=()=>fillAssist(assist.value);reason.onchange=fill;fill();
 const correction=el('details',{class:'vp-match-more'},[el('summary',{text:'Исправить команду, получившую очко'}),p('Меняет счёт и переходы. Детали только выбранного розыгрыша будут сброшены до очка без автора. Остальные события не переписываются.')]);
 const preview=el('div',{class:'vp-stack','data-rally-correction':'',role:'status'}),winner=event.side==='ours'?'theirs':'ours';
 correction.append(btn('Предпросмотр: очко '+sideName(d,winner),()=>{preview.replaceChildren();try{const {before,after}=V.previewRallyCorrection(d,index,winner);const fmt=x=>x.sets.map(score).join(', ')||'—';preview.append(p('Текущий счёт: '+score(before.score)+' → '+score(after.score)+' · завершённые партии: '+fmt(before)+' → '+fmt(after)),p('Подача: '+sideName(d,before.serve)+' → '+sideName(d,after.serve)+'. Проверьте фактические переходы и составы.'),...sides.map(side=>p(sideName(d,side)+': '+shown(d,after)[side].map((id,i)=>'P'+(i+1)+' '+name(d,side,id)).join(' · '))),btn('Подтвердить исправление счёта',()=>correct(winner),'primary wide'));}catch(e){preview.append(p(e.message));}},'wide'),preview);
 const node=section('Редактирование · сет '+event.set+' · '+event.score,p('Команда, получившая очко: '+sideName(d,event.side)+'. Уточнение причины и автора не меняет счёт.'),field('Причина',reason),field('Автор',player),field('Ассист · автор передачи',assist),field('Зона завершения',zone),field('Дополнительная ошибка соперника',defender),btn('Сохранить уточнение',()=>save({kind:reason.value,player:player.value||null,assist:!assist.disabled&&assist.value?assist.value:null,placement:!zone.disabled&&zone.value?Number(zone.value):null,secondary:!defender.disabled&&defender.value?{kind:V.secondaryKind(reason.value),player:defender.value}:null}),'primary wide'),
 correction,observationEditor(d,event,items=>save({observations:items})),touchEditor(d,event,(touches,captureComplete)=>save({touches,captureComplete})),btn('Отмена',close,'wide'));
 return node;
}
function touchEditor(d,event,save){
 const items=structuredClone(event.touches||[]),side=select(sides.map(x=>[x,sideName(d,x)]),event.before.serve),player=select([],''),action=select(Object.entries(touchActions),'serve'),quality=select(Object.entries(touchQuality),'unknown'),result=select(Object.entries(touchResults),'continue'),zone=select([['','Не указана'],...Array.from({length:6},(_,i)=>[i+1,'P'+(i+1)])],'');
 const complete=el('input',{type:'checkbox'});complete.checked=event.captureComplete===true;
 const rows=el('div',{class:'vp-stack'});const draw=()=>rows.replaceChildren(...items.map((t,i)=>el('div',{class:'vp-observed-row'},[p((i+1)+'. '+name(d,t.side,t.player)+' · '+touchActions[t.action]+' · '+touchQuality[t.quality]+' · '+touchResults[t.result]+(t.zone?' · P'+t.zone:'')),btn('Удалить',()=>{items.splice(i,1);complete.checked=false;draw();})])));
 const fill=()=>player.replaceChildren(el('option',{value:'',text:'Выберите игрока'}),...roster(d,side.value).filter(p=>event.before.lineups[side.value].includes(p.id)).map(p=>el('option',{value:p.id,text:playerLabel(p)})));side.onchange=fill;fill();draw();
 return section('Последовательность касаний',p('Только фактически наблюдаемые действия. Полную запись отметьте, если записаны все действия от подачи до окончания розыгрыша. Незавершённая запись не участвует в процентах эффективности.'),field('Команда',side),field('Игрок',player),field('Элемент',action),field('Качество',quality),field('Результат',result),field('Зона направления (сторона получателя)',zone),btn('+ Добавить действие',()=>{if(!player.value||items.length>=60)return toast('Выберите игрока; максимум 60 действий');items.push({side:side.value,player:player.value,action:action.value,quality:quality.value,result:result.value,zone:zone.value?Number(zone.value):null});complete.checked=false;draw();},'wide'),rows,el('label',{class:'field'},[complete,el('span',{text:'Все действия записаны полностью'})]),btn('Сохранить последовательность',()=>save(structuredClone(items),complete.checked),'primary wide'));
}
function captureBlock(d,s){
 const side=select(sides.map(x=>[x,sideName(d,x)]),'ours'),set=select([[0,'Весь матч'],...Array.from({length:d.bestOf},(_,i)=>[i+1,'Партия '+(i+1)])],0),action=select(Object.entries(touchActions),'serve'),player=select([['','Все игроки']],'');
 const rotation=select([['','Все переходы'],...Array.from({length:6},(_,i)=>[i,'P'+(i+1)])],'');const out=el('div',{class:'vp-stack'});
 const fill=()=>player.replaceChildren(el('option',{value:'',text:'Все игроки'}),...roster(d,side.value).map(p=>el('option',{value:p.id,text:playerLabel(p)})));
 const fmt=m=>m.value==null?'— ('+m.total+' действий)':m.value.toFixed(1)+'% · '+m.n+'/'+m.total;
 function draw(){const options={set:Number(set.value),side:side.value,player:player.value||null},a=captureSummary(s.timeline,options),z=captureZoneSummary(s.timeline,{...options,action:action.value,rotation:rotation.value===''?null:Number(rotation.value)}),max=Math.max(1,...z.zones.map(x=>x.count));
 out.replaceChildren(p('Розыгрыши: '+a.rallies+' · с причиной '+a.reasons+' · с автором '+a.authors+' · с касаниями '+a.touchRallies+' · проверенная полная запись '+a.complete+' · конфликтных '+a.conflicting),table(['Режим','Розыгрыши'],Object.entries(a.modes).map(([k,v])=>[captureModes[k]||'Старые записи',v])),table(['Показатель','По полной выборке'],[['Эффективность атаки (очки − ошибки)',fmt(a.attackEfficiency)],['Эффективность подачи (очки − ошибки)',fmt(a.serveEfficiency)],['Положительный приём',fmt(a.positiveReceive)],['Идеальный приём',fmt(a.perfectReceive)],['Конверсия защиты',fmt(a.defenseConversion)]]),p('Проценты относятся только к непротиворечивым розыгрышам, явно отмеченным как полные. При неизвестном знаменателе или качестве — прочерк. Это не оценка всего матча.'),p('Карта записанных действий: зона известна в '+z.known+' из '+z.total+'; учитываются также частичные записи.'),el('div',{class:'vp-heat-grid'},[4,3,2,5,6,1].map(n=>{const x=z.zones[n-1];return el('div',{class:'vp-heat-cell',style:'--heat:'+(x.count/max)},[el('small',{text:'P'+n}),el('strong',{text:x.count}),el('small',{text:'Очки '+x.point+' · ошибки '+x.error})]);})));
 }side.onchange=()=>{fill();draw()};for(const x of [set,action,player,rotation])x.onchange=draw;fill();draw();return section('Полнота регистрации и расширенная статистика',field('Партия',set),field('Команда',side),field('Игрок',player),field('Действие для карты',action),field('Переход для карты',rotation),out);
}
function observationEditor(d,event,save){
 const items=[...(event.observations||[])],side=select(sides.map(x=>[x,sideName(d,x)]),event.before.serve==='ours'?'theirs':'ours'),kind=select([['serve','Приём подачи · мяч остался в игре'],['attack','Защита от атаки'],['tip','Защита от скидки'],['defense','Защита без уточнения']],'serve'),person=select([],'');
 function fill(){person.replaceChildren(el('option',{value:'',text:'Выберите игрока'}),...roster(d,side.value).filter(p=>event.before.lineups[side.value].includes(p.id)).map(p=>el('option',{value:p.id,text:playerLabel(p)})));}
 side.onchange=fill;fill();
 const node=el('details',{class:'vp-match-more'},[el('summary',{text:'Успешные приёмы и защита · '+items.length}),p('Запишите только наблюдавшиеся мячи, которые остались в игре. Игроки — до перехода. Можно отметить несколько защитных действий.'),
 field('Команда',side),field('Действие',kind),field('Игрок',person),btn('Добавить успешное действие',()=>{if(!person.value)return toast('Выберите игрока');save([...items,{side:side.value,kind:kind.value,player:person.value}]);},'wide'),
 ...items.map((x,i)=>el('div',{class:'vp-observed-row'},[p(sideName(d,x.side)+' · '+name(d,x.side,x.player)+' · '+V.scoutTypes[x.kind]),btn('Удалить',()=>save(items.filter((_,j)=>i!==j)))]))]);
 return node;
}
function scoutPanel(d,s,options,change,close){
 const side=options.side,kind=options.kind,active=shown(d,s)[side],current=s.setEnded?s.sets.length:s.sets.length+1;
 const a=V.scoutSummary(s.timeline,side,{kind,set:options.set,active});
 const types=select(Object.entries(V.scoutTypes),kind),period=select([[0,'Весь матч'],...Array.from({length:current},(_,i)=>[i+1,'Партия '+(i+1)])],options.set);
 types.onchange=()=>change({kind:types.value});period.onchange=()=>change({set:Number(period.value)});
 const top=a.ranked[0],zone=a.topZones[0],hint=side==='theirs'?'Проверить игрока соперника':'Обратить внимание на нашу защиту';
 const observed=[...a.rows].filter(r=>r.attempts>=5&&r.success>0&&r.misses>0).sort((x,y)=>y.errorRate-x.errorRate||y.attempts-x.attempts)[0];
 const ranked=top&&top.misses>=2?el('div',{class:'vp-scout-tip'},[el('strong',{text:hint+': '+name(d,side,top.id)+' · P'+top.zone}),p('Отмечено '+top.misses+' ошибок выбранного типа за период. Это наблюдение, не вероятность ошибки. '+(a.ranked.filter(x=>x.misses===top.misses).length>1?'Есть другие игроки с таким же количеством.':''))]):p('Пока нет повторяющихся персональных ошибок выбранного типа.');
 const zoneTip=zone&&zone.count>=2?el('div',{class:'vp-scout-tip'},[el('strong',{text:(side==='theirs'?'Проверить зону соперника P':'Прикрыть нашу зону P')+zone.zone}),p('Зафиксировано завершений: '+zone.count+'. '+(a.topZones.filter(x=>x.count===zone.count).length>1?'Есть зоны с таким же количеством.':''))]):p('Пока нет повторяющихся завершений в известной зоне.');
 const byZone=new Map(a.rows.map(x=>[x.zone,x])),maxPlayer=Math.max(1,...a.rows.map(x=>x.misses)),maxZone=Math.max(1,...a.zones);
 const detail=el('p',{class:'vp-zone-detail','aria-live':'polite',text:'Нажмите на зону, чтобы увидеть её показатели.'});
 const grid=(isPlayer)=>el('div',{class:'vp-heat-grid vp-radar-grid'},[4,3,2,5,6,1].map(z=>{
  const r=byZone.get(z),pl=roster(d,side).find(p=>p.id===r?.id),count=isPlayer?r?.misses||0:a.zones[z-1];
  return el('button',{type:'button',class:'vp-heat-cell vp-scout-cell',style:'--heat:'+count/(isPlayer?maxPlayer:maxZone),'aria-pressed':'false',onclick:e=>{const n=e.currentTarget;for(const x of n.closest('.vp-scout-panel').querySelectorAll('.vp-scout-cell'))x.setAttribute('aria-pressed','false');n.setAttribute('aria-pressed','true');detail.textContent=isPlayer?'P'+z+' · '+(pl?pl.name+' · '+count+' отмеченных ошибок · '+(r?.onCourt||0)+' розыгрышей на площадке':'нет игрока'):'P'+z+' · '+count+' завершений · зон известно '+a.knownZones+' из '+a.total;animateOnce(n,'pulse',{duration:180});}},[el('small',{text:'P'+z}),el('strong',{text:isPlayer?(pl?.number!=null?'№'+pl.number:pl?'•':'—'):String(count)}),el('small',{text:isPlayer?(pl?pl.name+' · '+count+' ошибок':'Нет состава'):'завершений'})]);
 }));
 return el('section',{class:'vp-attribution vp-scout-panel','aria-label':'Тактическая разведка'},[
  el('h3',{text:'Тактическая разведка'}),el('div',{class:'vp-tabs'},[['theirs','Соперник'],['ours','Наша команда']].map(([id,label])=>btn(label,()=>change({side:id}),side===id?'primary':''))),field('Период',period),field('Тип действия',types),
  p('Розыгрышей: '+a.rallies+' · пропущенных завершений выбранного типа: '+a.total),p('С автором ошибки: '+a.knownPlayers+' из '+a.total+' · с зоной: '+a.knownZones+' из '+a.total),
  ranked,observed?el('div',{class:'vp-scout-tip'},[el('strong',{text:'По записанным попыткам: '+name(d,side,observed.id)}),p(Math.round(observed.errorRate*100)+'% ошибок · '+observed.misses+' из '+observed.attempts+' отмеченных действий. Выборка может быть неполной.')]):null,zoneTip,el('strong',{text:'Игроки в текущей расстановке'}),el('div',{class:'vp-heat-net',text:'СЕТКА'}),grid(true),p('P1–P6 — текущие позиции по расстановке, не фактическое место игрока в розыгрыше. Цвет показывает число отмеченных ошибок, а не качество игры.'),
  el('strong',{text:'Карта пропущенных завершений'}),el('div',{class:'vp-heat-net',text:'СЕТКА'}),grid(false),detail,
  table(['Игрок на площадке','Розыгрыши¹','Ошибки','Успешно','Попытки','Доля²','Приём','Атака','Скидка'],[...a.rows].sort((x,y)=>y.misses-x.misses||x.zone-y.zone).map(r=>[name(d,side,r.id),r.onCourt,r.misses,r.success,r.attempts,r.attempts>=5&&r.success>0?Math.round(r.errorRate*100)+'%':'—',r.serve,r.attack,r.tip])),
  a.former.length?el('details',{},[el('summary',{text:'Игроки вне площадки · '+a.former.length}),...a.former.map(r=>p(name(d,side,r.id)+' · '+r.misses+' отмеченных ошибок'))]):null,
  p('¹ Розыгрыши с игроком на площадке. ² Доля ошибок среди записанных попыток (не менее пяти и хотя бы одно успешное действие). Не все мячи обязательно отмечены. Ноль ошибок не доказывает безошибочную игру.'),
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
    table(['Игрок','Атаки*','Скидки','Блок','Эйс','Ошибки','Очки','Ассисты','Баллы'],roster(d,side).map(p=>{const x=r.stats[p.id]||{};return [playerLabel(p),x.attackKills??'—',x.tipKills??'—',x.blocks??'—',x.aces??'—',x.errors??'—',x.points??'—',x.assists??'—',x.points!=null||x.assists!=null?(x.points||0)+(x.assists||0):'—'];})),
    p('* Результативные атаки включают скидки. Процент успешности всех атак не рассчитывается без записи всех попыток.'),
    table(['Причина очка','Количество'],Object.entries(V.reasons).map(([k,t])=>[t,r.reasons[k]||0])))];
  });
  const tactical=matchTactics(d,5,{set,min:Number(sample.value)});
  const combo=(title,items)=>section(title,p('Выигранные розыгрыши в присутствии игроков. Сочетание не доказывает индивидуальный вклад.'),table(['Игроки','Розыгрыши','Победы','+/−','Доля'],items.slice(0,20).map(x=>[x.players.map(id=>name(d,'ours',id)).join(' · '),x.rallies,x.won,x.plusMinus,x.eligible?pct(x.won,x.rallies):'Мало данных'])),!items.length?p('Нет записанных сочетаний.'):null);
  const rotationData=rotationPerformance(s.timeline,{set,min:Number(sample.value)});
  const phaseRate=(won,n,eligible)=>won+'/'+n+' · '+(eligible?pct(won,n):'мало данных');
  const rotationRows=sides.flatMap(side=>{
   const {rows:r,comparisons}=rotationData[side];
   const runs=[...s.sides[side].runs,...(s.sides[side].activeRun?[s.sides[side].activeRun]:[])].filter(x=>!set||x.set===set);
   return [section('Переходы · '+sideName(d,side),p('P1–P6 — циклы относительно стартового состава партии. Съём — выигранный розыгрыш на приёме, break-point — на своей подаче. Минимум применяется к каждой фазе отдельно.'),table(['Цикл','Розыгрыши','+/−','На подаче','На приёме'],r.map(x=>['P'+x.position,x.rallies,x.plusMinus,phaseRate(x.serveWon,x.serve,x.serveEligible),phaseRate(x.receiveWon,x.receive,x.receiveEligible)])),
    ...comparisons.map(x=>p('Проверить '+(x.phase==='serve'?'подачу':'приём')+' в циклах '+x.low.map(n=>'P'+n).join(', ')+' относительно '+x.high.map(n=>'P'+n).join(', ')+' · разница '+Math.round(x.gap)+' п.п. Не индивидуальная оценка.'))),
    section('Серии подач · '+sideName(d,side),table(['Сет','Подающая','Очки','Эйсы','Ошибки'],runs.map(x=>[x.set,name(d,side,x.player),x.won,x.aces,x.errors])))];
  });
  const links=recordedConnections([s.timeline],{side,set,min:Number(sample.value)}),subs=substitutionWindows(s.timeline,{set,window:5});
  const connectionCard=section('Связка передачи и атаки · '+sideName(d,side),p('Полностью зарегистрировано '+links.complete+'/'+links.rallies+' розыгрышей; связки найдены в '+links.linkedRallies+'. Только соседние записанные действия передачи и атаки разных игроков одной команды; не предполагаемые ассисты.'),
    table(['Передающая','Атакующая','Попытки','Очки','Ошибки','Эфф.'],links.rows.slice(0,30).map(x=>[name(d,side,x.setter),name(d,side,x.attacker),x.attempts,x.points,x.errors,x.eligible?Math.round(x.efficiency)+'%':'Мало данных'])),!links.rows.length?p('Нет подходящих полных записей действий.'):null);
  const subCard=section('До и после замен',p('До 5 розыгрышей с каждой стороны события, только в той же партии; окна могут пересекаться. Разница не доказывает вклад заменённого игрока.'),
    table(['Сет · счёт','Команда','Ушла / вышла','До','После','Разница'],subs.map(x=>[x.set+' · '+x.score,sideName(d,x.side),name(d,x.side,x.out)+' / '+name(d,x.side,x.in),x.before.won+'/'+x.before.total,x.after.won+'/'+x.after.total,x.delta===null?'Неполное окно':Math.round(x.delta)+' п.п.'])),!subs.length?p('Замен в выбранном периоде нет.'):null);
  const passing=setterAnalysis([s.timeline],{side,set,min:Number(sample.value)}),lineups=orderedLineups([s.timeline],{side,set,min:Number(sample.value)}),min=Number(sample.value);
  const rate=(x,eligible)=>x==null?'—':eligible?Math.round(x*10)/10+'%':'Мало данных';
  const setterCard=section('Связующие · '+sideName(d,side),p('Отмеченные ассисты: '+passing.assists+' из '+passing.kills+' результативных атак и скидок; с автором атаки '+passing.attributed+'. Это полнота регистрации, не эффективность передачи.'),p('Попытки и проценты — только из полных непротиворечивых записей PRO ('+passing.complete+'/'+passing.rallies+' розыгрышей). Прочерк — нет данных.'),
   table(['Игрок','Ассисты','Передачи PRO','Ошибки PRO','Положительные PRO'],passing.rows.map(x=>[name(d,side,x.id),x.assists||'—',x.attempts||'—',rate(x.errorRate,x.eligible),rate(x.positiveRate,x.positiveEligible)])),!passing.rows.length?p('Нет зарегистрированных передач.'):null,
   section('Результативные связки (ассисты)',table(['Связующая','Нападающая','Ассисты'],passing.pairs.slice(0,30).map(x=>[name(d,side,x.setter),name(d,side,x.attacker),x.assists])),!passing.pairs.length?p('Укажите автора передачи в обычном LIVE, чтобы появилась связка.'):null));
  const ordered=section('Фактический порядок P1–P6 · '+sideName(d,side),p('Игроки до розыгрыша, включая либеро. Доля побед и фазы только при минимуме '+min+' розыгрышей в соответствующей выборке.'),table(['P1–P6','Розыгрыши','+/−','Победы','Подача','Приём'],lineups.slice(0,20).map(x=>[x.players.map((id,i)=>'P'+(i+1)+' '+name(d,side,id)).join(' · '),x.rallies,x.plusMinus,phaseRate(x.won,x.rallies,x.eligible),phaseRate(x.serveWon,x.serve,x.serveEligible),phaseRate(x.receiveWon,x.receive,x.receiveEligible)])),!lineups.length?p('Нет записанных составов.'):null);
  output.replaceChildren(...rows,setterCard,heat,...rotationRows,ordered,connectionCard,subCard,combo('Сочетания двух игроков',tactical.pairs),combo('Фактические шестёрки',tactical.six));
 }
 playerOptions();sidePicker.addEventListener('change',()=>{playerOptions();draw();});for(const control of [period,mode,player,sample])control.addEventListener('change',draw);draw();
 return section('Аналитика розыгрышей',field('Период',period),field('Команда для карты',sidePicker),field('Вид завершения',mode),field('Игрок для карты',player),field('Минимум выборки для сравнения',sample),output);
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
  const end=a.points.at(-1),runs=rallyStreaks(s.timeline,{set:Number(picker.value)}),maxRun=Math.max(1,runs.summary.ours.max,runs.summary.theirs.max);
  chart.replaceChildren(el('div',{class:'vp-momentum-legend'},[el('span',{class:'ours',style:'color:'+V.boardPalette[(d.boardColors||V.defaultBoardColors).ours].start,text:d.teamName+' · '+end.ours}),el('span',{class:'theirs',style:'color:'+V.boardPalette[(d.boardColors||V.defaultBoardColors).theirs].start,text:d.opponent+' · '+end.theirs})]),plot,
   p('Розыгрышей: '+(a.points.length-1)+' · смен лидера: '+a.changes+' · равный счёт: '+a.ties),
   table(['Показатель',d.teamName,d.opponent],[['Макс. серия',a.maxRun.ours,a.maxRun.theirs],['Серии от 3 очков',runs.summary.ours.long,runs.summary.theirs.long],['Макс. преимущество',a.maxLead.ours,a.maxLead.theirs]]),section('Серии набранных и потерянных очков',p('От начала к концу партии. Серия не переносится в следующую партию.'),el('div',{class:'vp-streak-bars'},runs.rows.slice(-40).map(r=>el('div',{class:'vp-streak-row'},[el('span',{text:r.start+' → '+r.end}),el('div',{class:'vp-streak-track'},[el('span',{class:r.side,style:'width:'+100*r.length/maxRun+'%'})]),el('strong',{text:r.length+' · '+sideName(d,r.side)})]))),runs.rows.length>40?p('Последние 40 серий; сводка учитывает всю партию.'):null,!runs.rows.length?p('Розыгрышей пока нет.'):null));
 }
 picker.addEventListener('change',draw);draw();return section('Ход партии',field('Партия',picker),chart);
}
function summaryBlocks(d,s){
 return sides.flatMap(side=>{
  const a=s.sides[side],op=sideName(d,side);
  return [section(op+' · '+a.points+' очков',p('На подаче: '+a.onServe+' · на ошибках соперника: '+a.opponentErrors+' · макс. серия: '+a.maxRun+' · без детализации: '+a.unknown),
    table(['Игрок','Атака (вкл. скидки)','Скидки','Блок','Эйс','Ошибки','Защита: ошибки','Очки','Ассисты','Баллы'],roster(d,side).map(r=>{const st=a.stats[r.id]||{};return [playerLabel(r),st.attackKills??'—',st.tipKills??'—',st.blocks??'—',st.aces??'—',st.errors??'—',st.defenseErrors??'—',st.points??'—',st.assists??'—',st.points!=null||st.assists!=null?(st.points||0)+(st.assists||0):'—'];})),
    table(['Причина очка','Количество'],Object.entries(V.reasons).map(([k,t])=>[t,s.timeline.filter(x=>x.type==='rally'&&x.side===side&&x.kind===k).length]))),
    section('Эффективность переходов · '+op,p('P1–P6 — шесть циклов относительно стартовой расстановки партии; первый цикл P1.'),
      table(['Цикл','Розыгрыши','Выиграно','Проиграно','+/−'],a.rotations.map(r=>['P'+r.position,r.rallies,r.won,r.lost,r.won-r.lost]))),
    section('Серии подач · '+op,table(['Сет','Подающая','Очки','Эйсы','Ошибки'],[...a.runs,...(a.activeRun?[a.activeRun]:[])].map(r=>[r.set,name(d,side,r.player),r.won,r.aces,r.errors]))),placementBlock(d,s,side,'ace'),placementBlock(d,s,side,'kill')];
 });
}
function courtTimeBlock(d,s,live=false){
 const t=V.courtTime(s,live?Date.now():undefined);
 if(!t.measured)return section('Игровое время',p('Нет измерений. Старые матчи без запуска учёта не считаются нулевым временем.'));
 const rows=d.ourPlayers.map(player=>[playerLabel(player),courtTimeLabel(t.players.ours[player.id]||0),...t.sets.map(set=>set.started?courtTimeLabel(set.players.ours[player.id]||0):'—')]);
 return section('Игровое время',p('Измерено '+courtTimeLabel(t.elapsedMs)+(t.partial?' · частичный замер: '+t.untrackedRallies+' розыгрышей вне учёта':'')+'. Состав на площадке в измеренных интервалах, включая паузы между розыгрышами; без тайм-аутов и перерывов. '+(live?'Таблица обновляется при следующем действии.':'')),table(['Игрок','Всего',...t.sets.map((_,i)=>'П'+(i+1))],rows),p('Прочерк — нет измерения партии; ноль — игрок не находился на площадке в измеренных интервалах.'));
}
export function buildMatchReport(m){
 const d=m.detail,{state:s,sets,duration}=V.reportData(d),wins=s.sets.filter(x=>x.ours>x.theirs).length;
 return el('article',{class:'vp-report'},[el('div',{class:'vp-report-brand'},[el('strong',{text:'TeachApp'}),el('span',{text:'Тренерский протокол'})]),
  el('h1',{text:'Протокол матча'}),el('div',{class:'vp-report-score'},[el('div',{},[teamEmblem(d,'ours'),p(d.teamName)]),el('strong',{text:wins+' : '+(s.sets.length-wins)}),el('div',{},[teamEmblem(d,'theirs'),p(d.opponent)])]),
  p('Волейбол · '+regulationOf(d).name+' · до '+d.bestOf+' партий · '+d.date+' · '+(d.competition||'Без турнира')+' · '+(d.venue||'Место не указано')+' · '+seconds(duration)),
  p('Журнал событий: '+d.events.length+' · результат восстановлен из истории. Не официальный судейский бланк. Неуказанная статистика обозначена прочерком. Баллы = зафиксированные личные очки + ассисты; не командный счёт.'),
  section('Результаты партий',table(['Сет',d.teamName,d.opponent,'Длительность'],sets.map(x=>[x.set,x.ours,x.theirs,seconds(x.seconds)]))),
  section('Стартовые расстановки',...sets.map(x=>section('Сет '+x.set,table(['Команда','P1','P2','P3','P4','P5','P6'],sides.map(side=>[sideName(d,side),...Array.from({length:6},(_,i)=>x.lineups[side][i]?name(d,side,x.lineups[side][i]):'—')]))))),
  section('Замены и либеро',table(['Сет','Счёт','Действие'],s.timeline.filter(x=>x.type==='sub'||x.type==='libero').map(x=>[x.set,x.score,eventText(d,x)]))),
  section('Смена сторон',table(['Сет','Счёт','Действие'],s.timeline.filter(x=>x.type==='changeEnds').map(x=>[x.set,x.score,eventText(d,x)]))),
  section('Судейские санкции (записанные решения)',table(['Сет','Счёт','Санкция'],s.timeline.filter(x=>x.type==='sanction').map(x=>[x.set,x.score,eventText(d,x)]))),
  section('Тайм-ауты',table(['Сет','Счёт','Команда','№'],s.timeline.filter(x=>x.type==='timeout').map(x=>[x.set,x.score,sideName(d,x.side),x.number]))),
  courtTimeBlock(d,s),...summaryBlocks(d,s),...sides.map(side=>{const a=setterAnalysis([s.timeline],{side});return section('Результативные связки (ассисты) · '+sideName(d,side),p('Отмечено '+a.assists+' из '+a.kills+' результативных атак и скидок. Не процент эффективности.'),table(['Связующая','Нападающая','Ассисты'],a.pairs.map(x=>[name(d,side,x.setter),name(d,side,x.attacker),x.assists])));}),captureBlock(d,s),
  section('Детали очка',table(['Сет','Счёт','Команда','Причина','Автор','Ассист','Зона','Доп. ошибка'],s.timeline.filter(x=>x.type==='rally').map(x=>[x.set,x.score,sideName(d,x.side),V.reasons[x.kind],name(d,x.actor,x.player),x.assist?name(d,x.side,x.assist):'—',x.placement??'—',x.secondary?V.reasons[x.secondary.kind]+' · '+name(d,x.side==='ours'?'theirs':'ours',x.secondary.player):'—']))),
  section('Подписи',p('Первый судья __________________________'),p('Капитан '+d.teamName+' __________________________'),p('Капитан '+d.opponent+' __________________________'))]);
}
import {openMatchTactics} from './match-tactics.js';
export function openMatchReport(m,back,rehearsal=false){
 try{
  const report=buildMatchReport(m);
  openSheet(el('div',{class:'vp-stack'},[btn('Печать / сохранить PDF',()=>{
   document.getElementById('teachapp-print-report')?.remove();
   const node=el('div',{id:'teachapp-print-report'},[buildMatchReport(m)]);document.body.append(node);
   const cleanup=()=>node.remove();window.addEventListener('afterprint',cleanup,{once:true});
   try{window.print();}catch{cleanup();toast('Печать недоступна');}
  },'primary wide'),rehearsal?p('ТЕСТ · Этот протокол не сохраняется в истории и не участвует в аналитике.'):btn('Тактический разбор',()=>openMatchTactics(m,()=>openMatchReport(m,back)),'wide'),report,btn('Назад',back||ui.closeSheet,'wide')]));
 }catch(e){toast(e.message);}
}
