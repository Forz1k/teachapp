/* Separate candidate scope. Stores only an explicit consent flag, never
 * identity, access token, endpoint, payload or personal data. */
const scope=new URL(self.registration.scope),target=new URL('index.html',scope),key=new URL('.push-consent',scope).href,cacheName='teachapp-platform-candidate-consent-v1';
const exactPage=url=>{try{const u=new URL(url);return u.origin===scope.origin&&(u.pathname===target.pathname||u.pathname===scope.pathname)&&!u.search&&!u.hash;}catch{return false;}};
const supported=scope.protocol==='https:'&&scope.pathname.endsWith('/platform-candidate/');
async function enabled(){try{return supported&&(await (await caches.open(cacheName)).match(key))?.headers.get('X-TeachApp-Consent')==='yes';}catch{return false;}}
async function setConsent(value){const cache=await caches.open(cacheName);if(value)await cache.put(key,new Response('',{headers:{'X-TeachApp-Consent':'yes'}}));else await cache.delete(key);}
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('message',e=>{
 const port=e.ports?.[0];if(!supported||!port||e.source?.type!=='window'||!exactPage(e.source.url)||!['enable','disable','status'].includes(e.data))return;
 e.waitUntil((async()=>{try{if(e.data!=='status')await setConsent(e.data==='enable');port.postMessage({enabled:await enabled()});}catch{port.postMessage({error:true});}})());
});
self.addEventListener('push',e=>e.waitUntil((async()=>{
 try{
  if(!e.data||!await enabled())return;
  const raw=e.data.text();if(raw.length>128)return;
  const v=JSON.parse(raw);if(!v||Array.isArray(v)||Object.keys(v).sort().join('|')!=='kind|version'||v.kind!=='workspace-update'||v.version!==1)return;
  if(await enabled())await self.registration.showNotification('TeachApp',{body:'В личном кабинете есть обновления.',tag:'teachapp-workspace-update',renotify:false});
 }catch{}
})()));
self.addEventListener('notificationclick',e=>{
 if(e.notification?.tag!=='teachapp-workspace-update')return;
 e.notification.close();e.waitUntil((async()=>{if(!await enabled())return;const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});if(!await enabled())return;const existing=windows.find(c=>exactPage(c.url));if(existing)await existing.focus();else await self.clients.openWindow(target.href);})());
});
