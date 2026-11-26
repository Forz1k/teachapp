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
export async function deliverGenericPushLab({endpoint,receiverPublic,auth,keyPair,now,expiresAt,stillCurrent=()=>false,transport}){
 check(typeof endpoint==='string'&&endpointPattern.test(endpoint),'Only synthetic endpoint is allowed');
 check(typeof transport==='function','Injected synthetic transport required');
 check(Number.isSafeInteger(now)&&now>=0&&Number.isSafeInteger(expiresAt),'Invalid signal lifetime');
 const ttl=Math.min(86400,expiresAt-now);
 if(ttl<=0||!await stillCurrent())return cancelled();
 // Both cryptographic functions snapshot their input and use separate keys.
 const authorization=await vapidAuthorizationLab({endpoint,keyPair,now,ttl:Math.min(600,ttl)});
 const body=await sealGenericPushLab({receiverPublic,auth});
 if(!await stillCurrent())return cancelled();
 const headers={'Authorization':authorization.authorization,'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','TTL':String(ttl),'Urgency':'normal','Topic':'teachapp-workspace-update'};
 // One attempt only; no redirects, automatic retries, logs or response body.
 try{
  const response=await transport(endpoint,{method:'POST',headers,body,redirect:'error'});
  return classifyPushResponseLab(response,{now,ttl});
 }catch{return {outcome:'unknown',retryAfter:null};}
}
