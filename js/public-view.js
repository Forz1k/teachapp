import {mediaTarget,fetchPublicMedia,newsTypes} from './public-media.js';
import {resolveArchiveRoute,routedArchivePage,routedArchiveRecord,resultLink,fixtureCalendar,archiveSeasons,archiveSeason,archiveSeasonBounds,filterArchiveSeason,searchArchive,mergeLoadedArchive,publicResultCard,archiveMatchSummary,opponentHistory} from './public-archive.js';
import {animateOnce,scoreChanges,enterGroup,normalizeMotion,motionModes,motionAllowed} from './motion.js';
import {viewerTarget,viewerPageLink,fixtureLink,fixtureState,scheduleSections,readPortal,portalState,countdown,fanResults,resultOutcome,resultSummary,publicMatchMoments,viewerFreshness,publicStatMetrics,publicStatRows} from './public-portal.js';
import {reasons,boardPalette} from './match-protocol.js';
import {paintStudio,canvasPng} from './media-studio.js';
const root=document.getElementById('portal'),connection=document.getElementById('connection'),nav=document.getElementById('portal-nav');
const el=(tag,cls,text,...children)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);n.append(...children.filter(Boolean));return n;};
const p=(t,c='muted')=>el('p',c,t),card=(...children)=>el('section','card',null,...children);
const format=(t,options)=>new Intl.DateTimeFormat('ru-RU',options).format(t);
const date=t=>format(t,{dateStyle:'long',timeStyle:'short'})+' · местное время';
const head=(title,detail='')=>el('div','section-head',null,el('h2','',title),detail?el('small','',detail):null);
let data=null,connected=false,awaitingSnapshot=true,received=false,problem='',lastMode='',lastStale=false,tab='overview',lastMatchId=null,lastPaintedMatch=null,lastPaintedTab=null;
let resultFilter='all',resultQuery='',resultLimit=40,primaryPage=false,lastStreakKey='',archiveRowsExtra=[],archiveCursor=null,archiveLoaded=false,archiveBusy=false,archiveMessage='',archiveAddress='',archiveRoute=null,directResult=null,directBusy=false,seasonFilter='all',archiveEpoch=0,archiveScope='all',archivePageEpoch=0,directError='',opponentFilter='';
let mediaAddress='',media=null,mediaBusy=false,mediaError='',mediaEpoch=0,reconnectViewer=null;
const statSort={ours:'points',theirs:'points'};
const tabs=[['overview','Матч'],['schedule','Расписание'],['results','Результаты'],['news','Новости'],['tournament','Турнир']];
function renderNav(){if(!nav)return;nav.hidden=!data;if(!data)return;if(!nav.childElementCount){for(const [key,label] of tabs){const b=el('button','',label);b.type='button';b.dataset.tab=key;b.onclick=()=>{tab=key;draw();if(['news','tournament'].includes(key))void loadMedia();};nav.append(b);}}for(const b of nav.children)b.setAttribute('aria-pressed',String(b.dataset.tab===tab));}
function scoreNode(match,side){const n=el('strong','team-score',match.status==='finished'?match.setsWon[side]:match.score[side]);n.dataset.scoreSide=side;return n;}
function teams(team,opponent,match,logos=match?.logos){
 const item=(name,side)=>{const icon=el('div','team-icon',name.slice(0,1).toUpperCase());if(logos?.[side]){const image=el('img');image.src=logos[side];image.alt='';image.width=96;image.height=96;icon.replaceChildren(image);}const n=el('div','team',null,icon,el('span','team-name',name),match?scoreNode(match,side):null,match&&match.status==='live'?p(match.serve===side?'● Подача':'Приём','serve-mark'+(match.serve===side?' active':'')):null);if(match)n.style.setProperty('--team-color',boardPalette[match.colors[side]].start);return n;};
 return el('div','teams',null,item(team,'ours'),el('span','vs',match?':':'VS'),item(opponent,'theirs'));
}
function sets(m){const item=(x,i,active=false)=>el('span',active?'current':'',null,el('small','',active?'Сейчас · '+i:'Партия '+i),el('strong','',x.ours+':'+x.theirs));return el('div','sets',null,...m.sets.map((x,i)=>item(x,i+1)),m.status==='live'?item(m.score,m.set,true):null);}
function statTable(rows,side,team){const a=publicStatRows(rows,side,statSort[side]);if(!a.length)return null;const sort=el('select','fan-stat-sort');sort.setAttribute('aria-label','Показатель игроков · '+team);for(const [k,label] of Object.entries(publicStatMetrics)){const option=el('option','',label);option.value=k;sort.append(option);}sort.value=statSort[side];const table=el('table','',null,el('thead','',null,el('tr','',null,...['№','Очки','Атаки*','Скидки','Эйсы','Блоки'].map(x=>el('th','',x)))),el('tbody'));const lead=p('','fan-stat-lead');function paint(){const sorted=publicStatRows(rows,side,statSort[side]),k=statSort[side],top=sorted[0][k];table.tBodies[0].replaceChildren(...sorted.map(x=>el('tr','',null,...[x.number,x.points,x.attack,x.tip,x.ace,x.block].map(v=>el('td','',v)))));lead.textContent=top>0?publicStatMetrics[k]+': '+top+' · '+sorted.filter(x=>x[k]===top).map(x=>'№'+x.number).join(', '):'Нет отмеченных действий по показателю.';}sort.onchange=()=>{statSort[side]=sort.value;paint();};paint();return card(head('Игроки · '+team),sort,lead,el('div','table-wrap',null,table),p('* Результативные атаки включают скидки. Только опубликованные номера и отмеченные действия; сумма личных очков не равна счёту команды.'));}
function scheduleRows(items){return items.map(x=>{
 const link=el('a','result-link',teamName()+' — '+x.opponent);link.href=fixtureLink(shareLink,x.id);
 return el('div','fixture',null,el('div','date-tile',null,el('strong','',format(x.startAt,{day:'numeric'})),el('small','',format(x.startAt,{month:'short'}))),el('div','',null,link,el('small','',date(x.startAt)),x.startAt<=Date.now()?p('Время прошло · начало или результат не опубликованы'):null,el('div','fixture-actions',null,calendarButton(x),shareFixture(x))));
 });}
