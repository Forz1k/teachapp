/* Localhost-only writable synthetic UI; never opens native TeachApp DB. */
import {vaultRouterLab,routedDataAccessLab} from '../vault-router-lab.mjs';
import {routedVaultLifecycleLab} from '../vault-routed-lifecycle-lab.mjs';
import {journalMarkSnapshot,journalLessonSnapshot} from '../../../js/journal-commands.js';
import {lessonHistoryKey} from '../../../js/grade-history.js';
import {createSchoolSession} from '../../../js/store.js';
const demo='teachapp-writable-demo',gradeId='demo-mark';
const $=id=>document.getElementById(id);
const ui=Object.fromEntries(['status','setup','new-demo','session','unlock','password','lock','lock-tabs','editor','record','edit','grade'].map(id=>[id,$(id)]));
const message=text=>{ui.status.textContent=text;};
const checked=(ok,text)=>{if(!ok)throw Error(text);};
async function readRecord(access){
 return access.transaction(['marks','students','lessons','topics','workRecords'],'readonly',async s=>{
  const mark=await s.marks.get(gradeId),student=await s.students.get('demo-pupil'),lesson=await s.lessons.get('demo-lesson');
  checked(mark?.studentId===student?.id&&mark?.lessonId===lesson?.id&&student?.classId===lesson?.classId&&['2','3','4','5'].includes(mark.value),'Демо-журнал повреждён');
  const topic=lesson.topicId?await s.topics.get(lesson.topicId):null,hist=await s.workRecords.get(lessonHistoryKey(student.id,lesson.id));
  return {grade:mark.value,revision:(hist?.events.length??0)+1,classId:student.classId,entry:{studentId:student.id,studentName:student.fullName,lessonId:lesson.id,date:lesson.date,slot:lesson.slot??null,time:lesson.time||'',expectedMark:journalMarkSnapshot(mark),expectedLesson:journalLessonSnapshot(lesson,topic),expectedHistoryId:hist?.events.at(-1)?.id??null}};
 });
}
async function writeRecord(access,school,expected,value){
 checked(['2','3','4','5'].includes(value),'Выберите оценку');
 await school.applyJournalPaste(expected.classId,[{...expected.entry,value}],true,{replace:true,requireLessonSnapshot:true});
 return readRecord(access);
}
function start(){
 if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)||!isSecureContext){message('LAB доступен только на localhost.');return;}
 const tag=new URLSearchParams(location.search).get('id')||'default-v2';
 if(!/^[a-z0-9-]{1,32}$/.test(tag)){message('Некорректный ID демо-журнала.');return;}
 const id='ui-write-'+tag;let router,lifecycle;
 let access=null,school=null,shown=null,busy=false,active=false,epoch=0,disposed=false;
 function render(){
  const open=!!access&&!!shown&&lifecycle?.isUnlocked();
  ui.editor.hidden=!open;ui.unlock.hidden=!!access;
  ui.password.disabled=busy||!active;ui.unlock.querySelector('button').disabled=busy||!active;
  ui.lock.disabled=!busy&&!access;ui.grade.disabled=busy||!open;ui.edit.querySelector('button').disabled=busy||!open;
 }
 function clear(){
  epoch++;const old=school;school=null;access=null;shown=null;busy=false;old?.close();ui.password.value='';ui.grade.value='';ui.record.textContent='';render();
 }
 function locked(){clear();if(active&&!disposed)message('Журнал заблокирован.');}
 try{router=vaultRouterLab(id);lifecycle=routedVaultLifecycleLab(router,{id,onLock:locked});}
 catch{message('Web Locks или BroadcastChannel недоступны. Журнал закрыт.');return;}
 const valid=token=>!disposed&&token===epoch&&lifecycle.isUnlocked();
 function display(row){
  shown=row;ui.record.textContent='Демо-оценка: '+row.grade+' · Ревизия: '+row.revision;
  ui.grade.value=row.grade;render();
 }
 ui['new-demo'].hidden=false;ui['new-demo'].addEventListener('click',()=>location.assign('?id='+crypto.randomUUID().replaceAll('-','')));
 ui.lock.addEventListener('click',()=>{lifecycle.lock();locked();});
 ui['lock-tabs'].addEventListener('click',()=>{try{lifecycle.lockEveryTab();locked();message('Команда блокировки отправлена открытым вкладкам.');}catch{locked();message('Локальный сеанс закрыт, доставка блокировки не подтверждена.');}});
 ui.unlock.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!active||disposed)return;
  const pass=ui.password.value;ui.password.value='';
  if(pass!==demo){message('Введите указанный демо-пароль.');return;}
  busy=true;const token=++epoch;render();
  try{
   const opened=await lifecycle.unlock(pass);if(!valid(token)){opened.close();return;}
   const instance=createSchoolSession(opened);school=instance;
   await instance.load();if(!valid(token)){instance.close();return;}
   const row=await readRecord(opened);if(!valid(token)){instance.close();return;}
   access=opened;display(row);message('Зашифрованный журнал открыт.');
  }catch{if(token===epoch){lifecycle.lock();locked();message('Не удалось открыть демо-журнал.');}}
  finally{if(token===epoch){busy=false;render();}}
 });
 ui.edit.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!access||!shown||disposed)return;
  const token=epoch,handle=access,instance=school,expected=shown,value=ui.grade.value;busy=true;render();
  try{
   const row=await writeRecord(handle,instance,expected,value);
   if(valid(token)){display(row);message('Оценка сохранена в зашифрованном журнале.');}
  }catch{if(token===epoch){lifecycle.lock();locked();message('Запись отклонена; откройте журнал заново.');}}
  finally{if(token===epoch){busy=false;render();}}
 });
 ui.setup.addEventListener('click',async()=>{
  if(disposed||busy)return;
  ui.setup.disabled=true;message('Создаётся синтетический журнал…');
  try{
   await router.initialize();const source=routedDataAccessLab(router,{expectedGeneration:1});
   try{await source.transaction(['classes','students','lessons','marks'],'readwrite',async s=>{
    await s.classes.put({id:'demo-class',name:'Демо-класс',gradeLevel:7});
    await s.students.put({id:'demo-pupil',classId:'demo-class',fullName:'Демо-ученик',number:1,normGroup:'girls'});
    await s.lessons.put({id:'demo-lesson',classId:'demo-class',date:'2026-11-24',slot:1,time:'09:00'});
    await s.marks.put({id:gradeId,studentId:'demo-pupil',lessonId:'demo-lesson',value:'4',source:'manual'});
   });}finally{source.close();}
   await router.stage({password:demo});await router.activate({password:demo});await refresh();
  }catch{ui.setup.hidden=true;message('Создание не подтверждено. Создайте новый демо-журнал; существующие записи не перезаписываются.');}
  finally{ui.setup.disabled=false;}
 });
 async function refresh(){
  try{
   const state=await router.status();active=state.generation===2&&state.phase==='vault';
   ui.setup.hidden=true;ui.session.hidden=!active;clear();
   message(active?'Журнал активен. Разблокируйте сеанс.':'Маршрут не зашифрован. Создайте новый демо-журнал.');
  }catch{active=false;ui.session.hidden=true;ui.setup.hidden=false;message('Зашифрованный маршрут не подтверждён. Можно создать только пустой демо-журнал.');}
 }
 window.addEventListener('pagehide',e=>{if(e.persisted)return;disposed=true;lifecycle.dispose();clear();});
 void refresh();
}
start();
