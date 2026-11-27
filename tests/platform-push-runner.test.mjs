import test from 'node:test';
import assert from 'node:assert/strict';
import {runPushDeliveryLab} from '../server/platform-push-runner.mjs';
import {pushProviderPolicy,parseProviderSubscription,deliverProviderPush} from '../server/platform-push-provider.mjs';
import {changeNotificationLab,queueAthleteNoticeLab,notificationInboxLab,claimNoticeDeliveryLab,noticeDeliveryCurrentLab,finishNoticeDeliveryLab} from '../server/platform-notification-lab.mjs';
import {createVapidKeyLab} from '../tools/prototypes/vapid-lab.mjs';
const now=1800000000000,endpoint='https://push.example.invalid/sub/00000000-0000-4000-8000-000000000001';
const b64=a=>Buffer.from(a).toString('base64url');
async function keys(){
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
 return {receiverPublic:new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)),auth:crypto.getRandomValues(new Uint8Array(16)),keyPair:await createVapidKeyLab()};
}
test('RC6 durable push runner serializes claim, checks consent, retries only explicit provider delay and keeps acknowledgement separate',async()=>{
 const m={id:'m',role:'athlete',teamId:'t',athleteId:'p',revokedAt:null,expiresAt:now+600000};
 changeNotificationLab(m,{expectedRevision:0,enabled:true,endpoint},now);queueAthleteNoticeLab([m],'t','p',now);
 const {receiverPublic,auth,keyPair}=await keys();let time=now,attempt=0,sends=0;
 const adapter={
  claim:async()=>claimNoticeDeliveryLab(m,{now:time,id:(++attempt).toString(16).padStart(32,'0')}),
  current:async({ticket})=>noticeDeliveryCurrentLab(m,ticket,time),
  subscription:async()=>({endpoint,receiverPublic,auth}),
  finish:async({ticket,outcome,retryAfter})=>finishNoticeDeliveryLab(m,{ticket,outcome,retryAfter,now:time})
 };
 const opts={adapter,memberId:'m',revision:1,sequence:1,readClock:()=>time,keyPair,transport:async()=>{sends++;return {status:429,headers:new Headers({'Retry-After':'60'})};}};
 const results=await Promise.all([runPushDeliveryLab(opts),runPushDeliveryLab(opts)]);
 assert.equal(sends,1);assert.ok(results.some(x=>x.status==='busy'));assert.ok(results.some(x=>x.status==='retry'));
 assert.equal((await runPushDeliveryLab(opts)).status,'waiting');
 time+=60000;
 const accepted=await runPushDeliveryLab({...opts,transport:async()=>{sends++;return {status:201};}});
 assert.equal(accepted.status,'accepted');assert.equal(sends,2);assert.equal(notificationInboxLab(m,time).pending,true);
 assert.equal((await runPushDeliveryLab(opts)).status,'settled');
});
test('RC6 push runner refuses stale subscription after claim and treats lost completion as unknown, no automatic resend',async()=>{
 const m={id:'m',role:'athlete',teamId:'t',athleteId:'p',revokedAt:null,expiresAt:now+600000};
 changeNotificationLab(m,{expectedRevision:0,enabled:true,endpoint},now);queueAthleteNoticeLab([m],'t','p',now);
 const {receiverPublic,auth,keyPair}=await keys();let calls=0,time=now;
 const adapter={claim:async()=>claimNoticeDeliveryLab(m,{now:time,id:'1'.repeat(32)}),current:async({ticket})=>noticeDeliveryCurrentLab(m,ticket,time),subscription:async()=>({endpoint,receiverPublic,auth}),finish:async()=>{throw Error('lost');}};
 const opts={adapter,memberId:'m',revision:1,sequence:1,readClock:()=>time,keyPair,transport:async()=>{calls++;return {status:201};}};
 assert.equal((await runPushDeliveryLab(opts)).status,'finish-unknown');assert.equal(calls,1);
 assert.equal((await runPushDeliveryLab(opts)).status,'busy');
 time+=31000;assert.equal((await runPushDeliveryLab(opts)).status,'unknown');assert.equal(calls,1);
 queueAthleteNoticeLab([m],'t','p',time);
 const stale={...adapter,subscription:async()=>{changeNotificationLab(m,{expectedRevision:1,enabled:false,endpoint:null},time);return {endpoint,receiverPublic,auth};}};
 assert.equal((await runPushDeliveryLab({...opts,adapter:stale,sequence:2})).outcome,'cancelled');assert.equal(calls,1);
});
test('RC6 provider transport pins HTTPS origins, sends generic encrypted body without redirect, and refuses invalid endpoints',async()=>{
 const policy=pushProviderPolicy([{origin:'https://fcm.googleapis.com',prefix:'/fcm/send/'}]);
 const {receiverPublic,auth,keyPair}=await keys(),subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',p256dh:b64(receiverPublic),auth:b64(auth),expirationTime:null};
 assert.ok(parseProviderSubscription(subscription,policy));
 for(const target of ['http://fcm.googleapis.com/fcm/send/synthetic','https://fcm.googleapis.com.evil.invalid/fcm/send/synthetic','https://fcm.googleapis.com/fcm/send/%2fother','https://fcm.googleapis.com/fcm/send/synthetic?x=1','https://fcm.googleapis.com:444/fcm/send/synthetic','https://127.0.0.1/fcm/send/synthetic'])assert.equal(parseProviderSubscription({...subscription,endpoint:target},policy),null);
 assert.throws(()=>pushProviderPolicy([{origin:'https://example.invalid',prefix:'/fcm/send/'}]));
 let calls=0;const opts={subscription,policy,keyPair,contact:'mailto:lab@example.invalid',noticeExpiresAt:now+600000,sendBefore:now+30000,readClock:()=>now,stillCurrent:()=>true,fetcher:async(url,req)=>{calls++;assert.equal(url,subscription.endpoint);assert.equal(req.redirect,'error');assert.equal(req.headers['Content-Encoding'],'aes128gcm');assert.match(req.headers.Authorization,/^vapid t=/);assert.ok(req.body instanceof Uint8Array);assert.equal(req.headers.TTL,'600');return {status:201};}};
 assert.deepEqual(await deliverProviderPush(opts),{outcome:'accepted',retryAfter:null});assert.equal(calls,1);
 assert.equal((await deliverProviderPush({...opts,stillCurrent:()=>false})).outcome,'cancelled');
 assert.equal((await deliverProviderPush({...opts,sendBefore:now})).outcome,'cancelled');assert.equal(calls,1);
 assert.equal((await deliverProviderPush({...opts,fetcher:async()=>{throw Error('unknown');}})).outcome,'unknown');
});
