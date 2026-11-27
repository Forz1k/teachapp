/* Provider-ready Web Push sender, disabled unless the operator supplies an
 * exact HTTPS endpoint policy, a non-exportable VAPID key and trusted fetch.
 * It is not installed in the existing production Worker. */
import {sealGenericPushLab} from '../tools/prototypes/web-push-crypto-lab.mjs';
import {classifyPushResponseLab} from '../tools/prototypes/push-transport-lab.mjs';
const enc=new TextEncoder(),alg={name:'ECDSA',hash:'SHA-256'};
const b64=a=>btoa(String.fromCharCode(...a)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const json=x=>b64(enc.encode(JSON.stringify(x)));
const invalid=()=>({outcome:'cancelled',retryAfter:null});
const unknown=()=>({outcome:'unknown',retryAfter:null});
const allowedHosts=new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
function exact(v,keys){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');}
export function pushProviderPolicy(entries){
 if(!Array.isArray(entries)||entries.length<1||entries.length>3)throw Error('Provider policy');
 const rules=entries.map(x=>{
  if(!exact(x,['origin','prefix'])||typeof x.origin!=='string'||typeof x.prefix!=='string')throw Error('Provider policy');
  const u=new URL(x.origin);
  if(u.protocol!=='https:'||u.origin!==x.origin||!allowedHosts.has(u.hostname)||u.port||u.username||u.password||! /^\/[A-Za-z0-9_/-]{1,100}\/$/.test(x.prefix)||x.prefix.includes('//')||x.prefix.includes('..'))throw Error('Provider policy');
  return {origin:u.origin,prefix:x.prefix};
 });
 return endpoint=>{
  try{
   if(typeof endpoint!=='string'||endpoint.length>2048)return null;
   const u=new URL(endpoint);
   if(u.href!==endpoint||u.username||u.password||u.hash||u.search||!rules.some(r=>r.origin===u.origin&&u.pathname.startsWith(r.prefix)&&u.pathname.length>r.prefix.length)||! /^\/[A-Za-z0-9_./~%-]+$/.test(u.pathname)||/%(?:2f|5c|2e|00)/i.test(u.pathname)||u.pathname.includes('//'))return null;
   return u;
  }catch{return null;}
 };
}
export function parseProviderSubscription(value,policy){
 try{
  if(!exact(value,['endpoint','p256dh','auth','expirationTime'])||typeof policy!=='function'||!policy(value.endpoint)||value.expirationTime!==null&&(!Number.isSafeInteger(value.expirationTime)||value.expirationTime<0))return null;
  const decode=(s,n)=>{
   if(typeof s!=='string'||s.length>128||! /^[A-Za-z0-9_-]+$/.test(s))throw Error('key');
   const a=Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
   if(a.length!==n||b64(a)!==s)throw Error('key');return a;
  };
  const receiverPublic=decode(value.p256dh,65),auth=decode(value.auth,16);
  return receiverPublic[0]===4?{endpoint:value.endpoint,receiverPublic,auth,expiresAt:value.expirationTime}:null;
 }catch{return null;}
}
export async function deliverProviderPush({subscription,policy,keyPair,contact,noticeExpiresAt,sendBefore,readClock=Date.now,stillCurrent,fetcher,timeoutMs=10000}){
 const sub=parseProviderSubscription(subscription,policy);
 if(!sub||typeof stillCurrent!=='function'||typeof fetcher!=='function'||typeof contact!=='string'||!/^mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(contact)||!Number.isSafeInteger(noticeExpiresAt)||!Number.isSafeInteger(sendBefore)||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>15000)return invalid();
 const expiry=Math.min(noticeExpiresAt,sub.expiresAt??noticeExpiresAt);
 let observed=-1;
 const clock=()=>{try{const v=readClock();if(!Number.isSafeInteger(v)||v<0||v<observed)return null;observed=v;return v;}catch{return null;}};
 const consent=async()=>{try{return await stillCurrent()===true;}catch{return false;}};
 const permitted=t=>t!==null&&t<expiry&&t<sendBefore;
 let t=clock();if(!permitted(t)||!await consent())return invalid();
 let authorization,body,tokenExpires;
 try{
  const {privateKey,publicKey}=keyPair??{};
  if(privateKey?.type!=='private'||privateKey.extractable||privateKey.algorithm?.name!=='ECDSA'||privateKey.algorithm.namedCurve!=='P-256'||publicKey?.algorithm?.namedCurve!=='P-256')return invalid();
  const raw=new Uint8Array(await crypto.subtle.exportKey('raw',publicKey));
  tokenExpires=Math.min(Math.floor(expiry/1000),Math.floor(t/1000)+600);
  if(tokenExpires<=Math.floor(t/1000))return invalid();
  const unsigned=json({typ:'JWT',alg:'ES256'})+'.'+json({aud:new URL(sub.endpoint).origin,exp:tokenExpires,sub:contact});
  const sig=new Uint8Array(await crypto.subtle.sign(alg,privateKey,enc.encode(unsigned)));
  if(sig.length!==64||!await crypto.subtle.verify(alg,publicKey,sig,enc.encode(unsigned)))return invalid();
  authorization='vapid t='+unsigned+'.'+b64(sig)+', k='+b64(raw);
  body=await sealGenericPushLab({receiverPublic:sub.receiverPublic,auth:sub.auth});
 }catch{return invalid();}
 if(!await consent())return invalid();
 t=clock();if(!permitted(t)||Math.floor(t/1000)>=tokenExpires)return invalid();
 const ttl=Math.min(86400,Math.floor((expiry-t)/1000));if(ttl<1)return invalid();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,Math.max(1,sendBefore-t)));
 try{
  const response=await fetcher(sub.endpoint,{method:'POST',headers:{Authorization:authorization,'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:String(ttl),Urgency:'normal',Topic:'teachapp-workspace-update'},body,redirect:'error',signal:controller.signal});
  const after=clock();
  return classifyPushResponseLab(response,{now:Math.floor((after??t)/1000),ttl:after===null?0:Math.max(0,Math.floor((expiry-after)/1000))});
 }catch{return unknown();}finally{clearTimeout(timer);}
}
