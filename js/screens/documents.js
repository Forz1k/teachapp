import * as S from '../store.js';
import * as C from '../coach.js';
import * as A from '../analytics.js';
import * as M from '../model.js';
import * as W from '../workbench.js';
import * as T from '../tournaments.js';
import {testHistory,summarizeTests} from '../coach-tests.js';
import {documentTypes,buildDocument,makeDocx,documentWorkbook,documentColumnWidths} from '../documents.js';
import {el,openSheet,closeSheet,toast,confirmDialog,downloadBlob} from '../ui.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const input=(value='',type='text',props={})=>el('input',{type,value,...props});
const area=(value='')=>el('textarea',{rows:3,maxlength:4000},[value]);
const field=(name,n)=>el('label',{class:'field'},[el('span',{text:name}),n]);
const select=(rows,value)=>{const n=el('select',{},rows.map(([value,text])=>el('option',{value,text})));n.value=value??rows[0]?.[0]??'';return n;};
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const stack=children=>el('div',{class:'coach-form'},children);
const val=v=>v==null?'—':String(v);
function reportView(report){
 return el('article',{class:'document-preview'},[el('h1',{text:report.title}),...report.sections.map(s=>el('section',{},[el('h2',{text:s.heading}),...s.paragraphs.map(p),s.matrix?el('div',{class:'document-table'},[el('table',{},[el('colgroup',{},documentColumnWidths(s.matrix).map(w=>el('col',{style:'width:'+w/100+'%'}))),el('thead',{},[el('tr',{},s.matrix[0].map(v=>el('th',{text:val(v)})))]),el('tbody',{},s.matrix.slice(1).map(row=>el('tr',{},row.map(v=>el('td',{text:val(v)})))))])]):null]))]);
}
function printReport(report){
 document.getElementById('teachapp-print-report')?.remove();const node=el('div',{id:'teachapp-print-report'},[reportView(report)]);document.body.append(node);
 const clean=()=>node.remove();window.addEventListener('afterprint',clean,{once:true});try{window.print();}catch{clean();toast('Печать недоступна');}
}
export function openDocumentPreview(report,back=closeSheet){
 async function exportFile(type){
  try{
   if(report.personal&&!await confirmDialog({title:'Документ содержит персональные данные',text:'Проверьте получателя, состав данных и основание передачи. Файл не зашифрован.',ok:'Продолжить'}))return;
   if(type==='pdf'){printReport(report);return;}
   const mime=type==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',data=type==='docx'?makeDocx(report):documentWorkbook(report,window.XLSX);
   downloadBlob(new Blob([data],{type:mime}),'teachapp-document-'+M.todayIso()+'.'+type);toast('Проверьте файл в загрузках');
  }catch(e){toast(e.message);}
 }
 openSheet(stack([el('h2',{text:'Предпросмотр документа'}),p('Редактируемые шаблоны TeachApp. Перед сдачей проверьте требования своей организации; это не утверждённый официальный бланк.'),report.personal?p('Содержит персональные данные. Не передавайте без основания.'):null,btn('Word (.docx)',()=>exportFile('docx'),'primary'),btn('Excel (.xlsx)',()=>exportFile('xlsx')),btn('Печать / сохранить PDF',()=>exportFile('pdf')),reportView(report),btn('Назад',back)]),{fullHeight:true});
}
export async function openDocuments(defaultType='lesson'){
 try{
  if(!Object.hasOwn(documentTypes,defaultType))defaultType='lesson';
  const [plans,coach,tournaments]=await Promise.all([W.listWork('plan'),C.loadCoach(),W.listWork('tournament')]);
  const type=select(Object.entries(documentTypes),defaultType),title=input(documentTypes[defaultType]),organization=input(),author=input(),date=input(M.todayIso(),'date'),venue=input(),audience=input(),additional=area(),rules=area(),conclusion=area(),signature=el('input',{type:'checkbox'});signature.checked=true;
  const cls=select(S.state.classes.map(c=>[c.id,c.name]),S.state.currentClassId),period=select(S.state.settings.trimesters.map(t=>[t.id,M.fmtFull(t.from)+' — '+M.fmtFull(t.to)]),S.currentTrimester()?.id),plan=select([]),team=select(coach.coachTeams.map(t=>[t.id,t.name])),player=select([]),tournament=select(tournaments.map(t=>[t.id,t.name])),from=input(S.state.settings.year.from,'date'),to=input(M.todayIso(),'date'),specific=el('div',{class:'coach-stack'}),roster=el('div',{class:'coach-stack'});
  let selectedPlayers=new Set();
  function updateRoster(){const players=coach.coachPlayers.filter(p=>p.teamId===team.value&&!p.archived);player.replaceChildren(...players.map(p=>el('option',{value:p.id,text:p.name})));selectedPlayers=new Set();roster.replaceChildren(...players.map(p=>{const n=el('input',{type:'checkbox'});n.onchange=()=>{if(n.checked)selectedPlayers.add(p.id);else selectedPlayers.delete(p.id);};return field(p.name,n);}));}
  function draw(){specific.replaceChildren();const k=type.value;
   if(['lesson','training','event'].includes(k)){const list=plans.filter(p=>k==='event'||p.context===(k==='training'?'coach':'school'));plan.replaceChildren(...list.map(p=>el('option',{value:p.id,text:p.name})));specific.append(field('Конспект-основа',plan),field('Дополнение к цели / организации',additional),k==='event'?field('Правила и организационные условия',rules):el('span',{text:''}));}
   else if(['classReport','ktp','norms'].includes(k))specific.append(field('Класс',cls),field('Учебный период',period));
   else if(k==='tournament')specific.append(field('Соревнование',tournament));
   else{updateRoster();specific.append(field('Команда',team));if(k==='registration')specific.append(p('Отметьте только необходимых участников.'),roster,field('Дополнительные сведения',additional));else{if(k==='playerReport')specific.append(field('Игрок',player));specific.append(el('div',{class:'coach-columns'},[field('С',from),field('По',to)]));}}
  }
  type.onchange=()=>{title.value=documentTypes[type.value];draw();};team.onchange=updateRoster;draw();
  function build(){
   const k=type.value,base={title:title.value,organization:organization.value,author:author.value,date:date.value,venue:venue.value,audience:audience.value,additional:additional.value,rules:rules.value,conclusion:conclusion.value,signatures:signature.checked};
   if(['lesson','training','event'].includes(k))base.plan=plans.find(p=>p.id===plan.value);
   else if(['classReport','ktp','norms'].includes(k)){
    const t=S.state.settings.trimesters.find(t=>t.id===period.value),c=S.state.classes.find(c=>c.id===cls.value);if(!t||!c)throw Error('Выберите класс и период');
    base.className=c.name;base.period=M.fmtFull(t.from)+' — '+M.fmtFull(t.to);base.matrix=A.reportMatrix(k==='classReport'?'class':k,A.schoolAnalytics(c.id,t.from,t.to));
   }else if(k==='tournament'){
    const t=tournaments.find(t=>t.id===tournament.value);if(!t)throw Error('Выберите соревнование');
    const label=id=>t.teams.find(x=>x.id===id)?.name||'Участник определится';
    base.tournamentName=t.name;base.systemLabel=T.systems[t.system];base.games=[['Раунд','Дата','Команда А','Команда Б','Счёт','Партии'],...T.gamesOf(t).filter(g=>!g.bye).map(g=>[g.round,g.date,label(g.a),label(g.b),g.result?g.result.a+':'+g.result.b:'—',g.result?.sets.map(s=>s.a+':'+s.b).join(' / ')||''])];
    if(t.system==='league')base.standings=[['Место','Команда','Игры','Победы','Ничьи','Поражения','Очки'],...T.standings(t).map(r=>[r.place,r.name,r.played,r.won,r.draw,r.lost,r.points])];
   }else{
    const t=coach.coachTeams.find(t=>t.id===team.value);if(!t)throw Error('Выберите команду');const view=C.teamView(coach,t.id);base.teamName=t.name;
    if(k==='registration')base.players=view.players.filter(p=>selectedPlayers.has(p.id)&&!p.archived).map(p=>({...p,positionLabel:C.positions[p.position]}));
    else{
     if(from.value&&to.value&&from.value>to.value)throw Error('Проверьте период');
     const range={from:from.value,to:to.value},inRange=m=>(!range.from||m.date>=range.from)&&(!range.to||m.date<=range.to);base.period=(from.value||'Весь архив')+' — '+(to.value||'Весь архив');
     const ms=view.matches.filter(inRange);
     if(k==='teamReport'){
      const wins=ms.filter(m=>{const x=C.matchScore(m);return x.ours>x.theirs;}).length;base.summary=['Матчей: '+ms.length,'Побед: '+wins,'Суммы только известных показателей; неполные протоколы не дают полного знаменателя попыток.'];
      base.matches=[['Дата','Соперник','Счёт по партиям','Очки игроков (записано)','Эйсы (записано)'],...ms.map(m=>{const x=C.matchScore(m),s=C.summarizeStats([m]).sums;return [m.date,m.opponent,x.ours+':'+x.theirs,s.points,s.aces];})];
     }else{
      const p=view.players.find(p=>p.id===player.value);if(!p)throw Error('Выберите спортсменку');base.playerName=p.name;const s=C.playerSeasonStats(ms,p.id,range);
      base.summary=['Матчей в заявке: '+s.rosterMatches,'Подробных матчей: '+s.detailedMatches,'Розыгрышей на площадке по подробным протоколам: '+s.rallies,'Очки: '+val(s.summary.sums.points)+' · эйсы: '+val(s.summary.sums.aces)+' · атаки: '+val(s.summary.sums.attackKills)+' · блоки: '+val(s.summary.sums.blocks),'Неизвестные сведения не считаются нулём.'];
      base.matches=[['Дата','Соперник','Очки','Эйсы','Атаки','Блоки'],...s.chosen.map(m=>[m.date,m.opponent,...['points','aces','attackKills','blocks'].map(k=>m.stats[p.id]?.[k]??null)])];
      base.tests=[['Методика','Успешность / последний замер','Объём'],...summarizeTests(testHistory(view.tests,p.id,range)).map(g=>[g.definition.name+' · '+g.definition.protocol,g.definition.kind==='skill'?g.pct==null?'—':Math.round(g.pct*10)/10+'%':val(g.last)+' '+g.definition.unit,g.definition.kind==='skill'?g.attempts+' попыток':g.measurements.length+' замеров'])];
     }
    }
   }
   return buildDocument(k,base);
  }
  const form=stack([el('h2',{text:'Генератор документов'}),p('Локальные Word, Excel и печать. Измените заголовок, реквизиты и выводы. Сведения об ограничениях и личные заметки автоматически не включаются.'),field('Шаблон',type),field('Заголовок',title),field('Организация',organization),field('Ответственный',author),field('Дата',date),field('Место',venue),field('Группа / участники',audience),specific,field('Выводы / примечания',conclusion),field('Добавить поля подписей',signature),btn('Предпросмотр',()=>{try{openDocumentPreview(build(),()=>openSheet(form));}catch(e){toast(e.message);}},'primary'),btn('Закрыть',closeSheet)]);
  openSheet(form);
 }catch(e){toast(e.message);}
}
