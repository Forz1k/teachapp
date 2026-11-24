import * as T from '../tournaments.js';
import * as W from '../workbench.js';
import * as S from '../store.js';
import * as C from '../coach.js';
import {fmtFull} from '../model.js';
import {el,openSheet,closeSheet,toast,confirmDialog,downloadBlob} from '../ui.js';
const p=text=>el('p',{text});
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]);
const inp=(value='',type='text',props={})=>el('input',{type,value,...props});
const select=(opts,value)=>{const n=el('select',{},opts.map(([v,text])=>el('option',{value:v,text})));n.value=value??opts[0]?.[0]??'';return n;};
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const stack=children=>el('div',{class:'coach-form'},children);
const value=n=>n.value.trim()===''?null:Number(n.value);
const label=(t,id)=>t.teams.find(x=>x.id===id)?.name||'Участник определится';
function exportCsv(t,type){downloadBlob(new Blob([T.tournamentCsv(t,type)],{type:'text/csv;charset=utf-8'}),'tournament-'+type+'.csv');}
async function newTournament(back){
 const name=inp(''),system=select(Object.entries(T.systems),'league'),format=select(Object.entries(T.formats),'volleyball'),best=select([['1','До одной победы'],['3','До двух побед'],['5','До трёх побед']],'3'),target=inp(25,'number',{min:2,max:99}),decider=inp(15,'number',{min:2,max:99}),names=el('textarea',{rows:8,placeholder:'Команда 1\nКоманда 2'});
 const settings=el('div',{class:'coach-stack'},[field('Формат матча',best),field('Очков в обычной партии',target),field('Очков в решающей партии',decider)]);
 format.onchange=()=>settings.hidden=format.value!=='volleyball';
 const addNames=values=>{const old=names.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);names.value=[...new Set([...old,...values])].join('\n');};
 const save=btn('Создать турнир',async()=>{save.disabled=true;try{const namesList=names.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const t=await T.createTournament({name:name.value,system:system.value,format:format.value,bestOf:Number(best.value),target:value(target),decider:value(decider),names:namesList});await showTournament(t,back);}catch(e){toast(e.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:'Новое соревнование'}),field('Название',name),field('Система',system),field('Вид счёта',format),settings,p('Порядок участников используется как посев в сетке. Можно указать школьные классы, клубы или свои команды.'),field('Участники, каждый с новой строки',names),btn('Добавить школьные классы',()=>addNames(S.state.classes.filter(c=>!c.isDemo).map(c=>c.name))),btn('Добавить тренерские команды',async()=>{try{addNames((await C.loadCoach()).coachTeams.filter(t=>!t.archived).map(t=>t.name));}catch(e){toast(e.message);}}),save,btn('Назад',back)]));
}
function gameForm(t,g,back){
 const date=inp(g.date,'date'),time=inp(g.time,'time'),venue=inp(g.venue),status=p('');
 const scores=el('div',{class:'coach-stack'}),has=el('input',{type:'checkbox'});has.checked=!!g.result;
 const a=inp(g.result?.a??'','number',{min:0,max:999,step:1}),b=inp(g.result?.b??'','number',{min:0,max:999,step:1});
 let sets=(g.result?.sets.length?g.result.sets:[{a:null,b:null}]).map(x=>({...x}));
 function draw(){
  scores.replaceChildren();if(!has.checked)return;
  if(t.format==='score'){scores.append(field(label(t,g.a),a),field(label(t,g.b),b));return;}
  for(const [i,s] of sets.entries()){const x=inp(s.a??'','number',{min:0,max:999,step:1}),y=inp(s.b??'','number',{min:0,max:999,step:1});x.oninput=()=>s.a=value(x);y.oninput=()=>s.b=value(y);scores.append(card('Партия '+(i+1),[el('div',{class:'coach-columns'},[field(label(t,g.a),x),field(label(t,g.b),y)]),btn('Убрать партию',()=>{sets.splice(i,1);draw();})]));}
  scores.append(btn('+ Партия',()=>{if(sets.length<t.bestOf){sets.push({a:null,b:null});draw();}else toast('Достигнут максимум партий');}));
 }
 has.onchange=draw;draw();
 const save=btn('Сохранить игру',async()=>{save.disabled=true;try{const result=has.checked?T.resultOf(t,g,t.format==='score'?{a:value(a),b:value(b)}:{sets}):null;
  if(g.result&&!result&&!await confirmDialog({title:'Удалить результат?',text:'Результат этой игры будет очищен. Если от неё зависят уже сыгранные матчи, изменение будет отклонено.',ok:'Очистить',danger:true}))return;
  const next=await T.saveGame(t.id,t.revision,g.id,{date:date.value,time:time.value,venue:venue.value.trim(),result});await back(next);
 }catch(e){status.textContent=e.message;toast(e.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:label(t,g.a)+' — '+label(t,g.b)}),field('Дата',date),field('Время',time),field('Место',venue),g.ready?field('Внести завершённый результат',has):p('Сначала определите участников предыдущих игр. Расписание можно задать заранее.'),scores,status,save,btn('Назад',()=>back(t))]));
}
async function showTournament(t,back){
 const games=T.gamesOf(t),rounds=[...new Set(games.map(g=>g.round))],choose=select([['all','Все раунды'],...rounds.map(r=>[String(r),'Раунд '+r])],String(rounds.find(r=>games.some(g=>g.round===r&&!g.bye&&!g.result))||rounds[0])),pending=el('input',{type:'checkbox'}),body=el('div',{class:'coach-stack'});
 const champ=T.tournamentChampion(t);
 function draw(){body.replaceChildren();let round=0;for(const g of games){if(choose.value!=='all'&&String(g.round)!==choose.value||pending.checked&&(g.bye||g.result))continue;if(round!==g.round){round=g.round;body.append(el('h3',{text:'Раунд '+round}));}
  const name=g.bye?(label(t,g.winner)+' · проходит автоматически'):label(t,g.a)+' — '+label(t,g.b);
  body.append(card(name,[p(g.result?g.result.a+':'+g.result.b+(g.result.sets.length?' · '+g.result.sets.map(s=>s.a+':'+s.b).join(' / '):''):g.bye?'Пропуск раунда':g.ready?'Ожидает игры':'Ожидает участников'),p([g.date?fmtFull(g.date):'Дата не задана',g.time,g.venue].filter(Boolean).join(' · ')),!g.bye?btn('Расписание / результат',()=>gameForm(t,g,next=>showTournament(next,back))):null]));
 }if(!body.children.length)body.append(p('Нет игр по фильтру.'));}
 choose.onchange=pending.onchange=draw;draw();
 const summary=t.system==='league'?card('Турнирная таблица',[p('3 очка за победу, 1 за ничью; в волейболе победа в решающей партии — 2/1. При равенстве: победы, разница счёта, разница мячей; полное равенство — общее место.'),...T.standings(t).map(r=>p(r.place+'. '+r.name+' · '+r.points+' очк. · И '+r.played+' / В '+r.won+' / Н '+r.draw+' / П '+r.lost+' · '+r.for+':'+r.against)),btn('Экспорт таблицы CSV',()=>exportCsv(t,'standings'))]):card('Сетка на выбывание',[p(champ?'Победитель: '+champ.name:'Победители автоматически переходят в следующий раунд. Изменение уже сыгранной зависимой игры требует сначала очистить её результат.')]);
 openSheet(stack([el('h2',{text:t.name}),p(T.systems[t.system]+' · '+T.formats[t.format]+' · '+t.teams.length+' команд'),p('Сыграно '+games.filter(g=>g.result).length+' из '+games.filter(g=>!g.bye).length+' игр. Турнирные результаты не меняют личную статистику спортсменок.'),summary,field('Раунд',choose),field('Только незавершённые',pending),body,btn('Экспорт игр CSV',()=>exportCsv(t,'games')),btn('Назад',back)]));
}
export async function openTournaments(){
 async function draw(){try{const list=await W.listWork('tournament');openSheet(stack([el('h2',{text:'Соревнования'}),p('Круговые турниры и сетки на выбывание, расписание игр и результаты. Назначенные игры видны в рабочем календаре.'),btn('+ Создать соревнование',()=>newTournament(draw),'primary'),...list.map(t=>card(t.name,[p(T.systems[t.system]+' · '+t.teams.length+' команд'),btn('Открыть',()=>showTournament(t,draw)),btn('Удалить турнир',async()=>{if(!await confirmDialog({title:'Удалить турнир?',text:'Все игры и результаты этого турнира будут удалены.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(t.id,'tournament');await draw();}catch(e){toast(e.message);}})])),!list.length?p('Турниров пока нет.'):null,btn('Закрыть',closeSheet)]));}catch(e){toast(e.message);}}
 await draw();
}