function schedulePanel(){
 const groups=scheduleSections(data),current=data.match?.scheduledId&&['live','break'].includes(data.match.status)?data.match:null;
 const liveLink=current?el('a','archive-link','Открыть текущий матч · '+current.opponent):null;if(liveLink)liveLink.href=fixtureLink(shareLink,current.scheduledId);
 const sections=[['Сегодня',groups.today],['Предстоящие встречи',groups.future],['Прошедшие даты без результата',groups.past]];
 return card(head('Расписание'),liveLink,...sections.filter(([,rows])=>rows.length).flatMap(([label,rows])=>[el('h3','',label),...scheduleRows(rows)]),!current&&!sections.some(([,rows])=>rows.length)?p('Опубликованных встреч пока нет.'):null,p('Дата в прошлом не означает, что встреча состоялась. Счёт появляется только после публикации.'));
}
function glyph(kind){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','fan-glyph '+kind);const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',kind==='trophy'?'M7 3h10v5c0 4-2 6-5 6s-5-2-5-6V3ZM7 5H3v2c0 3 2 5 5 5m9-7h4v2c0 3-2 5-5 5M12 14v5m-5 2h10':'M12 2c2 5 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 0 3 1 4 2 4 2-3 1-5 1-8Z');svg.append(path);return svg;}
function teamName(){return primaryPage?'Гимназия №26':data?.team||'Команда';}
function matchLink(x){const a=el('a','result-link',teamName()+' — '+x.opponent);a.href=resultLink(shareLink,x);return a;}
function shareButton(url,title,label){
 const b=el('button','archive-link',label);b.type='button';b.onclick=async()=>{try{if(window.navigator.share){await window.navigator.share({title,url});return;}await window.navigator.clipboard.writeText(url);b.textContent='Ссылка скопирована';}catch(e){if(e.name==='AbortError')return;let input=b.nextElementSibling;if(!input?.classList.contains('share-fallback')){input=el('input','share-fallback');input.readOnly=true;input.setAttribute('aria-label','Ссылка матча');b.after(input);}input.value=url;input.focus();input.select();}};return b;
}
function shareMatch(x){return shareButton(resultLink(shareLink,x),teamName()+' — '+x.opponent,'Поделиться матчем');}
function shareFixture(x){return shareButton(fixtureLink(shareLink,x.scheduledId||x.id),teamName()+' — '+x.opponent,'Поделиться встречей');}
function resultDownload(row){
 // Snapshot of only the visible published result; no current player stats,
 // stored credentials or personal artwork. No download on a live score.
 const b=el('button','archive-link','Скачать карточку PNG');b.type='button';
 b.onclick=async()=>{
  if(b.disabled)return;b.disabled=true;const canvas=document.createElement('canvas');
  try{
   paintStudio(canvas,publicResultCard(teamName(),row));const blob=await canvasPng(canvas);
   // A stream update may revoke a result while rendering. Don't download from
   // a disconnected/replaced button or after the page is unpublished.
   if(!b.isConnected||!data)return;
   const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='teachapp-result.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
   b.textContent='Карточка подготовлена';
  }catch(e){b.textContent='Карточка недоступна';b.title=e.message;}
  finally{canvas.width=canvas.height=1;b.disabled=false;}
 };return b;
}
function calendarButton(x){const a=el('button','archive-link','В календарь');a.type='button';a.onclick=()=>{const u=URL.createObjectURL(new Blob([fixtureCalendar(teamName(),x)],{type:'text/calendar;charset=utf-8'})),l=document.createElement('a');l.href=u;l.download='teachapp-match.ics';l.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};return a;}
async function loadMoreArchive(refresh=false){if(archiveBusy||!data)return;const epoch=archivePageEpoch,scope=archiveScope;archiveBusy=true;archiveMessage='Загрузка…';draw();try{const route=await resolveArchiveRoute(archiveAddress,{previous:archiveRoute});if(epoch!==archivePageEpoch||!data)return;const changed=archiveRoute?.key!==route.key;if(changed){archiveRowsExtra=[];archiveCursor=null;archiveLoaded=false;}archiveRoute=route;const page=await routedArchivePage(route,{cursor:refresh||changed?null:archiveCursor,season:scope});if(epoch!==archivePageEpoch||!data)return;archiveRowsExtra=[...new Map([...(refresh||changed?[]:archiveRowsExtra),...page.rows].map(r=>[r.archiveKey,r])).values()];archiveCursor=page.cursor;archiveLoaded=true;archiveMessage=archiveCursor?'':scope==='all'?'Весь доступный архив загружен':'Все доступные записи выбранного сезона загружены';}catch(e){if(epoch===archivePageEpoch){archiveMessage=e.message;if(e.status===401||e.status===403){archiveRowsExtra=[];archiveCursor=null;archiveLoaded=false;}}}finally{if(epoch===archivePageEpoch){archiveBusy=false;draw();}}}
 function selectArchiveSeason(value){archiveSeasonBounds(value);seasonFilter=value;resultLimit=40;if(value!==archiveScope){archivePageEpoch++;archiveScope=value;archiveRowsExtra=[];archiveCursor=null;archiveLoaded=false;archiveBusy=false;archiveMessage='';}void loadMoreArchive(true);}
