import * as S from '../store.js';
import * as db from '../db.js';
import {syncAreas,normalizeEndpoint,relayClient,prepareSync,previewSync,executeSync,syncStatus,disconnectSync} from '../sync.js';
import {autoSyncStatus} from '../auto-sync.js';
import {parsePersonalCode,personalCredentials,readPersonalCode,savePersonalCode,forgetPersonalCode} from '../personal-sync.js';
import {createPairingCode,readPairingCode} from '../sync-pairing.js';
import {el,openSheet,closeSheet,isSheetOpen,confirmDialog,promptDialog,toast} from '../ui.js';

const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const field=(text,node)=>el('label',{class:'field'},[el('span',{text}),node]);
const labels={meta:'Учебный год и настройки школы',classes:'Классы',students:'Ученики',lessons:'Уроки',topics:'Темы',ktp:'КТП',schedule:'Расписание',scheduleOverrides:'Замены',marks:'Оценки',exemptions:'Освобождения',studentHealthProfiles:'Группы здоровья',activityRestrictions:'Ограничения нагрузки',activityCategories:'Виды нагрузки',participation:'Участие',norms:'Нормативы',normResults:'Результаты',finalGrades:'Итоговые оценки',monthly:'Архивные отметки',coachTeams:'Команды',coachPlayers:'Состав',coachTrainings:'Тренировки',coachMatches:'Матчи',coachLineups:'Расстановки',coachTests:'Тесты',workRecords:'Рабочая запись / история'};
const explain=v=>v===null?'Запись отсутствует (удаление)':JSON.stringify(v,null,2);
function blockConflict(c,onChoice){
 const select=el('select',{'aria-label':'Выбор версии '+(labels[c.store]||c.store)},[el('option',{value:'',text:'Не выбрано'}),el('option',{value:'local',text:'Оставить данные этого устройства'}),el('option',{value:'remote',text:'Принять данные с сервера'})]);
 const values=[['Общая ревизия',c.base],['Это устройство',c.local],['Сервер',c.remote]];
 const tooLarge=values.some(([,v])=>explain(v).length>100000);
 select.disabled=tooLarge;
 select.onchange=()=>onChoice(c.key,select.value);
 return el('section',{class:'card-block coach-card'},[el('h3',{text:labels[c.store]||c.store}),p('ID: '+c.id),
  ...values.map(([name,value])=>el('details',{},[el('summary',{text:name}),tooLarge?p('Слишком большая запись для безопасного сравнения в интерфейсе. Разрешите конфликт штатными инструментами.'):el('pre',{text:explain(value),style:'white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-size:12px'})])),select]);
}
export function openSync(){
 const area=el('select',{'aria-label':'Контур синхронизации'},Object.entries(syncAreas).map(([value,text])=>el('option',{value,text})));
 const endpoint=el('input',{type:'url',placeholder:'https://ваш-сервер',autocomplete:'off',spellcheck:'false'});
 const token=el('input',{type:'password',autocomplete:'off',spellcheck:'false'});
 const password=el('input',{type:'password',autocomplete:'off'});
 const status=el('p',{class:'profile-note','aria-live':'polite'}),results=el('div',{class:'coach-stack'}),choicesStatus=el('p',{class:'profile-note','aria-live':'polite'});
 let plan=null,client=null,secret=null,choices={},busy=false,seq=0,closed=false;
 const active=()=>!closed&&root.isConnected&&isSheetOpen();
 function clear(){plan=null;client=null;secret=null;choices={};token.value='';password.value='';results.replaceChildren();choicesStatus.textContent='';apply.disabled=true;}
 function controls(disabled){area.disabled=endpoint.disabled=token.disabled=password.disabled=preview.disabled=detach.disabled=pairCreate.disabled=pairImport.disabled=personalConnect.disabled=personalForget.disabled=disabled;}
 async function refresh(){
  const n=++seq,selected=area.value;
  try{
   const cp=await syncStatus(selected);if(n!==seq||closed)return;
   endpoint.value=cp?.endpoint||'';
   const saved=readPersonalCode();
   if(saved){const credentials=await personalCredentials(saved,selected);if(n!==seq||closed)return;
    if(!cp||cp.endpoint===credentials.endpoint){endpoint.value=credentials.endpoint;token.value=credentials.token;password.value=credentials.password;}
   }
   const report=autoSyncStatus(),summary=report.areas.map(r=>syncAreas[r.area]+': '+({synced:'синхронизировано',setup:'нужно первое подключение',conflict:'конфликт',review:'требуется подтверждение удаления',error:'не удалось обменяться данными',paused:'приостановлено'}[r.status]||r.status)).join(' · ');
   personalStatus.textContent=saved?'Личный код сохранён на этом устройстве.'+(report.at?' Последняя автопроверка: '+new Date(report.at).toLocaleString('ru-RU')+'. '+summary:''):'Личный код не сохранён.';
   personalForget.hidden=!saved;
   status.textContent=cp?'Последняя подтверждённая ревизия: '+cp.revision:'Контур пока не подключён.';
   detach.hidden=!cp;detach.style.display=cp?'':'none';
  }catch{if(n===seq)status.textContent='Не удалось прочитать состояние.';}
 }
 async function drawSummary(){
  const n=++seq,chosen=plan;if(!chosen)return;
  apply.disabled=true;
  try{
   const next=previewSync(await db.dumpAll(),chosen,choices);
   if(n!==seq||chosen!==plan||closed)return;
   if(next.conflicts.length){choicesStatus.textContent='Осталось разрешить: '+next.conflicts.length;return;}
   choicesStatus.textContent='На этом устройстве: новых '+next.counts.added+', изменённых '+next.counts.changed+', удалённых '+next.counts.deleted+'. Сервер получит итоговый зашифрованный снимок.';
   apply.disabled=busy;
  }catch(e){if(n===seq)choicesStatus.textContent=e.message;}
 }
 const preview=btn('Получить и сравнить ревизии',async()=>{
  if(busy)return;
  const selected=area.value,t=token.value,pw=password.value;
  let address;
  try{address=normalizeEndpoint(endpoint.value);}catch(e){toast(e.message);return;}
  clear();busy=true;controls(true);
  try{
   if(!await confirmDialog({title:'Подключиться к своему серверу?',text:'Адрес: '+address+'. На этом этапе передаётся ключ доступа и запрашивается только зашифрованная ревизия. Используйте согласованный сервер и закройте другие окна TeachApp. Не используйте реальные данные до отдельной проверки безопасности.',ok:'Сравнить'}))return;
   client=relayClient(address,selected,t);secret=pw;
   plan=await prepareSync({area:selected,endpoint:address,password:secret,client});
   if(!active()){clear();return;}
   status.textContent='Ревизия на сервере: '+plan.revision+' · '+syncAreas[selected];
   if(plan.conflicts.length>100){choicesStatus.textContent='Слишком много конфликтов. Сначала согласуйте данные на устройствах; автоматическая перезапись запрещена.';return;}
   results.replaceChildren(p(plan.conflicts.length?'Конфликтов: '+plan.conflicts.length+'. Выберите версию каждой записи.':'Конкурирующих изменений не обнаружено.'),...plan.conflicts.map(c=>blockConflict(c,(key,value)=>{if(value)choices[key]=value;else delete choices[key];drawSummary();})));
  }catch(e){clear();if(active())toast(e.message,null,8000);}
  finally{busy=false;controls(false);if(plan&&plan.conflicts.length<=100&&active())await drawSummary();}
 },'primary');
 const apply=btn('Синхронизировать и сохранить',async()=>{
  if(busy||!plan||!secret||!client)return;
  const selected=plan,selectedClient=client,pw=secret;
  busy=true;controls(true);apply.disabled=true;
  try{
   if(selected.revision===0){
    const repeat=await promptDialog({title:'Подтвердите пароль нового контура',text:'Один пароль шифрования для всех доверенных устройств этого контура; храните отдельно от ключей доступа.',password:true,ok:'Далее'});
    if(repeat!==pw){if(repeat!==null)toast('Пароли не совпадают');return;}
   }
   if(!await confirmDialog({title:'Передать зашифрованные данные и применить изменения?',text:'Контур: '+syncAreas[selected.area]+'. Будут переданы записи выбранной области, в том числе персональные сведения и история, в зашифрованном виде. Создайте защищённую резервную копию заранее. Удаления также распространяются. Не закрывайте приложение во время записи.',ok:'Синхронизировать',danger:true}))return;
   const result=await executeSync({plan:selected,choices:{...choices},password:pw,client:selectedClient,confirmed:true});
   await S.load();clear();if(active()){await refresh();status.textContent='Синхронизировано · ревизия '+result.revision;}
   toast('Синхронизация завершена · ревизия '+result.revision);
  }catch(e){clear();toast(e.message,null,9000);}
  finally{busy=false;controls(false);if(plan&&active())await drawSummary();}
 },'primary');apply.disabled=true;
 const detach=btn('Забыть подключение на этом устройстве',async()=>{
  if(busy)return;
  if(!await confirmDialog({title:'Отключить контур?',text:'Локальные записи и серверная копия останутся. Удаляется только общая ревизия на этом устройстве. Если данные отличаются, повторное подключение потребует отдельного согласования. Для отзыва ключа обратитесь к администратору сервера.',ok:'Отключить',danger:true}))return;
  clear();try{await disconnectSync(area.value,true);await refresh();}catch(e){toast(e.message);}
 });
 const personalStatus=el('p',{class:'profile-note','aria-live':'polite'});
 const personalConnect=btn('Ввести личный код',async()=>{
  if(busy)return;
  busy=true;controls(true);apply.disabled=true;
  try{
   const value=await promptDialog({title:'Личный код TeachApp',text:'Вставьте один и тот же секретный код на iPhone и ПК.',password:true,ok:'Продолжить'});
   if(value===null||!active())return;
   const parsed=parsePersonalCode(value);
   for(const scope of Object.keys(syncAreas)){
    const cp=await syncStatus(scope);
    if(cp&&cp.endpoint!==parsed.endpoint)throw Error('Есть подключение к другому серверу. Сначала согласуйте данные и отключите старый контур.');
   }
   if(!active())return;
   if(!await confirmDialog({title:'Сохранить личный код?',text:'Сервер: '+parsed.endpoint+'. Код будет храниться в браузере этого устройства без дополнительного пароля. Любой, кто имеет доступ к профилю браузера, может получить код. Только на личном защищённом устройстве. Пока данные не отправляются.',ok:'Сохранить'}))return;
   if(!active())return;
   savePersonalCode(parsed.code);clear();await refresh();
   toast('Код сохранён. Выполните первое сравнение для каждого нужного контура.');
  }catch(e){if(active())toast(e.message,null,8000);}
  finally{busy=false;controls(false);if(plan&&active())await drawSummary();}
 },'primary');
 const personalForget=btn('Забыть личный код',async()=>{
  if(busy)return;
  if(!await confirmDialog({title:'Забыть личный код?',text:'Код удалится только из этого браузера. Локальные записи, ревизии и серверная копия останутся. Код на другом устройстве продолжит работать.',ok:'Забыть',danger:true}))return;
  try{forgetPersonalCode();clear();await refresh();}catch(e){toast(e.message);}
 });
 const pairCreate=btn('Создать код для другого устройства',async()=>{
  if(busy)return;
  const selected=area.value;
  let address;
  try{address=normalizeEndpoint(endpoint.value);}catch(e){toast(e.message);return;}
  busy=true;controls(true);apply.disabled=true;
  try{
   const newToken=await promptDialog({title:'Ключ второго устройства',text:'Введите отдельный ключ, уже разрешённый администратором сервера для этого контура. Не используйте ключ текущего устройства.',password:true,ok:'Далее'});
   if(newToken===null||!active())return;
   if(newToken===token.value)throw Error('Нужен другой ключ устройства');
   const pw=await promptDialog({title:'Защитите код подключения',text:'Введите общий пароль шифрования контура. На втором устройстве потребуется тот же пароль. Не передавайте пароль вместе с кодом.',password:true,ok:'Создать код'});
   if(pw===null||!active())return;
   const code=await createPairingCode({endpoint:address,area:selected,token:newToken},pw);
   if(!active())return;
   await promptDialog({title:'Код подключения',text:'Скопируйте код на доверенное устройство. Он зашифрован, но не одноразовый; храните его как секрет. Код не создаёт новый серверный ключ.',value:code,multiline:true,ok:'Закрыть'});
  }catch(e){if(active())toast(e.message,null,8000);}
  finally{busy=false;controls(false);if(plan&&active())await drawSummary();}
 });
 const pairImport=btn('Подключить по коду',async()=>{
  if(busy)return;
  busy=true;controls(true);apply.disabled=true;
  try{
   const code=await promptDialog({title:'Подключить устройство',text:'Вставьте код с доверенного устройства. До явного сравнения сетевых запросов и изменений базы не будет.',password:true,ok:'Далее'});
   if(code===null||!active())return;
   const pw=await promptDialog({title:'Пароль контура',text:'Введите общий пароль шифрования, которым защищён код.',password:true,ok:'Открыть'});
   if(pw===null||!active())return;
   const profile=await readPairingCode(code,pw);
   if(!active())return;
   const cp=await syncStatus(profile.area);
   if(!active())return;
   if(cp&&cp.endpoint!==profile.endpoint)throw Error('Этот контур уже подключён к другому серверу. Сначала согласуйте существующее подключение.');
   if(!await confirmDialog({title:'Применить параметры подключения?',text:'Контур: '+syncAreas[profile.area]+'. Сервер: '+profile.endpoint+'. Продолжайте только если узнаёте этот адрес. Данные пока не отправляются.',ok:'Применить'}))return;
   if(!active())return;
   ++seq;clear();
   area.value=profile.area;endpoint.value=profile.endpoint;token.value=profile.token;password.value=pw;
   status.textContent=cp?'Последняя подтверждённая ревизия: '+cp.revision:'Код принят. Нажмите «Получить и сравнить ревизии».';
   detach.hidden=!cp;detach.style.display=cp?'':'none';
  }catch(e){if(active())toast(e.message,null,8000);}
  finally{busy=false;controls(false);if(plan&&active())await drawSummary();}
 });
 area.onchange=()=>{clear();refresh();};
 for(const input of [endpoint,token,password])input.oninput=()=>{if(plan){plan=null;client=null;secret=null;choices={};results.replaceChildren();choicesStatus.textContent='';apply.disabled=true;}};
 const root=el('div',{class:'coach-form'},[el('h2',{text:'Синхронизация устройств · бета'}),p('Личное пространство: один секретный код на всех доверенных устройствах. Приложение остаётся автономным. Первую синхронизацию каждого контура подтвердите вручную. После этого обмен без конфликтов и удалений выполняется автоматически при открытии и на главном экране; спорные изменения подтверждаются здесь.'),personalStatus,personalConnect,personalForget,p('Школа и тренер разделены. Общие упражнения, инвентарь, календарные события и турниры пока остаются локальными. Активные черновики матчей не синхронизируются. Закройте другие окна приложения.'),pairImport,field('Рабочая область',area),status,field('Адрес собственного сервера',endpoint),field('Индивидуальный ключ доступа',token),field('Общий пароль шифрования контура',password),pairCreate,preview,results,choicesStatus,apply,detach,btn('Закрыть',closeSheet)]);
 openSheet(root,{fullHeight:true,onClose:()=>{closed=true;clear();}});
 refresh();
}
