/* Fixed synthetic localhost workflow; no live app database or real secrets. */
import {SCHEMA} from '../../../js/db.js';
import {createSchoolSession} from '../../../js/store.js';
import {createCoachSession} from '../../../js/coach.js';
import {createWorkSession} from '../../../js/workbench.js';
import {partitionedVaultLab} from '../vault-partitioned-lab.mjs';
import {partitionedVaultLifecycleLab} from '../vault-partitioned-lifecycle-lab.mjs';
import {openPartitionLegacyLab,preparePartitionLegacyMigrationLab,migratePartitionLegacyLab} from '../vault-partition-migration-lab.mjs';
import {openPartitionRecoveryCopyLab,samePartitionSnapshotLab} from '../vault-partition-recovery-lab.mjs';
const demo=Object.freeze({school:'teachapp-school-demo',coach:'teachapp-coach-demo',workspace:'teachapp-owner-demo'});
const backupPasswords=Object.freeze({school:'teachapp-school-copy-demo',coach:'teachapp-coach-copy-demo',workspace:'teachapp-owner-copy-demo'});
const scopes=Object.keys(demo),labels={school:'Учитель',coach:'Тренер',workspace:'Владелец'};
const $=id=>document.getElementById(id),ui=Object.fromEntries(['status','prepare','download','activate','copy','confirm','new-demo','lock-tabs','scopes'].map(id=>[id,$(id)]));
const message=text=>ui.status.textContent=text;
const checked=(ok,msg)=>{if(!ok)throw Error(msg);};
function fixture(){
 const data=Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]]));
 data.classes=[{id:'demo-class',name:'Демо-класс',gradeLevel:7}];data.students=[{id:'demo-pupil',classId:'demo-class',fullName:'Демо-ученик',number:1,normGroup:'girls'}];
 data.lessons=[{id:'demo-lesson',classId:'demo-class',date:'2025-10-01',slot:1,time:'09:00'}];
 data.marks=[{id:'demo-mark',studentId:'demo-pupil',lessonId:'demo-lesson',value:'4',source:'manual'}];
 data.coachTeams=[{id:'demo-team',name:'Демо-команда',archived:false}];data.meta=[{id:'settings',year:{from:'2025-09-01',to:'2026-08-31'},theme:'dark'}];
 data.workRecords=[{id:'demo-event',kind:'event',name:'Демо-событие',date:'2025-10-01',time:'16:00',minutes:30,eventType:'meeting',note:'',remind:15,done:false}];return data;
}
async function ensureSource(id){
 const db=await openPartitionLegacyLab(id),data=fixture(),names=Object.keys(SCHEMA);
 try{await new Promise((resolve,reject)=>{
  const tx=db.transaction(names,'readwrite'),requests=names.map(n=>[n,tx.objectStore(n).getAll()]);let remaining=names.length,failure;
  for(const [,q] of requests)q.onsuccess=()=>{
   if(--remaining)return;
   try{const old=Object.fromEntries(requests.map(([n,q])=>[n,q.result]));
    if(Object.values(old).every(rows=>rows.length===0)){for(const n of names)for(const row of data[n])tx.objectStore(n).add(row);}
    else checked(samePartitionSnapshotLab(old,data),'Исходник не является фиксированным демо');
   }catch(e){failure=e;tx.abort();}
  };
  tx.oncomplete=resolve;tx.onabort=()=>reject(failure||tx.error||Error('Создание демо отменено'));
 });}finally{db.close();}
}
function node(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
function start(){
 if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)||!isSecureContext){message('LAB доступен только в защищённой среде localhost.');return;}
 const tag=new URLSearchParams(location.search).get('id')||'partition-demo-v1';
 if(!/^[a-z0-9-]{1,32}$/.test(tag)){message('Некорректный ID демо.');return;}
 const id='ui-part-'+tag,layout='school-v2-migrated',lab=partitionedVaultLab(id,{layout}),rows=new Map();
 let lifecycle,active=false,disposed=false,migrationBusy=false,blob=null;
 const revokeCopy=()=>{if(blob)URL.revokeObjectURL(blob);blob=null;ui.download.removeAttribute('href');ui.download.hidden=true;ui.copy.value='';ui.confirm.checked=false;ui.activate.hidden=true;};
 function render(row){
  const opened=!!row.session&&lifecycle.isUnlocked(row.scope);
  row.state.textContent=opened?'Открыто':'Заблокировано';row.form.hidden=opened;
  row.input.disabled=row.busy||!active;row.open.disabled=row.busy||!active;row.lock.disabled=!row.busy&&!opened;
  row.editor.hidden=!opened;row.save.disabled=row.busy||!opened;if(row.grade)row.grade.disabled=row.busy||!opened;
 }
 function clear(scope){
  const row=rows.get(scope);if(!row)return;
  row.epoch++;const old=row.session;row.session=null;row.access=null;row.shown=null;row.busy=false;old?.close();
  row.input.value='';row.result.textContent='';if(row.grade)row.grade.value='';render(row);
 }
 try{lifecycle=partitionedVaultLifecycleLab(lab,{id,layout,onLock:clear});}
 catch{message('Межвкладочная блокировка недоступна. Доступ закрыт.');return;}
 function valid(row,epoch){return !disposed&&row.epoch===epoch&&lifecycle.isUnlocked(row.scope);}
 async function refreshRow(row,epoch){
  let shown,text;
  if(row.scope==='school'){
   shown=row.session.state.marks.find(m=>m.studentId==='demo-pupil'&&m.lessonId==='demo-lesson');
   checked(shown&&['2','3','4','5'].includes(shown.value),'Демо-журнал повреждён');text='Демо-оценка: '+shown.value;
  }else if(row.scope==='coach'){
   shown=await row.access.get('coachTeams','demo-team');checked(shown,'Демо-команда отсутствует');text=shown.name;
  }else{
   shown=(await row.session.listWork('event')).find(r=>r.id==='demo-event');checked(shown,'Демо-событие отсутствует');text=shown.name+' · '+(shown.done?'Выполнено':'Запланировано');
  }
  if(valid(row,epoch)){row.shown=shown;row.result.textContent=text;if(row.grade)row.grade.value=shown.value;render(row);}
 }
 for(const scope of scopes){
  const card=node('article'),heading=node('h2',labels[scope]),state=node('p','Заблокировано'),hint=node('p','Демо-пароль: '+demo[scope]),form=node('form'),label=node('label','Демо-пароль'),input=node('input'),open=node('button','Открыть'),lock=node('button','Заблокировать'),editor=node('div'),result=node('p'),save=node('button',scope==='school'?'Сохранить оценку':scope==='coach'?'Изменить демо-команду':'Изменить статус события');
  card.dataset.scope=scope;state.className='state';hint.className='hint';result.className='result';input.type='password';input.autocomplete='off';input.maxLength=128;input.required=true;label.append(input);open.type='submit';lock.type=save.type='button';form.append(label,open);editor.append(result);
  let grade=null;
  if(scope==='school'){grade=node('select');grade.setAttribute('aria-label','Демо-оценка');for(const v of ['','2','3','4','5']){const option=node('option',v||'Выберите оценку');option.value=v;grade.append(option);}editor.append(grade);}
  editor.append(save);card.append(heading,state,hint,form,lock,editor);ui.scopes.append(card);
  const row={scope,state,form,input,open,lock,editor,result,save,grade,session:null,access:null,shown:null,busy:false,epoch:0};rows.set(scope,row);
  lock.addEventListener('click',()=>{lifecycle.lock(scope);clear(scope);});
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(row.busy||!active||disposed)return;
   const password=input.value;input.value='';
   if(password!==demo[scope]){message('Введите указанный демо-пароль.');return;}
   row.busy=true;const epoch=++row.epoch;render(row);
   try{
    const access=await lifecycle.unlock(scope,password);if(!valid(row,epoch)){access.close();return;}
    row.access=access;row.session=scope==='school'?createSchoolSession(access):scope==='coach'?createCoachSession(access):createWorkSession(access,'workspace');
    if(scope==='school')await row.session.load();if(!valid(row,epoch))return;
    await refreshRow(row,epoch);if(valid(row,epoch))message('Демо-область открыта.');
   }catch{if(epoch===row.epoch){lifecycle.lock(scope);clear(scope);}message('Не удалось открыть демо-область.');}
   finally{if(epoch===row.epoch){row.busy=false;render(row);}}
  });
  save.addEventListener('click',async()=>{
   if(row.busy||!row.session||!row.shown||disposed)return;
   const epoch=row.epoch,session=row.session,shown=row.shown,value=grade?.value;row.busy=true;render(row);
   try{
    if(scope==='school'){checked(['2','3','4','5'].includes(value),'Выберите оценку');await session.setMark('demo-pupil','demo-lesson',{value});}
    else if(scope==='coach')await session.saveTeam({id:shown.id,name:shown.name==='Демо-команда'?'Демо-команда 2':'Демо-команда',archived:false});
    else await session.saveWork({...shown,done:!shown.done});
    if(valid(row,epoch)){await refreshRow(row,epoch);message('Запись сохранена в зашифрованной области.');}
   }catch{if(epoch===row.epoch){lifecycle.lock(scope);clear(scope);}message('Запись отклонена; откройте область заново.');}
   finally{if(epoch===row.epoch){row.busy=false;render(row);}}
  });
  render(row);
 }
 ui['new-demo'].hidden=false;ui['new-demo'].addEventListener('click',()=>location.assign('?id='+crypto.randomUUID().replaceAll('-','')));
 ui['lock-tabs'].addEventListener('click',()=>{try{lifecycle.lockEveryTab();message('Команда блокировки отправлена открытым вкладкам.');}catch{message('Локальные области закрыты; доставка не подтверждена.');}});
 ui.prepare.addEventListener('click',async()=>{
  if(migrationBusy||active||disposed)return;migrationBusy=true;ui.prepare.disabled=true;revokeCopy();message('Готовится независимая демо-копия…');
  try{await ensureSource(id);const copy=await preparePartitionLegacyMigrationLab(id,{backupPasswords});if(disposed)return;
   blob=URL.createObjectURL(new Blob([copy.file],{type:'application/json'}));ui.download.href=blob;ui.download.download='teachapp-demo-recovery.json';ui.download.hidden=false;ui.activate.hidden=false;
   message('Сохраните файл отдельно, затем выберите сохранённую копию.');
  }catch{message('Не удалось подтвердить синтетический источник. Создайте новый демо-набор.');}
  finally{migrationBusy=false;ui.prepare.disabled=false;}
 });
 ui.activate.addEventListener('submit',async e=>{
  e.preventDefault();if(migrationBusy||active||disposed)return;
  const file=ui.copy.files[0];if(!file||file.size>1024*1024||!ui.confirm.checked){message('Выберите сохранённый демо-файл и подтвердите перенос.');return;}
  migrationBusy=true;ui.activate.querySelector('button').disabled=true;ui.prepare.disabled=true;message('Проверяется файл и выполняется атомарный перенос…');
  try{const text=await file.text(),copy=await openPartitionRecoveryCopyLab(text,{passwords:backupPasswords});checked(samePartitionSnapshotLab(copy.data,fixture()),'Требуется фиксированный демо-снимок');
   await migratePartitionLegacyLab(id,{passwords:demo,backupPasswords,backupFile:text,saved:true,confirmed:true});revokeCopy();await refresh();
  }catch{message('Перенос не подтверждён. Исходник не заменяется при ошибке.');}
  finally{migrationBusy=false;ui.activate.querySelector('button').disabled=false;ui.prepare.disabled=false;}
 });
 async function refresh(){
  try{active=(await lab.status()).active===true;}catch{active=false;}
  if(disposed)return;ui.prepare.hidden=active;ui.scopes.hidden=!active;ui['lock-tabs'].hidden=!active;
  for(const row of rows.values())render(row);
  message(active?'Перенос завершён. Откройте нужную область.':'Подготовьте независимую копию фиксированного демо-источника.');
 }
 window.addEventListener('pagehide',e=>{if(e.persisted)return;disposed=true;lifecycle.dispose();revokeCopy();});
 void refresh();
}
start();
