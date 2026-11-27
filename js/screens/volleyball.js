import {makeDraftTransfer,openDraftTransfer,importDraftTransfer,draftSummary} from '../match-transfer.js';
import {holdPortalForImportedDraft} from '../public-publisher.js';
import * as C from '../coach.js';
import * as V from '../volleyball.js';
import {openDetailedSetup,openDetailedMatch,openRehearsal} from './match-protocol.js';
import {openPublicPortal} from './public-portal.js';
import {portalInfo} from '../public-publisher.js';
import {localDay} from '../public-portal.js';
import {todayIso} from '../model.js';
import * as ui from '../ui.js';
import {lineupPicker} from './lineup-picker.js';
const {el,openSheet,toast}=ui;
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
const p=text=>el('p',{text});
const field=(text,input)=>el('label',{class:'field'},[el('span',{text}),input]);
function select(rows,value){const node=el('select',{},rows.map(([value,text])=>el('option',{value:String(value),text})));if(value!=null)node.value=String(value);return node;}
const name=(players,id)=>{const p=players.find(x=>x.id===id);return p?(p.number==null?'':'№'+p.number+' · ')+p.name:'—';};
function court(players,lineup,libero,liberoFor,serve,onPick){
 return el('div',{class:'vb-court','aria-label':'Волейбольная площадка'},[
   el('div',{class:'vb-net',text:'Сетка'}),
   ...[4,3,2,5,6,1].map(z=>{
    const original=lineup[z-1],id=liberoFor===original?libero:original;
    return el('button',{type:'button',class:'vb-zone'+(z===1&&serve==='ours'?' serving':'')+(id===libero?' libero':''),onclick:()=>onPick?.(id),disabled:!onPick},[
      el('strong',{text:'Зона '+z}),el('span',{text:name(players,id)}),id===libero?el('small',{text:'Либеро'}):null,z===1&&serve==='ours'?el('small',{text:'Подача'}):null]);
   })]);
}
function lineupFields(players,initial=[],libero=null){
 const lib=select([['','Без либеро'],...players.map(p=>[p.id,name(players,p.id)])],libero||'');
 const picker=lineupPicker(players,initial,{excluded:lib.value?[lib.value]:[]});
 lib.onchange=()=>picker.setExcluded(lib.value?[lib.value]:[]);
 return {node:el('div',{class:'vb-stack'},[picker.node,field('Либеро (не входит в стартовую шестёрку)',lib)]),values:()=>({lineup:picker.get(),libero:lib.value||null})};
}
import {openLineupAssistant,openTacticBoards} from './tactics.js';
import {openPreMatchDossier} from './coach-opponents.js';
export async function openMatchCenter(team,refresh,options={}){
 try{
 const data=await C.loadCoach(),players=data.coachPlayers.filter(p=>p.teamId===team.id),active=players.filter(p=>!p.archived);
 const body=el('div',{class:'vb-stack'},[el('h2',{text:'Площадка и матч · '+team.name}),p('Черновик матча сохраняется после каждого действия. Статистика отражает только отмеченные действия.')]);
 const back=()=>openMatchCenter(team,refresh);
 const check=btn('Предматчевая проверка',async()=>{check.disabled=true;try{await C.probeLiveStorage();const info=portalInfo(team.id),drafts=(await C.listLiveMatches()).filter(d=>d.teamId===team.id);openSheet(el('div',{class:'vb-stack'},[el('h2',{text:'Готовность к LIVE'}),p('✓ Локальная база: пробная запись и удаление прошли без изменения данных.'),p((active.length>=6?'✓':'!')+' Действующих игроков: '+active.length+' (нужно не менее 6; фактический состав и ограничения проверяются при настройке).'),p((navigator.serviceWorker?.controller?'✓':'!')+' Офлайн-кеш: '+(navigator.serviceWorker?.controller?'приложение контролируется Service Worker; это не гарантия полного кеша':'откройте приложение онлайн перед игрой')),p(navigator.onLine===false?'! Интернет недоступен по данным браузера. LIVE сохраняется локально.':'✓ Сеть доступна по данным браузера; сервер может быть недоступен.'),p('Публичная страница: '+(!info.data.enabled?'выключена':info.conflict||info.data.publisherPaused?'остановлена / конфликт':info.connected?info.status:'требуется вход')),p('Незавершённых черновиков команды: '+drafts.length),p('Проверьте питание устройства, свободное место, составы и фактическую работу тестового матча. При отсутствии сети публичный счёт не обновляется.'),btn('Тестовый LIVE-матч',openRehearsal,'primary wide'),btn('Назад',back,'wide')]));}catch(e){toast('Локальная запись не проверена: '+e.message);}finally{check.disabled=false;}},'wide');
 if(options.draftId){const draft=data.coachLive.find(x=>x.teamId===team.id&&x.id===options.draftId);if(draft){if(draft.mode==='dual')openDetailedMatch(draft,back,refresh);else live(team,players,draft,refresh);return;}}
 const setupOptions={matches:data.coachMatches,presets:data.coachLineups};
 const portal=portalInfo(team.id).data,fixtures=portal.schedule.filter(x=>localDay(x.startAt)===todayIso()&&x.id!==portal.match?.scheduledId&&!data.coachLive.some(d=>d.teamId===team.id&&d.date===todayIso()&&d.opponent.trim().toLocaleLowerCase('ru')===x.opponent.trim().toLocaleLowerCase('ru')));
 if(fixtures.length)body.append(el('section',{class:'card-block vb-stack'},[el('h3',{text:'Сегодня по расписанию'}),...fixtures.map(f=>el('div',{class:'vb-stack'},[p(new Intl.DateTimeFormat('ru-RU',{timeStyle:'short'}).format(f.startAt)+' · '+f.opponent),btn('Подготовить матч · '+f.opponent,()=>openDetailedSetup(team,active,back,refresh,null,{...setupOptions,fixture:f}),'primary wide')]))]));
 body.append(check,btn('Тестовый LIVE-матч',openRehearsal,'wide'),btn('Предматчевое досье',()=>openPreMatchDossier(team,back),'wide'),btn('+ Новый подробный матч',()=>openDetailedSetup(team,active,back,refresh,null,setupOptions),'primary wide'),btn('Прежний режим матча',()=>setup(team,active,null,refresh),'wide'),btn('+ Сохранить расстановку',()=>setup(team,active,{preset:true},refresh),'wide'),btn('Помощник состава',()=>openLineupAssistant(team,C.teamView(data,team.id),back),'wide'),btn('Тактическая доска',()=>openTacticBoards(team),'wide'),btn('Публичная страница команды',()=>openPublicPortal(team,back),'wide'),btn('Импорт защищённого черновика',()=>openDraftImport(team,back),'wide'));
 for(const x of data.coachLineups.filter(x=>x.teamId===team.id))body.append(el('div',{class:'card-block vb-stack'},[p(x.name+' · '+V.schemes[x.scheme]),court(players,x.lineup,x.libero,null,null,null),
   btn('Начать с этой расстановкой',()=>openDetailedSetup(team,active,back,refresh,x,setupOptions),'wide'),btn('Удалить расстановку',async()=>{if(await ui.confirmDialog({title:'Удалить расстановку?',text:'Матчи не меняются.',ok:'Удалить'})){await C.deleteLineup(x.id);openMatchCenter(team,refresh);}},'wide')]));
 for(const d of data.coachLive.filter(x=>x.teamId===team.id)){
  const s=V.replay(d);body.append(el('div',{class:'card-block vb-stack'},[p(d.date+' · '+d.opponent+' · '+(s.score?.ours??s.ours)+':'+(s.score?.theirs??s.theirs)),btn('Продолжить матч',()=>d.mode==='dual'?openDetailedMatch(d,back,refresh):live(team,players,d,refresh),'primary wide'),d.mode==='dual'&&!s.finished?btn('Экспорт черновика для передачи',()=>exportDraft(d),'wide'):null]));
 }
 body.append(btn('Закрыть',ui.closeSheet,'wide'));openSheet(body);
 }catch(e){toast(e.message);}
}
function setup(team,players,preset,refresh){
 const isPreset=preset?.preset===true;
 if(players.length<6)return toast('Нужно не менее шести действующих игроков');
 const title=el('input',{placeholder:isPreset?'Название расстановки':'Соперник'}),competition=el('input',{placeholder:'Соревнование'}),day=el('input',{type:'date',value:todayIso(),max:todayIso()});
 const scheme=select(Object.entries(V.schemes),preset?.scheme||'5-1'),best=select([[3,'До двух побед'],[5,'До трёх побед']],3),target=select([15,21,25].map(n=>[n,n]),25),decider=select([15,21,25].map(n=>[n,n]),15),serve=select([['ours','Наши'],['theirs','Соперник']],'ours');
 const l=lineupFields(players,preset?.lineup,preset?.libero),roster=players.map(p=>p.id);
 const warnings=el('div',{class:'vb-stack'}),drawWarnings=()=>{
  const m=C.trainingWarnings({date:day.value,roster,exercises:[{name:'Волейбол',activityId:'volley'},{name:'Прыжки',activityId:'jump'},{name:'Соревнование',activityId:'competition'}]},players);
  warnings.replaceChildren(p(m.length?'Проверьте ограничения у '+new Set(m.map(x=>x.player.id)).size+' игроков.':'По выбранным нагрузкам совпадений нет. Это не медицинский допуск.'),...m.map(x=>p(name(players,x.player.id)+' · '+x.exercises.map(e=>e.name).join(', '))));
 };day.onchange=drawWarnings;drawWarnings();
 let busy=false;
 const save=btn(isPreset?'Сохранить':'Начать матч',async()=>{
  if(busy)return;busy=true;save.disabled=true;
  try{
   const values=l.values();
   if(!V.validLineup(values.lineup,roster)||values.lineup.includes(values.libero))throw Error('Выберите шесть разных игроков и отдельного либеро');
   if(isPreset){await C.saveLineup({teamId:team.id,name:title.value,scheme:scheme.value,roster,...values});await openMatchCenter(team,refresh);}
   else{
    if(!await ui.confirmDialog({title:'Начать матч?',text:'Подтвердите фактический состав и допустимость нагрузки. Проверки не заменяют решение тренера.',ok:'Начать'}))return;
    const d=await C.startLiveMatch({teamId:team.id,date:day.value,opponent:title.value,competition:competition.value,scheme:scheme.value,roster,...values,bestOf:Number(best.value),target:Number(target.value),decider:Number(decider.value),firstServe:serve.value});live(team,players,d,refresh);
   }
  }catch(e){toast(e.message);}finally{busy=false;save.disabled=false;}
 },'primary wide');
 openSheet(el('div',{class:'vb-stack'},[el('h2',{text:isPreset?'Расстановка':'Новый матч'}),field(isPreset?'Название':'Соперник',title),field('Схема (подсказка тренера)',scheme),
   p('5–1 и 4–2 — обозначения схемы. Позиции задаются вручную, приложение не проверяет тактические обязанности.'),
   ...(!isPreset?[field('Дата',day),field('Соревнование',competition),field('Формат',best),field('Очков в партии',target),field('Решающая партия',decider),field('Первая подача',serve),warnings]:[]),
   l.node,save,btn('Назад',()=>openMatchCenter(team,refresh),'wide')]));
}
function live(team,players,initial,refresh){
 let d=initial,busy=false,selected=null;
 const body=el('div',{class:'vb-stack vb-live'});
 const perform=async ev=>{if(busy)return;busy=true;try{d=await C.changeLiveMatch(d.id,d.revision,ev);draw();}catch(e){toast(e.message);}finally{busy=false;}};
 function draw(){
  const s=V.replay(d),won=s.sets.filter(x=>x.ours>x.theirs).length;
  const ids=s.lineup.map(id=>id===s.liberoFor?d.libero:id);
  if(!ids.includes(selected))selected=null;
  body.replaceChildren(el('h2',{text:team.name+' — '+d.opponent}),p('Партии: '+won+':'+(s.sets.length-won)+' · '+s.sets.map(x=>x.ours+':'+x.theirs).join(' / ')),
   el('div',{class:'vp-scoreboard'},[['ours',team.name,s.ours,won],['theirs',d.opponent,s.theirs,s.sets.length-won]].map(([side,name,value,sets])=>el('div',{class:'vp-score-side '+side+(s.serve===side?' score-serving':'')},[el('span',{text:name}),el('strong',{text:String(value)}),el('small',{text:(s.serve===side?'● Подача · ':'')+'Партии '+sets})]))),p('Схема '+V.schemes[d.scheme]),p('Учёт игрового времени доступен в подробном режиме матча.'),
   court(players,s.lineup,d.libero,s.liberoFor,s.serve,id=>{selected=id;draw();}),p('Выбран: '+name(players,selected)));
  if(s.finished)body.append(p('Матч завершён'),btn('Сохранить в историю матчей',async()=>{
    if(busy||!await ui.confirmDialog({title:'Сохранить матч?',text:'Счёт и отмеченные действия будут перенесены в историю. Черновик будет закрыт.',ok:'Сохранить'}))return;
    busy=true;try{await C.finishLiveMatch(d.id,d.revision);ui.closeSheet();await refresh();}catch(e){toast(e.message);}finally{busy=false;}
  },'primary wide'));
  else if(s.setEnded){
    const prev=d.events.filter(ev=>ev.type==='next').at(-1)?.lineup||d.lineup;
    const l=lineupPicker(players.filter(p=>d.roster.includes(p.id)&&p.id!==d.libero),prev,{previous:prev,final:s.lineup}),serve=select([['ours','Наши'],['theirs','Соперник']],s.sets.length%2===0?d.firstServe:d.firstServe==='ours'?'theirs':'ours');
    body.append(p('Партия завершена'),l.node,field('Подача в следующей партии',serve),btn('Начать следующую партию',()=>perform({type:'next',lineup:l.get(),serve:serve.value}),'primary wide'));
  }else{
    const rally=(side,kind,player=null)=>perform({type:'rally',side,kind,player});
    body.append(el('div',{class:'vb-actions'},[btn('+ Очко нашим',()=>rally('ours','point'),'primary'),btn('+ Очко сопернику',()=>rally('theirs','point'))]),
      p('Очковые действия уже добавляют очко. Не нажимайте счёт повторно. Подача в игре — только не завершившая розыгрыш эйсом или ошибкой.'),
      el('div',{class:'vb-actions'},[...Object.entries(V.rallyKinds).filter(([k])=>k!=='point').map(([k,t])=>btn(t,()=>rally(k==='serveError'?'theirs':'ours',k,selected))),
       ...Object.entries(V.actionKinds).map(([k,t])=>btn(t,()=>perform({type:'action',kind:k,player:selected})))]),
      el('div',{class:'vb-actions'},[btn('Наш тайм-аут '+s.timeouts.ours+'/2',()=>perform({type:'timeout',side:'ours'})),btn('Тайм-аут соперника '+s.timeouts.theirs+'/2',()=>perform({type:'timeout',side:'theirs'}))]));
    const reserve=select([['','Выберите запасного'],...players.filter(p=>d.roster.includes(p.id)&&!p.archived&&!s.lineup.includes(p.id)&&p.id!==d.libero).map(p=>[p.id,name(players,p.id)])],'');
    body.append(field('Замена выбранного игрока',reserve),btn('Заменить · '+s.subs+'/6',()=>perform({type:'sub',out:selected,in:reserve.value}),'wide'));
    if(d.libero)body.append(btn(s.liberoFor?'Вернуть основного игрока':'Либеро вместо выбранного',()=>perform({type:'libero',for:s.liberoFor?null:selected}),'wide'));
  }
  body.append(p('Отмеченная статистика (не полный протокол):'),...Object.entries(s.stats).map(([id,r])=>p(name(players,id)+' · '+Object.entries(r).map(([k,v])=>C.metrics[k]+': '+v).join(' · '))),
   btn('Отменить последнее действие',()=>{if(d.events.length)perform(null);},'wide'),btn('Сохранить черновик и выйти',()=>openMatchCenter(team,refresh),'wide'),
   btn('Удалить черновик',async()=>{if(busy||!await ui.confirmDialog({title:'Удалить черновик?',text:'Действия этого матча будут удалены.',ok:'Удалить',danger:true}))return;busy=true;try{await C.discardLiveMatch(d.id,d.revision);openMatchCenter(team,refresh);}catch(e){toast(e.message);}finally{busy=false;}},'wide'));
 }
 draw();openSheet(body,{fullHeight:true,match:true});
}

