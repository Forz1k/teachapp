import * as S from '../store.js';
import * as db from '../db.js';
import * as E from '../export.js';
import {validateBackup} from '../backup.js';
import {isEncryptedBackup,decryptBackup,encryptBackup} from '../privacy.js';
import {availableScopes,scopeLabels,makeScopedBackup,planSelective,restoreSelective} from '../selective-backup.js';
import {el,openSheet,closeSheet,toast,confirmDialog,promptDialog,downloadBlob} from '../ui.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{class:'btn wide '+kind,type:'button',text,onclick});
const stack=children=>el('div',{class:'coach-form'},children);
const field=(name,n)=>el('label',{class:'field'},[el('span',{text:name}),n]);
const storeLabels={meta:'Учебный год',classes:'Классы',students:'Ученики',lessons:'Уроки',topics:'Темы',ktp:'КТП',schedule:'Расписание',scheduleOverrides:'Замены',marks:'Отметки',exemptions:'Освобождения',studentHealthProfiles:'Группы',activityRestrictions:'Ограничения',activityCategories:'Виды нагрузки',participation:'Участие',norms:'Нормативы',normResults:'Результаты нормативов',finalGrades:'Итоговые оценки',monthly:'Архивные отметки',coachTeams:'Команды',coachPlayers:'Игроки',coachTrainings:'Тренировки',coachMatches:'Матчи',coachLineups:'Расстановки',coachLive:'Черновики матчей',coachTests:'Тесты',workRecords:'Рабочие записи / история / архив',validation:'Проверка связей'};
async function passwordPair(){
 let password=await promptDialog({title:'Пароль для выборочной копии',text:'Не менее 12 символов. Пароль не сохраняется.',password:true,ok:'Далее'});
 if(password===null)return null;if(password.length<12){toast('Пароль не короче 12 символов');return null;}
 let repeat=await promptDialog({title:'Повторите пароль',password:true,ok:'Шифровать'});
 if(repeat!==password){if(repeat!==null)toast('Пароли не совпадают');return null;}repeat=null;return password;
}
function scopePicker(source,kind='export'){
 const data=validateBackup(source),scopes=availableScopes(data),pick=el('select',{'aria-label':'Область выборочной копии'},scopes.map((s,i)=>el('option',{value:String(i),text:scopeLabels[s.kind]+' · '+s.label}))),body=el('div',{class:'coach-stack'});
 let sequence=0,preview=null;
 async function draw(){
  const seq=++sequence;preview=null;body.replaceChildren(p('Подготовка…'));
  try{
   const scope=scopes[Number(pick.value)];if(!scope)throw Error('Нет доступных классов, команд или архивов');
   const part=makeScopedBackup(source,scope);
   const plan=kind==='restore'?planSelective(await db.dumpAll(),source,scope):null;if(seq!==sequence)return;
   preview={scope,part,plan};
   body.replaceChildren(...Object.entries(part.counts).map(([name,n])=>p((storeLabels[name]||name)+': '+n)));
   if(part.omitted)body.append(p('Не включено перекрёстных замен с другими классами: '+part.omitted+'. Проверьте расписание вручную.'));
   if(plan){body.append(p('Будет добавлено: '+plan.counts.added+' · дополнено общих связей/шкал: '+plan.counts.merged+' · уже совпадают: '+plan.counts.identical));
    if(plan.conflicts.length){const summary=new Map();for(const c of plan.conflicts){const key=(storeLabels[c.store]||c.store)+' · '+c.reason;summary.set(key,(summary.get(key)||0)+1);}body.append(p('Восстановление заблокировано. Конфликтов: '+plan.conflicts.length),...([...summary].slice(0,20).map(([message,n])=>p(message+' ('+n+')'))));}
   }
  }catch(e){if(seq===sequence)body.replaceChildren(p(e.message));}
 }
 const action=btn(kind==='restore'?'Восстановить выбранную область':'Создать защищённую выборочную копию',async()=>{
  if(!preview)return toast('Выберите область и дождитесь предпросмотра');const selected=preview;action.disabled=true;
  try{
   if(kind==='restore'){
    if(selected.plan.conflicts.length)throw Error('Сначала устраните конфликты');
    if(!await confirmDialog({title:'Добавить выбранные записи?',text:'Добавлено: '+selected.plan.counts.added+'. Дополнено общих связей/шкал: '+selected.plan.counts.merged+'. Другие данные не удаляются. Сначала сохраните полную защищённую копию.',ok:'Восстановить',danger:true}))return;
    await restoreSelective(source,selected.scope,selected.plan.token,true);await S.load();toast('Выбранная область восстановлена');closeSheet();
   }else{
    let password=await passwordPair();if(password===null)return;
    try{const encrypted=await encryptBackup(selected.part.payload,password);downloadBlob(new Blob([JSON.stringify(encrypted)],{type:'application/json'}),'teachapp-'+selected.scope.kind+'-encrypted.json');toast('Проверьте файл в загрузках. Это не полная копия.');}finally{password=null;}
   }
  }catch(e){toast(e.message);}finally{action.disabled=false;}
 },'primary');
 pick.onchange=draw;openSheet(stack([el('h2',{text:kind==='restore'?'Выборочное восстановление':'Выборочная защищённая копия'}),p('Класс — только совпадающий учебный год. Команда и архив — независимо. Восстановление добавляет недостающие записи; существующие конфликтующие записи не перезаписываются. Общие КТП и шкалы дополняются только при совпадающей методике и параметрах. Настройки текущего устройства сохраняются. Общие рабочие инструменты (инвентарь, конспекты, турниры, события) не входят.'),field('Область',pick),body,action,btn('Назад',openSelectiveBackup)]));draw();
}
export async function openSelectiveBackup(){
 const input=el('input',{type:'file',accept:'.json',style:'display:none'});
 input.onchange=async()=>{const file=input.files?.[0];input.value='';if(!file)return;try{
  let source=await E.readBackupFile(file);
  if(isEncryptedBackup(source)){let password=await promptDialog({title:'Пароль копии',password:true,ok:'Открыть'});if(password===null)return;try{source=await decryptBackup(source,password);}finally{password=null;}}
  else if(!await confirmDialog({title:'Незашифрованная копия',text:'Файл может содержать персональные данные. Открывается только на этом устройстве.',ok:'Открыть'}))return;
  scopePicker(source,'restore');
 }catch(e){toast(e.message);}};
 openSheet(stack([el('h2',{text:'Выборочные копии'}),p('Перенос отдельного класса, команды или архива между устройствами без облачного сервера. Это ручной перенос, а не автоматическая синхронизация. Защищённый файл сохраняется локально.'),btn('Создать выборочную копию',async()=>{try{scopePicker(await S.makeBackup(),'export');}catch(e){toast(e.message);}},'primary'),btn('Восстановить из полной или выборочной копии',()=>input.click()),input,btn('Закрыть',closeSheet)]));
}
