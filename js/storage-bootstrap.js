/* Determine the real storage mode before the normal application starts. */
import {configureEncryptedStorage} from './db.js';
import {probeStorageMode,openEncryptedStorage,prepareNativeEncryptionCopy,activateNativeEncryption,recoverIntoEmptyEncryptedStorage,migrationFileLimit} from './encrypted-storage.js';
import {createOwnerSessionLifecycle,scrubPrivateDocument} from './vault-owner-lifecycle.js';
import {clearSessionSyncCredentials} from './sync-credential-storage.js';
const root=document.getElementById('app');
const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text)n.textContent=text;for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
const button=(text,fn)=>{const n=el('button',text,{type:'button',class:'btn wide'});n.onclick=fn;return n;};
const panel=(title,text)=>{const n=el('main',null,{class:'card-block'});n.style.cssText='max-width:520px;margin:24px auto;padding:16px';n.append(el('h1',title),el('p',text));root.replaceChildren(n);return n;};
function secret(parent,label,name){const input=el('input',null,{type:'password',name,autocomplete:'off',maxlength:'1024'}),field=el('label',label,{class:'field'});field.append(input);parent.append(field);return input;}
const scopes=[['school','Школа'],['coach','Тренер'],['workspace','Владелец']];
function values(fields){const result=Object.fromEntries(Object.entries(fields).map(([k,input])=>[k,input.value]));Object.values(fields).forEach(i=>{i.value='';});return result;}
function clearSecrets(v){if(v)for(const k of Object.keys(v))v[k]=undefined;}
const resetURL=()=>{const u=new URL(location.href);u.searchParams.delete('secure-migration');u.searchParams.delete('secure-recovery');location.replace(u.href);};
function migrationScreen(recovery=false){
 const n=panel(recovery?'Восстановление защищённой базы · RC3':'Шифрование базы · RC3',recovery?'Только новый профиль без базы TeachApp. Существующее хранилище никогда не заменяется.':'Экспериментальный перенос на v11. Сохраните независимую копию вне браузера и выберите тот же файл. Не используйте рабочие данные до независимой приёмки. Старые версии не смогут открыть v11.');
 const bp=secret(n,'Независимый пароль копии (от 12 символов)','backup');
 const status=el('p','Данные не изменены.',{role:'status'});let busy=false,active=true;
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&busy)active=false;});window.addEventListener('pagehide',()=>{active=false;});
 const download=button('Создать защищённую копию',async()=>{
  if(busy||!active)return;busy=true;download.disabled=true;let password=bp.value;bp.value='';
  try{const file=await prepareNativeEncryptionCopy({backupPassword:password});if(!active)return;const url=URL.createObjectURL(new Blob([file],{type:'application/json'})),a=el('a','',{href:url,download:'teachapp-v11-recovery.json'});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status.textContent='Копия создана и проверена. Сохраните файл, затем выберите его ниже.';}
  catch(e){status.textContent=e.message;}finally{password=undefined;busy=false;download.disabled=false;}
 });
 if(!recovery)n.append(download);
 const file=el('input',null,{type:'file',accept:'.json,application/json','aria-label':'Сохранённая независимая копия'});n.append(file);
 const fields=Object.fromEntries(scopes.map(([k,label])=>[k,secret(n,'Новый пароль · '+label,k)]));
 const cp=Object.fromEntries(scopes.slice(0,2).map(([k,label])=>[k,secret(n,'Пароль существующей синхронизации · '+label+' (если есть контрольная точка)','checkpoint-'+k)]));
 const confirm=el('input',null,{type:'checkbox'}),label=el('label',' Я сохранил независимую копию и понимаю, что старые версии не откроют v11.');label.prepend(confirm);n.append(label,status);
 const activate=button(recovery?'Восстановить в пустой профиль':'Перенести в зашифрованную базу',async()=>{
  if(busy||!active||!confirm.checked||!file.files[0]){status.textContent='Выберите сохранённую копию и подтвердите действие.';return;}
  if(file.files[0].size>migrationFileLimit){status.textContent='Файл слишком большой.';return;}
  busy=true;activate.disabled=download.disabled=true;const passwords=values(fields),checkpointPasswords=values(cp);let backupPassword=bp.value;bp.value='';
  try{const content=await file.files[0].text();if(!active)return;await (recovery?recoverIntoEmptyEncryptedStorage:activateNativeEncryption)({passwords,backupPassword,file:content,checkpointPasswords,confirmed:true,stillAllowed:()=>active&&document.visibilityState==='visible'});resetURL();}
  catch(e){status.textContent='Операция не подтверждена: '+e.message+' Не очищайте данные.';}
  finally{clearSecrets(passwords);clearSecrets(checkpointPasswords);backupPassword=undefined;busy=false;activate.disabled=download.disabled=false;}
 });
 n.append(activate,button('Вернуться без изменений',()=>{if(!busy)resetURL();}));
}
async function encryptedScreen(){
 const n=panel('Защищённый TeachApp','Введите три независимых пароля. Ключи не сохраняются. При скрытии страницы потребуется повторный вход.');
 const form=el('form'),fields=Object.fromEntries(scopes.map(([k,label])=>[k,secret(form,label,k)])),status=el('p','',{role:'status'}),submit=el('button','Войти',{type:'submit',class:'btn primary wide'});form.append(status,submit);n.append(form,el('p','Если пароли утеряны, сохраните существующий профиль и восстановите независимую копию в новом профиле через ?secure-recovery=1.'));
 const gate=createOwnerSessionLifecycle({channelName:'teachapp-encrypted-owner-v11',openSession:openEncryptedStorage,onLock:reason=>{
  clearSessionSyncCredentials();window.dispatchEvent(new Event('teachapp:encrypted-locked'));scrubPrivateDocument();
  if(!['pagehide','freeze','dispose'].includes(reason))location.reload();
 }});
 configureEncryptedStorage(gate);
 window.addEventListener('teachapp:lock-encrypted',()=>gate.lockEveryTab());
 window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(submit.disabled)return;submit.disabled=true;const passwords=values(fields);
  try{await gate.unlock(passwords);}catch{status.textContent='Неверный пароль или повреждение хранилища. Данные не изменены.';submit.disabled=false;return;}
  finally{clearSecrets(passwords);}
  root.replaceChildren();await import('./app.js');
 });
}
async function boot(){
 const mode=await probeStorageMode(),query=new URL(location.href).searchParams;
 if(mode==='encrypted')return encryptedScreen();
 if(query.get('secure-recovery')==='1'){
  if(mode!=='empty'){const n=panel('Восстановление остановлено','База уже существует. Используйте новый профиль браузера; не удаляйте данные.');n.append(button('Назад',resetURL));return;}
  return migrationScreen(true);
 }
 if(query.get('secure-migration')==='1')return migrationScreen();
 await import('./app.js');
}
boot().catch(()=>{const n=panel('Не удалось определить формат базы','Не очищайте данные браузера. Закройте другие вкладки, проверьте резервную копию и повторите запуск.');n.append(button('Повторить',()=>location.reload()));});
