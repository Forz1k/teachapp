/* Separate local-only candidate; no production route or personal sync binding. */
import {DurableObject} from 'cloudflare:workers';
import {digestToken} from './cloudflare-protocol.mjs';
import {dispatchWorkspace,BODY_LIMIT,STATE_LIMIT,workspaceRatePolicy,consumeWorkspaceRate} from './platform-api.mjs';
import {syntheticPlatformConfig} from './platform-config.mjs';
import {identityConfig,verifyIdentityAccessToken,identityPlan,bindIdentityResult} from './platform-identity.mjs';
import {sealWorkspaceBackup,openWorkspaceBackup,restoreWorkspaceData,BACKUP_BODY_LIMIT} from './platform-backup.mjs';
const H={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8'};
const json=(status,body,cors={})=>new Response(JSON.stringify(body),{status,headers:{...H,...cors}});
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
async function bodyOf(request,limit=BODY_LIMIT){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return {error:415};
 const len=request.headers.get('content-length');if(len!==null&&(!/^\d+$/.test(len)||Number(len)>limit))return {error:413};
 if(!request.body)return {error:400};const reader=request.body.getReader();let count=0,chunks=[];
 try{for(;;){const p=await reader.read();if(p.done)break;count+=p.value.byteLength;if(count>limit){await reader.cancel();return {error:413};}chunks.push(p.value);}}finally{reader.releaseLock();}
 try{const raw=new Uint8Array(count);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.byteLength;}return {body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};}catch{return {error:400};}
}
export default {async fetch(request,env){
 const settings=syntheticPlatformConfig(env,request.url),u=new URL(request.url);if(u.pathname==='/healthz'&&request.method==='GET')return json(settings?200:503,{status:settings?'synthetic-ready':'disabled'});
 if(!settings)return json(503,{error:'disabled'});
 const r=/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_/-]{1,200})$/.exec(u.pathname);if(!r||u.search||u.hash)return json(404,{error:'route'});
 const origin=request.headers.get('Origin'),cors=origin===settings.origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Expose-Headers':'Retry-After'}:{};if(origin&&origin!==settings.origin)return json(403,{error:'origin'});
 if(request.method==='OPTIONS')return origin===settings.origin?new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}}):json(403,{error:'origin'});
 if(!['GET','POST','PUT'].includes(request.method))return json(405,{error:'method'},cors);
 // One bounded deployment-wide ingress bucket in the loopback rehearsal.
 // No caller header, token, workspace name or attacker-derived storage key.
 try{
  const ingress=env.INGRESS.get(env.INGRESS.idFromName('loopback-v1'));
  const limited=await ingress.fetch('https://internal/admit',{method:'POST'});
  if(limited.status!==204){const retry=limited.headers.get('Retry-After');return json(limited.status===429?429:503,{error:limited.status===429?'rate-limit':'unavailable',...(retry?{retryAfter:Number(retry)}:{})},{...cors,...(retry?{'Retry-After':retry}:{})});}
 }catch{return json(503,{error:'unavailable'},cors);}
 const identityRoute=r[2].startsWith('identity/');
 const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization')||'');
 const assertion=identityRoute&&/^Bearer ([A-Za-z0-9_.-]{1,8192})$/.exec(request.headers.get('Authorization')||'');
 if(identityRoute?(!assertion||request.method!=='POST'):!token)return json(401,{error:'unauthorized'},cors);
 try{
  let auth=null,identityHash=null;
  if(identityRoute){
   const config=identityConfig(env.TEACHAPP_PLATFORM_IDENTITY);
   if(!config)return json(503,{error:'identity-disabled'},cors);
   identityHash=await verifyIdentityAccessToken(config,assertion[1]);
   if(!identityHash)return json(401,{error:'unauthorized'},cors);
  }else auth=await digestToken(token[1]);
  const restore=r[2]==='workspace/restore';
  if(restore&&(auth!==settings.rootHash||request.method!=='POST'))return json(401,{error:'unauthorized'},cors);
  const packet=request.method==='GET'?{body:null}:await bodyOf(request,restore?BACKUP_BODY_LIMIT:BODY_LIMIT);if(packet.error)return json(packet.error,{error:'packet'},cors);
  if(identityRoute&&['identity/bind','identity/redeem'].includes(r[2])){
   const value=packet.body;
   if(!value||Array.isArray(value)||Object.keys(value).join(',')!=='credential'||typeof value.credential!=='string'||! /^[a-f0-9]{64}$/.test(value.credential))return json(400,{error:'packet'},cors);
   packet.body={credentialHash:await digestToken(value.credential)};
  }
  const issuedSecret=secret(),issued={id:crypto.randomUUID(),hash:await digestToken(issuedSecret),secret:issuedSecret};
  const stub=env.WORKSPACES.get(env.WORKSPACES.idFromName(r[1]));
  const response=await stub.fetch(new Request('https://internal/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspaceId:r[1],path:r[2],method:request.method,auth,identityHash,rootHash:settings.rootHash,body:packet.body,issued})}));
  const retry=response.headers.get('Retry-After');return new Response(response.body,{status:response.status,headers:{...H,...cors,...(retry?{'Retry-After':retry}:{})}});
 }catch{return json(503,{error:'unavailable'},cors);}
}};
export class PlatformWorkspace extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.storage=ctx.storage;this.sql=ctx.storage.sql;this.backupKey=env.TEACHAPP_PLATFORM_BACKUP_KEY;this.sql.exec('CREATE TABLE IF NOT EXISTS workspace_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');this.sql.exec('CREATE TABLE IF NOT EXISTS rate_buckets (key TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL)');}
 async fetch(request){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/dispatch')return json(404,{error:'route'});
  try{const input=await request.json();let recovery=null;
   if(input.path==='workspace/restore'){
    if(input.auth!==input.rootHash||input.method!=='POST')return json(401,{error:'unauthorized'});
    if(typeof this.backupKey!=='string'||! /^[a-f0-9]{64}$/.test(this.backupKey))return json(503,{error:'backup-disabled'});
    if(!input.body||Object.keys(input.body).sort().join(',')!=='packet,sourceWorkspaceId')return json(400,{error:'packet'});
    try{recovery=await openWorkspaceBackup(input.body.packet,this.backupKey,input.body.sourceWorkspaceId);}catch{return json(400,{error:'backup-invalid'});}
   }
   const out=this.storage.transactionSync(()=>{
   const row=this.sql.exec('SELECT body FROM workspace_state WHERE id=1').toArray()[0],current=row?JSON.parse(row.body):null,now=Date.now();
   const plan=input.path.startsWith('identity/')?identityPlan(current,{...input,now}):null;
   if(plan?.error)return plan.error;
   const effective=plan?.input??{...input,now};
   const policy=workspaceRatePolicy(current,effective);
   if(policy){
    this.sql.exec('DELETE FROM rate_buckets WHERE start<=?',now-60000);
    const previous=this.sql.exec('SELECT start,count FROM rate_buckets WHERE key=?',policy.key).toArray()[0];
    const rate=consumeWorkspaceRate(policy,previous,now);
    if(!rate.allowed)return {status:429,body:{error:'rate-limit',retryAfter:rate.retryAfter},retryAfter:rate.retryAfter};
    this.sql.exec('INSERT INTO rate_buckets(key,start,count) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET start=excluded.start,count=excluded.count',policy.key,rate.start,rate.count);
   }
   if(input.path==='workspace/backup'&&input.method==='GET'){
    const gate=dispatchWorkspace(current,{...effective,path:'members'});
    return gate.status===200?{status:200,backupState:current}:gate;
   }
   let result=dispatchWorkspace(current,recovery?{...effective,path:'bootstrap',body:{name:recovery.name}}:effective);
   if(recovery&&result.changed){try{result=restoreWorkspaceData(result,recovery,now);}catch{return {status:409,body:{error:'backup-invalid'}};}}
   if(plan?.bind)result=bindIdentityResult(result,input.identityHash,STATE_LIMIT);
   if(result.changed)this.sql.exec('INSERT INTO workspace_state(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',JSON.stringify(result.state));return result;
  });
  if(out.backupState){
   if(typeof this.backupKey!=='string'||! /^[a-f0-9]{64}$/.test(this.backupKey))return json(503,{error:'backup-disabled'});
   return json(200,{packet:await sealWorkspaceBackup(out.backupState,this.backupKey)});
  }
  return json(out.status,out.body,out.retryAfter?{'Retry-After':String(out.retryAfter)}:{});}catch{return json(503,{error:'storage'});}
 }
}

