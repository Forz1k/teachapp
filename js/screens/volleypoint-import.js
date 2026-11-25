import {extractVolleyPdf} from '../volleypoint-pdf.js';
import {parseVolleyRows,suggestPlayer,buildVolleyImport,duplicateVolleyMatch} from '../volleypoint-import.js';
import {saveVolleyImport,enrichVolleyImport,loadCoach} from '../coach.js';
import {volleyPlayerTime,volleyTimeLabel,sameVolleyEvidence} from '../volleypoint-time.js';
import {courtTimeLabel} from '../court-time.js';
import {el,openSheet,closeSheet,toast} from '../ui.js';
const p=text=>el('p',{text});
const button=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const label=(text,node)=>el('label',{class:'field'},[el('span',{text}),node]);
const select=(options,value='')=>{const node=el('select',{},options.map(([value,text])=>el('option',{value,text})));node.value=value;return node;};
export function openVolleyImport(team,view,refresh,{matchId=null}={}){
 const file=el('input',{type:'file',accept:'.pdf,application/pdf','aria-label':'PDF VolleyPoint'});
 const status=el('div',{role:'status'}),preview=el('div',{class:'coach-stack'});
 let generation=0;
 file.onchange=async()=>{
  const g=++generation;preview.replaceChildren();status.textContent='Читаем PDF локально…';
  try{
   const f=file.files?.[0];if(!f){status.textContent='';return;}if(f.size>8*1024*1024)throw Error('PDF больше 8 МБ');
   const report=parseVolleyRows(await extractVolleyPdf(new Uint8Array(await f.arrayBuffer())));if(g!==generation)return;
   const data=await loadCoach();if(g!==generation)return;
   const matches=data.coachMatches.filter(m=>m.teamId===team.id&&m.imported?.hash===report.hash),players=data.coachPlayers.filter(p=>p.teamId===team.id);
   if(matches.length>1)throw Error('Неоднозначный исходный импорт');const existing=matches[0];
   if(matchId&&existing?.id!==matchId)throw Error('Выберите исходный PDF именно этого матча');
   status.textContent='Прочитано: '+report.sets.length+' партий · '+report.rallies.length+' розыгрышей. Счёт проверен по журналу.'+(existing?' Найден сохранённый матч.':'');
   const choose=select([['','Выберите нашу команду'],...report.teams.map((t,i)=>[String(i),t.name])]);
   const fields=el('div',{class:'coach-stack'});
   preview.replaceChildren(p(report.date+' · '+report.teams.map(t=>t.name).join(' — ')),p(report.sets.map(s=>s.join(':')).join(' / ')),p('Время матча по PDF: '+courtTimeLabel(report.timing.matchSeconds===null?null:report.timing.matchSeconds*1000)+' · партии: '+report.timing.sets.map(s=>courtTimeLabel(s.seconds*1000)).join(' / ')),...(existing?[p('Повторный импорт дополнит сохранённый матч '+existing.opponent+' от '+existing.date+'. Его ID, дата, соперник, счёт и статистика не изменятся.')]:[]),p('Отпечаток из отчёта используется для поиска дублей, но не является проверкой подлинности PDF.'),label('Какая команда наша?',choose),fields);
   choose.onchange=()=>{
    fields.replaceChildren();if(!choose.value)return;
    const side=Number(choose.value),source=report.teams[side];
    const date=el('input',{type:'date',value:existing?.date??report.date,disabled:!!existing}),opponent=el('input',{value:existing?.opponent??report.teams[1-side].name,maxlength:200,disabled:!!existing}),competition=el('input',{value:existing?.competition??report.competition,maxlength:200,disabled:!!existing});
    const rows=source.players.map((player,i)=>{
     const picker=select([['','Не сопоставлен'],...players.map(x=>[x.id,(x.number==null?'':'№'+x.number+' · ')+x.name+(x.archived?' (архив)':'')])],existing?.roster[i]??suggestPlayer(player,players));
     return {player,picker};
    });
    const confirm=el('input',{type:'checkbox'}),timingPreview=el('div',{class:'coach-stack','aria-label':'Предварительный расчёт времени'});
    const makeRecord=()=>({...buildVolleyImport(report,side,Object.fromEntries(rows.map(r=>[r.player.number,r.picker.value]))),teamId:team.id,date:date.value,opponent:opponent.value.trim(),competition:competition.value.trim()});
    const drawTiming=()=>{timingPreview.replaceChildren(el('h3',{text:'Время по PDF'}));try{const record=makeRecord();const t=record.imported.timing;timingPreview.append(p('Партии с распознанными составами: '+t.sets.filter(s=>s.lineup).length+'/'+t.sets.length+' · с распознанными заменами: '+t.sets.filter(s=>s.changes!==null).length+'/'+t.sets.length),...rows.map(r=>{const v=volleyPlayerTime(record,r.picker.value);return p('№'+r.player.number+' '+r.player.name+' · '+volleyTimeLabel(v)+(v?' · '+v.knownSets+'/'+v.sets.length+' партий':''));}));}catch{timingPreview.append(p('Сопоставьте весь состав для расчёта.'));}timingPreview.append(p('Полная партия — длительность из PDF, возможно включая паузы. Для замен без точного времени показан диапазон; если состав или раздел замен неполный, замер не выводится.'));};
    const save=button(existing?'Дополнить существующий матч':'Импортировать матч',async()=>{
     if(g!==generation)return;save.disabled=true;file.disabled=true;
     try{
      if(!confirm.checked)throw Error('Подтвердите сопоставления и данные');
      if(new Set(rows.map(r=>r.picker.value)).size!==rows.length)throw Error('Нельзя сопоставить двух игроков с одной карточкой');
      const record=makeRecord();
      if(existing)await enrichVolleyImport(record,{confirmed:true});else{if(duplicateVolleyMatch((await loadCoach()).coachMatches,record))throw Error('Такой матч уже есть в истории');await saveVolleyImport(record);}
      closeSheet();toast(existing?'Существующий матч дополнен без дубля':'Матч импортирован');await refresh();
     }catch(e){status.textContent=e.message;toast(e.message);}finally{save.disabled=false;file.disabled=false;}
    },'primary');
    fields.append(label('Дата',date),label('Соперник',opponent),label('Соревнование',competition),el('h3',{text:'Сопоставьте игроков'}),p('Совпадение имени и номера предлагается автоматически. При смене номера выберите карточку вручную; отсутствующих игроков сначала добавьте в состав. В заявке могут быть игроки, которые не выходили на площадку.'));
    for(const r of rows){const x=r.player;fields.append(label('№'+x.number+' '+x.name+' · очки '+(x.attackKills+x.blocks+x.aces)+' · ошибки '+x.errors,r.picker));r.picker.onchange=()=>{confirm.checked=false;drawTiming();};}
    for(const input of [date,opponent,competition])input.oninput=()=>{confirm.checked=false;};
    fields.append(timingPreview,label(existing?'Подтверждаю прежние сопоставления и дополнение матча':'Подтверждаю данные и все сопоставления',confirm),save);drawTiming();
   };
   if(existing){const sides=report.teams.map((_,i)=>i).filter(i=>sameVolleyEvidence(report.sets.map(s=>({ours:s[i],theirs:s[1-i]})),existing.sets));if(sides.length!==1)throw Error('Счёт исходного PDF не соответствует сохранённому матчу');choose.value=String(sides[0]);choose.disabled=true;choose.onchange();}
  }catch(e){if(g===generation)status.textContent=e.message;}
 };
 openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Импорт PDF VolleyPoint'}),p('Файл разбирается на устройстве; ничего не отправляется в интернет. Поддерживаются текстовые отчёты проверенного формата, не сканы.'),file,status,preview,button('Закрыть',closeSheet)]));
}
export function openImportedReport(m,view,onEnrich=null){
 const v=m.imported,player=id=>view.players.find(p=>p.id===id)?.name||'Игрок';
 const reasons={attackKills:'Атака',blocks:'Блок',aces:'Эйс',serveErrors:'Ошибка подачи',attackErrors:'Ошибка атаки',receiveErrors:'Ошибка приёма',otherErrors:'Другая ошибка',unknown:'Другое'};
 const body=el('div',{class:'coach-form'},[el('h2',{text:'Протокол VolleyPoint · '+m.opponent}),p(m.date+' · '+m.sets.map(s=>s.ours+':'+s.theirs).join(' / ')),p('Исторический импорт. Журнал очков сохранён без имитации live-матча. Длительность по PDF не является чистым измеренным временем.')]);
 const timing=v.timing;
 const summary=el('section',{class:'card-block coach-card'},[el('h3',{text:'Игровое время по PDF'}),timing?p('Матч: '+courtTimeLabel(timing.matchSeconds===null?null:timing.matchSeconds*1000)+' · сумма партий: '+courtTimeLabel(timing.sets.reduce((n,s)=>n+s.seconds*1000,0))):p('В старом импорте нет данных времени. Выберите исходный PDF, чтобы дополнить матч без дубля.'),...(timing?.sets.map((s,i)=>el('details',{},[el('summary',{text:'Партия '+(i+1)+' · '+courtTimeLabel(s.seconds*1000)}),p('Старт: '+(s.lineup?s.lineup.map((id,j)=>'P'+(j+1)+' '+player(id)).join(' · '):'не распознан')),p('Замены: '+(s.changes===null?'нет надёжных данных':s.changes.length)),...(s.changes||[]).map(x=>p('P'+x.zone+' · '+player(x.out)+' → '+player(x.in)+(x.kind==='libero'?' · либеро':''))),p('Тайм-ауты: '+(s.timeouts===null?'нет данных':s.timeouts.length+' · '+courtTimeLabel(s.timeouts.reduce((n,t)=>n+t.seconds*1000,0)))),...(s.timeouts||[]).map(t=>p((t.side==='ours'?'Наши':'Соперник')+' · №'+t.number+' · '+courtTimeLabel(t.seconds*1000)))]))||[]),p('У неизменённого стартового игрока учитывается вся длительность партии. При замене без меток времени известен только диапазон. Тайм-ауты показаны отдельно: неизвестно, исключены ли они из длительности PDF.'),onEnrich?button('Дополнить из исходного PDF',onEnrich,'primary'):null]);body.append(summary);
 for(const id of m.roster){const s=m.stats[id],v2=v.players[id],t=volleyPlayerTime(m,id);body.append(el('section',{class:'card-block coach-card'},[el('h3',{text:player(id)}),p('Очки '+s.points+' · атаки '+s.attackKills+' · блоки '+s.blocks+' · эйсы '+s.aces),p('На площадке по PDF: '+volleyTimeLabel(t)+(t?' · '+t.knownSets+'/'+t.sets.length+' партий':'')),t?p(t.sets.map(s=>'П'+s.set+' '+volleyTimeLabel(s)+(s.kind==='changed'?' (диапазон)':'')).join(' · ')):null,p('Ошибки (итог отчёта): '+v2.errors+' · подача '+v2.serveErrors+' · атака '+v2.attackErrors+' · приём '+v2.receiveErrors+' · другие '+v2.otherErrors),p('Серии из отчёта: '+v2.serviceSeries.length+' · очков выиграно на подаче '+v2.serviceSeries.reduce((a,s)=>a+s.wins,0)),...v2.serviceSeries.map(s=>p('Партия '+s.set+' · серия '+s.wins+' · эйсы '+s.aces+' · ошибки '+s.errors))]));}
 const list=el('details',{},[el('summary',{text:'Журнал очков ('+v.rallies.length+')'})]);
 list.addEventListener('toggle',()=>{if(list.open&&list.children.length===1)for(const r of v.rallies)list.append(p('Партия '+r.set+' · '+r.ours+':'+r.theirs+' · '+(r.winner==='ours'?'Наши':'Соперник')+' · '+reasons[r.kind]+(r.playerId?' · '+player(r.playerId):'')));});
 body.append(list,button('Закрыть',closeSheet));openSheet(body);
}
