import {pushReceiverLab} from '../push-receiver-lab.mjs';
// This worker is never registered by the main application. Memory-only
// synthetic consent expires when the isolated worker is terminated.
let enabled=false;
const receiver=pushReceiverLab({registration:self.registration,clients:self.clients,consent:()=>enabled});
const target=new URL('index.html',self.registration.scope);
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>event.waitUntil(receiver.push(event)));
self.addEventListener('notificationclick',event=>event.waitUntil(receiver.click(event)));
self.addEventListener('message',event=>{
 const source=event.source,port=event.ports?.[0];
 if(!port||source?.type!=='window'||source.url!==target.href)return;
 const command=event.data;
 if(command==='enable'||command==='disable'){enabled=command==='enable';port.postMessage({enabled});return;}
 if(command==='status'){port.postMessage({enabled});return;}
 // Synthetic malformed/denied cases only: avoid browser-generated fallback
 // notifications for a real push that does not display a notification.
 if(command?.kind==='rehearse'&&typeof command.text==='string'&&command.text.length<=512){
  event.waitUntil(receiver.push({data:{text:()=>command.text}}).then(shown=>port.postMessage({shown})));
 }
});
