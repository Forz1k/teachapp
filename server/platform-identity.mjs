/* Signed access-token candidate. Explicit pinned key, no discovery, no network,
 * no caller-controlled role or workspace membership. Local Worker only. */
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>plain(x)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const bounded=(s,n)=>typeof s==='string'&&s.length>0&&s.length<=n&&!/[\x00-\x20\x7f]/.test(s);
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function decode(s,max){
 if(typeof s!=='string'||s.length>max||! /^[A-Za-z0-9_-]+$/.test(s))throw Error('encoding');
 const bytes=Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 if(b64(bytes)!==s)throw Error('encoding');return bytes;
}
export function identityConfig(raw){
 try{
  if(typeof raw!=='string'||raw.length>8192)return null;
  const c=JSON.parse(raw);
  if(!exact(c,['issuer','audience','clientId','key'])||!bounded(c.issuer,512)||!bounded(c.audience,256)||!bounded(c.clientId,256))return null;
  const u=new URL(c.issuer);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.href!==c.issuer)return null;
  const k=c.key;
  if(!exact(k,['kty','kid','n','e','alg','use'])||k.kty!=='RSA'||k.alg!=='RS256'||k.use!=='sig'||k.e!=='AQAB'||!bounded(k.kid,128))return null;
  const n=decode(k.n,1024);if(n.length<256||n.length>512||n[0]<128||!(n.at(-1)&1))return null;
  return {issuer:c.issuer,audience:c.audience,clientId:c.clientId,key:{...k}};
 }catch{return null;}
}
export async function verifyIdentityAssertion(config,token,now=Date.now()){
 try{
  if(!config||typeof token!=='string'||token.length>8192||!Number.isSafeInteger(now)||now<0)return null;
  const [h,p,s,...rest]=token.split('.');if(rest.length||!s)return null;
  const header=JSON.parse(dec.decode(decode(h,1024))),claims=JSON.parse(dec.decode(decode(p,6144)));
  if(!exact(header,['alg','kid','typ'])||header.alg!=='RS256'||header.kid!==config.key.kid||header.typ!=='at+jwt')return null;
  const t=Math.floor(now/1000);
  if(!plain(claims)||claims.iss!==config.issuer||claims.aud!==config.audience||claims.client_id!==config.clientId||!bounded(claims.sub,256)||!bounded(claims.jti,256)||!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.iat<0||claims.iat>t+30||claims.exp<=t||claims.exp<=claims.iat||claims.exp-claims.iat>900)return null;
  if(claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf<0||claims.nbf>t||claims.nbf>=claims.exp))return null;
  const key=await crypto.subtle.importKey('jwk',config.key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(s,1024),enc.encode(h+'.'+p)))return null;
  const bytes=await crypto.subtle.digest('SHA-256',enc.encode(JSON.stringify([claims.iss,claims.sub])));
  return {identityHash:Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''),expiresAt:claims.exp*1000};
 }catch{return null;}
}
export async function verifyIdentityAccessToken(config,token,now=Date.now()){return (await verifyIdentityAssertion(config,token,now))?.identityHash??null;}
const fail=(status,error)=>({status,body:{error}});
// Only the Worker supplies identityHash after cryptographic verification.
// An access token never supplies role, member ID or authorization scope.
export function identityPlan(current,input){
 const {identityHash,path,method,body,now}=input;
 if(!hash(identityHash)||method!=='POST'||current&&current.id!==input.workspaceId)return {error:fail(401,'unauthorized')};
 if(input.candidate){
  if(!Number.isSafeInteger(input.identityExpiresAt)||input.identityExpiresAt<=now||path==='identity/bind'||path==='identity/redeem'&&identityHash===input.operatorIdentity)return {error:fail(401,'unauthorized')};
  if(path==='identity/bootstrap'){
   if(identityHash!==input.operatorIdentity||!exact(body,['credentialHash','name'])||!hash(body.credentialHash))return {error:fail(401,'unauthorized')};
   return {input:{...input,path:'bootstrap',auth:body.credentialHash,body:{name:body.name}},bind:true};
  }
  if(path==='identity/recover'){
   if(identityHash!==input.operatorIdentity||!exact(body,['credentialHash'])||!hash(body.credentialHash))return {error:fail(401,'unauthorized')};
   return {input:{...input,path:'recover',auth:body.credentialHash,body:{}},bind:true};
  }
 }
 if(!current)return {error:fail(401,'unauthorized')};
 const active=current.members.filter(m=>m.revokedAt===null&&m.expiresAt>now),bound=active.filter(m=>m.identityHash===identityHash);
 if(path==='identity/session'){
  if(!exact(body,[])||bound.length!==1)return {error:fail(401,'unauthorized')};
  return {input:{...input,path:'session/rotate',body:{},auth:bound[0].tokenHash},bind:false};
 }
 if(!['identity/bind','identity/redeem'].includes(path)||!exact(body,['credentialHash'])||!hash(body.credentialHash))return {error:fail(400,'packet')};
 if(bound.length)return {error:fail(409,'identity-bound')};
 if(path==='identity/bind'){
  const actor=active.find(m=>m.tokenHash===body.credentialHash);
  if(!actor)return {error:fail(401,'unauthorized')};
  if(actor.identityHash)return {error:fail(409,'identity-bound')};
 }
 return {input:{...input,path:path==='identity/bind'?'session/rotate':'redeem',auth:body.credentialHash,body:{}},bind:true};
}
export function bindIdentityResult(result,identityHash,stateLimit,{candidate=false,expiresAt=null,now=0,bind=true}={}){
 if(!result.changed||!result.state)return result;
 const member=result.state.members.find(m=>m.id===result.body.member?.id);
 if(!member||!hash(identityHash)||bind&&member.identityHash||!bind&&member.identityHash!==identityHash)return fail(409,'identity-bound');
 member.identityHash=identityHash;
 if(candidate){
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=now)return fail(401,'unauthorized');
  member.identitySessionUntil=Math.min(expiresAt,member.expiresAt,now+900000);
 }
 if(enc.encode(JSON.stringify(result.state)).length>stateLimit)return fail(409,'workspace-limit');
 return result;
}

export function candidateSessionAllowed(state,auth,now){
 return !!state?.members?.some(m=>m.tokenHash===auth&&m.revokedAt===null&&m.expiresAt>now&&hash(m.identityHash)&&Number.isSafeInteger(m.identitySessionUntil)&&m.identitySessionUntil>now);
}
