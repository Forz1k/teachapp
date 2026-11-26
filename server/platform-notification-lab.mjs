/* Local synthetic subscription lifecycle. Never accepts a real endpoint,
 * encryption key, push token or notification content; never sends a request. */
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
const endpointPattern=/^https:\/\/push\.example\.invalid\/sub\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const roles=new Set(['owner','coach','athlete']);
const current=m=>m.notificationLab??{revision:0,endpoint:null};
export function notificationLabState(member,now){
 if(!roles.has(member?.role)||member.revokedAt!==null||member.expiresAt<=now)return null;
 const s=current(member);
 return {revision:s.revision,enabled:s.endpoint!==null,expiresAt:s.endpoint===null?null:member.expiresAt};
}
export function changeNotificationLab(member,body,now){
 const status=notificationLabState(member,now);
 if(!status)return {status:403,error:'forbidden'};
 if(!exact(body,['expectedRevision','enabled','endpoint'])||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||typeof body.enabled!=='boolean'||(body.enabled?typeof body.endpoint!=='string'||!endpointPattern.test(body.endpoint):body.endpoint!==null))return {status:400,error:'subscription'};
 if(body.expectedRevision!==status.revision)return {status:409,error:'revision'};
 const old=current(member);
 if(old.endpoint===body.endpoint)return {status:200,body:status,changed:false};
 if(!Number.isSafeInteger(status.revision+1))return {status:409,error:'revision'};
 member.notificationLab={revision:status.revision+1,endpoint:body.endpoint};
 return {status:200,body:notificationLabState(member,now),changed:true};
}

const NOTICE_TTL=24*60*60*1000;
const inbox=m=>current(m).notice??{sequence:0,pending:false,expiresAt:null};
// A single generic signal per opted-in athlete session. No event, profile,
// endpoint or account identifier is copied into the notice.
export function queueAthleteNoticeLab(members,teamId,athleteId,now){
 for(const member of members){
  if(member.role!=='athlete'||member.teamId!==teamId||member.athleteId!==athleteId||!notificationLabState(member,now)?.enabled)continue;
  const s=current(member),sequence=inbox(member).sequence+1;
  if(!Number.isSafeInteger(sequence))throw Error('Synthetic notice sequence exhausted');
  s.notice={sequence,pending:true,expiresAt:Math.min(now+NOTICE_TTL,member.expiresAt)};
 }
}
export function notificationInboxLab(member,now){
 const status=notificationLabState(member,now);
 if(!status||member.role!=='athlete')return null;
 const n=inbox(member),pending=status.enabled&&n.pending&&n.expiresAt>now;
 return {revision:status.revision,sequence:status.enabled?n.sequence:0,pending,expiresAt:pending?n.expiresAt:null,notice:pending?{title:'TeachApp',body:'В личном кабинете есть обновления.'}:null};
}
export function acknowledgeNoticeLab(member,body,now){
 const status=notificationInboxLab(member,now);
 if(!status)return {status:403,error:'forbidden'};
 if(!exact(body,['expectedRevision','sequence'])||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!Number.isSafeInteger(body.sequence)||body.sequence<1)return {status:400,error:'packet'};
 const n=inbox(member);
 if(!notificationLabState(member,now).enabled||body.expectedRevision!==status.revision||body.sequence!==status.sequence||n.expiresAt<=now)return {status:409,error:'revision'};
 if(!n.pending)return {status:200,body:status,changed:false};
 n.pending=false;
 return {status:200,body:notificationInboxLab(member,now),changed:true};
}
