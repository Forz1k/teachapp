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

// Internal pure scheduling rehearsal. Caller must persist the returned member
// state transactionally before sending. No public route, timer or transport.
const LEASE_MS=30000,MAX_ATTEMPTS=3;
const validTime=n=>Number.isSafeInteger(n)&&n>=0;
const ticketId=s=>typeof s==='string'&&/^[0-9a-f]{32}$/.test(s);
const outcomeSet=new Set(['accepted','subscription-gone','authorization-error','payload-error','retry-later','unknown','rejected','cancelled']);
const activeNotice=(member,now)=>validTime(now)&&notificationInboxLab(member,now)?.pending?inbox(member):null;
const delivery=n=>n.delivery??{phase:'ready',attempt:0};
const result=(status,changed=false,ticket=null)=>({status,changed,ticket});
export function claimNoticeDeliveryLab(member,{now,id}={}){
 if(!validTime(now)||!ticketId(id))return result('invalid');
 const n=activeNotice(member,now);if(!n)return result('inactive');
 const d=delivery(n);
 if(d.phase==='sending'){
  if(now<d.leaseUntil)return result('busy');
  n.delivery={phase:'unknown',attempt:d.attempt};return result('unknown',true);
 }
 if(d.phase==='retry'&&now<d.notBefore)return result('waiting');
 if(!['ready','retry'].includes(d.phase)||d.attempt>=MAX_ATTEMPTS)return result('settled');
 const ticket={revision:current(member).revision,sequence:n.sequence,attempt:d.attempt+1,id,leaseUntil:Math.min(now+LEASE_MS,n.expiresAt),expiresAt:n.expiresAt};
 n.delivery={phase:'sending',attempt:ticket.attempt,id,leaseUntil:ticket.leaseUntil};
 return result('claimed',true,ticket);
}
export function noticeDeliveryCurrentLab(member,ticket,now){
 const n=activeNotice(member,now);if(!n||!ticket)return false;
 const d=delivery(n);
 return d.phase==='sending'&&current(member).revision===ticket.revision&&n.sequence===ticket.sequence&&n.expiresAt===ticket.expiresAt&&d.attempt===ticket.attempt&&d.id===ticket.id&&d.leaseUntil===ticket.leaseUntil&&now<d.leaseUntil;
}
export function finishNoticeDeliveryLab(member,{ticket,outcome,retryAfter=null,now}={}){
 if(!outcomeSet.has(outcome)||!validTime(now)||retryAfter!==null&&(!Number.isSafeInteger(retryAfter)||retryAfter<1||retryAfter>3600)||outcome!=='retry-later'&&retryAfter!==null)return result('invalid');
 if(!noticeDeliveryCurrentLab(member,ticket,now))return result('stale');
 const n=inbox(member),attempt=ticket.attempt;
 if(outcome==='subscription-gone'){
  const change=changeNotificationLab(member,{expectedRevision:ticket.revision,enabled:false,endpoint:null},now);
  return change.changed?result('subscription-gone',true):result('stale');
 }
 if(outcome==='retry-later'&&retryAfter!==null&&attempt<MAX_ATTEMPTS&&now+retryAfter*1000<n.expiresAt){
  n.delivery={phase:'retry',attempt,notBefore:now+retryAfter*1000};return result('retry',true);
 }
 // A timeout/unknown outcome is terminal for this sequence; no automatic
 // replay after a process crash or a possibly accepted network request.
 n.delivery={phase:outcome==='retry-later'?'rejected':outcome,attempt};
 return result(n.delivery.phase,true);
}
