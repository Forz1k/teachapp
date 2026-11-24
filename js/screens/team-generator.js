import * as S from '../store.js';
import * as C from '../coach.js';
import * as H from '../health.js';
import * as M from '../model.js';
import * as ui from '../ui.js';
import {schoolCandidates,coachCandidates,generateTeams,swapPlayers} from '../team-generator.js';
const {el,openSheet,toast}=ui;
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
const p=text=>el('p',{text});
const field=(text,input)=>el('label',{class:'field'},[el('span',{text}),input]);
function select(rows,value){const n=el('select',{},rows.map(([v,text])=>el('option',{value:v,text})));if(value!=null)n.value=String(value);return n;}
export function openSchoolTeams(lessonId,onReturn){
  const lesson=S.state.lessons.find(l=>l.id===lessonId);
  if(!lesson)return toast('Урок недоступен');
  const title=S.state.classes.find(c=>c.id===lesson.classId)?.name||'Класс';
  const tags=lesson.activityIds??S.state.topics.find(t=>t.id===lesson.topicId)?.activityIds??[];
  openTeamGenerator({title,date:lesson.date,activities:S.activities(),initial:tags.length===1?tags[0]:'',onReturn,
    candidates:activityId=>{
      const current=S.state.lessons.find(l=>l.id===lessonId);
      if(!current)throw Error('Урок недоступен');
      return schoolCandidates({lesson:current,students:S.state.students,marks:S.state.marks,parts:S.state.participation,exemptions:S.state.exemptions,activities:S.activities(),restrictions:S.state.activityRestrictions,activityId});
    }});
}
export function openCoachTeams(team,players,onReturn){
  if(team.archived)return toast('Команда в архиве');
  openTeamGenerator({title:team.name,date:M.todayIso(),activities:H.catalog,initial:'volley',onReturn,coach:true,
    candidates:(activityId,date)=>coachCandidates(players,activityId,date)});
}
export function openTeamGenerator({title,date,activities,initial='',candidates,onReturn,coach=false}){
  const activity=select([['','Выберите нагрузку'],...activities.map(a=>[a.id,a.name])],initial);
  const day=el('input',{type:'date',value:date,max:M.todayIso()});day.disabled=!coach;
  const count=el('input',{type:'number',min:2,max:12,step:1,value:2});
  const mode=select([['random','Случайно'],['balanced','По уровню подготовки']],'random');
  const list=el('div',{class:'team-gen-list'}),output=el('div',{class:'team-gen-output'}),info=el('p',{role:'status','aria-live':'polite'});
  const picked=new Set(),ratings=new Map(),locks=new Map();let rows=[],teams=null,serial=0;
  const clear=()=>{teams=null;output.replaceChildren();};
  function reload(){
    clear();picked.clear();locks.clear();
    try{rows=activity.value?candidates(activity.value,day.value):[];for(const r of rows)if(r.confirmed&&!r.reason)picked.add(r.id);draw();}
    catch(e){rows=[];draw();info.textContent=e.message;}
  }
  function draw(){
    list.replaceChildren();
    info.textContent=activity.value?'Выбрано: '+picked.size+' · исключено по отметкам / ограничениям: '+rows.filter(r=>r.reason).length:'Сначала выберите вид нагрузки';
    for(const r of rows){
      const check=el('input',{type:'checkbox','aria-label':'Выбрать '+r.name});check.checked=picked.has(r.id);check.disabled=!!r.reason;
      check.onchange=()=>{if(check.checked)picked.add(r.id);else{picked.delete(r.id);locks.delete(r.id);}clear();draw();};
      const row=el('div',{class:'card-block team-gen-row'},[field(r.name,check)]);
      if(r.reason)row.append(p(r.reason));else if(!r.confirmed)row.append(p('Явку и возможность участия подтверждает преподаватель'));
      if(picked.has(r.id)){
        if(mode.value==='balanced'){
          const rating=select([['','Не задан'],...['1','2','3','4','5'].map(v=>[v,v])],ratings.get(r.id)??'');
          rating.onchange=()=>{ratings.set(r.id,rating.value?Number(rating.value):null);clear();};row.append(field('Уровень подготовки (1–5)',rating));
        }
        const k=Number(count.value),n=Number.isInteger(k)&&k>=2&&k<=12?k:0;
        const lock=select([['','Не закреплён'],...Array.from({length:n},(_,i)=>[String(i),'Команда '+(i+1)])],locks.get(r.id)??'');
        lock.onchange=()=>{if(lock.value==='')locks.delete(r.id);else locks.set(r.id,Number(lock.value));clear();};row.append(field('Закрепить игрока',lock));
      }
      list.append(row);
    }
  }
  function drawOutput(){
    output.replaceChildren();
    if(!teams)return;
    for(const [i,players] of teams.entries()){
      const total=players.reduce((s,r)=>s+(r.rating||0),0);
      output.append(el('section',{class:'card-block team-gen-row'},[el('h3',{text:'Команда '+(i+1)+' · '+players.length+' чел.'}),
        mode.value==='balanced'?p('Сумма уровней: '+total+' · средний: '+(total/players.length).toFixed(2)):null,
        ...players.map(r=>p(r.name+(r.lock!=null?' · закреплён':'')))]));
    }
    const options=[['','Выберите игрока'],...teams.flatMap((t,i)=>t.filter(r=>r.lock==null).map(r=>[r.id,'К'+(i+1)+' · '+r.name]))];
    const a=select(options,''),b=select(options,'');
    output.append(field('Обменять игрока',a),field('С игроком',b),btn('Поменять местами',()=>{
      try{teams=swapPlayers(teams,a.value,b.value);drawOutput();}catch(e){toast(e.message);}
    },'wide'));
    output.append(p('Распределение временное. Не меняет оценки, явку или основной состав. При закрытии черновик не сохраняется.'));
  }
  function generate(){
    try{
      // Проверяем ограничения и состав повторно перед генерацией.
      const latest=candidates(activity.value,day.value),byId=new Map(latest.map(r=>[r.id,r]));
      if([...picked].some(id=>!byId.has(id)||byId.get(id).reason)){reload();throw Error('Состав или ограничения изменились. Проверьте список заново');}
      const players=[...picked].map(id=>({...byId.get(id),rating:ratings.get(id)??null,lock:locks.get(id)??null}));
      teams=generateTeams(players,Number(count.value),mode.value);drawOutput();
    }catch(e){clear();toast(e.message);}
  }
  activity.onchange=day.onchange=reload;
  count.onchange=()=>{locks.clear();clear();draw();};
  mode.onchange=()=>{clear();draw();};
  const content=el('div',{class:'team-generator'},[el('h2',{text:'Генератор команд · '+title}),p('Выберите конкретную нагрузку. Совпадения с внесёнными ограничениями исключаются. Это не медицинский допуск.'),
    field('Дата',day),field('Вид нагрузки',activity),field('Количество команд',count),field('Распределение',mode),
    p('Уровень 1–5 задаётся вручную только для этого распределения. Школьные оценки не используются.'),
    btn('Выбрать всех с подтверждённой явкой',()=>{for(const r of rows)if(r.confirmed&&!r.reason)picked.add(r.id);clear();draw();},'wide'),
    btn('Снять выбор',()=>{picked.clear();locks.clear();clear();draw();},'wide'),info,list,
    btn('Сформировать команды / перемешать',generate,'primary wide'),output,
    btn('Назад',onReturn||ui.closeSheet,'wide')]);
  reload();openSheet(content);
}
