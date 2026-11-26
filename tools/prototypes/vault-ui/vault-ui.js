/* Localhost-only, synthetic fixture. No access to app storage or real passwords. */
import {SCHEMA} from '../../../js/db.js';
import {vaultBundleActivationLab} from '../vault-bundle-activation-lab.mjs';
import {vaultSessionLifecycleLab} from '../vault-session-lifecycle-lab.mjs';

const demo=Object.freeze({school:'teachapp-school-demo',coach:'teachapp-coach-demo',workspace:'teachapp-owner-demo'});
const names={school:'Школа',coach:'Тренер',workspace:'Общие данные'};
const scopes=Object.keys(demo),status=document.querySelector('#status'),setup=document.querySelector('#setup'),newDemo=document.querySelector('#new-demo'),root=document.querySelector('#scopes');
function fixture(){
 const data=Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]]));
 data.classes.push({id:'demo-class',name:'Демо-класс',gradeLevel:7});
 data.meta.push({id:'demo-meta',value:'synthetic'});
 return data;
}
function node(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
function start(){
 if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)||!isSecureContext){status.textContent='LAB доступен только в защищённой среде localhost.';return;}
 const id=new URLSearchParams(location.search).get('id')||'ui-demo-v1';
 let bundle;
 try{bundle=vaultBundleActivationLab(id);}catch{status.textContent='Неверный ID набора или Web Locks недоступен.';return;}
 const lifecycle=vaultSessionLifecycleLab(bundle),rows=new Map();
 let active=false,disposed=false;
 newDemo.hidden=false;newDemo.addEventListener('click',()=>location.assign('?id=demo-'+crypto.randomUUID()));
 function clear(row){row.result.textContent='';row.input.value='';}
 function render(scope){
  const row=rows.get(scope),unlocked=lifecycle.isUnlocked(scope);
  if(!unlocked)row.result.textContent='';
  row.state.textContent=unlocked?'Открыто':'Заблокировано';
  row.submit.disabled=row.busy||!active||unlocked;
  row.input.disabled=row.busy||!active||unlocked;
  row.lock.disabled=!row.busy&&!unlocked;
 }
 function lock(scope){
  const row=rows.get(scope);row.epoch++;row.busy=false;lifecycle.lock(scope);clear(row);row.message.textContent='';render(scope);
 }
 for(const scope of scopes){
  const card=node('article'),heading=node('h2',names[scope]),state=node('p','Заблокировано'),hint=node('p','Демо-пароль: '+demo[scope]),form=node('form'),label=node('label','Пароль'),input=node('input'),submit=node('button','Открыть'),lockButton=node('button','Заблокировать'),result=node('p'),message=node('p');
  card.dataset.scope=scope;state.className='state';hint.className='hint';message.setAttribute('role','status');result.className='result';input.type='password';input.autocomplete='off';input.required=true;input.maxLength=128;label.append(input);submit.type='submit';lockButton.type='button';form.append(label,submit);card.append(heading,state,hint,form,lockButton,result,message);root.append(card);
  const row={state,input,submit,lock:lockButton,result,message,busy:false,epoch:0};rows.set(scope,row);
  lockButton.addEventListener('click',()=>lock(scope));
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(!active||row.busy||disposed)return;
   const password=input.value;clear(row);row.message.textContent='';
   // This UI accepts only public fixture credentials; never derives real passwords.
   if(password!==demo[scope]){row.message.textContent='Введите указанный демо-пароль.';return;}
   row.busy=true;const epoch=++row.epoch;render(scope);
   try{
    await lifecycle.unlock(scope,password);
    const data=await lifecycle.read(scope);
    if(disposed||epoch!==row.epoch||!lifecycle.isUnlocked(scope))return;
    row.result.textContent='Таблиц: '+Object.keys(data).length+' · Записей: '+Object.values(data).reduce((sum,list)=>sum+list.length,0);
   }catch{if(epoch===row.epoch){lifecycle.lock(scope);clear(row);row.message.textContent='Не удалось открыть демо-сеанс.';}}
   finally{if(epoch===row.epoch){row.busy=false;render(scope);}}
  });
  render(scope);
 }
 function lockAll(){for(const scope of scopes)lock(scope);}
 function onVisibility(){if(document.visibilityState!=='visible')lockAll();}
 document.addEventListener('visibilitychange',onVisibility);
 document.addEventListener('freeze',lockAll);window.addEventListener('pagehide',lockAll);
 const timer=setInterval(()=>{for(const scope of scopes)render(scope);},250);
 window.addEventListener('pagehide',e=>{if(e.persisted)return;disposed=true;clearInterval(timer);lifecycle.dispose();},{once:true});
 setup.addEventListener('click',async()=>{
  setup.disabled=true;status.textContent='Создаётся синтетический зашифрованный набор…';
  try{const data=fixture(),staged=await bundle.stage({data,passwords:demo});await bundle.activate({expectedData:data,passwords:demo,expectedBundleId:staged.bundleId});await refresh();}
  catch{status.textContent='Не удалось создать набор. Для новой попытки создайте новый демо-набор.';setup.hidden=true;}
  finally{setup.disabled=false;}
 });
 async function refresh(){
  try{const info=await bundle.status();active=info.active;setup.hidden=active;root.hidden=!active;status.textContent=active?'Демо-набор активен. Откройте нужную область.':'Набор не активирован. Создайте синтетический пример.';for(const scope of scopes)render(scope);}
  catch{active=false;lockAll();root.hidden=true;setup.hidden=true;status.textContent='Состояние набора не подтверждено. Доступ закрыт.';}
 }
 void refresh();
}
start();