function resetArchive(){mediaEpoch++;media=null;mediaBusy=false;mediaError='';archiveEpoch++;archivePageEpoch++;archiveScope='all';seasonFilter='all';archiveRowsExtra=[];archiveCursor=null;archiveLoaded=false;archiveBusy=false;archiveMessage='';archiveRoute=null;directResult=null;directBusy=false;directError='';opponentFilter='';resultQuery='';resultLimit=40;}
async function loadDirectArchive(){const params=new URL(shareLink).searchParams,k=params.get('archive'),id=params.get('match');if((!k&&!id)||!data||directBusy)return;if(!k&&(data.match?.id===id||fanResults(data).some(x=>x.id===id)))return;const epoch=archiveEpoch;directBusy=true;directError='';draw();try{const route=await resolveArchiveRoute(archiveAddress,{previous:archiveRoute});if(epoch!==archiveEpoch||!data)return;const row=await routedArchiveRecord(route,{archiveKey:k,matchId:id});if(epoch===archiveEpoch&&data){archiveRoute=route;directResult=row;}}catch(e){if(epoch===archiveEpoch){directResult=null;directError=e.status===401||e.status===403?'Постоянный архив недоступен.':'Не удалось прочитать архивную запись.';}}finally{if(epoch===archiveEpoch){directBusy=false;draw();}}}
 function archiveControls(){
  const b=el('button','archive-link',archiveLoaded?'Загрузить ещё':'Загрузить расширенный архив');b.type='button';b.disabled=archiveBusy||archiveLoaded&&!archiveCursor;b.onclick=()=>void loadMoreArchive();
  const refresh=el('button','archive-link','Обновить архив');refresh.type='button';refresh.disabled=archiveBusy;refresh.onclick=()=>void loadMoreArchive(true);
  const year=el('input','archive-season-year');year.type='number';year.min='1970';year.max='9998';year.step='1';year.value=archiveScope==='all'?String(archiveSeason(Date.now())):archiveScope;year.setAttribute('aria-label','Год начала спортивного сезона');
  const go=el('button','archive-link','Загрузить сезон');go.type='button';go.onclick=()=>{try{selectArchiveSeason(year.value);}catch(e){archiveMessage=e.message;draw();}};
  const all=el('button','archive-link','Загрузить все сезоны');all.type='button';all.onclick=()=>selectArchiveSeason('all');
  return card(head('Постоянный архив',archiveScope==='all'?'Все сезоны':archiveScope+' / '+(Number(archiveScope)+1)),p('Укажите год начала сезона (сентябрь). Можно открыть старый сезон сразу, не загружая более новые матчи.'),el('div','archive-search-row',null,year,go),archiveScope!=='all'?all:null,b,archiveLoaded?refresh:null,archiveMessage?p(archiveMessage):null,p('Поиск и сводка учитывают только загруженные результаты; архив может содержать дополнительные страницы.'));
 }
async function loadMedia(){if(mediaBusy||!data)return;const epoch=mediaEpoch;mediaBusy=true;mediaError='';draw();try{const next=await fetchPublicMedia(mediaAddress);if(epoch===mediaEpoch&&data)media=next;}catch(e){if(epoch===mediaEpoch){media=null;mediaError='Медиацентр пока недоступен.';}}finally{if(epoch===mediaEpoch){mediaBusy=false;draw();}}}
function mediaPanel(){const refresh=el('button','archive-link','Обновить');refresh.type='button';refresh.disabled=mediaBusy;refresh.onclick=()=>void loadMedia();const title=tab==='news'?'Новости команды':'Турнир';if(mediaBusy||!media)return card(head(title),p(mediaError||(mediaBusy?'Загрузка…':'Откройте опубликованные материалы.')),refresh);if(tab==='news')return card(head(title),...media.news.map(n=>el('article','media-news',null,p(n.date+' · '+newsTypes[n.type]),el('h3','',n.title),p(n.body,'media-body'))),...(!media.news.length?[p('Новостей пока нет.')]:[]),refresh);const t=media.tournament;if(!t)return card(head(title),p('Турнир не опубликован.'),refresh);const table=el('table','',null,el('thead','',null,el('tr','',null,...['Гр.','Место','Команда','И','В','Н','П','Очки'].map(x=>el('th','',x)))),el('tbody','',null,...t.rows.map(r=>el('tr','',null,...[r.group||'—',r.place,r.name,r.played,r.won,r.draw,r.lost,r.points].map(x=>el('td','',x))))));return card(head(t.name,'Публичная копия'),el('div','table-wrap',null,table),el('h3','','Расписание и результаты'),...t.games.map(g=>el('article','media-news',null,el('strong','',g.a+' — '+g.b),p([g.group?'Группа '+g.group:'', 'Раунд '+g.round,g.date,g.time,g.venue].filter(Boolean).join(' · ')),p(g.score||(g.status==='waiting'?'Ожидаются участники':'Ожидается игра')))),refresh);}
function setScoreboard(active){
 document.body.classList.toggle('fan-fullscreen',active);
 const b=root.querySelector('.scoreboard-toggle');if(b){b.textContent=active?'Выйти из табло':'Табло на весь экран';b.setAttribute('aria-pressed',String(active));}
}
function fullScreen(){const b=el('button','archive-link scoreboard-toggle',document.body.classList.contains('fan-fullscreen')?'Выйти из табло':'Табло на весь экран');b.type='button';b.setAttribute('aria-pressed',String(document.body.classList.contains('fan-fullscreen')));b.onclick=()=>setScoreboard(!document.body.classList.contains('fan-fullscreen'));return b;}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('fan-fullscreen'))setScoreboard(false);});
const fixtureTarget=()=>new URL(shareLink).searchParams.get('fixture');
function selectedState(value,now=Date.now()){const id=tab==='overview'?fixtureTarget():null;return id?fixtureState(value,id,now):portalState(value,now);}
function archiveRows(items){return items.map(x=>{
 const outcome=resultOutcome(x),label=outcome==='win'?(x.setsWon.theirs===0&&x.setsWon.ours>=2?'Сухая победа':'Победа'):outcome==='loss'?'Поражение':'Ничья';
 const dateText=format(x.startedAt,{dateStyle:'long',...(x.id.startsWith('result_')?{timeZone:'UTC'}:{})});
 const chips=el('div','result-sets',null,...x.sets.map((s,i)=>el('div','set-chip '+(s.ours>s.theirs?'won':s.ours<s.theirs?'lost':''),null,el('small','','Партия '+(i+1)),el('strong','',s.ours+':'+s.theirs))));
 return el('article','result-card '+outcome,null,el('div','result-info',null,el('div','result-meta',null,el('span','result-date',dateText),el('span','outcome-label '+outcome,label)),el('h3','result-title',null,matchLink(x)),chips),el('div','result-total '+outcome,null,outcome==='win'?glyph('trophy'):null,el('strong','',x.setsWon.ours+':'+x.setsWon.theirs),el('small','','Итог')));
 });}
