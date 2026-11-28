/* Optional Cloudflare relay for synthetic data. No default credentials. */
import {DurableObject} from 'cloudflare:workers';
import {LIMIT,digestToken} from './cloudflare-protocol.mjs';
import {DeviceRegistry,validDeviceHash,validRegistration,validRevocation} from './device-trust.mjs';
import {validAnchorCommitment,normalizeReceiptKeys,importReceiptKey,verifyRollbackReceipt} from './migration-receipt.mjs';
const areas=['school','coach'];
const tokenPattern=/^[A-Za-z0-9_-]{32,256}$/;
const digestPattern=/^[0-9a-f]{64}$/;
const migrationIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const loopback=['127.0.0.1','localhost','[::1]'];
const validMigrationRevision=b=>b&&typeof b==='object'&&!Array.isArray(b)&&Number.isSafeInteger(b.expectedRevision)&&b.expectedRevision>0&&typeof b.migrationId==='string'&&migrationIdPattern.test(b.migrationId);
const validFencePacket=b=>validMigrationRevision(b)&&(Object.keys(b).sort().join(',')==='expectedRevision,migrationId'||Object.keys(b).sort().join(',')==='destinationAnchorCommitment,expectedRevision,migrationId'&&validAnchorCommitment(b.destinationAnchorCommitment));
const validResumePacket=b=>validMigrationRevision(b)&&Object.keys(b).sort().join(',')==='expectedRevision,migrationId,receipt'&&b.receipt&&typeof b.receipt==='object'&&!Array.isArray(b.receipt);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function json(status,body,extra={}){
 return new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8',...extra}});
}
function config(env){
 let origin,hashes,adminHash=null,fenceHashes={},verifyKeys={},migrationMode=null,migrationEndpoint=null;
 try{
  const url=new URL(env.TEACHAPP_SYNC_ORIGIN);
  if(url.protocol!=='https:'||url.origin!==env.TEACHAPP_SYNC_ORIGIN)throw Error();
  origin=url.origin;
  hashes=JSON.parse(env.TEACHAPP_SYNC_TOKEN_HASHES||'{}');
  if(!hashes||typeof hashes!=='object'||Array.isArray(hashes)||Object.keys(hashes).some(k=>!areas.includes(k)))throw Error();
  const seen=new Set();
  for(const area of areas){
   const list=hashes[area]??[];
   if(!Array.isArray(list)||list.length>32)throw Error();
   for(const h of list){if(typeof h!=='string'||!digestPattern.test(h)||seen.has(h))throw Error();seen.add(h);}
   hashes[area]=list;
  }
  const admin=env.TEACHAPP_SYNC_ADMIN_HASH;
  // v2 is opt-in. A legacy shared token can never become the administrative token.
  if(validDeviceHash(admin)&&!seen.has(admin))adminHash=admin;
  if(!seen.size&&!adminHash)throw Error();
  const synthetic=env.TEACHAPP_SYNC_MIGRATION_SYNTHETIC==='true',candidate=env.TEACHAPP_SYNC_MIGRATION_CANDIDATE==='true';
  if(synthetic&&candidate)throw Error();
  if(candidate){const endpoint=new URL(env.TEACHAPP_SYNC_MIGRATION_ENDPOINT);if(endpoint.protocol!=='https:'||endpoint.origin!==env.TEACHAPP_SYNC_MIGRATION_ENDPOINT||endpoint.port||loopback.includes(endpoint.hostname)||endpoint.origin===origin)throw Error();migrationEndpoint=endpoint.origin;}
  if(synthetic||candidate){
   migrationMode=candidate?'candidate':'lab';
   const f=JSON.parse(env.TEACHAPP_SYNC_FENCE_HASHES||'{}');
   if(!f||typeof f!=='object'||Array.isArray(f)||Object.keys(f).some(a=>!areas.includes(a)))throw Error();
   for(const [area,h] of Object.entries(f)){if(!validDeviceHash(h)||seen.has(h)||h===adminHash||!hashes[area].length&&!adminHash)throw Error();seen.add(h);fenceHashes[area]=h;}
   verifyKeys=normalizeReceiptKeys(JSON.parse(env.TEACHAPP_SYNC_ROLLBACK_VERIFY_KEYS||'{}'));
   if(!verifyKeys||Object.keys(verifyKeys).some(a=>!fenceHashes[a])||candidate&&(!Object.keys(fenceHashes).length||Object.keys(fenceHashes).some(a=>!verifyKeys[a])))throw Error();
  }
 }catch{return null;}
 return {origin,hashes,adminHash,fenceHashes,verifyKeys,migrationMode,migrationEndpoint};
}
function equal(a,b){let diff=0;for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function authorized(request,hashes){
 const match=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('Authorization')||'');
 if(!match||!tokenPattern.test(match[1]))return false;
 const digest=await digestToken(match[1]);let ok=0;
 for(const h of hashes)ok|=Number(equal(digest,h));
 return Boolean(ok);
}
function envelopeValid(e){
 return e&&typeof e==='object'&&!Array.isArray(e)&&Object.keys(e).sort().join(',')==='app,cipher,data,iterations,iv,kdf,salt,version'&&e.app==='teachapp-encrypted'&&e.version===1&&e.kdf==='PBKDF2-SHA256'&&e.iterations===600000&&e.cipher==='AES-256-GCM'&&typeof e.salt==='string'&&/^[A-Za-z0-9+/]{22}==$/.test(e.salt)&&typeof e.iv==='string'&&/^[A-Za-z0-9+/]{16}$/.test(e.iv)&&typeof e.data==='string'&&e.data.length>=24&&e.data.length<=LIMIT&&e.data.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(e.data);
}
async function readPacket(request){
 const rawLength=request.headers.get('Content-Length');
 if(rawLength!==null&&(!/^\d+$/.test(rawLength)||Number(rawLength)>LIMIT))return {error:413};
 if(!request.body)return {error:400};
 const reader=request.body.getReader();let total=0;const parts=[];
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>LIMIT){await reader.cancel();return {error:413};}parts.push(value);}
 }finally{reader.releaseLock();}
 let body;
 try{
  const bytes=new Uint8Array(total);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch{return {error:400};}
 if(!body||Object.keys(body).sort().join(',')!=='envelope,expectedRevision'||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!envelopeValid(body.envelope))return {error:400};
 return {body};
}
async function readSmallJson(request){
 const raw=request.headers.get('Content-Length');
 if(raw!==null&&(!/^\d+$/.test(raw)||Number(raw)>4096))return {error:413};
 if(!request.body)return {error:400};
 const reader=request.body.getReader();let size=0,parts=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();return {error:413};}parts.push(value);}}finally{reader.releaseLock();}
 try{const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return {body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};}catch{return {error:400};}
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/healthz'&&request.method==='GET'){
  // No data, credentials, or revision information is disclosed.
  return json(config(env)?200:503,{status:config(env)?'ready':'not-configured'});
 }
 const match=/^\/v1\/snapshot\/(school|coach)$/.exec(url.pathname),pair=/^\/v1\/pairing\/(create|redeem)$/.exec(url.pathname);
 const v2Snapshot=/^\/v2\/snapshot\/(school|coach)$/.exec(url.pathname),devices=/^\/v2\/devices\/(school|coach)(\/revoke)?$/.exec(url.pathname),pairV2=/^\/v2\/pairing\/(create|redeem)$/.exec(url.pathname);
 const fence=/^\/v1\/migration-fence\/(school|coach)$/.exec(url.pathname),resume=/^\/v1\/migration-rollback\/(school|coach)$/.exec(url.pathname),fenceStatus=/^\/v([12])\/migration-fence-status\/(school|coach)$/.exec(url.pathname);
 if((!match&&!pair&&!pairV2&&!v2Snapshot&&!devices&&!fence&&!resume&&!fenceStatus)||url.search)return json(404,{error:'route'});
 const settings=config(env);
 if(!settings)return json(503,{error:'not-configured'});
 if((v2Snapshot||devices||pairV2||fenceStatus?.[1]==='2')&&!settings.adminHash)return json(404,{error:'route'});
 if((fence||resume||fenceStatus)&&(!(settings.migrationMode==='lab'&&loopback.includes(url.hostname)&&url.protocol==='http:'||settings.migrationMode==='candidate'&&url.origin===settings.migrationEndpoint)||!settings.fenceHashes[fence?.[1]??resume?.[1]??fenceStatus[2]]))return json(404,{error:'route'});
 if(resume&&!settings.verifyKeys[resume[1]])return json(404,{error:'route'});
 const origin=request.headers.get('Origin'),cors=origin===settings.origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
 if(origin&&origin!==settings.origin)return json(403,{error:'origin'});
 if(request.method==='OPTIONS'){
  if(origin!==settings.origin)return json(403,{error:'origin'});
  return new Response(null,{status:204,headers:{...headers,...cors,'Access-Control-Allow-Methods':'GET, PUT, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}});
 }
 try{
  if(fence||resume||fenceStatus){
   const area=fence?.[1]??resume?.[1]??fenceStatus[2],version=fenceStatus?.[1];
   const init={method:request.method,headers:{}};let internal;
   if(fence||resume){
    if(!await authorized(request,[settings.fenceHashes[area]]))return json(401,{error:'unauthorized'},cors);
    if(resume?request.method!=='PUT':!['GET','PUT'].includes(request.method))return json(405,{error:'method'},cors);
    // A pre-existing device token cannot acquire administrative privilege, even across contours.
    for(const a of areas){const object=env.SNAPSHOTS.get(env.SNAPSHOTS.idFromName(a));const r=await object.fetch(new Request('https://internal/migration-key-available',{method:'POST',body:JSON.stringify({hash:settings.fenceHashes[area]})}));if(r.status!==200)return json(409,{error:'fence-key-reuse'},cors);}
    internal=resume?'/migration-rollback':'/migration-fence';
    init.headers['X-Migration-Area']=area;
    if(request.method==='PUT'){
     if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return json(415,{error:'content-type'},cors);
     const packet=await readSmallJson(request);if(packet.error)return json(packet.error,{error:'packet'},cors);
     if(resume?!validResumePacket(packet.body):!validFencePacket(packet.body)||Boolean(settings.verifyKeys[area])!==Object.hasOwn(packet.body,'destinationAnchorCommitment'))return json(400,{error:'packet'},cors);init.body=JSON.stringify(packet.body);
    }
   }else{
    if(request.method!=='GET')return json(405,{error:'method'},cors);
    if(version==='1'){
     if(!await authorized(request,settings.hashes[area]))return json(401,{error:'unauthorized'},cors);
     internal='/migration-fence-status';
    }else{
     const auth=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('Authorization')||'');if(!auth)return json(401,{error:'unauthorized'},cors);
     const hash=await digestToken(auth[1]);if(equal(hash,settings.adminHash)||Object.values(settings.fenceHashes).includes(hash)||areas.some(a=>settings.hashes[a].includes(hash)))return json(401,{error:'unauthorized'},cors);
     init.headers['X-TeachApp-Device-Hash']=hash;internal='/migration-fence-status-v2';
    }
   }
   const stub=env.SNAPSHOTS.get(env.SNAPSHOTS.idFromName(area));const result=await stub.fetch(new Request('https://internal'+internal,init));
   return new Response(result.body,{status:result.status,headers:{...headers,...cors,'Content-Type':'application/json; charset=utf-8'}});
  }
  if(devices){
   if(!await authorized(request,[settings.adminHash]))return json(401,{error:'unauthorized'},cors);
   const revoke=Boolean(devices[2]);
   if(revoke?request.method!=='POST':!['GET','POST'].includes(request.method))return json(405,{error:'method'},cors);
   const init={method:request.method};
   if(request.method==='POST'){
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return json(415,{error:'content-type'},cors);
    const packet=await readSmallJson(request);
    if(packet.error)return json(packet.error,{error:packet.error===413?'too-large':'packet'},cors);
    const body=packet.body;
    if(revoke?!validRevocation(body):!validRegistration(body))return json(400,{error:'packet'},cors);
    if(!revoke&&(equal(body.tokenHash,settings.adminHash)||Object.values(settings.fenceHashes).includes(body.tokenHash)||areas.some(a=>settings.hashes[a].some(h=>equal(body.tokenHash,h)))))return json(400,{error:'shared-key-not-allowed'},cors);
    init.body=JSON.stringify(body);
   }
   const stub=env.SNAPSHOTS.get(env.SNAPSHOTS.idFromName(devices[1]));
   const result=await stub.fetch(new Request('https://internal/devices'+(revoke?'/revoke':''),init));
   return new Response(result.body,{status:result.status,headers:{...headers,...cors,'Content-Type':'application/json; charset=utf-8'}});
  }
  if(v2Snapshot){
   const auth=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('Authorization')||'');
   if(!auth)return json(401,{error:'unauthorized'},cors);
   if(!['GET','PUT'].includes(request.method))return json(405,{error:'method'},cors);
   const hash=await digestToken(auth[1]);
   if(equal(hash,settings.adminHash)||Object.values(settings.fenceHashes).includes(hash)||areas.some(a=>settings.hashes[a].some(h=>equal(hash,h))))return json(401,{error:'unauthorized'},cors);
   const init={method:request.method,headers:{'X-TeachApp-Device-Hash':hash}};
   if(request.method==='PUT'){
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return json(415,{error:'content-type'},cors);
    const n=request.headers.get('Content-Length');
    if(n!==null&&(!/^\d+$/.test(n)||Number(n)>LIMIT))return json(413,{error:'too-large'},cors);
    init.body=request.body;
   }
   const stub=env.SNAPSHOTS.get(env.SNAPSHOTS.idFromName(v2Snapshot[1]));
   const result=await stub.fetch(new Request('https://internal/snapshot-v2',init));
   return new Response(result.body,{status:result.status,headers:{...headers,...cors,'Content-Type':'application/json; charset=utf-8'}});
  }
  if(pair||pairV2){
   if(request.method!=='POST')return json(405,{error:'method'},cors);
   if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return json(415,{error:'content-type'},cors);
   const op=(pairV2||pair)[1],auth=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('Authorization')||'');
   if(!auth)return json(401,{error:'unauthorized'},cors);
   if(op==='create'&&!await authorized(request,pairV2?[settings.adminHash]:settings.hashes.school))return json(401,{error:'unauthorized'},cors);
   const rawLength=request.headers.get('Content-Length');
   if(rawLength!==null&&(!/^\d+$/.test(rawLength)||Number(rawLength)>4096))return json(413,{error:'too-large'},cors);
   if(!request.body)return json(400,{error:'packet'},cors);
   const reader=request.body.getReader();let size=0,parts=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();return json(413,{error:'too-large'},cors);}parts.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
   let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return json(400,{error:'packet'},cors);}
   if(!payload||typeof payload!=='object'||Array.isArray(payload))return json(400,{error:'packet'},cors);
   let body;
   if(op==='create'){
    if(Object.keys(payload).sort().join(',')!=='envelope,verifier'||!digestPattern.test(payload.verifier)||!envelopeValid(payload.envelope)||payload.envelope.data.length>2048)return json(400,{error:'packet'},cors);
    body=payload;
   }else{
    if(Object.keys(payload).length)return json(400,{error:'packet'},cors);
    body={verifier:await digestToken(auth[1])};
   }
   const stub=env.SNAPSHOTS.get(env.SNAPSHOTS.idFromName(pairV2?'device-invite-v2':'device-invite-v1'));
   const result=await stub.fetch(new Request('https://internal/pairing/'+op,{method:'POST',body:JSON.stringify(body)}));
   return new Response(result.body,{status:result.status,headers:{...headers,...cors,'Content-Type':'application/json; charset=utf-8'}});
  }
  if(!await authorized(request,settings.hashes[match[1]]))return json(401,{error:'unauthorized'},cors);
  if(!['GET','PUT'].includes(request.method))return json(405,{error:'method'},cors);
  if(request.method==='PUT'&&!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return json(415,{error:'content-type'},cors);
  const stub=env.SNAPSHOTS.get(env.SNAPSHOTS.idFromName(match[1]));
  // Only the authenticated front end can access this binding. Never forward credentials.
  const init={method:request.method};
  if(request.method==='PUT'){
   const n=request.headers.get('Content-Length');
   if(n!==null&&(!/^\d+$/.test(n)||Number(n)>LIMIT))return json(413,{error:'too-large'},cors);
   init.body=request.body;
  }
  const result=await stub.fetch(new Request('https://internal/snapshot',init));
  return new Response(result.body,{status:result.status,headers:{...headers,...cors,'Content-Type':'application/json; charset=utf-8'}});
 }catch{return json(503,{error:'storage-unavailable'},cors);}
}};
/* One SQLite-backed object per area. All writes share a synchronous transaction. */
export class SyncSnapshot extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);
  this.storage=ctx.storage;
  this.sql=ctx.storage.sql;
  this.sql.exec('CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, envelope TEXT NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS migration_fence (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, migration_id TEXT NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS migration_rollback_guard (id INTEGER PRIMARY KEY CHECK(id=1), commitment TEXT NOT NULL, public_key TEXT NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS migration_rollback_done (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, migration_id TEXT NOT NULL)');
  this.settings=config(env);
 }
 get(){
  const row=this.sql.exec('SELECT revision, envelope FROM snapshot WHERE id=1').toArray()[0];
  if(!row)return {revision:0,envelope:null};
  if(!Number.isSafeInteger(row.revision)||row.revision<1)throw Error('Invalid revision');
  const envelope=JSON.parse(row.envelope);
  if(!envelopeValid(envelope))throw Error('Invalid envelope');
  return {revision:row.revision,envelope};
 }
 fence(){
  const row=this.sql.exec('SELECT revision,migration_id FROM migration_fence WHERE id=1').toArray()[0];
  return row?{revision:row.revision,migrationId:row.migration_id}:null;
 }
 fenceState(){const revision=this.get().revision,fence=this.fence();if(fence&&(fence.revision!==revision||!migrationIdPattern.test(fence.migrationId)))throw Error('Invalid migration fence');return {revision,fence};}
 // Must be called inside the same synchronous transaction as v2 authorization.
 write(expectedRevision,envelope){
  const current=this.get();
  if(current.revision!==expectedRevision)return null;
  if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('Revision limit');
  const revision=current.revision+1;
  this.sql.exec('INSERT INTO snapshot (id, revision, envelope) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, envelope=excluded.envelope',revision,JSON.stringify(envelope));
  return {revision,envelope};
 }
 async alarm(){
  // A newer invitation may have replaced the old one. Never remove a live invitation early.
  const row=this.sql.exec('SELECT expires FROM device_invite WHERE id=1').toArray()[0];
  if(row&&row.expires>Date.now())await this.storage.setAlarm(row.expires);else this.sql.exec('DELETE FROM device_invite WHERE id=1');
 }
 async fetch(request){
  try{
   const path=new URL(request.url).pathname,pair=/^\/pairing\/(create|redeem)$/.exec(path);
   if(path==='/migration-key-available'&&request.method==='POST'){
    const {hash}=await request.json();if(!validDeviceHash(hash))return json(400,{error:'packet'});
    new DeviceRegistry(this.sql);
    return this.sql.exec('SELECT id FROM trusted_device WHERE token_hash=?',hash).toArray().length?json(409,{error:'key-reuse'}):json(200,{available:true});
   }
   if(path==='/migration-fence-status-v2'&&request.method==='GET'){
    const registry=new DeviceRegistry(this.sql),hash=request.headers.get('X-TeachApp-Device-Hash');
    return this.storage.transactionSync(()=>registry.active(hash)?json(200,this.fenceState()):json(401,{error:'unauthorized'}));
   }
   if((path==='/migration-fence'||path==='/migration-fence-status')&&request.method==='GET')return json(200,this.fenceState());
   if(path==='/migration-fence'&&request.method==='PUT'){
    const body=await request.json(),area=request.headers.get('X-Migration-Area'),key=this.settings?.verifyKeys[area];
    if(!validFencePacket(body)||!areas.includes(area)||Boolean(key)!==Object.hasOwn(body,'destinationAnchorCommitment'))return json(400,{error:'packet'});
    if(key)try{await importReceiptKey(key);}catch{return json(400,{error:'invalid-pinned-key'});}
    return this.storage.transactionSync(()=>{
     const state=this.fenceState(),guard=this.sql.exec('SELECT commitment,public_key FROM migration_rollback_guard WHERE id=1').toArray()[0];
     if(this.sql.exec('SELECT id FROM migration_rollback_done WHERE id=1').toArray().length)return json(409,{error:'rollback-completed'});
     if(state.fence)return state.fence.revision===body.expectedRevision&&state.fence.migrationId===body.migrationId&&(!key&&!guard||key&&guard?.commitment===body.destinationAnchorCommitment&&guard.public_key===JSON.stringify(key))?json(200,state):json(423,{error:'migration-frozen'});
     if(state.revision!==body.expectedRevision||guard)return json(409,{error:'stale'});
     this.sql.exec('INSERT INTO migration_fence(id,revision,migration_id) VALUES(1,?,?)',state.revision,body.migrationId);
     if(key)this.sql.exec('INSERT INTO migration_rollback_guard(id,commitment,public_key) VALUES(1,?,?)',body.destinationAnchorCommitment,JSON.stringify(key));
     return json(200,this.fenceState());
    });
   }
   if(path==='/migration-rollback'&&request.method==='PUT'){
    const body=await request.json(),area=request.headers.get('X-Migration-Area'),key=this.settings?.verifyKeys[area];
    if(!validResumePacket(body)||!areas.includes(area)||!key)return json(400,{error:'packet'});
    const guard=this.sql.exec('SELECT commitment,public_key FROM migration_rollback_guard WHERE id=1').toArray()[0];
    if(!guard||guard.public_key!==JSON.stringify(key)||!await verifyRollbackReceipt(body.receipt,{area,migrationId:body.migrationId,anchorCommitment:guard.commitment},key))return json(409,{error:'invalid-seal-receipt'});
    return this.storage.transactionSync(()=>{
     const state=this.fenceState(),currentGuard=this.sql.exec('SELECT commitment,public_key FROM migration_rollback_guard WHERE id=1').toArray()[0],done=this.sql.exec('SELECT revision,migration_id FROM migration_rollback_done WHERE id=1').toArray()[0];
     if(!currentGuard||currentGuard.commitment!==guard.commitment||currentGuard.public_key!==guard.public_key)return json(409,{error:'guard-changed'});
     if(done)return done.revision===body.expectedRevision&&done.migration_id===body.migrationId&&!state.fence?json(200,state):json(409,{error:'rollback-completed'});
     if(state.revision!==body.expectedRevision||state.fence?.migrationId!==body.migrationId)return json(409,{error:'fence-mismatch'});
     this.sql.exec('INSERT INTO migration_rollback_done(id,revision,migration_id) VALUES(1,?,?)',state.revision,body.migrationId);
     this.sql.exec('DELETE FROM migration_fence WHERE id=1');
     return json(200,this.fenceState());
    });
   }
   if(path==='/devices'||path==='/devices/revoke'){
    const registry=new DeviceRegistry(this.sql);
    if(path==='/devices'&&request.method==='GET')return json(200,{devices:registry.list()});
    if(request.method!=='POST')return json(405,{error:'method'});
    const body=await request.json();
    const result=this.storage.transactionSync(()=>path==='/devices'?registry.register(body):validRevocation(body)?registry.revoke(body.id):{status:400,error:'packet'});
    return json(result.status,result.device?{device:result.device}:{error:result.error});
   }
   if(path==='/snapshot-v2'){
    const registry=new DeviceRegistry(this.sql),hash=request.headers.get('X-TeachApp-Device-Hash');
    // Reject unauthorized streams early, and recheck inside the commit transaction.
    if(!registry.active(hash))return json(401,{error:'unauthorized'});
    if(request.method==='GET'){
     const result=this.storage.transactionSync(()=>{
      const id=registry.active(hash);if(!id)return null;
      const snapshot=this.get();registry.touch(id);return snapshot;
     });
     return result?json(200,result):json(401,{error:'unauthorized'});
    }
    if(request.method!=='PUT')return json(405,{error:'method'});
    const packet=await readPacket(request);
    if(packet.error)return json(packet.error,{error:packet.error===413?'too-large':'packet'});
    const result=this.storage.transactionSync(()=>{
     const id=registry.active(hash);if(!id)return {status:401,error:'unauthorized'};
     if(this.fence())return {status:423,error:'migration-frozen'};
     const next=this.write(packet.body.expectedRevision,packet.body.envelope);
     if(!next)return {status:409,error:'stale'};
     registry.touch(id,Date.now(),true);return {status:200,snapshot:next};
    });
    return json(result.status,result.snapshot||{error:result.error});
   }
   if(pair&&request.method==='POST'){
    const body=await request.json(),now=Date.now();
    this.sql.exec('CREATE TABLE IF NOT EXISTS device_invite (id INTEGER PRIMARY KEY CHECK (id=1), verifier TEXT NOT NULL, envelope TEXT NOT NULL, expires INTEGER NOT NULL)');
    if(pair[1]==='create'){
     this.sql.exec('INSERT INTO device_invite VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET verifier=excluded.verifier,envelope=excluded.envelope,expires=excluded.expires',body.verifier,JSON.stringify(body.envelope),now+600000);
     await this.storage.setAlarm(now+600000);
     return json(200,{status:'created'});
    }
    const result=this.storage.transactionSync(()=>{
     const row=this.sql.exec('SELECT * FROM device_invite WHERE id=1').toArray()[0];
     if(!row)return null;
     if(row.expires<=now){this.sql.exec('DELETE FROM device_invite WHERE id=1');return null;}
     if(!equal(row.verifier,body.verifier))return null;
     this.sql.exec('DELETE FROM device_invite WHERE id=1');
     return JSON.parse(row.envelope);
    });
    return result?json(200,{envelope:result}):json(410,{error:'expired-or-used'});
   }
   if(request.method==='GET')return json(200,this.get());
   if(request.method!=='PUT')return json(405,{error:'method'});
   const packet=await readPacket(request);
   if(packet.error)return json(packet.error,{error:packet.error===413?'too-large':'packet'});
   const {expectedRevision,envelope}=packet.body;
   return this.storage.transactionSync(()=>{
    if(this.fence())return json(423,{error:'migration-frozen'});
    const next=this.write(expectedRevision,envelope);
    return next?json(200,next):json(409,{error:'stale'});
   });
  }catch{return json(503,{error:'storage-unavailable'});}
 }
}