export class PlatformIngress extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);this.storage=ctx.storage;this.sql=ctx.storage.sql;
  this.limit=env.TEACHAPP_PLATFORM_INGRESS_LIMIT===undefined?1200:Number(env.TEACHAPP_PLATFORM_INGRESS_LIMIT);
  this.sql.exec('CREATE TABLE IF NOT EXISTS ingress_rate (id INTEGER PRIMARY KEY CHECK(id=1), start INTEGER NOT NULL, count INTEGER NOT NULL)');
 }
 async fetch(request){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/admit')return json(404,{error:'route'});
  if(!Number.isSafeInteger(this.limit)||this.limit<1||this.limit>10000)return json(503,{error:'disabled'});
  try{
   const rate=this.storage.transactionSync(()=>{
    const prior=this.sql.exec('SELECT start,count FROM ingress_rate WHERE id=1').toArray()[0];
    const next=consumeWorkspaceRate({limit:this.limit},prior,Date.now());
    if(next.allowed)this.sql.exec('INSERT INTO ingress_rate(id,start,count) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET start=excluded.start,count=excluded.count',next.start,next.count);
    return next;
   });
   return rate.allowed?new Response(null,{status:204}):json(429,{error:'rate-limit',retryAfter:rate.retryAfter},{'Retry-After':String(rate.retryAfter)});
  }catch{return json(503,{error:'storage'});}
 }
}
