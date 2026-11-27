/* Candidate-only encrypted push subscription storage. The key is independent
 * of workspace backups; only the background sender opens the envelope. */
import {pushProviderPolicy,parseProviderSubscription} from './platform-push-provider.mjs';
import {notificationInboxLab,notificationLabState} from './platform-notification-lab.mjs';
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===k.slice().sort().join('|');
const b64=a=>btoa(String.fromCharCode(...a)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function decode(s,max){if(typeof s!=='string'||s.length>max||! /^[A-Za-z0-9_-]+$/.test(s))throw Error('encoding');const a=Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));if(b64(a)!==s)throw Error('encoding');return a;}
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(s);
const context=(w,m,r)=>{if(!id(w)||!id(m)||!Number.isSafeInteger(r)||r<1)throw Error('context');return enc.encode(JSON.stringify(['teachapp-provider-sub-v1',w,m,r]));};
export async function providerConfiguration(env){
 try{
  if(env.TEACHAPP_PLATFORM_STAGE!=='candidate'||env.TEACHAPP_PLATFORM_PUSH_ENABLED!=='true'||typeof env.TEACHAPP_PLATFORM_PUSH_STORAGE_KEY!=='string'||! /^[a-f0-9]{64}$/.test(env.TEACHAPP_PLATFORM_PUSH_STORAGE_KEY)||env.TEACHAPP_PLATFORM_PUSH_STORAGE_KEY===env.TEACHAPP_PLATFORM_BACKUP_KEY)return null;
  const rules=JSON.parse(env.TEACHAPP_PLATFORM_PUSH_PROVIDERS),policy=pushProviderPolicy(rules),contact=env.TEACHAPP_PLATFORM_PUSH_CONTACT;
  if(typeof contact!=='string'||!/^mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(contact))return null;
  const j=JSON.parse(env.TEACHAPP_PLATFORM_VAPID_PRIVATE_JWK);
  if(!exact(j,['kty','crv','x','y','d'])||j.kty!=='EC'||j.crv!=='P-256'||['x','y','d'].some(k=>decode(j[k],64).length!==32))return null;
  const curve={name:'ECDSA',namedCurve:'P-256'},privateKey=await crypto.subtle.importKey('jwk',j,curve,false,['sign']),publicKey=await crypto.subtle.importKey('jwk',{kty:j.kty,crv:j.crv,x:j.x,y:j.y},curve,true,['verify']);
  const proof=enc.encode('teachapp-vapid-key-check');
  if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,proof),proof))return null;
  const storageKey=await crypto.subtle.importKey('raw',Uint8Array.from(env.TEACHAPP_PLATFORM_PUSH_STORAGE_KEY.match(/../g),x=>parseInt(x,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
  return {policy,contact,keyPair:{privateKey,publicKey},publicKey:b64(new Uint8Array(await crypto.subtle.exportKey('raw',publicKey))),storageKey};
 }catch{return null;}
}
export async function sealProviderSubscription(config,value,workspaceId,memberId,revision,now){
 const sub=parseProviderSubscription(value,config.policy);
 if(!sub||sub.expiresAt!==null&&sub.expiresAt<=now)throw Error('subscription');
 const iv=crypto.getRandomValues(new Uint8Array(12)),raw=enc.encode(JSON.stringify(value));if(raw.length>3072)throw Error('subscription');
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context(workspaceId,memberId,revision)},config.storageKey,raw);
 return {iv:b64(iv),ciphertext:b64(new Uint8Array(cipher)),expiresAt:sub.expiresAt};
}
export async function openProviderSubscription(config,sealed,workspaceId,memberId,revision){
 if(!exact(sealed,['iv','ciphertext','expiresAt']))throw Error('subscription');
 const iv=decode(sealed.iv,32);if(iv.length!==12)throw Error('iv');
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:context(workspaceId,memberId,revision)},config.storageKey,decode(sealed.ciphertext,4200));
 const value=JSON.parse(dec.decode(raw));const parsed=parseProviderSubscription(value,config.policy);
 if(!parsed||parsed.expiresAt!==sealed.expiresAt)throw Error('subscription');return value;
}
export function providerStatus(member,now){
 if(member?.role!=='athlete'||!notificationLabState(member,now))return null;
 const state=member.notificationLab??{revision:0,endpoint:null};
 const enabled=state.endpoint==='provider'&&!!state.sealedSubscription&&(state.sealedSubscription.expiresAt===null||state.sealedSubscription.expiresAt>now);
 return {revision:state.revision,enabled,expiresAt:enabled?Math.min(member.expiresAt,state.sealedSubscription.expiresAt??member.expiresAt):null};
}
export function changeProviderSubscription(member,expectedRevision,sealed,now){
 const current=providerStatus(member,now);
 if(!current)return {status:403,body:{error:'forbidden'}};
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision!==current.revision||!Number.isSafeInteger(expectedRevision+1))return {status:409,body:{error:'revision'}};
 if(sealed===null&&(!member.notificationLab||member.notificationLab.endpoint===null))return {status:200,body:current,changed:false};
 member.notificationLab=sealed===null?{revision:expectedRevision+1,endpoint:null}:{revision:expectedRevision+1,endpoint:'provider',sealedSubscription:sealed};
 return {status:200,body:providerStatus(member,now),changed:true};
}
export function providerDeliveryDue(member,now){
 const n=member?.notificationLab?.notice;
 if(!providerStatus(member,now)?.enabled||!notificationInboxLab(member,now)?.pending||!n)return null;
 const phase=n.delivery?.phase??'ready';
 if(phase==='ready')return now;
 if(phase==='retry')return n.delivery.notBefore<n.expiresAt?n.delivery.notBefore:null;
 if(phase==='sending')return n.delivery.leaseUntil;
 return null;
}
