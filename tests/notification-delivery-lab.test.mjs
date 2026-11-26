import test from 'node:test';
import assert from 'node:assert/strict';
import {changeNotificationLab,queueAthleteNoticeLab,notificationInboxLab,acknowledgeNoticeLab,claimNoticeDeliveryLab,noticeDeliveryCurrentLab,finishNoticeDeliveryLab} from '../server/platform-notification-lab.mjs';
const now=1800000000000,endpoint='https://push.example.invalid/sub/00000000-0000-4000-8000-000000000001',id=n=>n.toString(16).padStart(32,'0');
function fixture(expiresAt=now+1000000){
 const m={role:'athlete',teamId:'t',athleteId:'a',revokedAt:null,expiresAt};
 changeNotificationLab(m,{expectedRevision:0,enabled:true,endpoint},now);queueAthleteNoticeLab([m],'t','a',now);return m;
}
const claim=(m,n,time=now)=>claimNoticeDeliveryLab(m,{now:time,id:id(n)});
const finish=(m,ticket,outcome,time=now,retryAfter=null)=>finishNoticeDeliveryLab(m,{ticket,outcome,now:time,retryAfter});
test('Delivery claim is exclusive, persists across a JSON reload and never acknowledges inbox on accepted transport',()=>{
 let m=fixture();const first=claim(m,1);assert.equal(first.status,'claimed');assert.equal(first.changed,true);assert.equal(first.ticket.leaseUntil,now+30000);
 m=JSON.parse(JSON.stringify(m));
 assert.equal(claim(m,2).status,'busy');assert.equal(noticeDeliveryCurrentLab(m,first.ticket,now),true);
 assert.equal(finish(m,first.ticket,'accepted').status,'accepted');
 assert.equal(finish(m,first.ticket,'accepted').status,'stale');assert.equal(claim(m,3).status,'settled');
 const inbox=notificationInboxLab(m,now);assert.equal(inbox.pending,true);assert.doesNotMatch(JSON.stringify(inbox),/leaseUntil|delivery|example.invalid/);
 assert.equal(acknowledgeNoticeLab(m,{expectedRevision:inbox.revision,sequence:inbox.sequence},now).status,200);
 assert.equal(claim(m,4).status,'inactive');
});
test('Delivery retries only explicit bounded hints and never repeats an uncertain attempt',()=>{
 const m=fixture(),a=claim(m,1).ticket;
 assert.equal(finish(m,a,'retry-later',now,10).status,'retry');
 assert.equal(claim(m,2,now+9999).status,'waiting');const b=claim(m,2,now+10000).ticket;assert.equal(b.attempt,2);
 assert.equal(finish(m,a,'accepted',now+10000).status,'stale');
 assert.equal(finish(m,b,'retry-later',now+10000,1).status,'retry');
 const c=claim(m,3,now+11000).ticket;assert.equal(c.attempt,3);assert.equal(finish(m,c,'retry-later',now+11000,1).status,'rejected');
 assert.equal(claim(m,4,now+12000).status,'settled');
 const lost=fixture(),l=claim(lost,1).ticket;
 assert.equal(noticeDeliveryCurrentLab(lost,l,now+30000),false);
 assert.equal(finish(lost,l,'accepted',now+30000).status,'stale');
 assert.equal(claim(lost,2,now+30000).status,'unknown');assert.equal(claim(lost,3,now+31000).status,'settled');
 const short=fixture(now+1000),s=claim(short,1).ticket;assert.equal(finish(short,s,'retry-later',now,1).status,'rejected');
});
test('Old delivery cannot disable replacement consent or settle a newer sequence',()=>{
 const m=fixture(),old=claim(m,1).ticket;
 queueAthleteNoticeLab([m],'t','a',now+1);assert.equal(finish(m,old,'subscription-gone',now+1).status,'stale');
 const latest=claim(m,2,now+1).ticket;assert.equal(latest.sequence,2);assert.equal(finish(m,latest,'subscription-gone',now+1).status,'subscription-gone');
 assert.equal(notificationInboxLab(m,now+1).pending,false);
 changeNotificationLab(m,{expectedRevision:2,enabled:true,endpoint},now+2);queueAthleteNoticeLab([m],'t','a',now+2);
 assert.equal(finish(m,latest,'accepted',now+2).status,'stale');assert.equal(claim(m,3,now+2).status,'claimed');
 m.revokedAt=now+3;assert.equal(claim(m,4,now+3).status,'inactive');
});
