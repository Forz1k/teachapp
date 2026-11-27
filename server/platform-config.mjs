import {identityConfig} from './platform-identity.mjs';
/* The synthetic server is deliberately not a public staging service.
 * Host validation is defense-in-depth, not authentication or a firewall. */
const loopback=new Set(['127.0.0.1','localhost','[::1]']);
const local=u=>['http:','https:'].includes(u.protocol)&&loopback.has(u.hostname)&&!u.username&&!u.password;
export function syntheticPlatformConfig(env,requestURL){
 try{
  const origin=new URL(env.TEACHAPP_PLATFORM_ORIGIN),request=new URL(requestURL);
  if(env.TEACHAPP_PLATFORM_SYNTHETIC!=='true'||!local(origin)||!local(request)||origin.origin!==env.TEACHAPP_PLATFORM_ORIGIN||
   typeof env.TEACHAPP_PLATFORM_ROOT_HASH!=='string'||!/^[a-f0-9]{64}$/.test(env.TEACHAPP_PLATFORM_ROOT_HASH))return null;
  return {origin:origin.origin,rootHash:env.TEACHAPP_PLATFORM_ROOT_HASH};
 }catch{return null;}
}

const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function httpsOrigin(raw){
 try{const u=new URL(raw);if(typeof raw==='string'&&u.origin===raw&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!loopback.has(u.hostname)&&u.hostname.includes('.')&&!/^[0-9.]+$/.test(u.hostname)&&!u.hostname.startsWith('['))return u.origin;}catch{}
 return null;
}
// This candidate is disabled in the checked-in configuration. A dedicated
// HTTPS origin, IdP and edge binding are mandatory; never fall back to LAB.
export function candidatePlatformConfig(env,requestURL){
 try{
  if(env.TEACHAPP_PLATFORM_STAGE!=='candidate'||env.TEACHAPP_PLATFORM_SYNTHETIC==='true')return null;
  const origin=httpsOrigin(env.TEACHAPP_PLATFORM_ORIGIN),apiOrigin=httpsOrigin(env.TEACHAPP_PLATFORM_API_ORIGIN),url=new URL(requestURL),identity=identityConfig(env.TEACHAPP_PLATFORM_IDENTITY);
  if(!origin||!apiOrigin||url.origin!==apiOrigin||url.username||url.password||!identity||!hash(env.TEACHAPP_PLATFORM_ROOT_HASH)||!hash(env.TEACHAPP_PLATFORM_OPERATOR_IDENTITY)||!hash(env.TEACHAPP_PLATFORM_BACKUP_KEY)||typeof env.EDGE_LIMIT?.limit!=='function')return null;
  return {origin,apiOrigin,rootHash:env.TEACHAPP_PLATFORM_ROOT_HASH,operatorIdentity:env.TEACHAPP_PLATFORM_OPERATOR_IDENTITY,identity,candidate:true};
 }catch{return null;}
}
export function platformConfig(env,requestURL){
 return env.TEACHAPP_PLATFORM_STAGE==='candidate'?candidatePlatformConfig(env,requestURL):env.TEACHAPP_PLATFORM_STAGE===undefined?syntheticPlatformConfig(env,requestURL):null;
}
// Only trust the ingress address on the configured Cloudflare route, never
// X-Forwarded-For or a workspace/credential chosen by the caller.
export function edgeAddress(request){
 if(!request.cf)return null;
 const ip=request.headers.get('CF-Connecting-IP');
 if(typeof ip!=='string'||ip.length>64||! /^[0-9a-fA-F:.]+$/.test(ip))return null;
 try{
  if(ip.includes(':'))return new URL('http://['+ip+']/').hostname;
  if(! /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip))return null;
  const parts=ip.split('.');if(parts.some(p=>Number(p)>255||String(Number(p))!==p))return null;
  return parts.join('.');
 }catch{return null;}
}
