/* Local, injected transport only. Does not call fetch or accept real endpoints.
 * A transport result is not proof that the device displayed or read anything. */
import {sealGenericPushLab} from './web-push-crypto-lab.mjs';
import {vapidAuthorizationLab} from './vapid-lab.mjs';
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const endpointPattern=/^https:\/\/push\.example\.invalid\/sub\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const cancelled=()=>({outcome:'cancelled',retryAfter:null});
function retryDelay(raw,now,ttl){
 let delay=60;
 if(typeof raw==='string'){
  if(/^\d{1,10}$/.test(raw))delay=Number(raw);
  else if(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)){
   const date=Date.parse(raw);if(Number.isFinite(date))delay=Math.ceil(date/1000-now);
  }
 }
 delay=Math.max(1,delay);
 // Never shorten server's retry request or retry beyond signal expiry.
 return delay<=3600&&delay<ttl?delay:null;
}
export function classifyPushResponseLab(response,{now,ttl}){
 const status=response?.status;
 if(!Number.isInteger(status)||status<100||status>599)return {outcome:'unknown',retryAfter:null};
 if(status===201||status===202)return {outcome:'accepted',retryAfter:null};
 if(status===404||status===410)return {outcome:'subscription-gone',retryAfter:null};
 if(status===401||status===403)return {outcome:'authorization-error',retryAfter:null};
 if(status===413)return {outcome:'payload-error',retryAfter:null};
 if(status===429||status===503){
  let raw=null;try{raw=response.headers?.get('Retry-After');}catch{}
  return {outcome:'retry-later',retryAfter:retryDelay(raw,now,ttl)};
 }
 if(status>=500)return {outcome:'unknown',retryAfter:null};
 return {outcome:'rejected',retryAfter:null};
}
export async function deliverGenericPushLab({endpoint,receiverPublic,auth,keyPair,now,expiresAt,readClock=()=>now,stillCurrent=()=>false,transport}){
 check(typeof endpoint==='string'&&endpointPattern.test(endpoint),'Only synthetic endpoint is allowed');
 check(typeof transport==='function','Injected synthetic transport required');
 check(Number.isSafeInteger(now)&&now>=0&&Number.isSafeInteger(expiresAt),'Invalid signal lifetime');
 check(typeof readClock==='function'&&typeof stillCurrent==='function','Invalid guard');
 // Capture inputs before the first await, including the pair container.
 check(receiverPublic instanceof Uint8Array&&receiverPublic.length===65&&auth instanceof Uint8Array&&auth.length===16,'Invalid subscription key');
 receiverPublic=receiverPublic.slice();auth=auth.slice();keyPair={publicKey:keyPair?.publicKey,privateKey:keyPair?.privateKey};
 let observed=now;
 const clock=()=>{try{const value=readClock();if(!Number.isSafeInteger(value)||value<observed)return null;observed=value;return value;}catch{return null;}};
 const allowed=async()=>{try{return await stillCurrent()===true;}catch{return false;}};
 if(expiresAt<=now||!await allowed())return cancelled();
 const started=clock();
 if(started===null||expiresAt<=started)return cancelled();
 const authorization=await vapidAuthorizationLab({endpoint,keyPair,now:started,ttl:Math.min(600,expiresAt-started)});
 const body=await sealGenericPushLab({receiverPublic,auth});
 if(!await allowed())return cancelled();
 // No asynchronous step between this final time fence and the call.
 const sentAt=clock();
 if(sentAt===null||sentAt>=expiresAt||sentAt>=authorization.expiresAt)return cancelled();
 const ttl=Math.min(86400,expiresAt-sentAt);
 const headers={'Authorization':authorization.authorization,'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','TTL':String(ttl),'Urgency':'normal','Topic':'teachapp-workspace-update'};
 try{
  const response=await transport(endpoint,{method:'POST',headers,body,redirect:'error'});
  const receivedAt=clock();
  // A failed clock after a possible send cannot turn it into "cancelled".
  // Retain the outcome, but suppress any retry hint.
  return classifyPushResponseLab(response,{now:receivedAt??sentAt,ttl:receivedAt===null?0:Math.max(0,Math.min(expiresAt,sentAt+ttl)-receivedAt)});
 }catch{return {outcome:'unknown',retryAfter:null};}
}
