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
