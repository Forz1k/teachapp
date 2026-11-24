import {extractVolleyPdf} from '../volleypoint-pdf.js';
import {parseVolleyRows,suggestPlayer,buildVolleyImport,duplicateVolleyMatch} from '../volleypoint-import.js';
import {saveVolleyImport,loadCoach} from '../coach.js';
import {el,openSheet,closeSheet,toast} from '../ui.js';
const p=text=>el('p',{text});
const button=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const label=(text,node)=>el('label',{class:'field'},[el('span',{text}),node]);
const select=(options,value='')=>{const node=el('select',{},options.map(([value,text])=>el('option',{value,text})));node.value=value;return node;};
export function openVolleyImport(team,view,refresh){
 const file=el('input',{type:'file',accept:'.pdf,application/pdf'});
 const status=el('div',{role:'status'}),preview=el('div',{class:'coach-stack'});
 let generation=0;
 file.onchange=async()=>{
  const g=++generation;preview.replaceChildren();status.textContent='Читаем PDF локально…';
  try{
   const f=file.files?.[0];if(!f){status.textContent='';return;}if(f.size>8*1024*1024)throw Error('PDF больше 8 МБ');
   const report=parseVolleyRows(await extractVolleyPdf(new Uint8Array(await f.arrayBuffer())));if(g!==generation)return;
   status.textContent='Прочитано: '+report.sets.length+' партий · '+report.rallies.length+' розыгрышей. Счёт проверен по журналу.';
   const choose=select([['','Выберите нашу команду'],...report.teams.map((t,i)=>[String(i),t.name])]);
   const fields=el('div',{class:'coach-stack'});
   preview.replaceChildren(p(report.date+' · '+report.teams.map(t=>t.name).join(' — ')),p(report.sets.map(s=>s.join(':')).join(' / ')),p('Отпечаток из отчёта используется для поиска дублей, но не является проверкой подлинности PDF.'),label('Какая команда наша?',choose),fields);
   choose.onchange=()=>{
    fields.replaceChildren();if(!choose.value)return;
    const side=Number(choose.value),source=report.teams[side];
    const date=el('input',{type:'date',value:report.date}),opponent=el('input',{value:report.teams[1-side].name,maxlength:200}),competition=el('input',{value:report.competition,maxlength:200});
    const rows=source.players.map(player=>{
     const picker=select([['','Не сопоставлен'],...view.players.map(x=>[x.id,(x.number==null?'':'№'+x.number+' · ')+x.name+(x.archived?' (архив)':'')])],suggestPlayer(player,view.players));
     return {player,picker};
    });
    const confirm=el('input',{type:'checkbox'});
    const save=button('Импортировать матч',async()=>{
     save.disabled=true;
     try{
      if(!confirm.checked)throw Error('Подтвердите сопоставления и данные');
      if(new Set(rows.map(r=>r.picker.value)).size!==rows.length)throw Error('Нельзя сопоставить двух игроков с одной карточкой');
      const mapping=Object.fromEntries(rows.map(r=>[r.player.number,r.picker.value]));
      const record={...buildVolleyImport(report,side,mapping),teamId:team.id,date:date.value,opponent:opponent.value.trim(),competition:competition.value.trim()};
      if(duplicateVolleyMatch((await loadCoach()).coachMatches,record))throw Error('Такой матч уже есть в истории');
      await saveVolleyImport(record);closeSheet();toast('Матч импортирован');await refresh();
     }catch(e){status.textContent=e.message;toast(e.message);}finally{save.disabled=false;}
    },'primary');
    fields.append(label('Дата',date),label('Соперник',opponent),label('Соревнование',competition),el('h3',{text:'Сопоставьте игроков'}),p('Совпадение имени и номера предлагается автоматически. При смене номера выберите карточку вручную; отсутствующих игроков сначала добавьте в состав. В заявке могут быть игроки, которые не выходили на площадку.'));
    for(const r of rows){const x=r.player;fields.append(label('№'+x.number+' '+x.name+' · очки '+(x.attackKills+x.blocks+x.aces)+' · ошибки '+x.errors,r.picker));r.picker.onchange=()=>{confirm.checked=false;};}
    for(const input of [date,opponent,competition])input.oninput=()=>{confirm.checked=false;};
    fields.append(label('Подтверждаю данные и все сопоставления',confirm),save);
   };
  }catch(e){if(g===generation)status.textContent=e.message;}
 };
 openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Импорт PDF VolleyPoint'}),p('Файл разбирается на устройстве; ничего не отправляется в интернет. Поддерживаются текстовые отчёты проверенного формата, не сканы.'),file,status,preview,button('Закрыть',closeSheet)]));
}
export function openImportedReport(m,view){
 const v=m.imported,player=id=>view.players.find(p=>p.id===id)?.name||'Игрок';
 const reasons={attackKills:'Атака',blocks:'Блок',aces:'Эйс',serveErrors:'Ошибка подачи',attackErrors:'Ошибка атаки',receiveErrors:'Ошибка приёма',otherErrors:'Другая ошибка',unknown:'Другое'};
 const body=el('div',{class:'coach-form'},[el('h2',{text:'Протокол VolleyPoint · '+m.opponent}),p(m.date+' · '+m.sets.map(s=>s.ours+':'+s.theirs).join(' / ')),p('Исторический импорт. Расстановки и все попытки не восстановлены; журнал очков сохранён без имитации live-матча.')]);
 for(const id of m.roster){const s=m.stats[id],v2=v.players[id];body.append(el('section',{class:'card-block coach-card'},[el('h3',{text:player(id)}),p('Очки '+s.points+' · атаки '+s.attackKills+' · блоки '+s.blocks+' · эйсы '+s.aces),p('Ошибки (итог отчёта): '+v2.errors+' · подача '+v2.serveErrors+' · атака '+v2.attackErrors+' · приём '+v2.receiveErrors+' · другие '+v2.otherErrors),p('Серии из отчёта: '+v2.serviceSeries.length+' · очков выиграно на подаче '+v2.serviceSeries.reduce((a,s)=>a+s.wins,0)),...v2.serviceSeries.map(s=>p('Партия '+s.set+' · серия '+s.wins+' · эйсы '+s.aces+' · ошибки '+s.errors))]));}
 const list=el('details',{},[el('summary',{text:'Журнал очков ('+v.rallies.length+')'})]);
 list.addEventListener('toggle',()=>{if(list.open&&list.children.length===1)for(const r of v.rallies)list.append(p('Партия '+r.set+' · '+r.ours+':'+r.theirs+' · '+(r.winner==='ours'?'Наши':'Соперник')+' · '+reasons[r.kind]+(r.playerId?' · '+player(r.playerId):'')));});
 body.append(list,button('Закрыть',closeSheet));openSheet(body);
}