function historicalMatchPanel(row,rows){
 let s;try{s=archiveMatchSummary(row);}catch{return card(head('Результат матча'),...archiveRows([row]),p('Подробная статистика недоступна.')); }
 const season=archiveSeason(row.startedAt),opponent=opponentHistory([row,...rows]).find(g=>g.rows.some(x=>x.id===row.id));
 const panel=card(head('Протокол матча','Завершён · '+season+' / '+(season+1)),el('div','historical-score',null,el('div','',null,el('strong','',teamName()),el('span','',row.setsWon.ours)),el('span','historical-divider',':'),el('div','',null,el('strong','',row.opponent),el('span','',row.setsWon.theirs))),p(format(row.startedAt,{dateStyle:'long',...(row.id.startsWith('result_')?{timeZone:'UTC'}:{})})),el('h3','','Счёт по партиям'),el('div','historical-sets',null,...s.sets.map(x=>el('div','historical-set',null,el('strong','','Партия '+x.number),el('span','',x.ours+' : '+x.theirs),p('Разница '+(x.margin>0?'+':'')+x.margin)))),el('div','historical-totals',null,el('strong','','Всего очков: '+s.points.ours+' : '+s.points.theirs),p('Разница очков: '+(s.margin>0?'+':'')+s.margin)),p('Опубликован счёт партий. Хронология розыгрышей, индивидуальные показатели и игровое время не опубликованы.'),el('div','fixture-actions',null,shareMatch(row),resultDownload(row)));
 if(opponent&&opponent.played>1)panel.append(el('h3','','Другие встречи с соперником'),p('По загруженным результатам: '+opponent.win+' побед · '+opponent.loss+' поражений'+(opponent.draw?' · '+opponent.draw+' ничьих':'')),...archiveRows(opponent.rows.filter(x=>x.id!==row.id).slice(0,5)));
 return panel;
}
function opponentsPanel(rows){
 const groups=opponentHistory(rows),panel=card(head('История противостояний',groups.length+' соперников'),p('Только загруженные матчи выбранного сезона. Разные названия команд не объединяются автоматически.'));
 const select=el('select','season-filter');select.setAttribute('aria-label','Соперник для сравнения');for(const [value,label] of [['','Выберите соперника'],...groups.map(g=>[g.key,g.opponent+' · '+g.played])]){const o=el('option','',label);o.value=value;select.append(o);}
 if(!groups.some(g=>g.key===opponentFilter))opponentFilter='';select.value=opponentFilter;
 const details=el('div','opponent-details');const render=()=>{const g=groups.find(x=>x.key===opponentFilter);details.replaceChildren(...(g?[el('div','fan-record',null,...[['Матчи',g.played],['Победы',g.win],['Поражения',g.loss],...(g.draw?[['Ничьи',g.draw]]:[])].map(([k,n])=>el('div','record-stat',null,el('strong','',n),el('small','',k)))),p('Партии: '+g.sets.ours+':'+g.sets.theirs+' · очки: '+g.points.ours+':'+g.points.theirs),...archiveRows(g.rows.slice(0,10)),g.rows.length>10?p('Показаны 10 последних встреч. Все загруженные матчи доступны в поиске.'):null].filter(Boolean):[p('Выберите команду, чтобы увидеть баланс встреч.')]));};
 select.onchange=()=>{opponentFilter=select.value;render();};panel.append(select,details);render();return panel;
}
function resultsOverview(rows){const s=resultSummary(rows),key=rows[0]?.id+':'+s.streak,animate=key!==lastStreakKey;lastStreakKey=key;return el('div','fan-record',null,...[['Матчи',s.total],['Победы',s.win],['Поражения',s.loss],...(s.draw?[['Ничьи',s.draw]]:[])].map(([label,n])=>el('div','record-stat',null,el('strong','',n),el('small','',label))),s.streak>=2?el('div','record-streak'+(animate?' streak-enter':''),null,glyph('flame'),el('div','',null,el('strong','',s.streak+' подряд'),el('small','','Серия побед · по архиву'))):null);}
function resultsPanel(rows,full=false){
 const panel=card(head(full?'Результаты':'Последние результаты',full?'Загружено: '+rows.length:'Опубликованные матчи'));panel.classList.add('results-panel');
 const list=el('div','result-list'),count=p(''),more=el('button','archive-link','Показать ещё результаты');more.type='button';
 const renderRows=()=>{
  const chosen=full?searchArchive(rows,{query:resultQuery,season:seasonFilter,outcome:resultFilter}):rows;
  count.textContent='Найдено '+chosen.length+' из '+rows.length+' загруженных матчей.';
  list.replaceChildren(...(chosen.length?archiveRows(chosen.slice(0,full?resultLimit:5)):[p('Нет результатов по выбранному фильтру.')]));
  more.hidden=chosen.length<=resultLimit;
 };
 if(full){
  const filters=el('div','result-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Фильтр результатов');
  for(const [key,label] of [['all','Все'],['win','Победы'],['loss','Поражения'],['draw','Ничьи']]){
   if(key==='draw'&&!rows.some(x=>resultOutcome(x)==='draw'))continue;
   const b=el('button','',label);b.type='button';b.dataset.filter=key;b.setAttribute('aria-pressed',String(resultFilter===key));b.onclick=()=>{resultFilter=key;resultLimit=40;draw();root.querySelector('[data-filter="'+key+'"]')?.focus({preventScroll:true});};filters.append(b);
  }
  const season=el('select','season-filter');season.setAttribute('aria-label','Спортивный сезон');
  for(const [value,label] of [['all','Все сезоны'],...[...new Set([...archiveSeasons(rows),...(archiveScope==='all'?[]:[Number(archiveScope)])])].sort((a,b)=>b-a).map(y=>[String(y),y+' / '+(y+1)])]){const o=el('option','',label);o.value=value;season.append(o);}
  if(![...season.options].some(o=>o.value===seasonFilter))seasonFilter='all';
  season.value=seasonFilter;season.onchange=()=>{selectArchiveSeason(season.value);root.querySelector('.season-filter')?.focus({preventScroll:true});};
  const search=el('input','archive-search');search.type='search';search.maxLength=200;search.value=resultQuery;search.placeholder='Поиск по сопернику';search.setAttribute('aria-label','Поиск по сопернику');
  const clear=el('button','archive-link','Очистить поиск');clear.type='button';clear.onclick=()=>{resultQuery='';resultLimit=40;search.value='';renderRows();search.focus();};
  search.oninput=()=>{resultQuery=search.value;resultLimit=40;renderRows();};count.setAttribute('role','status');
  more.onclick=()=>{resultLimit+=40;renderRows();};
  panel.append(filters,season,el('div','archive-search-row',null,search,clear),count,p('Поиск по загруженным матчам. Сезон: сентябрь — август. Сводка выше относится к загруженным матчам выбранного сезона.'));
 }
 renderRows();panel.append(list);if(full)panel.append(more);
 else {const b=el('button','archive-link','Все результаты →');b.type='button';b.onclick=()=>{tab='results';resultFilter='all';resultQuery='';resultLimit=40;draw();nav?.querySelector('[data-tab=results]')?.focus();};panel.append(b);}
 return panel;
}
function eventsPanel(m){const events=publicMatchMoments(m);return card(head('Ход матча','Последние '+events.length+' розыгрышей'),p('Только опубликованные события. Серии и смена лидера отмечаются по непрерывному видимому отрезку.'),...events.slice().reverse().map(e=>el('div','event',null,el('span','point-side '+e.side),el('strong','',e.score),el('div','',null,el('span','event-name',e.kind==='point'?'Очко без детализации':reasons[e.kind]),el('small','',(e.actor==='ours'?teamName():m.opponent)+(e.number==null?'':' · №'+e.number)+' · партия '+e.set+' · очко: '+(e.side==='ours'?teamName():m.opponent)),...e.notes.map(n=>el('span','moment-note',n))))));}
function momentum(m){const rows=m.events.filter(e=>e.set===m.set);if(rows.length<2)return null;const chart=el('div','momentum',null,...rows.map(e=>{const n=el('span',e.side);n.title=e.score+' · '+(e.side==='ours'?teamName():m.opponent);return n;}));chart.style.setProperty('--n',rows.length);chart.setAttribute('role','img');chart.setAttribute('aria-label','Последние '+rows.length+' очков текущей партии: '+rows.map(e=>e.score+' '+(e.side==='ours'?teamName():m.opponent)).join(', '));return card(head('Динамика партии','Последние '+rows.length+' очков'),chart,el('div','legend',null,el('span','',teamName()),el('span','',m.opponent)),p('Слева направо: от более раннего очка к последнему.'));}
function reconnectButton(){const b=el('button','archive-link','Обновить соединение');b.type='button';b.onclick=()=>reconnectViewer?.();return b;}
function ageText(f){return f.clockMismatch?'Время устройства отличается от времени сервера.':f.age===null?'':('Последняя публикация: '+(f.age<60?f.age+' сек. назад':Math.floor(f.age/60)+' мин. назад'));}
function draw(){
 const now=Date.now(),pinned=tab==='overview'?fixtureTarget():null,state=selectedState(data,now),f=viewerFreshness(data,{connected,awaitingSnapshot,now}),stale=f.stale,modeChanged=lastMode!==state.mode;lastMode=state.mode;lastStale=stale;const fresh=f.fresh;
 const previous=lastPaintedMatch,current=data?.match;const changes=scoreChanges(previous,current),finished=previous&&current&&previous.id===current.id&&previous.status!=='finished'&&current.status==='finished';lastPaintedMatch=current?{id:current.id,set:current.set,status:current.status,score:{...current.score}}:null;
 const tabChanged=lastPaintedTab!==tab;lastPaintedTab=tab;
 const mount=parts=>{
  const focus=document.activeElement?.classList.contains('archive-search'),selection=focus?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;
  root.replaceChildren(...parts);if(!root.querySelector('.hero'))setScoreboard(false);
  if(focus){const search=root.querySelector('.archive-search');if(search){search.focus({preventScroll:true});try{search.setSelectionRange(...selection);}catch{}}}
  if(tabChanged||modeChanged)enterGroup(root.children);
 };
 const matchId=state.match?.id;if(!fixtureTarget()&&matchId&&matchId!==lastMatchId&&['live','break'].includes(state.mode))tab='overview';lastMatchId=matchId;
 const name=teamName();for(const id of ['brand-team','footer-team']){const n=document.getElementById(id);if(n)n.textContent=name;}document.title=name+' — матчи и результаты | TeachApp';if(brand)brand.setAttribute('aria-label','TeachApp — '+name);
 connection.textContent=f.transport?(stale?'Счёт не обновляется':'● На связи'):received?'Нет актуальной связи':'Подключение…';connection.dataset.state=fresh?'online':'offline';renderNav();
 if(!data){setScoreboard(false);root.replaceChildren(card(el('h1','',received?'Страница пока не опубликована':'TeachApp Volleyball'),p(problem||(received?'Попросите тренера опубликовать расписание.':'Ожидание данных…')),reconnectViewer?reconnectButton():null));return;}
 const m=state.match,upcoming=data.schedule.filter(x=>x.id!==data.match?.scheduledId),merged=mergeLoadedArchive(fanResults(data),archiveRowsExtra),past=merged.rows;
 if(seasonFilter!=='all'&&seasonFilter!==archiveScope&&!archiveSeasons(past).map(String).includes(seasonFilter))seasonFilter='all';
 if(resultFilter==='draw'&&!past.some(x=>resultOutcome(x)==='draw'))resultFilter='all';const latest=!pinned&&!state.next&&!['live','break'].includes(state.mode)&&past[0]&&(!m||past[0].id!==m.id)?past[0]:null;
 const parts=[];parts.push(el('p','portal-updated','Последнее обновление: '+format(data.updatedAt,{dateStyle:'short',timeStyle:'medium'})));if(f.live)parts.push(el('p','portal-age',ageText(f)));if(stale||!f.transport)parts.push(el('div','notice',null,p(!f.transport?'Соединение восстанавливается. Показаны последние данные.':f.clockMismatch?'Проверьте часы устройства. Актуальность счёта не подтверждена.':'Данные давно не обновлялись. Связь со страницей есть, но тренер давно не отправлял счёт. Показан последний полученный счёт.'),reconnectButton()));
 if(merged.conflicts.length&&['overview','results'].includes(tab))parts.push(el('div','notice','В архиве найдены противоречивые записи ('+merged.conflicts.length+'). Они исключены из сводки, если нет актуального опубликованного результата.'));
 const params=new URL(shareLink).searchParams,requested=params.get('archive')||params.get('match');if(requested&&tab==='overview'){const detailed=data.match?.id===requested&&!params.has('archive')?data.match:null;const row=params.has('archive')?directResult:detailed||past.find(x=>x.id===requested)||directResult;const back=el('a','archive-link','← Все матчи');const u=new URL(shareLink);back.href=viewerPageLink(u.href);const retry=el('button','archive-link','Проверить архивную запись');retry.type='button';retry.disabled=directBusy;retry.onclick=()=>void loadDirectArchive();parts.push(back,row?(detailed?card(head('Матч',detailed.status==='finished'?'Завершён':fresh?'Текущий счёт':'Последний счёт'),teams(teamName(),detailed.opponent,detailed),sets(detailed),p(date(detailed.startedAt)),shareMatch(row),detailed.status==='finished'?resultDownload(row):null):historicalMatchPanel(row,past)):card(p(directBusy?'Загрузка результата…':directError||'Результат не найден или снят с публикации.')));if(!detailed&&(params.has('archive')||!past.some(x=>x.id===requested)))parts.push(retry);if(detailed?.events.length){parts.push(eventsPanel(detailed));const trend=momentum(detailed);if(trend)parts.push(trend);}if(detailed?.stats.length)parts.push(...[statTable(detailed.stats,'ours',teamName()),statTable(detailed.stats,'theirs',detailed.opponent)].filter(Boolean));mount(parts);return;}
 if(['news','tournament'].includes(tab)){parts.push(mediaPanel());mount(parts);return;}
 if(tab==='schedule'){parts.push(schedulePanel());mount(parts);return;}
 if(tab==='results'){if(past.length||archiveScope!=='all')parts.push(resultsOverview(filterArchiveSeason(past,seasonFilter)),resultsPanel(past,true),opponentsPanel(filterArchiveSeason(past,seasonFilter)));else parts.push(el('section','card empty',null,el('h2','','Результаты'),p('Опубликованных результатов пока нет.')));parts.push(archiveControls());mount(parts);return;}
 if(pinned){const back=el('a','archive-link','← Все матчи');back.href=viewerPageLink(shareLink);parts.push(back);if(state.mode==='unavailable'){parts.push(card(head('Встреча недоступна'),p('Эта встреча больше не опубликована в расписании или текущем матче. Проверьте общий раздел результатов.')));mount(parts);return;}}
 const hero=el('section','card hero');hero.append(el('div','eyebrow','Волейбол · '+teamName()));
 if(state.next){hero.append(el('div','status-pill',state.mode==='waiting'?'ОЖИДАНИЕ':'ПРЕДСТОЯЩАЯ ВСТРЕЧА'),el('h1','',state.mode==='waiting'?'Ожидаем начала матча':'Следующий матч'),teams(teamName(),state.next.opponent,null,state.next.logos),p(date(state.next.startAt)));
 if(state.mode==='upcoming'){const labels=['дней','часов','мин','сек'];hero.append(el('div','clock',null,...countdown(state.remaining).map((n,i)=>el('div','',null,el('strong','',String(n).padStart(2,'0')),el('span','',labels[i])))),p('Трансляция начнётся автоматически после старта матча.'));}else hero.append(p('Счёт появится после фактического запуска тренером.'));
 }else if(latest){hero.append(el('div','status-pill','ФИНАЛ'),el('h1','','Последний результат'),teams(teamName(),latest.opponent,{...latest,status:'finished',colors:{ours:'blue',theirs:'red'}}),p(format(latest.startedAt,{dateStyle:'long',...(latest.id.startsWith('result_')?{timeZone:'UTC'}:{})})),sets({...latest,status:'finished'}));
 }else if(m){const finished=m.status==='finished',live=m.status==='live';hero.append(el('div','status-pill'+(live&&fresh?' live':''),finished?'ФИНАЛ':!fresh?'ПОСЛЕДНИЙ СЧЁТ':live?'LIVE':'ПЕРЕРЫВ'),el('h1','',finished?'Матч завершён':live?'Партия '+m.set:'Перерыв · партия '+m.set),teams(teamName(),m.opponent,m),el('p','set-wins',finished?(m.setsWon.ours>m.setsWon.theirs?'Победа команды '+teamName():'Итог встречи'):'Партии '+m.setsWon.ours+':'+m.setsWon.theirs),sets(m));}
 else hero.append(el('h1','',teamName()),p('Предстоящих матчей пока нет. Загляните позже.'));
 if(finished&&current&&(!pinned||m?.id===current.id)){const final=el('div','fan-final'+(current.setsWon.ours>current.setsWon.theirs?'':' neutral'),null,el('strong','',current.setsWon.ours>current.setsWon.theirs?'Победа!':'Матч завершён'),el('span','',teamName()+' — '+current.opponent+' · '+current.setsWon.ours+':'+current.setsWon.theirs));if(current.setsWon.ours>current.setsWon.theirs&&document.documentElement.dataset.motion==='full'&&motionAllowed()){const sparks=el('div','fan-sparks');sparks.setAttribute('aria-hidden','true');for(let i=0;i<16;i++){const n=el('i');n.style.setProperty('--x',Math.round(Math.cos(i*Math.PI/8)*(70+(i%3)*15))+'px');n.style.setProperty('--y',Math.round(Math.sin(i*Math.PI/8)*(40+(i%3)*10))+'px');n.style.setProperty('--turn',(i%2?1:-1)*(45+i*17)+'deg');n.style.setProperty('--spark', ['#FDE68A','#86EFAC','#F8FAFC','#93C5FD'][i%4]);sparks.append(n);}final.append(sparks);}parts.push(final);final.classList.add('fan-final-enter');}
 if(state.next)hero.append(shareFixture(state.next));else if(m&&!latest)hero.append(pinned?shareFixture(m):shareMatch(m));if(latest||m?.status==='finished')hero.append(resultDownload(latest||m));hero.append(fullScreen());parts.push(hero);if(!pinned&&past.length)parts.push(resultsOverview(past));
 if(!latest&&m?.events.length){const trend=momentum(m);parts.push(trend?el('div','overview-grid',null,eventsPanel(m),trend):eventsPanel(m));}
 if(!latest&&m?.stats.length)parts.push(el('div','details-grid',null,...[statTable(m.stats,'ours',teamName()),statTable(m.stats,'theirs',m.opponent)].filter(Boolean)));
 if(!pinned&&upcoming.length)parts.push(card(head('Расписание',upcoming.length+' встреч'),...scheduleRows(upcoming)));
 if(!pinned&&past.length)parts.push(resultsPanel(past));
 mount(parts);
 if(!tabChanged&&m&&m.status!=='finished'){for(const [side,kind] of Object.entries(changes)){const n=root.querySelector('[data-score-side="'+side+'"]');if(n){animateOnce(n,kind,{duration:320});if(kind==='score'){animateOnce(n.parentElement,'pulse',{duration:250});animateOnce(root.querySelector('.event'),'slide',{duration:220});}}}}
}
let shareLink=location.href;
const brand=document.querySelector('.brand');if(brand)brand.href=shareLink;
const motionControl=document.getElementById('fan-motion');
function viewerMotion(value){const v=normalizeMotion(value);document.documentElement.dataset.motion=v;if(motionControl){motionControl.textContent='Анимации: '+motionModes[v];motionControl.setAttribute('aria-label','Анимации: '+motionModes[v]+'; нажмите для смены режима');}try{window.localStorage.setItem('teachapp:viewer-motion',v);}catch{}}
try{viewerMotion(window.localStorage.getItem('teachapp:viewer-motion'));}catch{viewerMotion('full');}
if(motionControl)motionControl.onclick=()=>{const modes=['full','subtle','off'];viewerMotion(modes[(modes.indexOf(document.documentElement.dataset.motion)+1)%3]);};
const theme=document.getElementById('theme');
function setTheme(value){document.documentElement.dataset.theme=value;if(theme){theme.textContent=value==='light'?'☾':'☀';theme.setAttribute('aria-label',value==='light'?'Включить тёмную тему':'Включить светлую тему');}try{window.localStorage.setItem('teachapp:viewer-theme',value);}catch{}}
try{setTheme(window.localStorage.getItem('teachapp:viewer-theme')==='light'?'light':'dark');}catch{setTheme('dark');}
if(theme)theme.onclick=()=>setTheme(document.documentElement.dataset.theme==='light'?'dark':'light');
const share=document.getElementById('share');
if(share)share.onclick=async()=>{try{if(window.navigator.share){await window.navigator.share({title:teamName()+' — матчи и результаты',url:shareLink});return;}await window.navigator.clipboard.writeText(shareLink);share.textContent='✓';setTimeout(()=>{share.textContent='↗';},1500);}catch(e){if(e.name==='AbortError')return;let input=document.querySelector('.share-fallback');if(!input){input=el('input','share-fallback');input.readOnly=true;input.setAttribute('aria-label','Ссылка для копирования');root.before(input);}input.value=shareLink;input.focus();input.select();}};
try{
 const target=viewerTarget(location.href);primaryPage=target.primary;shareLink=target.share;if(brand)brand.href=viewerPageLink(shareLink);for(const id of ['brand-team','footer-team']){const n=document.getElementById(id);if(n)n.textContent=teamName();}
 if(shareLink!==location.href){try{window.history.replaceState(window.history.state,'',shareLink);}catch{}}
 archiveAddress=target.address;mediaAddress=mediaTarget(target.address);
 let stream=null,current=null,generation=0,closed=false,retryTimer=null;
 function clearRetry(){if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}}
 function startStream(){
  if(closed)return;clearRetry();stream?.close();current=null;const token=++generation;connected=false;awaitingSnapshot=true;problem='';draw();
  if(navigator.onLine===false){problem='Нет интернета. Проверьте подключение.';draw();return;}
  const source=new EventSource(target.address);stream=source;
  const active=()=>!closed&&generation===token;
  source.onopen=()=>{if(!active())return;connected=true;awaitingSnapshot=true;problem='';draw();};
  function receive(event){
   if(!active())return;
   try{
    const {path,data:value}=JSON.parse(event.data);
    if(typeof path!=='string')throw Error('Invalid path');
    const rootPut=path==='/'&&event.type==='put';
    // Never apply partial patches to an old or uninitialized root on reconnect.
    if(awaitingSnapshot&&!rootPut)return;
    if(rootPut)current=value;
    else{
     if(!current||typeof current!=='object')throw Error('Missing root');
     const assign=(key,v)=>{const parts=key.split('/').filter(Boolean);if(!parts.length||parts.some(k=>['__proto__','constructor','prototype'].includes(k)))return;let parent=current;for(const k of parts.slice(0,-1)){if(!Object.hasOwn(parent,k)||!parent[k]||typeof parent[k]!=='object')parent[k]=Object.create(null);parent=parent[k];}if(v===null)delete parent[parts.at(-1)];else parent[parts.at(-1)]=v;};
     if(event.type==='put')assign(path,value);else for(const [key,v] of Object.entries(value||{}))assign(path+'/'+key,v);
    }
    const next=readPortal(current);if(current!==null&&!next)throw Error('Invalid public snapshot');
    const same=JSON.stringify(data&&{...data,updatedAt:0})===JSON.stringify(next&&{...next,updatedAt:0}),wasConnected=connected&&!awaitingSnapshot,hadData=!!data;data=next;if(!next)resetArchive();received=true;connected=true;awaitingSnapshot=false;
    const nextMode=selectedState(data).mode,nextStale=viewerFreshness(data,{connected,awaitingSnapshot}).stale;
    if(!same||!wasConnected||nextStale!==lastStale||nextMode!==lastMode)draw();else if(next){const updated=root.querySelector('.portal-updated');if(updated)updated.textContent='Последнее обновление: '+format(next.updatedAt,{dateStyle:'short',timeStyle:'medium'});const age=root.querySelector('.portal-age');if(age)age.textContent=ageText(viewerFreshness(data,{connected,awaitingSnapshot}));}
    if(next&&(!hadData||!wasConnected)&&['news','tournament'].includes(tab))void loadMedia();if(next&&(!hadData||!wasConnected)&&(new URL(shareLink).searchParams.has('archive')||new URL(shareLink).searchParams.has('match')))void loadDirectArchive();else if(next&&!same&&!directResult&&new URL(shareLink).searchParams.has('match'))void loadDirectArchive();
   }catch{connected=false;awaitingSnapshot=true;problem='Не удалось прочитать обновление. Ожидаем повторного подключения.';source.close();generation++;draw();retryTimer=setTimeout(startStream,2000);}
  }
  source.addEventListener('put',receive);source.addEventListener('patch',receive);
  source.onerror=()=>{if(!active())return;connected=false;awaitingSnapshot=true;current=null;problem='Не удалось подключиться. Проверьте ссылку или интернет.';draw();};
  const revoked=message=>{if(!active())return;source.close();generation++;connected=false;awaitingSnapshot=true;current=null;data=null;resetArchive();received=true;problem=message;draw();};
  source.addEventListener('cancel',()=>revoked('Страница недоступна'));source.addEventListener('auth_revoked',()=>revoked('Доступ отозван'));
 }
 reconnectViewer=startStream;startStream();
 const offline=()=>{clearRetry();stream?.close();generation++;current=null;connected=false;awaitingSnapshot=true;problem='Нет интернета';draw();};
 window.addEventListener('offline',offline);window.addEventListener('online',startStream);
 const visible=()=>{if(!document.hidden){if(!connected||awaitingSnapshot)startStream();else draw();}};document.addEventListener('visibilitychange',visible);
 window.addEventListener('pagehide',()=>{closed=true;clearRetry();stream?.close();clearInterval(clock);window.removeEventListener('offline',offline);window.removeEventListener('online',startStream);document.removeEventListener('visibilitychange',visible);},{once:true});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 const clock=setInterval(()=>{if(!data)return;const state=selectedState(data),f=viewerFreshness(data,{connected,awaitingSnapshot}),stale=f.stale;if(state.mode!==lastMode||stale!==lastStale){draw();return;}const age=root.querySelector('.portal-age');if(age)age.textContent=ageText(f);if(state.mode==='upcoming'&&tab==='overview')root.querySelectorAll('.clock strong').forEach((n,i)=>{const value=String(countdown(state.remaining)[i]).padStart(2,'0');if(n.textContent===value)return;n.textContent=value;if(i<3&&!document.hidden)animateOnce(n,'score',{duration:200});});},1000);
}catch{received=true;problem='Откройте постоянную ссылку, которую отправил тренер.';draw();}
