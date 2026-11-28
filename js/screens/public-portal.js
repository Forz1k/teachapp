import {migrationLabAllowed} from '../rollout-policy.js';
import {resultLink,archiveKey,verifyPublicMigrationBundle} from '../public-archive.js';
import {openStudio} from './studio.js';
import {openMediaCenter} from './public-media.js';
import * as P from '../public-publisher.js';
import {loadCoach,matchScore} from '../coach.js';
import {prepareLogo} from '../match-protocol.js';
import {primaryPortal,savedResult,resultFixtures,fixtureLink} from '../public-portal.js';
import {resetPortalPassword} from '../firebase-portal.js';
import {uid} from '../model.js';
import {el,openSheet,closeSheet,toast,confirmDialog} from '../ui.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
const field=(text,node)=>el('label',{class:'field'},[el('span',{text}),node]);
const input=(type,value='',extra={})=>el('input',{type,value,...extra});
const date=t=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(t);
const localInput=t=>{const x=new Date(t);return new Date(x.getTime()-x.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const card=(title,...children)=>el('section',{class:'card-block vb-stack'},[el('h3',{text:title}),...children]);
export function openPublicPortal(team,back=closeSheet){
 const id=team.id,body=el('div',{class:'vb-stack'});let editing=null,busy=false;
 function draw(){
  const {data:d,connected,status,running,dirty,conflict}=P.portalInfo(id),publicName=input('text',d.team||team.name,{maxlength:100}),origin=input('url',d.origin||primaryPortal.origin,{placeholder:'https://...firebaseio.com',autocomplete:'off',readonly:d.origin?true:null}),api=input('text',d.apiKey||primaryPortal.apiKey,{placeholder:'Web API Key',autocomplete:'off'}),email=input('email','',{autocomplete:'username'}),password=input('password','',{autocomplete:'current-password'}),slug=input('text',d.slug||P.defaultPageCode(id),{placeholder:'Оставьте пустым для новой ссылки',readonly:d.slug?true:null,maxlength:100});
  const statusLine=el('p',{class:'vp-portal-status',role:'status',text:status}),inspection=el('div',{class:'vb-stack','aria-live':'polite'});
  const verify=btn('Проверить опубликованный счёт',async()=>{verify.disabled=true;try{const s=await P.inspectPortal(id);inspection.replaceChildren(p(s.exists?'Сервер: '+(s.match?s.match.opponent+' · партия '+s.match.set+' · '+s.match.score.ours+':'+s.match.score.theirs:'нет активного матча'):'Страница не опубликована'),p('Обновлено: '+(s.updatedAt==null?'—':date(s.updatedAt))+' · '+(s.contentEqual?'Совпадает с локальной публичной версией':'Отличается от локальной публичной версии')),p(s.pending?'Есть ожидающие изменения.':s.conflict?'Конфликт: запись заблокирована.':s.paused?'Отправка остановлена.':'Проверка только читает сервер.'));}catch(e){inspection.replaceChildren(p(e.message));}finally{verify.disabled=false;}},'wide');
  const link=P.portalLink(id),linkInput=input('url',link,{readonly:true,'aria-label':'Постоянная ссылка зрителей'});
  const opponent=input('text',editing?.opponent||'',{maxlength:100,placeholder:'Название соперника'}),when=input('datetime-local',editing?localInput(editing.startAt):'');
  const logoFile=()=>input('file','',{accept:'image/png,image/jpeg,image/webp'});
  const ours=logoFile(),theirs=logoFile();
  const fixtureLogo=(file,side)=>file.files[0]?prepareLogo(file.files[0]):editing?.logos?.[side]??null;
  const run=async fn=>{if(busy)return;busy=true;const buttons=[...body.querySelectorAll('button')];buttons.forEach(x=>x.disabled=true);try{await fn();draw();}catch(e){toast(e.message);}finally{busy=false;buttons.forEach(x=>x.disabled=false);}};
  const check=(label,k)=>{const cb=el('input',{type:'checkbox'});cb.checked=d.settings[k];cb.disabled=!!d.publisherPaused;cb.onchange=async()=>{if(k==='permanent'&&!await confirmDialog({title:cb.checked?'Сохранять результаты для постоянного архива?':'Отключить очередь?',text:cb.checked?'Только результаты, которые вы уже публикуете на сайте. Отправка очереди требует отдельного подтверждения; имена, время игроков и тактика не передаются.':'Неотправленная очередь будет очищена. Уже опубликованные записи останутся в архиве.',ok:'Подтвердить'})){cb.checked=!cb.checked;return;}if(k==='numbers'&&cb.checked&&!await confirmDialog({title:'Публиковать номера игроков?',text:'Номера могут позволять знакомым опознать учащихся. Включайте только при наличии необходимых разрешений. Имена, здоровье и тактическая разведка никогда не публикуются.',ok:'Разрешить'})){cb.checked=false;return;}try{P.setPortalSettings(id,{[k]:cb.checked});}catch(e){cb.checked=!cb.checked;toast(e.message);}};return el('label',{class:'vp-portal-check'},[cb,el('span',{text:label})]);};
  body.replaceChildren(el('h2',{text:'Публичная страница · '+team.name}),p('Одна постоянная ссылка для зрителей. Публикация отдельна от локального журнала, выключена по умолчанию.'),
   card('Подключение',statusLine,p('Управление публикацией доступно только владельцу разрешённой учётной записи Firebase. Зрительская ссылка — только для чтения. Передача между устройствами требует явного подтверждения и совпадения черновика.'),connected?verify:null,inspection,connected?btn('Повторить ожидающую отправку',()=>run(()=>{if(!P.retryPortal(id))toast('Нет ожидающей отправки или обмен уже выполняется');}),'wide'):null,connected?btn('Принять опубликованную версию',()=>run(async()=>{if(!await confirmDialog({title:'Принять версию сервера?',text:'Локальный черновик публичной страницы будет заменён текущей публикацией. Локальные записи матчей и статистика сохранятся. Автозапуск трансляции будет выключен.',ok:'Принять',danger:true}))return;await P.acceptRemotePortal(id);}), 'wide'):null,connected?btn('Отключить учётную запись',()=>run(()=>P.disconnectPortal(id)),'wide'):el('div',{class:'vb-stack'},[field('Почта тренера',email),field('Пароль Firebase',password),el('details',{},[el('summary',{text:'Настройки страницы и проекта'}),field('Код страницы',slug),field('Адрес Realtime Database',origin),field('Web API Key',api)]),btn('Подключить Firebase',()=>run(async()=>{await P.connectPortal(id,{origin:origin.value,apiKey:api.value.trim(),email:email.value.trim(),password:password.value,slug:slug.value.trim(),team:publicName.value});password.value='';}),'primary wide'),btn('Получить письмо для установки пароля',()=>run(async()=>{await resetPortalPassword(api.value.trim(),email.value.trim());toast('Проверьте почту тренера');}),'wide')])),
   card('Постоянная ссылка',field('Публичное название команды',publicName),btn('Сохранить название',()=>run(()=>P.setPublicTeamName(id,publicName.value)),'wide'),link?field('Ссылка для зрителей',linkInput):p('Ссылка появится после подключения Firebase.'),
    link?btn('Скопировать ссылку',async()=>{try{await navigator.clipboard.writeText(link);toast('Ссылка скопирована');}catch{linkInput.focus();linkInput.select();toast('Скопируйте выделенную ссылку');}},'wide'):null,
    link?el('a',{class:'btn wide',href:link,target:'_blank',rel:'noopener noreferrer',text:'Открыть страницу зрителя'}):null,
    btn(d.enabled?'Снять страницу с публикации':'Опубликовать страницу',()=>run(async()=>{if(!await confirmDialog({title:d.enabled?'Снять публикацию?':'Опубликовать страницу?',text:d.enabled?'Основная страница будет удалена; расширенный архив и медиацентр скрываются, но их записи остаются и могут снова стать доступны при повторной публикации. Неотправленная очередь очищается. Медиацентр можно отдельно удалить после снятия страницы.':'Расписание и выбранные публичные данные будут доступны всем, у кого есть ссылка. Ранее сохранённые архив и медиацентр могут снова открыться. Проверьте их и разрешения на публикацию.',ok:d.enabled?'Снять':'Опубликовать',danger:d.enabled}))return;P.setPortalEnabled(id,!d.enabled,publicName.value);}),d.enabled?'wide':'primary wide')),
   card('Предстоящие матчи',p('Время вводится в часовом поясе устройства тренера. У зрителя отображается его местное время.'),
    field('Соперник',opponent),field('Дата и время',when),el('details',{},[el('summary',{text:'Эмблемы команд'}),field('Наша команда',ours),field('Соперник',theirs)]),btn(editing?'Сохранить изменения':'+ Добавить матч',()=>run(async()=>{if(!when.value)throw Error('Укажите дату и время');P.saveFixture(id,{id:editing?.id||uid('fixture'),opponent:opponent.value,startAt:new Date(when.value).getTime(),logos:{ours:await fixtureLogo(ours,'ours'),theirs:await fixtureLogo(theirs,'theirs')}});editing=null;}),'primary wide'),
    editing?btn('Отмена редактирования',()=>{editing=null;draw();},'wide'):null,
    ...d.schedule.map(x=>el('div',{class:'vp-portal-fixture'},[el('strong',{text:(d.team||team.name)+' — '+x.opponent}),p(date(x.startAt)+(x.startAt<Date.now()?' · проверьте актуальность':'')),el('div',{class:'vp-actions'},[btn('Изменить',()=>{editing=x;draw();}),link?btn('Скопировать ссылку встречи',async()=>{const url=fixtureLink(link,x.id);try{await navigator.clipboard.writeText(url);toast('Ссылка скопирована. Доступна после публикации встречи.');}catch{const field=input('url',url,{readonly:true,'aria-label':'Ссылка встречи'});const parent=body.querySelectorAll('.vp-portal-fixture')[d.schedule.indexOf(x)];if(parent){parent.append(field);field.focus();field.select();}}}):null,link?el('a',{class:'btn',href:fixtureLink(link,x.id),target:'_blank',rel:'noopener noreferrer',text:'Открыть встречу'}):null,btn('Афиша',()=>openStudio({template:'matchday',team:d.team||team.name,scope:id,opponent:x.opponent,details:date(x.startAt),link:link?fixtureLink(link,x.id):''},()=>openPublicPortal(team,back))),btn('Удалить',()=>run(async()=>{if(await confirmDialog({title:'Убрать матч из расписания?',text:'Зрители больше не увидят эту встречу.',ok:'Удалить',danger:true}))P.removeFixture(id,x.id);}))])]))),
   card('Новости и публичные турниры',p('Отдельные черновики, предпросмотр и публикация.'),btn('Медиацентр команды',()=>openMediaCenter(team,()=>openPublicPortal(team,back)),'wide')),
   card('TeachApp Studio',p('Афиши, результаты, грамоты и другие изображения без интернета.'),btn('Открыть студию',()=>openStudio({team:d.team||team.name,scope:id,link},()=>openPublicPortal(team,back)),'wide')),
   card('Расширенный архив',p('Постоянные ссылки и отдельные записи. Требуются согласованные правила Firebase v2.'),check('Добавлять публикуемые результаты в очередь постоянного архива','permanent'),p('Ожидают отправки: '+d.archivePending.length+'. Отправьте очередь после синхронизации страницы.'),btn('Управлять расширенным архивом',()=>openExtendedArchive(team,()=>openPublicPortal(team,back)),'wide')),
   card('Опубликованные результаты',p('Добавляйте результаты из истории матчей. Здесь можно убрать отдельную встречу, не удаляя локальную запись.'),btn('+ Добавить результат из истории',()=>openSavedResults(team,()=>openPublicPortal(team,back)),'primary wide'),...d.archive.map(x=>el('div',{class:'vp-portal-fixture'},[el('strong',{text:x.opponent+' · '+x.setsWon.ours+':'+x.setsWon.theirs}),p(x.sets.map(s=>s.ours+':'+s.theirs).join(' / ')),btn('Убрать с сайта',()=>run(async()=>{if(await confirmDialog({title:'Убрать результат с сайта?',text:'Локальный матч и статистика сохранятся. Удаляется только запись из последних результатов; постоянный архив управляется отдельно.',ok:'Убрать',danger:true}))P.unpublishResult(id,x.id);}), 'wide')])),!d.archive.length?p('Пока нет опубликованных результатов.'):null),
   card('Что видят зрители',check('Лента событий', 'events'),check('Номера игроков (при наличии разрешений)','numbers'),check('Результативность игроков (требуются номера)','stats'),check('Автозапуск трансляции запланированного матча','auto'),p('Автозапуск срабатывает только при открытии подробного матча с одним совпадением соперника и даты. Можно начать вручную из матча. Имена, тактика и медицинские данные закрыты.')),
   card('Текущая трансляция',d.publisherPaused?p('Отправка с этого устройства остановлена. Для продолжения откройте совпадающий подробный матч; если встреча завершена на другом устройстве, примите опубликованную версию.'):null,d.match?p(d.match.opponent+' · '+d.match.status+' · '+d.match.score.ours+':'+d.match.score.theirs):p('Трансляция не запущена.'),d.activeId&&!d.publisherPaused?btn('Остановить текущую трансляцию',()=>run(async()=>{if(await confirmDialog({title:'Остановить трансляцию?',text:'Страница вернётся к расписанию. Запись локального матча продолжится.',ok:'Остановить'}))P.stopPortalMatch(id);}), 'wide'):null,d.activeId&&!d.publisherPaused?btn('Передать управление · остановить отправку',()=>run(async()=>{if(await confirmDialog({title:'Приостановить отправку?',text:'Последний счёт останется опубликованным. Продолжение потребует явной проверки совпадающего черновика.',ok:'Приостановить'}))P.pausePortalPublisher(id);}), 'wide'):null,p('Матч продолжает записываться без интернета. Для зрителей показывается последний полученный счёт.'),p('Архив опубликованных матчей: '+d.archive.length)),
   btn('Назад',()=>{unsubscribe();back();},'wide'));
 }
 let unsubscribe=P.watchPortal(id,()=>{if(!body.isConnected){unsubscribe();return;}const n=body.querySelector('.vp-portal-status');if(n)n.textContent=P.portalInfo(id).status;});
 draw();openSheet(body,{onClose:unsubscribe});
}

export async function openPublicResult(team,match,back=closeSheet){
 try{
  const result=await savedResult(match),id=team.id,info=P.portalInfo(id),d=info.data;
  const existing=d.archive.some(x=>x.id===result.id)||d.match?.id===result.id&&d.match.status==='finished';
  const fixtures=resultFixtures(d.schedule,match,d.activeId?d.match?.scheduledId:null);
  const fixture=el('select',{'aria-label':'Связать с расписанием'},[el('option',{value:'',text:'Не изменять расписание'}),...fixtures.map(x=>el('option',{value:x.id,text:date(x.startAt)+' · '+x.opponent}))]);
  const status=el('p',{class:'vp-portal-status',role:'status',text:info.status});
  const body=el('div',{class:'vb-stack'},[el('h2',{text:'Результат на зрительском сайте'}),card('Предпросмотр',el('strong',{text:(d.team||team.name)+' — '+result.opponent}),p(match.date),el('div',{class:'public-result-score',text:result.setsWon.ours+' : '+result.setsWon.theirs}),p('Партии: '+result.sets.map(s=>s.ours+':'+s.theirs).join(' / '))),p('Будут опубликованы только дата, соперник и счёт партий. Состав, имена, индивидуальная статистика и тактика не передаются.'),status,p(existing?'Результат уже добавлен в публичный архив. Можно обновить его.':'Результат ещё не добавлен в публичный архив.')]);
  body.append(btn('PNG результата',()=>openStudio({template:'result',team:d.team||team.name,scope:id,opponent:result.opponent,score:result.setsWon.ours+' : '+result.setsWon.theirs,details:match.date+' · '+result.sets.map(s=>s.ours+':'+s.theirs).join(' / '),link:existing&&P.portalLink(id)?resultLink(P.portalLink(id),result):''},()=>openPublicResult(team,match,back)),'wide'));
  if(fixtures.length)body.append(field('Убрать завершённую встречу из расписания',fixture));
  if(!d.enabled)body.append(p('Сначала подключите и опубликуйте страницу команды.'),btn('Настройки зрительской страницы',()=>openPublicPortal(team,()=>openPublicResult(team,match,back)),'primary wide'));
  else{
   const publish=btn(existing?'Обновить результат на сайте':'Опубликовать результат',async()=>{publish.disabled=true;try{if(!await confirmDialog({title:'Опубликовать результат?',text:'Счёт станет доступен зрителям после синхронизации.'+(fixture.value?' Выбранная встреча будет убрана из расписания.':''),ok:'Опубликовать'}))return;await P.publishSavedResult(id,match,{fixtureId:fixture.value||null});toast('Результат сохранён для публикации');await openPublicResult(team,match,back);}catch(e){toast(e.message);}finally{publish.disabled=false;}},'primary wide');
   body.append(publish,btn('В расширенный архив',async()=>{try{const done=await P.publishExtendedResult(id,result,{confirm:old=>confirmDialog({title:old?'Обновить архивный результат?':'Опубликовать в расширенном архиве?',text:'Только соперник, дата и счёт. Требуется настроенный расширенный архив Firebase.',ok:'Подтвердить'})});if(done){toast('Результат опубликован в расширенном архиве');if(P.portalLink(id))body.append(el('a',{class:'btn wide',href:resultLink(P.portalLink(id),{...result,archiveKey:archiveKey(result)}),target:'_blank',rel:'noopener noreferrer',text:'Открыть постоянную ссылку'}));}}catch(e){toast(e.message);}},'wide'));
   if(existing)body.append(btn('Убрать результат с сайта',async()=>{if(!await confirmDialog({title:'Убрать результат с сайта?',text:'Матч останется в истории TeachApp. Удаляется только недавняя публичная запись; постоянный архив управляется отдельно.',ok:'Убрать',danger:true}))return;try{P.unpublishResult(id,result.id);await openPublicResult(team,match,back);}catch(e){toast(e.message);}},'wide'));
   if(!info.connected)body.append(p('Войдите в Firebase для отправки сохранённых изменений.'),btn('Войти в Firebase',()=>openPublicPortal(team,()=>openPublicResult(team,match,back)),'wide'));
  }
  const link=P.portalLink(id);if(link)body.append(el('a',{class:'btn wide',href:link,target:'_blank',rel:'noopener noreferrer',text:'Открыть зрительский сайт'}));
  let unsubscribe=P.watchPortal(id,()=>{if(!body.isConnected){unsubscribe();return;}status.textContent=P.portalInfo(id).status;});
  body.append(btn('Назад',()=>{unsubscribe();back();},'wide'));openSheet(body,{onClose:unsubscribe});
 }catch(e){toast(e.message);}
}

async function openSavedResults(team,back){
 try{
  const data=await loadCoach(),matches=data.coachMatches.filter(m=>m.teamId===team.id).sort((a,b)=>b.date.localeCompare(a.date)),search=input('search','',{placeholder:'Поиск по сопернику','aria-label':'Поиск результата'}),rows=el('div',{class:'vb-stack'});let limit=20;
  const more=btn('Показать ещё',()=>{limit+=20;draw();},'wide');
  function draw(){const q=search.value.trim().toLocaleLowerCase('ru'),chosen=matches.filter(m=>(m.opponent+' '+m.date).toLocaleLowerCase('ru').includes(q));rows.replaceChildren(...chosen.slice(0,limit).map(m=>{const s=matchScore(m);return card(m.opponent+' · '+s.ours+':'+s.theirs,p(m.date+' · '+m.sets.map(x=>x.ours+':'+x.theirs).join(' / ')),btn('Выбрать результат',()=>openPublicResult(team,m,()=>openSavedResults(team,back)),'wide'));}));if(!chosen.length)rows.append(p('Нет сохранённых результатов по выбранному условию.'));more.hidden=chosen.length<=limit;more.style.display=more.hidden?'none':'';}
  search.oninput=()=>{limit=20;draw();};draw();openSheet(el('div',{class:'vb-stack'},[el('h2',{text:'Добавить результат из истории'}),search,rows,more,btn('Назад',back,'wide')]));
 }catch(e){toast(e.message);}
}

async function openExtendedArchive(team,back){
 const id=team.id,body=el('div',{class:'vb-stack'}),list=el('div',{class:'vb-stack'}),notice=p(''),link=P.portalLink(id);let rows=[],cursor=null,busy=false,loaded=false,routeKey=null;
 const run=async fn=>{if(busy)return;busy=true;draw();try{await fn();}catch(e){notice.textContent=e.message;}finally{busy=false;draw();}};
 const load=async(next=false)=>{const page=await P.listExtendedArchive(id,{cursor:next?cursor:null,expectedRoute:routeKey});routeKey=page.routeKey;rows=[...new Map([...(next&&!page.reset?rows:[]),...page.rows].map(r=>[r.archiveKey,r])).values()];cursor=page.cursor;loaded=true;notice.textContent='Получено '+rows.length+' записей'+(cursor?' · есть следующие страницы':'');};
 const pending=el('div',{class:'vb-stack'});
 const send=btn('Отправить очередь в постоянный архив',()=>run(async()=>{const result=await P.sendPendingArchive(id,{confirm:n=>confirmDialog({title:'Опубликовать '+n+' результатов постоянно?',text:'Передаются только ранее разрешённые к публикации счета. Отличающиеся архивные записи не заменяются.',ok:'Отправить'})});if(!result.cancelled){await load();notice.textContent='Добавлено: '+result.copied+' · уже есть: '+result.existing+' · конфликты: '+result.conflicts+' · ошибки: '+result.failed;}}),'primary wide');
 const refresh=btn('Обновить список',()=>run(()=>load()),'wide');
 const copy=btn('Перенести последние опубликованные результаты',()=>run(async()=>{
  const result=await P.migrateExtendedArchive(id,{confirm:n=>confirmDialog({title:'Перенести '+n+' опубликованных результатов?',text:'Копируются только уже опубликованные счета. Отличающиеся записи не заменяются. Локальные матчи не затрагиваются.',ok:'Перенести'})});
  if(result.cancelled)return;const text='Добавлено: '+result.copied+' · уже есть: '+result.existing+' · конфликты: '+result.conflicts+' · ошибки: '+result.failed;await load();notice.textContent=text;
 }),'primary wide');
 function draw(){
  const more=btn('Следующая страница',()=>run(()=>load(true)),'wide');more.disabled=busy;
  const queued=P.portalInfo(id).data.archivePending;send.disabled=busy||!queued.length;pending.replaceChildren(p('Ожидают подтверждённой отправки: '+queued.length),...queued.map(r=>{const remove=btn('Убрать из очереди',()=>run(async()=>P.discardPendingArchive(id,r.id)),'wide');remove.disabled=busy;return card(r.opponent+' · '+r.setsWon.ours+':'+r.setsWon.theirs,p(date(r.startedAt)),remove);}));refresh.disabled=copy.disabled=busy;list.replaceChildren(...rows.map(r=>{
   const remove=btn('Убрать расширенную запись',()=>run(async()=>{
    const ok=await P.removeExtendedResult(id,r,{confirm:old=>confirmDialog({title:'Убрать '+old.opponent+' · '+old.setsWon.ours+':'+old.setsWon.theirs+'?',text:'Удаляется только расширенная публичная запись. Последние 20 результатов и локальная история не изменяются.',ok:'Убрать',danger:true})});
    if(ok){await load();notice.textContent='Расширенная запись удалена.';}
   }),'wide');remove.disabled=busy;
   return card(r.opponent+' · '+r.setsWon.ours+':'+r.setsWon.theirs,p(date(r.startedAt)),p(r.sets.map(x=>x.ours+':'+x.theirs).join(' / ')),link?el('a',{class:'btn wide',href:resultLink(link,r),target:'_blank',rel:'noopener noreferrer',text:'Постоянная ссылка матча'}):null,remove);
  }),cursor?more:null,loaded&&!rows.length?p('Архив пуст.'):null);
 }
 body.append(el('h2',{text:'Расширенный архив'}),p('Расширенная история хранится отдельно от последних 20 матчей. Снятие страницы с публикации скрывает архив; повторная публикация снова открывает оставленные записи. Чтобы удалить результат полностью, уберите его из обоих публичных списков.'),notice,pending,send,refresh,copy,...(migrationLabAllowed()?[btn('Миграция архива V3 · кандидат',()=>openArchiveMigration(team,()=>openExtendedArchive(team,back)),'wide')]:[]),list,btn('Назад',back,'wide'));openSheet(body,{fullHeight:true});await run(()=>load());
}

/** Explicit operator workflow. The saved backup must be re-imported from a file. */
function openArchiveMigration(team,back){
 if(!migrationLabAllowed()){toast('Миграция V3 отключена на публичном адресе.');return;}
 const id=team.id,body=el('div',{class:'vb-stack'}),notice=el('p',{role:'status'}),controls=el('div',{class:'vb-stack'});
 let state=null,backup=null,plan=null,busy=false;
 const op=(name,options={})=>P.archiveMigrationOperation(id,name,options);
 const run=async fn=>{if(busy)return;busy=true;draw();try{await fn();}catch(e){plan=null;notice.textContent=e.message;}finally{busy=false;draw();}};
 const refresh=async()=>{state=await op('inspect');if(backup&&backup.archive.generation!==state.generation)backup=null;plan=null;notice.textContent='Состояние подтверждено сервером.';};
 const change=(action,title,text,ok)=>run(async()=>{
  const expected={...state};
  if(!await confirmDialog({title,text,ok,danger:true}))return;
  state=await op(action,{expected,backup,confirmed:true});backup=null;plan=null;notice.textContent='Переход подтверждён сервером: '+state.phase;
 });
 const verify=async()=>{plan=await op('verify',{backup});notice.textContent='Сверено: V2 '+plan.sourceCount+' · V3 '+plan.destinationCount+' · осталось '+plan.ready.length+' · новости '+plan.news+' · турнир '+(plan.tournament?'есть':'нет');};
 function draw(){
  const items=[p(state?'Фаза: '+state.phase+' · поколение '+state.generation:'Сначала проверьте подключение и состояние.'),btn('Проверить состояние',()=>run(refresh),'wide')];
  if(state?.phase==='legacy')items.push(btn('Заморозить архив V2',()=>change('freeze','Заморозить архив?','Постоянный архив и медиацентр будут закрыты для изменений. Согласуйте остановку публикации с другими устройствами.','Заморозить'),'wide'));
  if(state?.phase==='frozen'){
   items.push(btn('Сохранить независимую JSON-копию',()=>run(async()=>{
    const saved=await op('backup'),url=URL.createObjectURL(new Blob([JSON.stringify(saved,null,2)],{type:'application/json'})),a=el('a',{href:url,download:'teachapp-archive-v3-g'+saved.archive.generation+'.json'});
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    notice.textContent='Сохраните файл отдельно, затем выберите его ниже. SHA-256: '+saved.sha256;
   }),'wide'));
   const file=input('file','',{accept:'.json,application/json','aria-label':'Независимая копия архива'});
   file.onchange=()=>run(async()=>{
    backup=null;plan=null;const f=file.files?.[0];if(!f)return;
    if(f.size>10000000)throw Error('Файл слишком большой');
    const value=JSON.parse(await f.text()),report=await verifyPublicMigrationBundle(value);
    if(report.generation!==state.generation)throw Error('Поколение миграции изменилось');
    plan=await op('verify',{backup:value});backup=value;
    notice.textContent='Сверено: V2 '+plan.sourceCount+' · V3 '+plan.destinationCount+' · осталось '+plan.ready.length+' · новости '+plan.news+' · турнир '+(plan.tournament?'есть':'нет');
   });
   items.push(field('Загрузить сохранённую копию',file),p(backup?'Копия проверена: '+backup.sha256:'Копия не загружена.'));
   if(backup){
    items.push(btn('Повторить полную сверку',()=>run(verify),'wide'));
    if(plan&&!plan.complete)items.push(btn('Копировать до 50 результатов',()=>run(async()=>{
     if(!await confirmDialog({title:'Копировать результаты?',text:'Только отсутствующие публичные счета. Записи не заменяются.',ok:'Копировать'}))return;
     const result=await op('copy',{backup,confirmed:true});await verify();notice.textContent='Скопировано: '+result.copied+' · осталось: '+result.remaining;
    }),'primary wide'));
    if(plan?.complete)items.push(btn('Активировать V3',()=>change('activate','Активировать архив V3?','Оба архива и медиацентр будут повторно сверены. Переход необратим: старые клиенты V2 требуют обновления.','Активировать'),'primary wide'));
   }
   items.push(btn('Отменить заморозку',()=>change('thaw','Вернуться к V2?','Скопированные записи V3 останутся. Для нового переноса потребуется новая копия.','Отменить заморозку'),'wide'));
  }
  if(state?.phase==='v3')items.push(p('V3 активен. Автоматический откат недоступен.'));
  controls.replaceChildren(...items);for(const node of controls.querySelectorAll('button,input'))node.disabled=busy;
 }
 body.append(el('h2',{text:'Миграция Firebase Archive V3 и медиа'}),p('Кандидат: используйте только согласованный тестовый контур с правилами V3. Не развёртывает правила и не переносит частные матчи. Активация необратима.'),notice,controls,btn('Назад',()=>{if(!busy)back();},'wide'));
 openSheet(body,{fullHeight:true});draw();
}
