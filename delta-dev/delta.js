/* Loopback-only operator console, no browser DB access or saved credentials. */
import {SCHEMA} from '../js/db.js';
import {defaultSettings} from '../js/model.js';
import {BACKUP_VERSION} from '../js/backup.js';
import {encryptBackup} from '../js/privacy.js';
import {normalizeEndpoint,deltaLabClient,readDeltaLab,projectScope,combineScope,prepareDeltaRotation,openDeltaRecovery,commitDeltaRotation,createDeltaDeviceRecovery,openDeltaDeviceRecovery,compactDeltaLab,syncValuesEqual} from '../js/sync.js';
import {deltaPartHash} from '../js/delta-anchor.js';

const root=document.querySelector('#app');
const localPage=location.protocol==='http:'&&['127.0.0.1','localhost'].includes(location.hostname)&&isSecureContext;
const MAX_FILE=32*1024*1024,scopes=[['school','Школа'],['coach','Тренер']];
const empty=()=>({...Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]])),meta:[defaultSettings()]});
const require=(ok,message)=>{if(!ok)throw Error(message);};
const node=(tag,text='',attrs={},children=[])=>{const n=document.createElement(tag);n.textContent=text;for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));for(const x of children)if(x)n.append(x);return n;};
const p=(text,cls='muted')=>node('p',text,{class:cls});
const card=(title,...children)=>node('section','',{class:'card'},[node('h2',title),...children]);
const field=(label,n)=>node('label',label,{},[n]);
const input=(label,value='',type='text')=>{const n=node('input','',{type,'aria-label':label,autocomplete:'off',spellcheck:'false'});if(type!=='file')n.value=value;else n.accept='.json,application/json';return n;};
const select=(label,opts)=>node('select','',{'aria-label':label},opts.map(([v,t])=>node('option',t,{value:v})));
const checkbox=label=>{const n=node('input','',{type:'checkbox','aria-label':label});return {n,label:node('label','',{class:'check'},[n,node('span',label)])};};
const button=(title,fn,primary=false)=>{const b=node('button',title,{type:'button',class:primary?'primary':''});b.onclick=()=>run(fn);return b;};
const row=(...x)=>node('div','',{class:'row'},x);
const fields=(...x)=>node('div','',{class:'fieldgroup'},x);
const status=(text,error=false)=>{const n=root.querySelector('#status');if(n){n.textContent=text;n.className=error?'status error':'status';}};
const statusNode=()=>node('p','',{id:'status',role:'status',class:'status'});
let session=null,pending=null,busy=false,serial=0;
let urls=new Set();
function clear(){serial++;session=null;pending=null;for(const u of urls)URL.revokeObjectURL(u);urls.clear();for(const n of root.querySelectorAll('input'))if(n.type!=='checkbox')n.value='';}
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));urls.add(url);const a=node('a','',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},1000);}
async function readFile(n){const file=n.files?.[0];require(file&&file.size>0&&file.size<=MAX_FILE,'Выберите защищённый JSON-файл не больше 32 МиБ');let value;try{value=JSON.parse(await file.text());}catch{throw Error('Файл не является JSON');}require(value?.app==='teachapp-encrypted','Требуется зашифрованный файл LAB');return value;}
function endpointOf(value){const endpoint=normalizeEndpoint(value),u=new URL(endpoint);require(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)&&u.pathname==='/'&&!!u.port,'Требуется локальный HTTP Worker с портом');return endpoint;}
async function checkWorker(endpoint){const r=await fetch(endpoint+'/healthz',{cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});require(r.ok&&await r.text().then(s=>{try{return JSON.parse(s).status==='synthetic-ready';}catch{return false;}}),'Не подтверждён синтетический Delta LAB');}
function options(s=session){return {endpoint:s.endpoint,area:s.area,password:s.password,current:empty(),synthetic:true,client:s.client};}
function credentials({endpoint,area,token,password,compactToken,rotateToken}){require(typeof password==='string'&&password.length>=12&&password.length<=1024,'Введите пароль шифрования (12–1024 символа)');return {endpoint,area,token,password,compactToken,rotateToken,client:deltaLabClient(endpoint,area,token,{compactToken,rotateToken})};}
async function readStatus(s){const h=await s.client.head();require(Number.isSafeInteger(h.revision)&&h.revision>=0&&Number.isSafeInteger(h.anchorRevision)&&h.anchorRevision>=0&&Number.isInteger(h.count)&&h.count>=0&&h.count<=129&&Number.isSafeInteger(h.bytes)&&h.bytes>=0&&Number.isSafeInteger(h.maxBytes)&&h.maxBytes>0&&h.bytes<=h.maxBytes&&Number.isSafeInteger(h.keyEpoch)&&h.keyEpoch>=0,'Некорректные метаданные сервера');return h;}
async function run(fn){if(busy)return;busy=true;const epoch=serial;const controls=[...root.querySelectorAll('input,button,select')].map(n=>[n,n.disabled]);controls.forEach(([n])=>n.disabled=true);try{await fn(()=>epoch===serial);if(epoch===serial&&root.querySelector('#status')&&!root.querySelector('#status').textContent)status('Готово');}catch(e){if(epoch===serial)status(e?.status===401?'Доступ отозван или ключ неверен. Проверьте тестовые ключи или войдите по новому файлу.':(e?.message||'Операция не завершилась'),true);}finally{controls.forEach(([n,was])=>{if(n.isConnected)n.disabled=was;});busy=false;}}
function login(message=''){
 if(!localPage){root.replaceChildren(card('Недоступно',p('Delta LAB работает только на локальной тестовой странице. Сеть и хранилища не используются.')));return;}
 const endpoint=input('Адрес тестового Worker','http://127.0.0.1:8789'),area=select('Контур',scopes),token=input('Ключ доступа','','password'),password=input('Пароль шифрования','','password'),compact=input('Ключ компактизации','','password'),rotate=input('Ключ ротации','','password'),consent=checkbox('Подтверждаю: только синтетические данные');
 const file=input('Файл восстановления','','file'),filePassword=input('Пароль файла','','password'),fileKind=select('Тип файла',[['device','Файл одного устройства'],['owner','Файл владельца']]);
 async function connect(alive,mode){
  require(consent.n.checked,'Подтвердите синтетический режим');const ep=endpointOf(endpoint.value),scope=area.value;
  await checkWorker(ep);
  let s,owner=null;
  if(mode==='keys')s=credentials({endpoint:ep,area:scope,token:token.value,password:password.value,compactToken:compact.value||undefined,rotateToken:rotate.value||undefined});
  else{
   const recovery=await readFile(file);
   if(fileKind.value==='owner'){
    const opened=await openDeltaRecovery({endpoint:ep,area:scope,current:empty(),recovery,recoveryPassword:filePassword.value,synthetic:true});
    s=credentials({endpoint:ep,area:scope,token:opened.readTokens[0],password:opened.newPassword,compactToken:opened.compactToken,rotateToken:rotate.value||undefined});
    const anchor=await s.client.getRevision(opened.expectedRevision+1);
    require(anchor.revision===opened.expectedRevision+1&&anchor.kind==='anchor'&&syncValuesEqual(anchor.envelope,opened.envelope),'Файл владельца не соответствует опубликованной ротации');
    owner={recovery,password:filePassword.value,opened,committed:true};
   }else{
    const opened=await openDeltaDeviceRecovery({endpoint:ep,area:scope,file:recovery,devicePassword:filePassword.value,synthetic:true});
    s=credentials({endpoint:ep,area:scope,token:opened.token,password:opened.password});
    const anchor=await s.client.getRevision(opened.anchorRevision);
    // Compare actual envelope bytes in a stable canonical order (same as sync).
    const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
    require(anchor.revision===opened.anchorRevision&&anchor.kind==='anchor'&&await deltaPartHash(canonical(anchor.envelope))===opened.anchorHash,'Контрольная точка устройства не совпадает');
    const decoded=await readDeltaLab({client:s.client,area:scope,password:s.password,current:empty()});
    require(decoded.workspaceId===opened.workspaceId&&decoded.revision>=opened.anchorRevision,'Рабочее пространство не совпадает');
   }
  }
  const head=await readStatus(s);if(!alive())return;session=s;session.head=head;pending=owner;
  for(const n of [token,password,compact,rotate,file,filePassword])n.value='';
  dashboard();status('Подключено. Содержимое базы ещё не проверено.');
 }
 root.replaceChildren(card('Подключение',p('Ключи и выбранные файлы остаются только в памяти этой вкладки. Никакой связи с обычной базой IndexedDB.'),fields(field('Worker',endpoint),field('Контур',area),consent.label,field('Обычный ключ',token),field('Шифрование',password),field('Компактизация (необязательно)',compact),field('Ротация (необязательно)',rotate),button('Подключиться',a=>connect(a,'keys'),true))),card('Вход по файлу',fields(field('Тип',fileKind),field('Защищённый файл',file),field('Пароль',filePassword),button('Войти по файлу',a=>connect(a,'file')))),statusNode());
 if(message)status(message);
}
function dashboard(){
 const s=session,h=s.head,metrics=node('div','',{class:'metrics'},[['Ревизия',h.revision],['Базовая ревизия',h.anchorRevision],['Эпоха ключей',h.keyEpoch],['Записей в цепочке',h.count],['Объём',Math.ceil(h.bytes/1024)+' КиБ']].map(([label,value])=>node('div','',{class:'metric'},[node('strong',String(value)),node('span',label)])));
 const progress=node('progress','',{max:h.maxBytes,value:h.bytes,'aria-label':'Заполненность хранилища'});
 const verification=p(s.verified===h.revision?'Снимок проверен · записей '+s.records:'Только метаданные · снимок не проверен');
 const refresh=button('Обновить диагностику',async alive=>{const head=await readStatus(s);if(!alive())return;s.head=head;if(s.verified!==head.revision)delete s.verified;dashboard();status('Диагностика обновлена.');});
 const verify=button('Проверить зашифрованный снимок',async alive=>{const result=await readDeltaLab(options(s));const head=await readStatus(s);require(result.revision===head.revision,'Ревизия изменилась во время чтения; повторите проверку');if(!alive())return;s.head=head;s.verified=result.revision;s.records=result.snapshot?Object.values(result.snapshot).reduce((n,a)=>n+a.length,0):0;dashboard();status('Снимок проверен, данные не изменены.');},true);
 const logout=button('Отключиться',()=>{clear();login('Сессия закрыта; ключи удалены из памяти интерфейса.');});
 root.replaceChildren(card('Диагностика · '+scopes.find(a=>a[0]===s.area)[1],metrics,progress,verification,row(refresh,verify),logout),statusNode());
 if(h.revision===0){
  const allow=checkbox('Создать только демонстрационные записи в пустом контуре');
  root.append(card('Первичный снимок',p('Создаёт маленькую фиксированную синтетическую базу. Не загружает журнал.'),allow.label,button('Создать демонстрационный снимок',async alive=>{
   require(allow.n.checked,'Подтвердите создание');require((await readStatus(s)).revision===0,'Контур уже содержит данные');
   const current=empty();if(s.area==='school'){current.classes=[{id:'lab-c',name:'LAB 7А'}];current.students=[{id:'lab-s',classId:'lab-c',fullName:'Синтетический ученик',number:1}];}else current.coachTeams=[{id:'lab-t',name:'Синтетическая команда LAB',archived:false}];
   const snapshot=projectScope(current,s.area);combineScope(empty(),snapshot,s.area);
   const envelope=await encryptBackup({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area:s.area,workspaceId:crypto.randomUUID(),revision:1,snapshot},s.password);
   require(alive(),'Сессия закрыта');const ack=await s.client.anchor(envelope);require(ack.revision===1,'Снимок не подтверждён');if(!alive())return;s.head=await readStatus(s);dashboard();status('Демонстрационный снимок создан.');
  },true)));
 }
 if(s.compactToken&&h.count>1&&!pending){
  const allow=checkbox('Подтверждаю уплотнение проверенной истории; резервная копия сохранена');
  root.append(card('Уплотнение истории',p('Удаляет прежние серверные ревизии. Не меняет данные или пароль.'),allow.label,button('Уплотнить историю',async alive=>{require(allow.n.checked,'Подтвердите резервную копию');const result=await compactDeltaLab({...options(s),expectedRevision:h.revision,confirmed:true});if(!alive())return;s.head=await readStatus(s);delete s.verified;dashboard();status('Уплотнено до ревизии '+result.revision+'.');})));
 }
 if(s.rotateToken&&h.revision>0&&!pending){
  const recoveryPassword=input('Пароль файла владельца','','password'),count=select('Количество устройств',Array.from({length:8},(_,i)=>[i+1,String(i+1)]));count.value='2';
  root.append(card('Смена ключей',p('Создаёт новые независимые ключи. Старые ключи будут отозваны только при подтверждённой записи.'),fields(field('Отдельный пароль файла',recoveryPassword),field('Количество устройств',count),button('Подготовить ротацию',async alive=>{
   const pw=recoveryPassword.value,prepared=await prepareDeltaRotation({...options(s),expectedRevision:h.revision,recoveryPassword:pw,deviceCount:Number(count.value)});if(!alive())return;pending={recovery:prepared.recovery,password:pw,prepared,committed:false,verified:false};recoveryPassword.value='';dashboard();status('Файл подготовлен. На сервере ничего не изменено.');
  },true))));
 }
 if(pending&&!pending.committed){
  const r=pending,file=input('Сохранённый файл владельца','','file'),allow=checkbox('Я сохранил и проверил файл; понимаю, что старые ключи будут отозваны'),verified=p(r.verified?'Сохранённый файл проверен':'Сначала скачайте и выберите сохранённый файл');
  const verifyFile=button('Проверить сохранённый файл',async alive=>{const loaded=await readFile(file);require(syncValuesEqual(loaded,r.recovery),'Выбран другой файл');await openDeltaRecovery({...options(s),recovery:loaded,recoveryPassword:r.password});if(!alive())return;r.verified=true;verified.textContent='Сохранённый файл проверен';status('Файл успешно расшифрован и совпадает с подготовленным снимком.');});
  const commit=button('Сменить ключи',async alive=>{require(r.verified&&allow.n.checked,'Сначала проверьте файл и подтвердите отзыв');const result=await commitDeltaRotation({...options(s),recovery:r.recovery,recoveryPassword:r.password,confirmed:true,backupVerified:true});if(!alive())return;const opened=await openDeltaRecovery({...options(s),recovery:r.recovery,recoveryPassword:r.password});if(!alive())return;const next=credentials({...s,token:opened.readTokens[0],password:opened.newPassword,compactToken:opened.compactToken});next.head=await readStatus(next);if(!alive())return;session=next;r.committed=true;r.opened=opened;dashboard();status('Ключи сменены · ревизия '+result.revision+'.');},true);
  root.append(card('Подготовленная ротация',p('Ревизия '+r.prepared.expectedRevision+' → '+r.prepared.newRevision+' · записей '+r.prepared.records,'notice'),button('Скачать файл владельца',()=>download(r.recovery,'teachapp-lab-owner.json')),field('Выберите скачанный файл',file),verifyFile,verified,allow.label,commit,button('Отменить подготовку',()=>{pending=null;dashboard();status('Подготовка отменена локально; при потерянном ответе проверьте сервер по сохранённому файлу.');})));
 }
 if(pending?.committed){
  const r=pending,index=select('Устройство',r.opened.readTokens.map((_,i)=>[i,'Устройство '+(i+1)])),devicePassword=input('Пароль файла устройства','','password');
  root.append(card('Файлы устройств',p('Каждый файл содержит только один обычный ключ и пароль шифрования. Не передавайте файл владельца на другие устройства.'),fields(field('Устройство',index),field('Отдельный пароль устройства',devicePassword),button('Скачать файл устройства',async alive=>{
   const n=Number(index.value),file=await createDeltaDeviceRecovery({...options(s),recovery:r.recovery,recoveryPassword:r.password,devicePassword:devicePassword.value,index:n});if(!alive())return;devicePassword.value='';download(file,'teachapp-lab-device-'+(n+1)+'.json');status('Файл устройства '+(n+1)+' сформирован.');
  },true),button('Скачать файл владельца повторно',()=>download(r.recovery,'teachapp-lab-owner.json')),button('Закрыть файлы восстановления',()=>{pending=null;dashboard();status('Файлы удалены из памяти интерфейса.');}))));
 }
}
addEventListener('pagehide',()=>{clear();root.replaceChildren();});
login();
