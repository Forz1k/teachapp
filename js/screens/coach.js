/* Тренерский интерфейс: отдельная навигация и данные, без связи со школьным журналом. */
import * as C from '../coach.js';
import {catalog} from '../health.js';
import {todayIso,fmtFull} from '../model.js';
import * as ui from '../ui.js';
import {openMatchCenter} from './volleyball.js';
import {openMatchReport} from './match-protocol.js';
import {openVolleyImport,openImportedReport} from './volleypoint-import.js';
import {openCoachTeams} from './team-generator.js';
import {openTestForm,testList,playerTestCards} from './coach-tests.js';
import {openSeasonAnalytics,playerInsightCard} from './coach-season.js';
import {openTournaments} from './tournaments.js';
import {openLibrary,chooseTrainingPlan} from './library.js';
import {metric,actionTile,dashboardHeading,trendChart} from '../dashboard.js';
const {el,openSheet,closeSheet,toast}=ui;
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
const field=(text,input)=>el('label',{class:'field'},[el('span',{text}),input]);
const input=(value='',type='text',extra={})=>el('input',{type,value,...extra});
const select=(options,value)=>{const node=el('select',{},options.map(([v,text])=>el('option',{value:v,text})));if(value!=null)node.value=value;return node;};
const entries=o=>Object.entries(o);
const number=x=>x.value.trim()===''?null:Number(x.value);
const activityOptions=catalog.map(a=>[a.id,a.name]);
const activityName=id=>catalog.find(a=>a.id===id)?.name||id;
const label=p=>(p.number==null?'':'№'+p.number+' · ')+p.name+(p.archived?' (архив)':'');
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h2',{text:title}),...children]);
const p=text=>el('p',{text});
const format=value=>value==null?'—':String(value);
const dateSort=(a,b)=>a.date.localeCompare(b.date)||String(a.time||'').localeCompare(String(b.time||''));
let selectedTeam=null,selectedSection='roster',showArchived=false;
function form(title,children,save,refresh){
  const content=el('div',{class:'coach-form'},[el('h2',{text:title}),...children]);
  const submit=btn('Сохранить',async()=>{
    submit.disabled=true;
    try{await save();closeSheet();toast('Сохранено');await refresh();}catch(e){toast(e.message);}finally{submit.disabled=false;}
  },'primary wide');
  content.append(submit,btn('Отмена',closeSheet,'wide'));openSheet(content);
}
async function confirm(title,text,action,refresh){
  if(!await ui.confirmDialog({title,text,ok:'Подтвердить',danger:true}))return;
  try{await action();closeSheet();await refresh();}catch(e){toast(e.message);}
}
function teamForm(team,refresh){
  const name=input(team?.name||'','text',{maxlength:200});
  form(team?'Редактирование команды':'Новая команда',[field('Название',name)],async()=>{
    const r=await C.saveTeam({...team,name:name.value});selectedTeam=r.id;selectedSection='roster';
  },refresh);
}
function playerForm(team,player,refresh){
  const name=input(player?.name||'','text',{maxlength:200}),num=input(player?.number??'','number',{min:0,max:99,step:1}),position=select(entries(C.positions),player?.position||'universal');
  let limits=(player?.restrictions||[]).map(r=>({...r}));
  const list=el('div',{class:'coach-stack'});
  function draw(){
    list.replaceChildren();
    limits.forEach((r,i)=>{
      const activity=select(activityOptions,r.activityId),type=select([['avoid','Не выполнять'],['adapt','Адаптировать нагрузку']],r.type),from=input(r.dateFrom,'date'),to=input(r.dateTo||'','date');
      activity.onchange=()=>r.activityId=activity.value;type.onchange=()=>r.type=type.value;from.oninput=()=>r.dateFrom=from.value;to.oninput=()=>r.dateTo=to.value||null;
      list.append(card('Ограничение '+(i+1),[field('Нагрузка',activity),field('Режим',type),field('С',from),field('По (необязательно)',to),
        btn('Убрать из черновика',()=>{limits.splice(i,1);draw();})]));
    });
  }
  draw();
  form(player?'Карточка игрока':'Новая спортсменка',[field('Имя и фамилия',name),field('Игровой номер',num),field('Позиция',position),
    p('Указывайте только необходимые ограничения, доступные вам как тренеру. Школьные медицинские сведения не импортируются. Без диагноза.'),list,
    btn('+ Ограничение',()=>{limits.push({activityId:'volley',type:'avoid',dateFrom:todayIso(),dateTo:null});draw();})],
    ()=>C.savePlayer({...player,teamId:team.id,name:name.value,number:number(num),position:position.value,restrictions:limits}),refresh);
}
function playerCard(team,player,view,refresh){
  const now=todayIso(),year=Number(now.slice(0,4))-(Number(now.slice(5,7))<9?1:0);
  const from=input(year+'-09-01','date'),to=input((year+1)+'-08-31','date');
  const content=el('div',{class:'coach-stack'});
  const ratio=(a,b)=>b?Math.round(a/b*1000)/10+'% · '+a+'/'+b:'—';
  function draw(){
    if(from.value&&to.value&&from.value>to.value){content.replaceChildren(p('Начало периода позже окончания'));return;}
    const range={from:from.value,to:to.value};
    const a=C.playerAttendance(player.id,view.trainings.filter(t=>(!range.from||t.date>=range.from)&&(!range.to||t.date<=range.to)));
    const s=C.playerSeasonStats(view.matches,player.id,range);
    const n=s.errors;
    content.replaceChildren(
      el('div',{class:'dashboard-metrics'},[metric('Личные очки',format(s.summary.sums.points),'trophy','Зафиксировано'),metric('Эйсы',format(s.summary.sums.aces),'quick','Зафиксировано'),metric('Атаки',format(s.summary.sums.attackKills),'chart','Результативные'),metric('Блоки',format(s.summary.sums.blocks),'shield','Зафиксировано')]),
      card('Матчи · выбранный период',[p('В заявке: '+s.rosterMatches+' · подробных протоколов: '+s.detailedMatches),p('Розыгрышей на площадке по подробным протоколам: '+s.rallies),trendChart(s.chosen.filter(m=>Number.isFinite(m.stats[player.id]?.points)).map(m=>({date:m.date,value:m.stats[player.id].points})).sort((a,b)=>a.date.localeCompare(b.date)).slice(-20),{unit:'очки',label:'Личные очки в матчах'}),p('График: последние 20 матчей с известным показателем.')]),
      card('Подача · подробные матчи',[p('Розыгрышей на своей подаче: '+(s.detailedMatches?s.serviceRallies:'—')),p('Выиграно командой на подаче: '+ratio(s.serviceWins,s.serviceRallies)),p('Эйсы: '+(s.detailedMatches?s.serviceAces:'—')+' · отмеченные ошибки подачи: '+(s.detailedMatches?s.serviceErrors:'—')),p('Проигрыши на подаче без указанной причины: '+s.unclassifiedServiceLosses),p('Выигрыш розыгрыша на подаче — командный показатель, не личная точность подачи.')]),
      card('Ошибки · подробные матчи',[p(s.detailedMatches?'Подача '+n.serve+' · атака '+n.attack+' · приём '+n.receive+' · прочие '+n.other:'Нет подробных протоколов'),p('Розыгрыши без полной атрибуции на площадке: '+s.unknownOnCourt),p('Ноль отмеченных ошибок не доказывает отсутствие ошибок.')]),
      card('Данные прежних и ручных матчей',[p('Доля успешных среди записанных действий (не гарантирует полноту):'),p('Подача '+ratio(s.rates.serve.success,s.rates.serve.total)),p('Приём '+ratio(s.rates.receive.success,s.rates.receive.total)),p('Атака '+ratio(s.rates.attack.success,s.rates.attack.total)),p('Событийные протоколы не содержат все попытки атаки и приёма; их проценты здесь не вычисляются.')]),
      ...(s.importedMatches?[card('VolleyPoint · импортированные матчи',[p('Протоколов: '+s.importedMatches+' · ошибок по итогам: '+s.importedErrors),p('Зафиксированные ошибки: подача '+s.importedBreakdown.serve+' · атака '+s.importedBreakdown.attack+' · приём '+s.importedBreakdown.receive+' · прочие '+s.importedBreakdown.other),p('Очки в записанных сериях подачи: '+s.importedServiceWins+' · максимальная записанная серия: '+s.importedLongestSeries),p('Полное число попыток и выходы на площадку неизвестны; проценты не вычисляются.')])]:[]),
      card('Тренировки · посещаемость',[p(format(a.pct)+(a.pct==null?'':'%')+' · посещено '+(a.present+a.limited)+' · пропущено '+a.absent+' · не отмечено '+a.unknown)]),
      card('Тренировочные тесты и физподготовка',[...playerTestCards(view,player.id,range),!team.archived&&!player.archived?btn('+ Индивидуальный тест',()=>openTestForm(team,view,null,refresh,player.id),'wide'):null]),
      playerInsightCard(view,player.id,range),
      card('История матчей',s.chosen.length?s.chosen.map(m=>p(fmtFull(m.date)+' · '+m.opponent+' · личные очки: '+format(m.stats[player.id]?.points))):[p('Матчей за период нет')]));
  }
  from.onchange=draw;to.onchange=draw;draw();
  openSheet(el('div',{class:'coach-form player-profile'},[el('div',{class:'player-profile-head'},[el('div',{class:'profile-avatar',text:player.number??'—'}),el('div',{},[el('h2',{text:player.name}),p(C.positions[player.position]+(player.archived?' · Архив':''))])]),el('div',{class:'coach-columns'},[field('Период с',from),field('По',to)]),btn('Весь архив',()=>{from.value='';to.value='';draw();},'wide'),content,
    p('Ограничений внесено: '+player.restrictions.length),
    ...player.restrictions.map(r=>p(activityName(r.activityId)+' · '+(r.type==='avoid'?'не выполнять':'адаптировать')+' · '+r.dateFrom+' — '+(r.dateTo||'бессрочно'))),
    btn('Редактировать карточку',()=>playerForm(team,player,refresh),'wide'),
    btn(player.archived?'Вернуть в состав':'В архив',()=>confirm('Изменить состав?', 'История тренировок и матчей сохранится.',()=>C.savePlayer({...player,archived:!player.archived}),refresh),'wide')]));
}
function metricTable(summary){
  return el('dl',{class:'coach-metrics'},entries(C.metrics).flatMap(([key,name])=>[el('dt',{text:name}),el('dd',{text:format(summary.sums[key])+(summary.recorded[key]?' ('+summary.recorded[key]+' записей)':'')})]));
}
function trainingForm(team,view,t,refresh,template=null){
  const title=input(t?.title||template?.name||'Тренировка'),date=input(t?.date||todayIso(),'date'),time=input(t?.time||'16:00','time'),minutes=input(t?.minutes??template?.minutes??90,'number',{min:1,max:600,step:1});
  const players=view.players.filter(p=>!p.archived||t?.roster.includes(p.id));
  const selected=new Set(t?.roster||players.filter(p=>!p.archived).map(p=>p.id)),attendance={...t?.attendance};
  let exercises=(t?.exercises||template?.exercises||[]).map(x=>({...x}));
  const held=el('input',{type:'checkbox'});held.checked=!!t?.held;
  const plan=el('div',{class:'coach-stack'}),roster=el('div',{class:'coach-stack'}),warnings=el('div',{role:'status',class:'coach-warning'});
  const preview=()=>({date:date.value,exercises,roster:[...selected]});
  function warn(){
    const matches=C.trainingWarnings(preview(),players);
    warnings.replaceChildren(p('Проверка внесённых ограничений: '+(matches.length?'есть совпадения':'совпадений нет. Это не подтверждение допуска.')));
    for(const m of matches)warnings.append(p(label(m.player)+': '+m.exercises.map(e=>e.name).join(', ')+' · '+(m.restriction.type==='avoid'?'не выполнять':'проверить адаптацию')));
    if(!exercises.length)warnings.append(p('В плане нет размеченных упражнений — сопоставление ограничений неполное.'));
  }
  function drawPlan(){
    plan.replaceChildren();
    exercises.forEach((x,i)=>{
      const name=input(x.name),activity=select(activityOptions,x.activityId),duration=input(x.minutes??'','number',{min:1,max:600,step:1});
      name.oninput=()=>{x.name=name.value;warn();};activity.onchange=()=>{x.activityId=activity.value;warn();};duration.oninput=()=>x.minutes=number(duration);
      plan.append(card('Упражнение '+(i+1),[field('Название',name),field('Вид нагрузки',activity),field('Минуты',duration),btn('Убрать',()=>{exercises.splice(i,1);drawPlan();})]));
    });warn();
  }
  function drawRoster(){
    roster.replaceChildren();
    for(const player of players){
      const check=el('input',{type:'checkbox'});check.checked=selected.has(player.id);
      check.onchange=()=>{if(check.checked)selected.add(player.id);else{selected.delete(player.id);delete attendance[player.id];}drawRoster();warn();};
      const item=el('div',{class:'coach-roster-row'},[field(label(player),check)]);
      if(check.checked&&held.checked){
        const state=select([['','Не отмечено'],...entries(C.attendanceLabels)],attendance[player.id]||'');
        state.onchange=()=>{if(state.value)attendance[player.id]=state.value;else delete attendance[player.id];};
        item.append(field('Посещаемость',state));
      }
      roster.append(item);
    }
  }
  held.onchange=drawRoster;date.oninput=warn;drawPlan();drawRoster();
  form(t?'Тренировка':'Запланировать тренировку',[field('Название',title),field('Дата',date),field('Время',time),field('Продолжительность, мин',minutes),
    el('h3',{text:'План занятия'}),plan,btn('+ Упражнение',()=>{exercises.push({name:'',activityId:'volley',minutes:10});drawPlan();}),
    el('h3',{text:'Состав'}),field('Тренировка проведена',held),roster,warnings],
    ()=>C.saveTraining({...t,teamId:team.id,title:title.value,date:date.value,time:time.value,minutes:number(minutes),exercises,roster:[...selected],held:held.checked,attendance:held.checked?attendance:{}}),refresh);
}
function matchForm(team,view,m,refresh){
  const date=input(m?.date||todayIso(),'date'),opponent=input(m?.opponent||''),competition=input(m?.competition||'');
  const players=view.players.filter(p=>!p.archived||m?.roster.includes(p.id));
  const selected=new Set(m?.roster||players.filter(p=>!p.archived).map(p=>p.id)),stats=structuredClone(m?.stats||{});
  let sets=(m?.sets||[{ours:null,theirs:null}]).map(x=>({...x}));
  const setList=el('div',{class:'coach-stack'}),playerList=el('div',{class:'coach-stack'}),score=el('p',{role:'status'});
  function showScore(){
    const complete=sets.filter(x=>Number.isInteger(x.ours)&&Number.isInteger(x.theirs)&&x.ours!==x.theirs);
    const s=C.matchScore({sets:complete});score.textContent='Счёт по заполненным партиям: '+s.ours+':'+s.theirs;
  }
  function drawSets(){
    setList.replaceChildren();
    sets.forEach((s,i)=>{
      const ours=input(s.ours??'','number',{min:0,step:1}),theirs=input(s.theirs??'','number',{min:0,step:1});
      ours.oninput=()=>{s.ours=number(ours);showScore();};theirs.oninput=()=>{s.theirs=number(theirs);showScore();};
      setList.append(card('Партия '+(i+1),[el('div',{class:'coach-columns'},[field('Наши',ours),field('Соперник',theirs)]),btn('Убрать партию',()=>{sets.splice(i,1);drawSets();})]));
    });showScore();
  }
  function drawPlayers(){
    playerList.replaceChildren();
    for(const player of players){
      const check=el('input',{type:'checkbox'});check.checked=selected.has(player.id);
      check.onchange=()=>{if(check.checked)selected.add(player.id);else{selected.delete(player.id);delete stats[player.id];}drawPlayers();};
      const item=el('div',{class:'coach-roster-row'},[field(label(player),check)]);
      if(check.checked){
        const details=el('details',{},[el('summary',{text:'Статистика игрока'})]);
        for(const [k,name] of entries(C.metrics)){
          const node=input(stats[player.id]?.[k]??'','number',{min:0,max:9999,step:1});
          node.oninput=()=>{stats[player.id]??={};if(node.value==='')delete stats[player.id][k];else stats[player.id][k]=number(node);};
          details.append(field(name,node));
        }
        item.append(details);
      }
      playerList.append(item);
    }
  }
  drawSets();drawPlayers();
  form(m?'Редактировать матч':'Результат матча',[field('Дата',date),field('Соперник',opponent),field('Соревнование (необязательно)',competition),
    el('h3',{text:'Партии'}),setList,btn('+ Партия',()=>{if(sets.length>=5)return toast('Не более пяти партий');sets.push({ours:null,theirs:null});drawSets();}),score,
    el('h3',{text:'Состав и статистика'}),p('Пусто — показатель не записан. Ноль — зафиксировано 0 действий.'),playerList],
    ()=>C.saveMatch({...m,teamId:team.id,date:date.value,opponent:opponent.value,competition:competition.value,sets,roster:[...selected],stats}),refresh);
}
function download(text,name){
  try{ui.downloadBlob(new Blob([text],{type:'text/csv;charset=utf-8'}),name+'-'+todayIso()+'.csv');toast('Проверьте файл в загрузках');}catch(e){toast(e.message);}
}
export async function renderCoach(root,ctx={}){
  root.replaceChildren();
  if(['home','roster','trainings','matches','analytics'].includes(ctx.section))selectedSection=ctx.section;
  const header=el('div',{class:'topbar'},[el('div',{class:'topbar-row'},[el('h1',{text:'Волейбол'}),btn('Школа',()=>ctx.onBack?.(),'small')]),el('div',{class:'subtitle',text:'Автономный режим тренера'})]);
  const body=el('div',{class:'coach-body'},[p('Загрузка…')]);root.append(header,body);
  let sequence=0;
  async function refresh(){
    const seq=++sequence;
    try{
      const data=await C.loadCoach();if(seq!==sequence)return;
      body.replaceChildren();
      const teams=data.coachTeams.filter(t=>showArchived||!t.archived);
      if(!teams.some(t=>t.id===selectedTeam))selectedTeam=teams[0]?.id||null;
      const picker=select(teams.map(t=>[t.id,t.name+(t.archived?' (архив)':'')]),selectedTeam);
      picker.onchange=()=>{selectedTeam=picker.value;refresh();};
      const archived=el('input',{type:'checkbox'});archived.checked=showArchived;archived.onchange=()=>{showArchived=archived.checked;refresh();};
      body.append(card('Команды',[teams.length?field('Команда',picker):p('Добавьте первую волейбольную команду.'),field('Показать архивные команды',archived),btn('+ Команда',()=>teamForm(null,refresh),'primary wide')]));
      body.append(btn('Организация соревнований',openTournaments,'wide'));
      const team=teams.find(t=>t.id===selectedTeam);if(!team)return;
      const view=C.teamView(data,team.id);
      body.append(el('div',{class:'coach-actions'},[btn('Название',()=>teamForm(team,refresh)),btn(team.archived?'Восстановить команду':'Архивировать',()=>confirm('Изменить статус команды?','Данные сохранятся.',()=>C.saveTeam({...team,archived:!team.archived}),refresh))]));
      const sections={home:'Главная',roster:'Состав',trainings:'Тренировки',matches:'Матчи',analytics:'Аналитика'};
      if(!ctx.onSection)body.append(el('div',{class:'coach-sections',role:'group','aria-label':'Разделы тренера'},entries(sections).map(([id,name])=>btn(name,()=>{selectedSection=id;refresh();},selectedSection===id?'primary':''))));
      if(selectedSection==='home'){
        const active=view.players.filter(p=>!p.archived),wins=view.matches.filter(m=>{const s=C.matchScore(m);return s.ours>s.theirs;}).length;
        const upcoming=view.trainings.filter(t=>!t.held&&t.date>=todayIso()).sort(dateSort),next=upcoming[0];
        const go=id=>{selectedSection=id;ctx.onSection?.(id);refresh();};
        body.append(dashboardHeading(team.name,'Рабочая панель команды'),el('div',{class:'dashboard-metrics'},[metric('Игроков',active.length,'classes'),metric('Матчей',view.matches.length,'trophy'),metric('Побед',wins,'check'),metric('Тренировки впереди',upcoming.length,'calendar')]));
        body.append(el('article',{class:'card-block today-card lesson-card lesson-card-next'},[el('div',{class:'today-meta',text:'Ближайшая тренировка'}),el('h2',{text:next?next.title:'Нет запланированных тренировок'}),next?p(fmtFull(next.date)+' · '+next.time+' · '+next.minutes+' мин'):null,team.archived?null:btn(next?'Открыть тренировку':'Запланировать',()=>trainingForm(team,view,next||null,refresh),'primary wide')]));
        body.append(dashboardHeading('Быстрые действия'),el('div',{class:'dashboard-actions'},[actionTile('Состав','classes',()=>go('roster')),actionTile('Тренировки','calendar',()=>go('trainings')),actionTile('Матчи','trophy',()=>go('matches')),actionTile('Аналитика','chart',()=>go('analytics')),team.archived?null:actionTile('Live-матч','quick',()=>openMatchCenter(team,refresh)),actionTile('Конспекты','journal',()=>openLibrary('coach'))]));
      }else if(selectedSection==='roster'){
        const active=view.players.filter(p=>!p.archived),arch=view.players.filter(p=>p.archived);
        const search=el('input',{type:'search',placeholder:'Найти игрока','aria-label':'Найти игрока'}),list=el('div',{class:'player-directory'});
        for(const player of active)list.append(el('button',{class:'player-directory-row',type:'button','data-name':(player.name+' '+(player.number??'')).toLocaleLowerCase('ru'),onclick:()=>playerCard(team,player,view,refresh)},[el('span',{class:'player-number',text:player.number??'—'}),el('span',{class:'player-directory-info'},[el('strong',{text:player.name}),el('small',{text:C.positions[player.position]})]),ui.icon('chevron')]));
        search.oninput=()=>{const q=search.value.trim().toLocaleLowerCase('ru');for(const row of list.children)row.hidden=!row.dataset.name.includes(q);};
        body.append(card('Состав · '+active.length,[team.archived?null:btn('+ Игрок',()=>playerForm(team,null,refresh),'primary wide'),
          team.archived?null:btn('Генератор команд',()=>openCoachTeams(team,active,closeSheet),'wide'),search,list,
          !active.length?p('Нет действующих игроков'):null,
          arch.length?el('details',{},[el('summary',{text:'Архив игроков ('+arch.length+')'}),...arch.map(player=>btn(label(player),()=>playerCard(team,player,view,refresh),'wide'))]):null]));
      }else if(selectedSection==='trainings'){
        body.append(card('Тестирования',[testList(team,view,refresh)]));
        body.append(card('Тренировки',[btn('Библиотека и конспекты',()=>openLibrary('coach'),'wide'),team.archived?null:btn('+ Тренировка',()=>trainingForm(team,view,null,refresh),'primary wide'),team.archived?null:btn('Из конспекта',()=>chooseTrainingPlan((plan,exercises)=>trainingForm(team,view,null,refresh,{...plan,exercises})),'wide')]));
        const upcoming=view.trainings.filter(t=>!t.held&&t.date>=todayIso()).sort(dateSort);
        const history=view.trainings.filter(t=>!upcoming.includes(t));
        for(const [title,list] of [['Расписание',upcoming],['История / не проведены',history]]){
          const nodes=list.map(t=>{
            const counts=Object.values(t.attendance);
            const alerts=C.trainingWarnings(t,view.players).length;
            return card(t.title,[p(fmtFull(t.date)+' · '+t.time+' · '+t.minutes+' мин · '+(t.held?'проведена':'не проведена')),
              p('План: '+(t.exercises.map(x=>x.name+' ('+x.minutes+' мин)').join(' · ')||'не заполнен')),
              p('Состав '+t.roster.length+' · явка '+counts.filter(x=>x!=='absent').length+' · нет отметки '+(t.roster.length-counts.length)),
              alerts?p('Совпадений с ограничениями: '+alerts):null,
              btn('Открыть план и посещаемость',()=>trainingForm(team,view,t,refresh),'wide'),
              btn('Удалить тренировку',()=>confirm('Удалить тренировку?','Будут удалены её план и посещаемость.',()=>C.removeEvent('coachTrainings',t.id),refresh),'wide')]);
          });
          body.append(card(title,[...nodes,!list.length?p('Нет записей'):null]));
        }
      }else if(selectedSection==='matches'){
        body.append(card('Матчи и соревнования',[team.archived?null:btn('Площадка и live-матч',()=>openMatchCenter(team,refresh),'primary wide'),team.archived?null:btn('+ Результат матча',()=>matchForm(team,view,null,refresh),'wide'),team.archived?null:btn('Импорт PDF VolleyPoint',()=>openVolleyImport(team,view,refresh),'wide')]));
        for(const m of view.matches){
          const s=C.matchScore(m);
          body.append(card(m.opponent+' · '+s.ours+':'+s.theirs,[p(fmtFull(m.date)+(m.competition?' · '+m.competition:'')),p(m.sets.map(x=>x.ours+':'+x.theirs).join(' / ')),p('Игроков в составе: '+m.roster.length),
            m.imported?btn('Импортированный протокол VolleyPoint',()=>openImportedReport(m,view),'primary wide'):m.detail?btn('Протокол матча · PDF / печать',()=>openMatchReport(m,ui.closeSheet),'primary wide'):btn('Состав, партии и статистика',()=>matchForm(team,view,m,refresh),'wide'),btn('Удалить матч',()=>confirm('Удалить матч?','Результат и статистика будут удалены.',()=>C.removeEvent('coachMatches',m.id),refresh),'wide')]));
        }
        if(!view.matches.length)body.append(p('Нет результатов матчей'));
      }else{
        body.append(card('Сезонная статистика',[p('Рейтинги по отдельным показателям, сравнение игроков, динамика и тренерские подсказки.'),btn('Открыть сезонную аналитику',()=>openSeasonAnalytics(view),'primary wide')]));
        const filter=select([['','Вся команда'],...view.players.map(p=>[p.id,label(p)])]),stats=el('div',{class:'coach-stack'});
        function draw(){
          const id=filter.value,chosen=id?view.matches.filter(m=>m.roster.includes(id)):view.matches;
          const won=chosen.filter(m=>{const s=C.matchScore(m);return s.ours>s.theirs;}).length;
          const lost=chosen.filter(m=>{const s=C.matchScore(m);return s.ours<s.theirs;}).length;
          stats.replaceChildren(p('Матчей: '+chosen.length+' · побед: '+won+' · поражений: '+lost+' · равный счёт: '+(chosen.length-won-lost)),
            metricTable(C.summarizeStats(chosen,id?[id]:null)));
          const attendanceRows=(id?view.players.filter(p=>p.id===id):view.players).map(player=>{
            const a=C.playerAttendance(player.id,view.trainings);
            return p(label(player)+' · '+format(a.pct)+(a.pct===null?'':'%')+' · явка '+(a.present+a.limited)+' · отсутствия '+a.absent+' · без отметки '+a.unknown);
          });
          stats.append(el('h3',{text:'Посещаемость'}),...attendanceRows);
          if(id)stats.append(el('h3',{text:'Динамика по матчам'}),...chosen.map(m=>p(fmtFull(m.date)+' · '+m.opponent+' · очки: '+format(m.stats[id]?.points))));
        }
        filter.onchange=draw;draw();body.append(card('Аналитика',[field('Игрок / команда',filter),stats,p('Суммируются только внесённые показатели. CSV содержат имя игрока и результаты, но не ограничения нагрузки.'),
          btn('CSV · матчи',()=>download(C.coachCsv(view),'volleyball-matches'),'wide'),btn('CSV · посещаемость',()=>download(C.attendanceCsv(view),'volleyball-attendance'),'wide')]));
      }
    }catch(e){if(seq===sequence)body.replaceChildren(p('Не удалось открыть режим тренера: '+e.message),btn('Повторить',refresh));}
  }
  await refresh();
}
