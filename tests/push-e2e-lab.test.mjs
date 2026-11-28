import test from 'node:test';
import assert from 'node:assert/strict';
import {changeNotificationLab,queueAthleteNoticeLab,notificationInboxLab,acknowledgeNoticeLab} from '../server/platform-notification-lab.mjs';
import {deliverGenericPushLab} from '../tools/prototypes/push-transport-lab.mjs';
import {createVapidKeyLab} from '../tools/prototypes/vapid-lab.mjs';
import {pushReceiverLab} from '../tools/prototypes/push-receiver-lab.mjs';
const now=1800000000,endpoint='https://push.example.invalid/sub/00000000-0000-4000-8000-000000000001',scope='http://127.0.0.1:8099/tools/prototypes/push-receiver/';
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true}),curve={name:'ECDH',namedCurve:'P-256'};
const b64=s=>Buffer.from(s,'base64url'),json=s=>JSON.parse(dec.decode(b64(s)));
async function fixture(){
 const member={role:'athlete',teamId:'team',athleteId:'athlete',revokedAt:null,expiresAt:(now+1800)*1000};
 const other={...member,athleteId:'other'};
 assert.equal(changeNotificationLab(member,{expectedRevision:0,enabled:true,endpoint},now*1000).status,200);
 assert.equal(changeNotificationLab(other,{expectedRevision:0,enabled:true,endpoint:endpoint.replace(/1$/,'2')},now*1000).status,200);
 queueAthleteNoticeLab([member,other],'team','athlete',now*1000);
 const selected=notificationInboxLab(member,now*1000);
 const current=()=>{const n=notificationInboxLab(member,now*1000);return !!(n?.pending&&n.revision===selected.revision&&n.sequence===selected.sequence);};
 const ua=await crypto.subtle.generateKey(curve,false,['deriveBits']),receiverPublic=new Uint8Array(await crypto.subtle.exportKey('raw',ua.publicKey)),auth=crypto.getRandomValues(new Uint8Array(16)),keyPair=await createVapidKeyLab();
 const trusted=new Uint8Array(await crypto.subtle.exportKey('raw',keyPair.publicKey));
 const shown=[],receiver=pushReceiverLab({registration:{scope,showNotification:async(...args)=>shown.push(args)},consent:()=>current()});
 const params={endpoint,receiverPublic,auth,keyPair,now,expiresAt:Math.floor(selected.expiresAt/1000),stillCurrent:current};
 // Test-only independent receiving side: verify the pinned signing key
 // and claims before deriving keys from the RFC 8188 header.
 async function receive(url,request){
  assert.equal(url,endpoint);assert.equal(request.method,'POST');assert.equal(request.redirect,'error');
  assert.equal(request.headers['Content-Encoding'],'aes128gcm');assert.equal(request.headers.TTL,'1800');
  const m=/^vapid t=([A-Za-z0-9_.-]+), k=([A-Za-z0-9_-]+)$/.exec(request.headers.Authorization);
  if(!m||!Buffer.from(trusted).equals(b64(m[2])))return {status:403};
  const [h,p,s]=m[1].split('.');const claims=json(p);
  if(json(h).alg!=='ES256'||claims.aud!==new URL(endpoint).origin||claims.exp<=now||claims.exp>now+86400)return {status:403};
  const verifier=await crypto.subtle.importKey('raw',trusted,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},verifier,b64(s),enc.encode(h+'.'+p)))return {status:403};
  const record=request.body;
  try{
   assert.ok(record.length>=103&&record.length<=4096);assert.equal(record[20],65);assert.equal(new DataView(record.buffer,record.byteOffset,record.byteLength).getUint32(16),4096);
   const senderBytes=record.slice(21,86),sender=await crypto.subtle.importKey('raw',senderBytes,curve,false,[]);
   const shared=await crypto.subtle.deriveBits({name:'ECDH',public:sender},ua.privateKey,256);
   const hkdf=async(key,salt,info,n)=>crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},await crypto.subtle.importKey('raw',key,'HKDF',false,['deriveBits']),n);
   const ikm=await hkdf(shared,auth,Buffer.concat([enc.encode('WebPush: info\0'),receiverPublic,senderBytes]),256);
   const cek=await crypto.subtle.importKey('raw',await hkdf(ikm,record.slice(0,16),enc.encode('Content-Encoding: aes128gcm\0'),128),'AES-GCM',false,['decrypt']);
   const iv=await hkdf(ikm,record.slice(0,16),enc.encode('Content-Encoding: nonce\0'),96);
   const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},cek,record.slice(86)));
   assert.equal(plain.at(-1),2);
   await receiver.push({data:{text:()=>dec.decode(plain.slice(0,-1))}});
   return {status:201};
  }catch{return {status:400};}
 }
 return {member,other,selected,params,receive,shown};
}
test('Full synthetic queue-to-receiver cycle verifies VAPID, decrypts, shows a generic notice and keeps explicit acknowledgement separate',async()=>{
 const f=await fixture();assert.equal(notificationInboxLab(f.other,now*1000).pending,false);
 assert.deepEqual(await deliverGenericPushLab({...f.params,transport:f.receive}),{outcome:'accepted',retryAfter:null});
 assert.deepEqual(f.shown,[['TeachApp',{body:'В личном кабинете есть обновления.',tag:'teachapp-workspace-update-lab',renotify:false}]]);
 assert.equal(notificationInboxLab(f.member,now*1000).pending,true);
 assert.equal(acknowledgeNoticeLab(f.member,{expectedRevision:f.selected.revision,sequence:f.selected.sequence},now*1000).body.pending,false);
 assert.equal(notificationInboxLab(f.other,now*1000).pending,false);
 let calls=0;assert.equal((await deliverGenericPushLab({...f.params,transport:()=>{calls++;return {status:201};}})).outcome,'cancelled');assert.equal(calls,0);
});
test('Full synthetic cycle refuses substituted VAPID key and tampered ciphertext, and does not show revoked or stale signals',async()=>{
 const f=await fixture();
 const otherKey=await createVapidKeyLab();
 assert.equal((await deliverGenericPushLab({...f.params,keyPair:otherKey,transport:f.receive})).outcome,'authorization-error');
 assert.equal((await deliverGenericPushLab({...f.params,transport:(u,r)=>{const body=r.body.slice();body[body.length-1]^=1;return f.receive(u,{...r,body});}})).outcome,'rejected');
 assert.deepEqual(f.shown,[]);assert.equal(notificationInboxLab(f.member,now*1000).pending,true);
 let calls=0;
 // Simulate unsubscribe after the transport has accepted the request.
 const result=await deliverGenericPushLab({...f.params,transport:(u,r)=>{calls++;changeNotificationLab(f.member,{expectedRevision:f.selected.revision,enabled:false,endpoint:null},now*1000);return f.receive(u,r);}});
 assert.equal(result.outcome,'accepted');assert.equal(calls,1);assert.deepEqual(f.shown,[]);
 const next=await fixture();queueAthleteNoticeLab([next.member],'team','athlete',now*1000);
 assert.equal((await deliverGenericPushLab({...next.params,transport:()=>{calls++;return {status:201};}})).outcome,'cancelled');assert.equal(calls,1);
});
