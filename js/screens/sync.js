import {readSyncIdentity,identityCredentials,identityAreas,readTrustedProfile,forgetTrustedProfile,trustedCredentials,hasTrustedProfileRecord} from '../device-trust.js';
import {openTrustedDevices} from './trusted-devices.js';
import * as S from '../store.js';
import * as db from '../db.js';
import {ktpLinkIssues} from '../backup.js';
import {syncAreas,normalizeEndpoint,relayClient,prepareSync,previewSync,executeSync,syncStatus,localSyncState,describeSyncConflict,disconnectSync,localScopeUploadSize,syncUploadBytes,syncDeltaEstimate,defaultCloudflarePacketLimit,migrationBindingStatus} from '../sync.js';
import {createDeviceInvite,redeemDeviceInvite,parseInvite} from '../device-invite.js';
import {autoSyncStatus,withSyncSession,runPersonalSync} from '../auto-sync.js';
import {parsePersonalCode,personalCredentials,readPersonalCode,savePersonalCode,forgetPersonalCode} from '../personal-sync.js';
import {createPairingCode,readPairingCode} from '../sync-pairing.js';
import {el,openSheet,closeSheet,isSheetOpen,confirmDialog,promptDialog,toast} from '../ui.js';

const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const field=(text,node)=>el('label',{class:'field'},[el('span',{text}),node]);
const labels={meta:'Учебный год и настройки школы',classes:'Классы',students:'Ученики',lessons:'Уроки',topics:'Темы',ktp:'КТП',schedule:'Расписание',scheduleOverrides:'Замены',marks:'Оценки',exemptions:'Освобождения',studentHealthProfiles:'Группы здоровья',activityRestrictions:'Ограничения нагрузки',activityCategories:'Виды нагрузки',participation:'Участие',norms:'Нормативы',normResults:'Результаты',finalGrades:'Итоговые оценки',monthly:'Архивные отметки',coachTeams:'Команды',coachPlayers:'Состав',coachTrainings:'Тренировки',coachMatches:'Матчи',coachLineups:'Расстановки',coachTests:'Тесты',workRecords:'Рабочая запись / история'};
const packetSizeText=bytes=>{
 const percent=Math.round(100*bytes/defaultCloudflarePacketLimit);
 return (bytes/1024).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})+' КиБ · '+percent+'% лимита стандартного Cloudflare Worker (1 МиБ)'+(bytes>defaultCloudflarePacketLimit?' · превышение лимита':bytes>=defaultCloudflarePacketLimit*.8?' · приближение к лимиту':'');
};
const explain=v=>v===null?'Запись отсутствует (удаление)':JSON.stringify(v,null,2);
const fieldNames={name:'Название / имя',date:'Дата',value:'Значение',mark:'Отметка',weight:'Вес',title:'Тема / заголовок',classId:'Класс (ID)',studentId:'Ученик (ID)',lessonId:'Урок (ID)',from:'Начало',to:'Окончание',status:'Статус',reason:'Причина',note:'Примечание',score:'Счёт',opponent:'Соперник'};
function conflictValue(value){
 if(value===undefined)return 'Не задано';
 if(value===null)return 'Нет значения';
 if(typeof value==='boolean')return value?'Да':'Нет';
 if(Array.isArray(value))return 'Список ('+value.length+') — см. полную запись';
 if(typeof value==='object')return 'Составное поле — см. полную запись';
 const str=String(value);return str.length>120?str.slice(0,120)+'…':str;
}
function blockConflict(c,onChoice){
 const select=el('select',{'aria-label':'Выбор версии '+(labels[c.store]||c.store)},[el('option',{value:'',text:'Не выбрано'}),el('option',{value:'local',text:c.local===null?'Удалить запись (как на этом устройстве)':'Оставить данные этого устройства'}),el('option',{value:'remote',text:c.remote===null?'Удалить запись (как на сервере)':'Принять данные с сервера'})]);
 const values=[['Общая ревизия',c.base],['Это устройство',c.local],['Сервер',c.remote]];
 const tooLarge=values.some(([,v])=>explain(v).length>100000);
 select.disabled=tooLarge;
 select.onchange=()=>onChoice(c.key,select.value);
 const summary=describeSyncConflict(c),kind={created:'Разные варианты новой записи',deleted:'Удаление против изменения',changed:'Обе версии изменены'}[summary.kind];
 const fields=summary.fields.slice(0,12).map(f=>el('p',{style:'white-space:pre-wrap;overflow-wrap:anywhere'},[
  el('strong',{text:fieldNames[f.key]||f.key}), '\nЭто устройство: '+(c.local===null?'Запись удалена':conflictValue(f.local))+(f.localChanged?' (изменено)':'')+'\nСервер: '+(c.remote===null?'Запись удалена':conflictValue(f.remote))+(f.remoteChanged?' (изменено)':'')
 ]));
 return el('section',{class:'card-block coach-card'},[el('h3',{text:labels[c.store]||c.store}),p(kind),p('ID: '+c.id),
  ...fields,...(summary.fields.length>12?[p('Других отличающихся полей: '+(summary.fields.length-12)+'. Откройте полные записи.')]:[]),
  ...values.map(([name,value])=>el('details',{},[el('summary',{text:name}),tooLarge?p('Слишком большая запись для безопасного сравнения в интерфейсе. Разрешите конфликт штатными инструментами.'):el('pre',{text:explain(value),style:'white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-size:12px'})])),p('Выбирается вся запись, а не отдельные поля. Удаление будет применено только после подтверждения.'),select]);
}
// Repair only after explicit selection and confirmation; no network requests.
export async function openKtpDiagnostics(){
 try{
  const data=await db.dumpAll(),issues=ktpLinkIssues(data);
  const root=el('div',{class:'coach-form'},[el('h2',{text:'Диагностика КТП'}),p('Только локальная проверка. Перед исправлением сохраните защищённую резервную копию. Темы, уроки, ученики и оценки не удаляются.')]);
  if(!issues.length)root.append(p('Некорректных полей и связей КТП не обнаружено.'));
  for(const issue of issues){
   const row=data.ktp.find(k=>k.id===issue.id);
   const name=el('input',{type:'text',value:issue.name,placeholder:'Название КТП'});
   const checks=data.classes.map(c=>({id:c.id,node:el('input',{type:'checkbox',checked:Array.isArray(row.classIds)&&row.classIds.includes(c.id)})}));
   const detail=el('div',{class:'card-block coach-card'},[el('h3',{text:issue.name||'КТП без названия'}),p([issue.missingName?'Не указано название':'',issue.missingList?'Нет корректного списка классов':'',issue.invalidCount?'Связей с отсутствующими классами: '+issue.invalidCount:''].filter(Boolean).join(' · ')),field('Название плана',name),p('Выберите классы, к которым относится этот план.'),...checks.map((c,i)=>el('label',{class:'row-item'},[c.node,el('span',{text:data.classes[i].name})]))]);
   const save=btn('Исправить этот КТП',async()=>{
    if(!name.value.trim()){toast('Укажите название плана');return;}
    const ids=checks.filter(c=>c.node.checked).map(c=>c.id);
    if(!await confirmDialog({title:'Сохранить исправление?',text:'Будет изменено только название и список привязанных классов этого КТП. Темы и уроки сохранятся. Резервная копия должна быть сохранена заранее.',ok:'Исправить'}))return;
    save.disabled=true;
    try{
     const result=await withSyncSession(async()=>{await S.repairKtpPlan(row,name.value,ids,true);return true;});
     if(!result)throw Error('Закройте другие вкладки TeachApp.');
     toast('КТП исправлено');await openKtpDiagnostics();
    }catch(e){toast(e.message);save.disabled=false;}
   },'primary');
   detail.append(save);root.append(detail);
  }
  root.append(btn('Закрыть',closeSheet));openSheet(root,{fullHeight:true});
 }catch(e){toast('Не удалось проверить КТП: '+e.message);}
}
export function openSync(){
 const area=el('select',{'aria-label':'Контур синхронизации'},Object.entries(syncAreas).map(([value,text])=>el('option',{value,text})));
 const endpoint=el('input',{type:'url',placeholder:'https://ваш-сервер',autocomplete:'off',spellcheck:'false'});
 const token=el('input',{type:'password',autocomplete:'off',spellcheck:'false'});
 const password=el('input',{type:'password',autocomplete:'off'});
 const status=el('p',{class:'profile-note','aria-live':'polite'}),results=el('div',{class:'coach-stack'}),choicesStatus=el('p',{class:'profile-note','aria-live':'polite'});
 let plan=null,client=null,secret=null,choices={},busy=false,seq=0,closed=false;
 const active=()=>!closed&&root.isConnected&&isSheetOpen();
 const permitted=()=>active()&&document.visibilityState!=='hidden'&&!document.body.classList.contains('privacy-covered');
 function clear(){plan=null;client=null;secret=null;choices={};token.value='';password.value='';results.replaceChildren();choicesStatus.textContent='';apply.disabled=true;}
 function controls(disabled){area.disabled=endpoint.disabled=token.disabled=password.disabled=preview.disabled=detach.disabled=pairCreate.disabled=pairImport.disabled=personalConnect.disabled=personalForget.disabled=inviteCreate.disabled=inviteImport.disabled=both.disabled=disabled;}
 async function refresh(){
  const n=++seq,selected=area.value;
  try{
   const [cp,binding]=await Promise.all([syncStatus(selected),migrationBindingStatus(selected)]);if(n!==seq||closed)return;
   endpoint.value=cp?.endpoint||'';
   const saved=readSyncIdentity();
   if(saved&&identityAreas(saved).includes(selected)){const credentials=await identityCredentials(saved,selected);if(n!==seq||closed)return;
    if(binding.status==='none'&&(!cp||cp.endpoint===credentials.endpoint)){endpoint.value=credentials.endpoint;token.value=credentials.token;password.value=credentials.password;}
   }
   const report=autoSyncStatus(),summary=report.areas.map(r=>syncAreas[r.area]+': '+({synced:'синхронизировано',setup:'нужно первое подключение',conflict:'конфликт',review:'требуется подтверждение удаления',error:'не удалось обменяться данными',paused:'приостановлено'}[r.status]||r.status)+(r.reason==='migration-binding'?' (нужен согласованный возврат Delta LAB)':r.reason==='packet-too-large'?' (пакет слишком велик)':r.reason==='remote-unconfirmed'?' (сервер мог принять пакет; сравните ревизии)':'')).join(' · ');
   const successes=report.areas.filter(r=>r.status==='synced'&&r.successfulAt).map(r=>syncAreas[r.area]+': '+new Date(r.successfulAt).toLocaleString('ru-RU')).join(' · ');
   personalStatus.textContent=saved?(readTrustedProfile()?'Индивидуальный профиль v2 сохранён.':'Личный код сохранён на этом устройстве.')+(report.phase==='offline'?' Нет сети.':report.phase==='running'?' Обмен выполняется.':report.phase==='interrupted'?' Обмен прерван.':'')+(report.at?' Последняя проверка: '+new Date(report.at).toLocaleString('ru-RU')+'. '+summary:'')+(successes?' Успешный обмен в последней попытке: '+successes:''):'Личный код не сохранён.';
   personalForget.hidden=!saved&&!hasTrustedProfileRecord();inviteCreate.hidden=!saved||!!readTrustedProfile();both.hidden=!saved;inviteImport.hidden=Boolean(saved)||hasTrustedProfileRecord();personalConnect.hidden=hasTrustedProfileRecord();
   status.textContent=binding.status!=='none'?'Обмен этого контура остановлен: экспериментальный перенос Delta LAB. Не удаляйте контрольную точку и не восстанавливайте копию поверх базы.':cp?'Последняя подтверждённая ревизия: '+cp.revision:'Контур пока не подключён.';
   detach.hidden=!cp||binding.status!=='none';detach.style.display=detach.hidden?'none':'';
   localStatus.hidden=!saved;
   if(saved){
    localStatus.textContent='Сравнение локальных записей с последней принятой ревизией…';
    try{
     const data=await db.dumpAll();
     const local=await Promise.all(identityAreas(saved).map(async scope=>localSyncState({...await identityCredentials(saved,scope),data})));
     if(n!==seq||closed||readSyncIdentity()!==saved)return;
     const labels={setup:'не подключён',clean:'локальных изменений нет',pending:'есть изменения, ещё не подтверждённые облаком',review:'нужна проверка подключения или данных'};
     localStatus.textContent=local.map(x=>syncAreas[x.area]+': '+labels[x.status]+(x.reason==='migration-binding'?' · незавершённый перенос Delta LAB':'')+(x.successfulAt?' · последняя успешная проверка '+new Date(x.successfulAt).toLocaleString('ru-RU'):'')).join('\n');
    }catch{if(n===seq&&!closed)localStatus.textContent='Не удалось сравнить локальные записи.';}
   }else localStatus.textContent='';
  }catch{if(n===seq)status.textContent='Не удалось прочитать состояние.';}
 }
 async function drawSummary(){
  const n=++seq,chosen=plan;if(!chosen)return;
  apply.disabled=true;
  try{
   const next=previewSync(await db.dumpAll(),chosen,choices);
   if(n!==seq||chosen!==plan||closed)return;
   if(next.conflicts.length){choicesStatus.textContent='Осталось разрешить: '+next.conflicts.length;return;}
   choicesStatus.textContent='На этом устройстве: новых '+next.counts.added+', изменённых '+next.counts.changed+', удалённых '+next.counts.deleted+'. Сервер получит итоговый зашифрованный снимок. Размер PUT: '+packetSizeText(syncUploadBytes(next.snapshot,{area:chosen.area,workspaceId:chosen.workspaceId,expectedRevision:chosen.revision}))+'. У другого relay лимит может отличаться.';
   if(chosen.revision>0){
    try{
     const delta=syncDeltaEstimate(chosen.remote,next.snapshot,{area:chosen.area,workspaceId:chosen.workspaceId,baseRevision:chosen.revision});
     if(delta.changedRecords)choicesStatus.textContent+=' Экспериментальная оценка передачи только изменений: '+packetSizeText(delta.bytes)+' · записей: '+delta.changedRecords+'. Сейчас по-прежнему отправляется полный снимок.';
    }catch{/* A comparison must never block the existing sync protocol. */}
   }
   apply.disabled=busy;
  }catch(e){if(n===seq){choicesStatus.textContent=e.message;if(e.message.includes('разделе ktp'))results.append(btn('Проверить и исправить КТП',openKtpDiagnostics));}}
 }
 const preview=btn('Получить и сравнить ревизии',async()=>{
  if(busy)return;
  const selected=area.value,t=token.value,pw=password.value;
  try{if((await migrationBindingStatus(selected)).status!=='none'){toast('Сначала согласуйте возврат экспериментального переноса Delta LAB');return;}}catch(e){toast(e.message);return;}
  let address;
  try{address=normalizeEndpoint(endpoint.value);}catch(e){toast(e.message);return;}
  clear();busy=true;controls(true);
  try{
   if(!await confirmDialog({title:'Подключиться к своему серверу?',text:'Адрес: '+address+'. На этом этапе передаётся ключ доступа и запрашивается только зашифрованная ревизия. Используйте согласованный сервер и закройте другие окна TeachApp. Не используйте реальные данные до отдельной проверки безопасности.',ok:'Сравнить'}))return;
   const profile=readTrustedProfile();if(hasTrustedProfileRecord()&&!profile)throw Error('Индивидуальный профиль повреждён; откройте доверенные устройства');if(profile){const v=trustedCredentials(profile,selected);if(v.endpoint!==address||v.token!==t||v.password!==pw)throw Error('Используйте параметры сохранённого индивидуального профиля');}client=relayClient(address,selected,t,{protocolVersion:profile?2:1});secret=pw;
   plan=await prepareSync({area:selected,endpoint:address,password:secret,client});
   if(!active()){clear();return;}
   status.textContent='Ревизия на сервере: '+plan.revision+' · '+syncAreas[selected];
   if(plan.conflicts.length>100){choicesStatus.textContent='Слишком много конфликтов. Сначала согласуйте данные на устройствах; автоматическая перезапись запрещена.';return;}
   results.replaceChildren(p(plan.conflicts.length?'Конфликтов: '+plan.conflicts.length+'. Выберите версию каждой записи.':'Конкурирующих изменений не обнаружено.'),...plan.conflicts.map(c=>blockConflict(c,(key,value)=>{if(value)choices[key]=value;else delete choices[key];drawSummary();})));
  }catch(e){clear();if(active()){if(readPersonalCode())await refresh();toast(e.message,null,8000);}}
  finally{busy=false;controls(false);if(plan&&plan.conflicts.length<=100&&active())await drawSummary();}
 },'primary');
 const apply=btn('Синхронизировать и сохранить',async()=>{
  if(busy||!plan||!secret||!client)return;
  const selected=plan,selectedClient=client,pw=secret;
  busy=true;controls(true);apply.disabled=true;
  try{
   const code=readSyncIdentity();
   const saved=code&&identityAreas(code).includes(selected.area)?await identityCredentials(code,selected.area):null;
   if(selected.revision===0&&!(saved&&saved.endpoint===selected.endpoint&&saved.password===pw)){
    const repeat=await promptDialog({title:'Подтвердите пароль нового контура',text:'Один пароль шифрования для всех доверенных устройств этого контура; храните отдельно от ключей доступа.',password:true,ok:'Далее'});
    if(repeat!==pw){if(repeat!==null)toast('Пароли не совпадают');return;}
   }
   if(!await confirmDialog({title:'Передать зашифрованные данные и применить изменения?',text:'Контур: '+syncAreas[selected.area]+'. Будут переданы записи выбранной области, в том числе персональные сведения и история, в зашифрованном виде. Создайте защищённую резервную копию заранее. Удаления также распространяются. Не закрывайте приложение во время записи.',ok:'Синхронизировать',danger:true}))return;
   let stopped=false;
   const stillAllowed=()=>{if(!stopped)stopped=!permitted()||readSyncIdentity()!==code||navigator.onLine===false;return !stopped;};
   const result=await withSyncSession(()=>executeSync({plan:selected,choices:{...choices},password:pw,client:selectedClient,confirmed:true,stillAllowed}));
   if(!result)throw Error('Закройте другие вкладки TeachApp перед синхронизацией.');
   await S.load();clear();if(active()){await refresh();status.textContent='Синхронизировано · ревизия '+result.revision;}
   toast('Синхронизация завершена · ревизия '+result.revision);
  }catch(e){clear();if(active()&&readPersonalCode())await refresh();toast(e.message,null,9000);}
  finally{busy=false;controls(false);if(plan&&active())await drawSummary();}
 },'primary');apply.disabled=true;
 const detach=btn('Забыть подключение на этом устройстве',async()=>{
  if(busy)return;
  if(!await confirmDialog({title:'Отключить контур?',text:'Локальные записи и серверная копия останутся. Удаляется только общая ревизия на этом устройстве. Если данные отличаются, повторное подключение потребует отдельного согласования. Для отзыва ключа обратитесь к администратору сервера.',ok:'Отключить',danger:true}))return;
  clear();try{await disconnectSync(area.value,true);await refresh();}catch(e){toast(e.message);}
 });
 async function saveConnection(code){
  const parsed=parsePersonalCode(code);
  for(const scope of Object.keys(syncAreas)){
   const cp=await syncStatus(scope);
   if(cp&&cp.endpoint!==parsed.endpoint)throw Error('Сначала согласуйте прежнее подключение.');
  }
  if(!active())return false;
  savePersonalCode(parsed.code);clear();await refresh();S.notify();return true;
 }
 async function exchangeBoth(){
  if(!readSyncIdentity())throw Error('Сначала подключите устройство');
  const result=await withSyncSession(async()=>{
   const report=await runPersonalSync({initialize:true,permitted});await S.load();return report;
  });
  if(!result)throw Error('Закройте другие вкладки TeachApp.');
  const statuses={synced:'готово',setup:'нужно подключение',conflict:'конфликт',review:'подтвердите изменения',error:'нужна проверка данных или подключения',paused:'обмен остановлен'};
  simpleResult.textContent=result.areas.map(r=>syncAreas[r.area]+': '+(r.reason==='packet-too-large'?'пакет превышает лимит сервера':r.reason==='remote-unconfirmed'?'сервер мог принять пакет — сравните ревизии':statuses[r.status]||'обмен не выполнен')).join(' · ')||'Обмен остановлен до записи.';
  const issues=ktpLinkIssues(await db.dumpAll());
  if(issues.length)simpleResult.textContent+=' · Исправьте КТП через диагностику.';
  await refresh();
  return result.phase==='finished'&&result.areas.length>0&&result.areas.every(x=>x.status==='synced');
 }
 const simpleResult=el('p',{class:'profile-note','aria-live':'polite'});
 const both=btn('Синхронизировать доступные области',async()=>{
  if(busy)return;
  if(!await confirmDialog({title:'Синхронизировать обе области?',text:'Будут переданы только зашифрованные записи. Первое подключение не заменяет отличающиеся данные, конфликты и удаления требуют отдельного подтверждения. Сохраните защищённую копию. Только тестовые данные до согласования.',ok:'Синхронизировать'}))return;
  clear();busy=true;controls(true);
  try{await exchangeBoth();}catch(e){toast(e.message);}finally{busy=false;controls(false);}
 },'primary');
 const inviteCreate=btn('Создать код для компьютера',async()=>{
  if(busy)return;
  busy=true;controls(true);
  try{
   if(!await confirmDialog({title:'Подключить другое устройство?',text:'Сначала проверим и синхронизируем школу и тренера, без перезаписи отличающихся данных. Сохраните защищённую копию; используйте только тестовые записи до согласования. Затем создадим одноразовый код на 10 минут, предоставляющий полный доступ к личному пространству. Передайте его только на свой компьютер.',ok:'Создать'}))return;
   clear();
   if(!await exchangeBoth()){toast('Сначала устраните замечания синхронизации. Код пока не создан.');return;}
   if(!active())return;
   const code=await createDeviceInvite(readPersonalCode());
   if(!active())return;
   await promptDialog({title:'Код для компьютера',text:'Скопируйте код и введите его на другом устройстве. Действует 10 минут, только один раз.',value:code,multiline:true,ok:'Закрыть'});
  }catch(e){toast(e.message,null,8000);}finally{busy=false;controls(false);}
 });
 const inviteImport=btn('Ввести код с телефона',async()=>{
  if(busy)return;
  busy=true;controls(true);
  try{
   const value=await promptDialog({title:'Код подключения',text:'Введите одноразовый код TAC1 с телефона.',password:true,ok:'Продолжить'});
   if(value===null||!active())return;
   const invite=parseInvite(value);
   if(!await confirmDialog({title:'Подключить и синхронизировать?',text:'Сервер: '+invite.endpoint+'. Личный ключ сохранится на этом устройстве. Будет выполнена первая проверка школы и тренера без перезаписи отличающейся базы. Используйте только личное защищённое устройство и тестовые данные.',ok:'Подключить'}))return;
   const code=await redeemDeviceInvite(value);
   if(await saveConnection(code))await exchangeBoth();
  }catch(e){toast(e.message,null,8000);}finally{busy=false;controls(false);}
 },'primary');
 const personalStatus=el('p',{class:'profile-note','aria-live':'polite'});
 const localStatus=el('p',{class:'profile-note','aria-live':'polite',style:'white-space:pre-line',hidden:true});
 const sizeStatus=el('div',{class:'profile-note','aria-live':'polite'});
 const sizeCheck=btn('Проверить размер пакетов',async()=>{
  if(busy||sizeCheck.disabled)return;
  sizeCheck.disabled=true;
  try{
   const data=await db.dumpAll(),rows=[];
   for(const scope of Object.keys(syncAreas)){
    try{const size=localScopeUploadSize(data,scope);rows.push(p(syncAreas[scope]+': '+packetSizeText(size.bytes)+' · записей: '+size.records));}
    catch(e){rows.push(p(syncAreas[scope]+': '+e.message));}
   }
   if(active())sizeStatus.replaceChildren(p('Локальная оценка, без отправки данных. После слияния размер может измениться. У другого relay лимит может отличаться.'),...rows);
  }catch{if(active())sizeStatus.replaceChildren(p('Не удалось прочитать локальные данные.'));}
  finally{sizeCheck.disabled=false;}
 });
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
   if(await saveConnection(parsed.code))toast('Код сохранён. Нажмите «Создать код для компьютера».');
  }catch(e){if(active())toast(e.message,null,8000);}
  finally{busy=false;controls(false);if(plan&&active())await drawSummary();}
 },'primary');
 const personalForget=btn('Забыть личный код',async()=>{
  if(busy)return;
  if(!await confirmDialog({title:'Забыть личный код?',text:'Код удалится только из этого браузера. Локальные записи, ревизии и серверная копия останутся. Код на другом устройстве продолжит работать.',ok:'Забыть',danger:true}))return;
  try{if(hasTrustedProfileRecord())forgetTrustedProfile();else forgetPersonalCode();clear();await refresh();S.notify();}catch(e){toast(e.message);}
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
 const root=el('div',{class:'coach-form'},[el('h2',{text:'Синхронизация устройств · бета'}),p('Личное пространство: один секретный код на всех доверенных устройствах. Приложение остаётся автономным. Первую синхронизацию каждого контура подтвердите вручную. После этого обмен без конфликтов и удалений выполняется автоматически при открытии и на главном экране; спорные изменения подтверждаются здесь.'),personalStatus,localStatus,sizeCheck,sizeStatus,btn('Доверенные устройства v2',()=>openTrustedDevices(openSync)),personalConnect,inviteImport,inviteCreate,both,simpleResult,btn('Проверить и исправить КТП',openKtpDiagnostics),personalForget,el('details',{},[el('summary',{text:'Расширенные настройки'}),p('Школа и тренер разделены. Общие упражнения, инвентарь, календарные события и турниры пока остаются локальными. Активные черновики матчей не синхронизируются. Закройте другие окна приложения.'),pairImport,field('Рабочая область',area),status,field('Адрес собственного сервера',endpoint),field('Индивидуальный ключ доступа',token),field('Общий пароль шифрования контура',password),pairCreate,preview,results,choicesStatus,apply,detach]),btn('Закрыть',closeSheet)]);
 openSheet(root,{fullHeight:true,onClose:()=>{closed=true;clear();}});
 refresh();
}