async function exportDraft(d){try{
 if(!await ui.confirmDialog({title:'Экспортировать защищённый черновик?',text:'Файл содержит составы и историю розыгрышей одного матча. Если передаёте LIVE, сначала приостановите отправку и перестаньте изменять матч на исходном устройстве. Передавайте только уполномоченному тренеру; не передавайте пароль вместе с файлом.',ok:'Продолжить'}))return;
 const password=await ui.promptDialog({title:'Пароль черновика',text:'Не менее 12 символов.',password:true,ok:'Далее'});if(password===null)return;
 const again=await ui.promptDialog({title:'Повторите пароль',password:true,ok:'Экспортировать'});if(again===null)return;if(again!==password)throw Error('Пароли не совпадают');
 const value=await makeDraftTransfer(d.id,d.revision,password);ui.downloadBlob(new Blob([value],{type:'application/json'}),'teachapp-live-draft.json');toast('Файл сформирован. Проверьте сохранение.');
 }catch(e){toast(e.message);}}
function openDraftImport(team,back){
 const file=el('input',{type:'file',accept:'.json,application/json','aria-label':'Защищённый черновик матча'}),notice=p(''),save=btn('Проверить и импортировать',async()=>{
 save.disabled=true;try{const selected=file.files[0];if(!selected||selected.size>8*1024*1024)throw Error('Выберите защищённый файл до 8 МБ');
 const password=await ui.promptDialog({title:'Пароль черновика',password:true,ok:'Открыть'});if(password===null)return;
 const draft=await openDraftTransfer(await selected.text(),password),summary=draftSummary(draft);
 if(summary.teamId!==team.id)throw Error('Черновик относится к другой команде. Сначала синхронизируйте состав.');
 if(!await ui.confirmDialog({title:'Импортировать черновик?',text:summary.team+' — '+summary.opponent+' · партия '+summary.set+' · '+summary.score.ours+':'+summary.score.theirs+' · событий '+summary.events+'. Существующие черновики не заменяются. Отправка публичной страницы на этом устройстве будет приостановлена даже если импорт не удастся; это не изменяет опубликованный счёт.',ok:'Импортировать'}))return;
 holdPortalForImportedDraft(team.id);const result=await importDraftTransfer(draft,team.id,{confirmed:true});toast(result.existing?'Такой черновик уже есть':'Черновик импортирован. Подключите Firebase и подтвердите передачу из матча.');await back();
 }catch(e){notice.textContent=e.message;toast(e.message);}finally{save.disabled=false;}},'primary wide');
 openSheet(el('div',{class:'vb-stack'},[el('h2',{text:'Перенос черновика матча'}),p('Импорт сохраняет только одну подробную встречу. Требуется та же команда и те же идентификаторы игроков. Не открывайте импортированный черновик на двух устройствах одновременно.'),field('Защищённый файл',file),save,notice,btn('Назад',back,'wide')]));
}
