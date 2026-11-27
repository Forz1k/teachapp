// No registration or permission request at import time.
const workerURL=new URL('./push-sw.js',import.meta.url),scope=new URL('./',workerURL).href;
const b64=a=>btoa(String.fromCharCode(...a)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function decode(s){if(typeof s!=='string'||! /^[A-Za-z0-9_-]+$/.test(s)||s.length>128)throw Error('Некорректный ключ VAPID');const a=Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));if(a.length!==65||a[0]!==4||b64(a)!==s)throw Error('Некорректный ключ VAPID');return a;}
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function check(active){if(active()!==true)throw Error('Сессия изменилась. Проверьте подписку заново.');}
async function localConsent(reg,command){
 if(!reg?.active)throw Error('Service Worker не готов');
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('Неизвестное состояние локального разрешения'));},5000);
  channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();if(typeof e.data?.enabled==='boolean')resolve(e.data.enabled);else reject(Error('Неизвестное состояние локального разрешения'));};
  reg.active.postMessage(command,[channel.port2]);
 });
}
async function registration(sw,create){
 if(!sw||typeof sw.getRegistration!=='function')throw Error('Service Worker недоступен');
 let reg=await sw.getRegistration(scope);
 if(!reg&&create)reg=await sw.register(workerURL.href,{scope});
 if(!reg)return null;
 if(reg.scope!==scope)throw Error('Неверная область Service Worker');
 if(!reg.active&&create){
  const active=await Promise.race([sw.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Service Worker не готов')),10000))]);
  if(active.scope!==scope)throw Error('Неверная область Service Worker');reg=active;
 }
 return reg;
}
function payload(s){
 const p=s.getKey('p256dh'),a=s.getKey('auth');
 if(!p||!a)throw Error('Браузер не вернул ключи подписки');
 return {endpoint:s.endpoint,p256dh:b64(new Uint8Array(p)),auth:b64(new Uint8Array(a)),expirationTime:s.expirationTime};
}
export async function inspectProviderPush(api,{sw=navigator.serviceWorker}={}){
 const server=await api.request('notification/provider'),reg=await registration(sw,false);
 const local=reg?await localConsent(reg,'status'):false;
 return {server,local,subscribed:!!(reg&&await reg.pushManager.getSubscription())};
}
export async function enableProviderPush(api,{active,notification=globalThis.Notification,sw=navigator.serviceWorker}={}){
 check(active);if(!notification||typeof notification.requestPermission!=='function')throw Error('Push не поддерживается');
 // Called synchronously from the explicit user action before any awaits.
 const permission=notification.permission==='default'?await notification.requestPermission():notification.permission;
 check(active);if(permission!=='granted')throw Error('Разрешение не выдано');
 const server=await api.request('notification/provider');check(active);
 const reg=await registration(sw,true);check(active);
 if(!reg?.pushManager)throw Error('PushManager недоступен');
 const key=decode(server.applicationServerKey);let sub=await reg.pushManager.getSubscription();check(active);
 if(sub){
  const currentKey=new Uint8Array(sub.options?.applicationServerKey??[]);
  if(!server.enabled||!equal(currentKey,key)||sub.options?.userVisibleOnly!==true)throw Error('Сначала отключите старую подписку этого браузера и проверьте серверное состояние.');
 }else{
  sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});check(active);
 }
 // No automatic retry of an uncertain registration or server write.
 const result=await api.request('notification/provider','PUT',{expectedRevision:server.revision,subscription:payload(sub)});check(active);
 if(!result.enabled||await localConsent(reg,'enable')!==true)throw Error('Подписка требует сверки');
 check(active);return result;
}
export async function disableProviderPush(api,{active,sw=navigator.serviceWorker}={}){
 check(active);
 let server,readError;try{server=await api.request('notification/provider');}catch(e){readError=e;}
 check(active);const reg=await registration(sw,false);check(active);
 if(reg){
  if(await localConsent(reg,'disable')!==false)throw Error('Локальное разрешение не отключено');
  const sub=await reg.pushManager.getSubscription();if(sub)await sub.unsubscribe();
  if(await reg.pushManager.getSubscription())throw Error('Браузерная подписка ещё существует');
 }
 check(active);if(readError)throw readError;
 const result=await api.request('notification/provider','PUT',{expectedRevision:server.revision,subscription:null});check(active);return result;
}
