/* Separate Platform Worker: loopback LAB or explicitly configured HTTPS candidate. No personal sync binding or deployed route in repository. */
import {DurableObject} from 'cloudflare:workers';
import {digestToken} from './cloudflare-protocol.mjs';
import {dispatchWorkspace,BODY_LIMIT,STATE_LIMIT,workspaceRatePolicy,consumeWorkspaceRate} from './platform-api.mjs';
import {platformConfig,edgeAddress} from './platform-config.mjs';
import {identityConfig,verifyIdentityAssertion,identityPlan,bindIdentityResult,candidateSessionAllowed,identitySessionEpoch} from './platform-identity.mjs';
import {sealWorkspaceBackup,openWorkspaceBackup,restoreWorkspaceData,BACKUP_BODY_LIMIT} from './platform-backup.mjs';
import {providerConfiguration,sealProviderSubscription,openProviderSubscription,providerStatus,changeProviderSubscription,providerDeliveryDue} from './platform-provider-state.mjs';
import {claimNoticeDeliveryLab,noticeDeliveryCurrentLab,finishNoticeDeliveryLab,notificationInboxLab} from './platform-notification-lab.mjs';
import {runProviderDelivery} from './platform-push-runner.mjs';
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
 const settings=platformConfig(env,request.url),u=new URL(request.url);if(u.pathname==='/healthz'&&request.method==='GET')return json(settings?200:503,{status:settings?(settings.candidate?'candidate-ready':'synthetic-ready'):'disabled'});
 if(!settings)return json(503,{error:'disabled'});
 const r=/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_/-]{1,200})$/.exec(u.pathname);if(!r||u.search||u.hash)return json(404,{error:'route'});
 const origin=request.headers.get('Origin'),cors=origin===settings.origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Expose-Headers':'Retry-After'}:{};if(origin&&origin!==settings.origin)return json(403,{error:'origin'});
 if(request.method==='OPTIONS')return origin===settings.origin?new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}}):json(403,{error:'origin'});
 if(!['GET','POST','PUT'].includes(request.method))return json(405,{error:'method'},cors);
 // One bounded deployment-wide ingress bucket in the loopback rehearsal.
 // No caller header, token, workspace name or attacker-derived storage key.
 try{
  if(settings.candidate){
   const ip=edgeAddress(request);if(!ip)return json(503,{error:'unavailable'},cors);
   const limit=await env.EDGE_LIMIT.limit({key:'platform:'+await digestToken(ip)});
   if(limit?.success!==true)return json(429,{error:'rate-limit',retryAfter:60},{...cors,'Retry-After':'60'});
  }
  const ingress=env.INGRESS.get(env.INGRESS.idFromName(settings.candidate?'candidate-v1':'loopback-v1'));
  const limited=await ingress.fetch('https://internal/admit',{method:'POST'});
  if(limited.status!==204){const retry=limited.headers.get('Retry-After');return json(limited.status===429?429:503,{error:limited.status===429?'rate-limit':'unavailable',...(retry?{retryAfter:Number(retry)}:{})},{...cors,...(retry?{'Retry-After':retry}:{})});}
 }catch{return json(503,{error:'unavailable'},cors);}
 const identityRoute=r[2].startsWith('identity/');
 if(settings.candidate&&['bootstrap','redeem','recover','workspace/restore'].includes(r[2]))return json(401,{error:'unauthorized'},cors);
 const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization')||'');
 const assertion=identityRoute&&/^Bearer ([A-Za-z0-9_.-]{1,8192})$/.exec(request.headers.get('Authorization')||'');
 if(identityRoute?(!assertion||request.method!=='POST'):!token)return json(401,{error:'unauthorized'},cors);
 try{
  let auth=null,identityHash=null,identityExpiresAt=null,assertionHash=null,path=r[2];
  const epoch=settings.candidate?await identitySessionEpoch(settings.identity,settings.operatorIdentity):null;
  if(identityRoute){
   const config=settings.identity??identityConfig(env.TEACHAPP_PLATFORM_IDENTITY);
   if(!config)return json(503,{error:'identity-disabled'},cors);
   const verified=await verifyIdentityAssertion(config,assertion[1]);
   if(!verified)return json(401,{error:'unauthorized'},cors);
   ({identityHash,assertionHash,expiresAt:identityExpiresAt}=verified);
  }else auth=await digestToken(token[1]);
  const signedRestore=settings.candidate&&path==='identity/restore',restore=path==='workspace/restore'||signedRestore;
  if(restore&&(request.method!=='POST'||(signedRestore?identityHash!==settings.operatorIdentity:auth!==settings.rootHash)))return json(401,{error:'unauthorized'},cors);
  const packet=request.method==='GET'?{body:null}:await bodyOf(request,restore?BACKUP_BODY_LIMIT:BODY_LIMIT);if(packet.error)return json(packet.error,{error:'packet'},cors);
  if(identityRoute&&['identity/bind','identity/redeem','identity/bootstrap','identity/recover','identity/restore'].includes(path)){
   const value=packet.body;
   const expected=path==='identity/bootstrap'?'credential,name':signedRestore?'credential,packet,sourceWorkspaceId':'credential';
   if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!==expected||typeof value.credential!=='string'||! /^[a-f0-9]{64}$/.test(value.credential))return json(400,{error:'packet'},cors);
   const credentialHash=await digestToken(value.credential);
   if(signedRestore){
    if(credentialHash!==settings.rootHash)return json(401,{error:'unauthorized'},cors);
    path='workspace/restore';auth=credentialHash;packet.body={packet:value.packet,sourceWorkspaceId:value.sourceWorkspaceId};
   }else packet.body={credentialHash,...(path==='identity/bootstrap'?{name:value.name}:{})};
  }
  const issuedSecret=secret(),issued={id:crypto.randomUUID(),hash:await digestToken(issuedSecret),secret:issuedSecret};
  const stub=env.WORKSPACES.get(env.WORKSPACES.idFromName(r[1]));
  const response=await stub.fetch(new Request('https://internal/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspaceId:r[1],path,method:request.method,auth,identityHash,identityExpiresAt,assertionHash,epoch,candidate:settings.candidate===true,operatorIdentity:settings.operatorIdentity,rootHash:settings.rootHash,body:packet.body,issued})}));
  const retry=response.headers.get('Retry-After');return new Response(response.body,{status:response.status,headers:{...H,...cors,...(retry?{'Retry-After':retry}:{})}});
 }catch{return json(503,{error:'unavailable'},cors);}
}};
export class PlatformWorkspace extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.storage=ctx.storage;this.sql=ctx.storage.sql;this.backupKey=env.TEACHAPP_PLATFORM_BACKUP_KEY;this.candidate=env.TEACHAPP_PLATFORM_STAGE==='candidate';this.pushConfig=this.candidate?providerConfiguration(env):Promise.resolve(null);this.sql.exec('CREATE TABLE IF NOT EXISTS workspace_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');this.sql.exec('CREATE TABLE IF NOT EXISTS rate_buckets (key TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL)');this.sql.exec('CREATE TABLE IF NOT EXISTS identity_exchanges (digest TEXT PRIMARY KEY, expires INTEGER NOT NULL)');this.sql.exec('CREATE INDEX IF NOT EXISTS identity_exchanges_expiry ON identity_exchanges(expires)');}
 readState(){const row=this.sql.exec('SELECT body FROM workspace_state WHERE id=1').toArray()[0];return row?JSON.parse(row.body):null;}
 saveState(state){const body=JSON.stringify(state);if(new TextEncoder().encode(body).length>STATE_LIMIT)throw Error('workspace-limit');this.sql.exec('INSERT INTO workspace_state(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',body);}
 async ensureAlarm(at){const prior=await this.storage.getAlarm();if(prior===null||prior>at)await this.storage.setAlarm(at);}
 async alarm(){
  const config=await this.pushConfig;if(!this.candidate||!config)return;
  const schedule=()=>{const s=this.readState(),now=Date.now();return (s?.members??[]).flatMap(m=>{const due=providerDeliveryDue(m,now);return due===null?[]:[{id:m.id,due,revision:m.notificationLab.revision,sequence:m.notificationLab.notice.sequence}];}).sort((a,b)=>a.due-b.due);};
  const pending=schedule();if(!pending.length)return;
  const now=Date.now(),due=pending.filter(x=>x.due<=now).slice(0,8);
  if(!due.length){await this.ensureAlarm(pending[0].due);return;}
  // Watchdog is persisted before network I/O; expired claims settle unknown.
  await this.ensureAlarm(now+60000);
  const mutate=(memberId,fn)=>this.storage.transactionSync(()=>{
   const s=this.readState(),m=s?.members.find(x=>x.id===memberId);if(!m)return {status:'inactive'};
   const result=fn(m,s,Date.now());if(result.changed)this.saveState(s);return result;
  });
  const adapter={
   claim:async({memberId,revision,sequence})=>mutate(memberId,(m,_s,t)=>{
    const n=notificationInboxLab(m,t);
    if(!providerStatus(m,t)?.enabled||!n?.pending||n.revision!==revision||n.sequence!==sequence)return {status:'inactive'};
    return claimNoticeDeliveryLab(m,{now:t,id:crypto.randomUUID().replaceAll('-','')});
   }),
   current:async({memberId,ticket})=>{const s=this.readState(),m=s?.members.find(x=>x.id===memberId),t=Date.now();return !!m&&providerStatus(m,t)?.enabled===true&&noticeDeliveryCurrentLab(m,ticket,t);},
   subscription:async({memberId,ticket})=>{const s=this.readState(),m=s?.members.find(x=>x.id===memberId);if(!m||!noticeDeliveryCurrentLab(m,ticket,Date.now()))return null;return openProviderSubscription(config,m.notificationLab.sealedSubscription,s.id,m.id,ticket.revision);},
   finish:async({memberId,ticket,outcome,retryAfter})=>mutate(memberId,(m,_s,t)=>finishNoticeDeliveryLab(m,{ticket,outcome,retryAfter,now:t}))
  };
  for(const item of due)await runProviderDelivery({adapter,memberId:item.id,revision:item.revision,sequence:item.sequence,config,fetcher:(url,init)=>fetch(url,init)});
  const next=schedule()[0];if(next)await this.ensureAlarm(Math.max(Date.now()+1000,next.due));
 }
 async fetch(request){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/dispatch')return json(404,{error:'route'});
  try{const input=await request.json();let recovery=null;
   if(input.candidate!==this.candidate)return json(503,{error:'disabled'});
   let push=null,sealed=null,providerActor=null;
   const providerRoute=input.path==='notification/provider'||input.path.startsWith('notification/provider/');
   if(input.candidate&&input.path.startsWith('notification-lab'))return json(404,{error:'route'});
   if(providerRoute){
    if(!input.candidate)return json(404,{error:'route'});
    const state=this.readState(),now=Date.now();
    if(!candidateSessionAllowed(state,input.auth,now,input.epoch))return json(401,{error:'unauthorized'});
    providerActor=state.members.find(m=>m.tokenHash===input.auth);
    if(providerActor.role!=='athlete')return json(403,{error:'forbidden'});
    push=await this.pushConfig;if(!push)return json(503,{error:'push-disabled'});
    if(input.path==='notification/provider'&&input.method==='PUT'){
     const b=input.body;if(!b||Object.keys(b).sort().join(',')!=='expectedRevision,subscription'||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0||!Number.isSafeInteger(b.expectedRevision+1))return json(400,{error:'packet'});
     if(providerStatus(providerActor,now).revision!==b.expectedRevision)return json(409,{error:'revision'});
     if(b.subscription!==null){try{sealed=await sealProviderSubscription(push,b.subscription,state.id,providerActor.id,b.expectedRevision+1,now);}catch{return json(400,{error:'subscription'});}}
    }else if(!((input.method==='GET'&&['notification/provider','notification/provider/inbox'].includes(input.path))||(input.method==='POST'&&input.path==='notification/provider/ack')))return json(404,{error:'route'});
   }
   const profileWrite=input.candidate&&input.method==='PUT'&&/^teams\/[A-Za-z0-9_-]{1,64}\/athletes\/[A-Za-z0-9_-]{1,64}$/.test(input.path)&&candidateSessionAllowed(this.readState(),input.auth,Date.now(),input.epoch)&&await this.pushConfig;
   if(profileWrite)await this.ensureAlarm(Date.now()+5000);
   if(input.path==='workspace/restore'){
    if(input.auth!==input.rootHash||input.method!=='POST'||input.candidate&&(input.identityHash!==input.operatorIdentity||!Number.isSafeInteger(input.identityExpiresAt)||input.identityExpiresAt<=Date.now()))return json(401,{error:'unauthorized'});
    if(typeof this.backupKey!=='string'||! /^[a-f0-9]{64}$/.test(this.backupKey))return json(503,{error:'backup-disabled'});
    if(!input.body||Object.keys(input.body).sort().join(',')!=='packet,sourceWorkspaceId')return json(400,{error:'packet'});
    try{recovery=await openWorkspaceBackup(input.body.packet,this.backupKey,input.body.sourceWorkspaceId);}catch{return json(400,{error:'backup-invalid'});}
   }
   const out=this.storage.transactionSync(()=>{
   const row=this.sql.exec('SELECT body FROM workspace_state WHERE id=1').toArray()[0],current=row?JSON.parse(row.body):null,now=Date.now();
   const identityRoute=input.path.startsWith('identity/');
   if(input.candidate&&!identityRoute&&!recovery&&!candidateSessionAllowed(current,input.auth,now,input.epoch))return {status:401,body:{error:'unauthorized'}};
   const exchange=input.candidate&&(identityRoute||recovery!==null);
   if(exchange){
    if(typeof input.assertionHash!=='string'||! /^[a-f0-9]{64}$/.test(input.assertionHash)||!Number.isSafeInteger(input.identityExpiresAt)||input.identityExpiresAt<=now)return {status:401,body:{error:'unauthorized'}};
    this.sql.exec('DELETE FROM identity_exchanges WHERE expires<=?',now);
    if(this.sql.exec('SELECT digest FROM identity_exchanges WHERE digest=?',input.assertionHash).toArray().length)return {status:401,body:{error:'unauthorized'}};
    if(this.sql.exec('SELECT count(*) AS count FROM identity_exchanges').one().count>=4096)return {status:429,body:{error:'rate-limit',retryAfter:60},retryAfter:60};
   }
   const plan=identityRoute?identityPlan(current,{...input,now}):null;
   if(plan?.error)return plan.error;
   const effective=plan?.input??{...input,now};
   if(providerRoute)effective.path=input.path.replace('notification/provider','notification-lab');
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
   if(providerRoute&&input.path==='notification/provider'){
    const actor=current.members.find(m=>m.id===providerActor.id&&m.tokenHash===input.auth);
    if(!actor)return {status:401,body:{error:'unauthorized'}};
    if(input.method==='GET')return {status:200,body:{...providerStatus(actor,now),applicationServerKey:push.publicKey}};
    const result=changeProviderSubscription(actor,input.body.expectedRevision,sealed,now);
    if(result.changed)this.saveState(current);
    return result;
   }
   let result=dispatchWorkspace(current,recovery?{...effective,path:'bootstrap',body:{name:recovery.name}}:effective);
   if(recovery&&result.changed){try{result=restoreWorkspaceData(result,recovery,now);}catch{return {status:409,body:{error:'backup-invalid'}};}}
   if(plan?.bind||input.candidate&&(plan||recovery))result=bindIdentityResult(result,input.identityHash,STATE_LIMIT,{candidate:input.candidate,expiresAt:input.identityExpiresAt,now,bind:plan?.bind??true,epoch:input.epoch});
   if(result.changed){this.saveState(result.state);if(exchange)this.sql.exec('INSERT INTO identity_exchanges(digest,expires) VALUES(?,?)',input.assertionHash,input.identityExpiresAt);}return result;
  });
  if(profileWrite&&out.changed)await this.ensureAlarm(Date.now()+1000);
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
