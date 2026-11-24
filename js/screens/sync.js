import * as S from '../store.js';
import * as db from '../db.js';
import {syncAreas,normalizeEndpoint,relayClient,prepareSync,previewSync,executeSync,syncStatus,disconnectSync} from '../sync.js';
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
 function controls(disabled){area.disabled=endpoint.disabled=token.disabled=password.disabled=preview.disabled=detach.disabled=disabled;}
 async function refresh(){
  const n=++seq,selected=area.value;
  try{
   const cp=await syncStatus(selected);if(n!==seq||closed)return;
   endpoint.value=cp?.endpoint||'';
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
 area.onchange=()=>{clear();refresh();};
 for(const input of [endpoint,token,password])input.oninput=()=>{if(plan){plan=null;client=null;secret=null;choices={};results.replaceChildren();choicesStatus.textContent='';apply.disabled=true;}};
 const root=el('div',{class:'coach-form'},[el('h2',{text:'Синхронизация устройств · бета'}),p('Явная двусторонняя синхронизация через ваш сервер. Приложение остаётся автономным; фоновой отправки нет. Токен и пароль не сохраняются. В рабочую базу запись выполняется только после предпросмотра и подтверждения.'),p('Школа и тренер разделены. Общие упражнения, инвентарь, календарные события и турниры пока остаются локальными. Активные черновики матчей не синхронизируются. Закройте другие окна приложения.'),field('Рабочая область',area),status,field('Адрес собственного сервера',endpoint),field('Индивидуальный ключ доступа',token),field('Общий пароль шифрования контура',password),preview,results,choicesStatus,apply,detach,btn('Закрыть',closeSheet)]);
 openSheet(root,{fullHeight:true,onClose:()=>{closed=true;clear();}});
 refresh();
}
