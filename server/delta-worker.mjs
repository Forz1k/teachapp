/* Isolated local-only delta relay. No production routes or snapshot bindings. */
import {DurableObject} from 'cloudflare:workers';
import {LIMIT,digestToken} from './cloudflare-protocol.mjs';
import {normalizeDeltaWrite,decideDeltaWrite,MAX_DELTA_ENTRIES,MAX_LEDGER_BYTES} from './delta-ledger.mjs';
import {normalizeAnchorManifest,anchorUploadId,verifyAnchorPart,singleDeltaAnchorCommitment} from '../js/delta-anchor.js';
import {normalizeReceiptKeys,signRollbackReceipt} from './migration-receipt.mjs';
const UPLOAD_TTL=10*60*1000,utf8=new TextEncoder();
const migrationId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const multipartRoute=/^\/multipart\/(anchor|compact|rotate)\/([a-f0-9]{64})\/(begin|commit|abort|part\/(0|[1-9]\d?))$/;
const partRoute=/^\/revision\/([1-9]\d{0,14})\/part\/(0|[1-9]\d?)$/;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const areas=['school','coach'],loopback=['127.0.0.1','localhost','[::1]'];
const H={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8'};
const json=(status,body,cors={})=>new Response(JSON.stringify(body),{status,headers:{...H,...cors}});
function config(env,url){
 try{
  const origin=new URL(env.TEACHAPP_DELTA_ORIGIN),hashes=JSON.parse(env.TEACHAPP_DELTA_TOKEN_HASHES||'{}'),compactors=JSON.parse(env.TEACHAPP_DELTA_COMPACT_HASHES||'{}'),rotators=JSON.parse(env.TEACHAPP_DELTA_ROTATE_HASHES||'{}'),sealers=JSON.parse(env.TEACHAPP_DELTA_SEAL_HASHES||'{}'),seen=new Set();
  if(env.TEACHAPP_DELTA_SYNTHETIC!=='true'||!loopback.includes(url.hostname)||origin.protocol!=='http:'||!loopback.includes(origin.hostname)||origin.origin!==env.TEACHAPP_DELTA_ORIGIN||!hashes||typeof hashes!=='object'||Array.isArray(hashes)||Object.keys(hashes).some(k=>!areas.includes(k)))return null;
  for(const area of areas){
   const list=hashes[area]??[];
   if(!Array.isArray(list)||list.length>32)return null;
   for(const h of list){if(typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h)||seen.has(h))return null;seen.add(h);}
   hashes[area]=list;
  }
  if(!compactors||typeof compactors!=='object'||Array.isArray(compactors)||Object.keys(compactors).some(k=>!areas.includes(k)))return null;
  const readCount=seen.size;
  for(const area of areas){
   const h=compactors[area];if(h===undefined)continue;
   if(typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h)||seen.has(h)||!hashes[area].length)return null;
   seen.add(h);
  }
  if(!rotators||typeof rotators!=='object'||Array.isArray(rotators)||Object.keys(rotators).some(k=>!areas.includes(k)))return null;
  for(const area of areas){const h=rotators[area];if(h===undefined)continue;if(typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h)||seen.has(h)||!hashes[area].length||!compactors[area])return null;seen.add(h);}
  if(!sealers||typeof sealers!=='object'||Array.isArray(sealers)||Object.keys(sealers).some(k=>!areas.includes(k)))return null;
  for(const area of areas){const h=sealers[area];if(h===undefined)continue;if(typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h)||seen.has(h)||!hashes[area].length)return null;seen.add(h);}
  const signKeys=normalizeReceiptKeys(JSON.parse(env.TEACHAPP_DELTA_ROLLBACK_SIGN_KEYS||'{}'),true);
  if(!signKeys||Object.keys(signKeys).some(a=>!sealers[a]))return null;
  return readCount?{origin:origin.origin,hashes,compactors,rotators,sealers,signKeys,reserved:[...seen]}:null;
 }catch{return null;}
}
function equal(a,b){let d=0;for(let i=0;i<64;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
function authorized(digest,hashes){if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))return false;let ok=0;for(const h of hashes)ok|=Number(equal(digest,h));return Boolean(ok);}
async function bodyOf(request){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return {error:415};
 const len=request.headers.get('Content-Length');if(len!==null&&(!/^\d+$/.test(len)||Number(len)>LIMIT))return {error:413};
 if(!request.body)return {error:400};
 const reader=request.body.getReader();let size=0,chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();return {error:413};}chunks.push(value);}}
 finally{reader.releaseLock();}
 try{const raw=new Uint8Array(size);let off=0;for(const chunk of chunks){raw.set(chunk,off);off+=chunk.byteLength;}return {body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};}catch{return {error:400};}
}
export default {async fetch(request,env){
 const u=new URL(request.url),settings=config(env,u);
 if(u.pathname==='/healthz'&&request.method==='GET'){
  const origin=request.headers.get('Origin');
  if(origin&&origin!==settings?.origin)return json(403,{error:'origin'});
  return json(settings?200:503,{status:settings?'synthetic-ready':'disabled'},origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{});
 }
 if(!settings)return json(503,{error:'disabled'});
 const route=/^\/v1\/delta\/(school|coach)(\/.*)$/.exec(u.pathname);
 if(!route||u.search)return json(404,{error:'route'});
 const [,area,internal]=route,path=internal.slice(1),multi=multipartRoute.exec(internal),part=partRoute.exec(internal);
 if(!multi&&!part&&!/^(head|anchor|append|compact|rollback-seal|rollback-status|rollback-receipt|revision\/[1-9]\d{0,14})$/.test(path))return json(404,{error:'route'});
 const origin=request.headers.get('Origin'),cors=origin===settings.origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
 if(origin&&origin!==settings.origin)return json(403,{error:'origin'});
 if(request.method==='OPTIONS')return origin===settings.origin?new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}}):json(403,{error:'origin'});
 const write=!!multi||['anchor','append','compact','rollback-seal'].includes(path);
 if(request.method!==(write?'PUT':'GET'))return json(405,{error:'method'},cors);
 try{
  const token=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('Authorization')||'');
  if(!token)return json(401,{error:'unauthorized'},cors);
  const digest=await digestToken(token[1]);
  const input=write?await bodyOf(request):{body:null};
  if(input.error)return json(input.error,{error:'packet'},cors);
  const stub=env.DELTA_LEDGERS.get(env.DELTA_LEDGERS.idFromName(area));
  const res=await stub.fetch(new Request('https://internal/'+path,{method:request.method,headers:{'X-Delta-Area':area,'X-Delta-Digest':digest,...(write?{'Content-Type':'application/json'}:{})},...(write?{body:JSON.stringify(input.body)}:{})}));
  return new Response(res.body,{status:res.status,headers:{...H,...cors}});
 }catch{return json(503,{error:'unavailable'},cors);}
}};
export class DeltaLedger extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);this.storage=ctx.storage;this.sql=ctx.storage.sql;this.settings=config(env,new URL('http://localhost'));
  this.sql.exec('CREATE TABLE IF NOT EXISTS revisions (revision INTEGER PRIMARY KEY, kind TEXT NOT NULL, envelope TEXT NOT NULL, bytes INTEGER NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS staged_anchor (id TEXT PRIMARY KEY, manifest TEXT NOT NULL, expires INTEGER NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS staged_parts (id TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id,part))');
  this.sql.exec('CREATE TABLE IF NOT EXISTS anchor_parts (revision INTEGER NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(revision,part))');
  this.sql.exec('CREATE TABLE IF NOT EXISTS credential_state (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL, hashes TEXT NOT NULL, compact TEXT NOT NULL)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS retired_hashes (hash TEXT PRIMARY KEY)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS rollback_seal (id INTEGER PRIMARY KEY CHECK(id=1), migration_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision=1))');
 }
 credentials(area){
  const r=this.sql.exec('SELECT epoch,hashes,compact FROM credential_state WHERE id=1').toArray()[0];
  return r?{epoch:r.epoch,readHashes:JSON.parse(r.hashes),compactHash:r.compact}:{epoch:0,readHashes:this.settings.hashes[area],compactHash:this.settings.compactors[area]};
 }
 allowed(area,digest,kind){
  const c=this.credentials(area);
  return authorized(digest,kind==='seal'?[this.settings.sealers[area]].filter(Boolean):kind==='rotate'?[this.settings.rotators[area]].filter(Boolean):kind==='compact'?[c.compactHash].filter(Boolean):c.readHashes);
 }
 validRotation(area,rotation){
  const c=this.credentials(area),used=new Set([...this.settings.reserved,...c.readHashes,c.compactHash,...this.sql.exec('SELECT hash FROM retired_hashes').toArray().map(r=>r.hash)]);
  return c.epoch<64&&[...rotation.readHashes,rotation.compactHash].every(h=>!used.has(h));
 }
 rotateCredentials(area,rotation){
  const c=this.credentials(area);
  for(const h of [...c.readHashes,c.compactHash].filter(Boolean))this.sql.exec('INSERT OR IGNORE INTO retired_hashes(hash) VALUES(?)',h);
  this.sql.exec('INSERT OR REPLACE INTO credential_state(id,epoch,hashes,compact) VALUES(1,?,?,?)',c.epoch+1,JSON.stringify(rotation.readHashes),rotation.compactHash);
 }
 seal(){const r=this.sql.exec('SELECT migration_id,revision FROM rollback_seal WHERE id=1').toArray()[0];return r?{migrationId:r.migration_id,revision:r.revision}:null;}
 last(revision){return this.sql.exec('SELECT revision,kind,envelope AS serialized FROM revisions WHERE revision=?',revision).toArray()[0];}
 stage(){return this.sql.exec('SELECT id,manifest,expires FROM staged_anchor LIMIT 1').toArray()[0];}
 clearStage(id){this.sql.exec('DELETE FROM staged_parts WHERE id=?',id);this.sql.exec('DELETE FROM staged_anchor WHERE id=?',id);}
 pruneStage(head){const s=this.stage();if(s&&(s.expires<=Date.now()||JSON.parse(s.manifest).expectedRevision!==head.revision))this.clearStage(s.id);}
 pruneHistory(revision){this.sql.exec('DELETE FROM anchor_parts WHERE revision<?',revision);this.sql.exec('DELETE FROM revisions WHERE revision<?',revision);}
 packet(manifest,id){
  const serialized=JSON.stringify({multipart:manifest,uploadId:id}),bytes=manifest.dataLength+utf8.encode(serialized).length+manifest.parts.length*128;
  return {expectedRevision:manifest.expectedRevision,serialized,bytes};
 }
 // The only published state transition is the transactional commit. Staging
 // is capped at one upload per contour, expires on subsequent writes, and
 // does not advance the revision or make partial data readable.
 async multipart(route,input,area,digest){
  const [,kind,id,action,indexText]=route;
  if(action==='begin'){
   if(!exact(input,['manifest']))return json(400,{error:'manifest'});
   const m=normalizeAnchorManifest(input.manifest);
   if(!m||m.kind!==kind||await anchorUploadId(m)!==id)return json(400,{error:'manifest'});
   const packet=this.packet(m,id);
   return this.storage.transactionSync(()=>{
    if(!this.allowed(area,digest,kind))return json(401,{error:'unauthorized'});
    if(this.seal())return json(423,{error:'rollback-sealed'});
    const h=this.head();this.pruneStage(h);
    const d=decideDeltaWrite(h,kind,packet,this.last(h.revision));
    if(d.status===200)return json(200,{revision:d.revision,replayed:true});
    if(d.status!==201)return json(d.status,{error:d.error});
    if(kind==='rotate'&&!this.validRotation(area,m.rotation))return json(409,{error:'credential-reuse-or-limit'});
    const s=this.stage();
    if(s&&s.id!==id)return json(409,{error:'upload-in-progress'});
    const expires=s?.expires??Date.now()+UPLOAD_TTL;
    if(!s)this.sql.exec('INSERT INTO staged_anchor(id,manifest,expires) VALUES(?,?,?)',id,JSON.stringify(m),expires);
    return json(s?200:201,{uploadId:id,expiresAt:expires});
   });
  }
  if(action==='commit'||action==='abort'){
   if(!exact(input,[]))return json(400,{error:'packet'});
   return this.storage.transactionSync(()=>{
    if(!this.allowed(area,digest,kind))return json(401,{error:'unauthorized'});
    if(this.seal())return json(423,{error:'rollback-sealed'});
    const h=this.head();this.pruneStage(h);
    const last=this.last(h.revision),stored=last&&JSON.parse(last.serialized);
    if(action==='commit'&&stored?.uploadId===id&&stored.multipart?.kind===kind&&stored.multipart.expectedRevision+1===h.revision)return json(200,{revision:h.revision,replayed:true});
    const s=this.stage();
    if(!s||s.id!==id)return json(409,{error:'upload-missing-or-stale'});
    const m=normalizeAnchorManifest(JSON.parse(s.manifest));
    if(!m||m.kind!==kind)return json(409,{error:'upload-kind'});
    if(action==='abort'){this.clearStage(id);return json(200,{aborted:true});}
    const rows=this.sql.exec('SELECT part,LENGTH(data) AS size FROM staged_parts WHERE id=? ORDER BY part',id).toArray();
    if(rows.length!==m.parts.length||rows.some((r,i)=>r.part!==i||r.size!==m.parts[i].size))return json(409,{error:'incomplete-upload'});
    const packet=this.packet(m,id),d=decideDeltaWrite(h,kind,packet,last);
    if(d.status!==201)return json(d.status,{error:d.error});
    if(kind==='rotate'&&!this.validRotation(area,m.rotation))return json(409,{error:'credential-reuse-or-limit'});
    this.sql.exec('INSERT INTO revisions(revision,kind,envelope,bytes) VALUES(?,?,?,?)',d.revision,'anchor',packet.serialized,packet.bytes);
    this.sql.exec('INSERT INTO anchor_parts(revision,part,data) SELECT ?,part,data FROM staged_parts WHERE id=?',d.revision,id);
    if(d.compact)this.pruneHistory(d.revision);
    if(kind==='rotate')this.rotateCredentials(area,m.rotation);
    this.clearStage(id);
    return json(201,{revision:d.revision,replayed:false});
   });
  }
  if(!exact(input,['data']))return json(400,{error:'part'});
  const index=Number(indexText),stage=this.stage(),m=stage?.id===id?normalizeAnchorManifest(JSON.parse(stage.manifest)):null;
  if(!m||m.kind!==kind||stage.expires<=Date.now())return json(409,{error:'upload-missing-or-stale'});
  try{await verifyAnchorPart(m,index,input.data);}catch{return json(400,{error:'part'});}
  return this.storage.transactionSync(()=>{
   if(!this.allowed(area,digest,kind))return json(401,{error:'unauthorized'});
   if(this.seal())return json(423,{error:'rollback-sealed'});
   const h=this.head();this.pruneStage(h);
   const s=this.stage();
   if(!s||s.id!==id||s.manifest!==stage.manifest||s.expires!==stage.expires)return json(409,{error:'upload-missing-or-stale'});
   const old=this.sql.exec('SELECT data FROM staged_parts WHERE id=? AND part=?',id,index).toArray()[0];
   if(old)return old.data===input.data?json(200,{index,replayed:true}):json(409,{error:'part-conflict'});
   this.sql.exec('INSERT INTO staged_parts(id,part,data) VALUES(?,?,?)',id,index,input.data);
   return json(201,{index,replayed:false});
  });
 }
 head(){return this.sql.exec('SELECT COALESCE(MAX(revision),0) AS revision, COALESCE(MIN(revision),0) AS anchorRevision, COUNT(*) AS count, COALESCE(SUM(bytes),0) AS bytes FROM revisions').toArray()[0];}
 async fetch(request){
  const path=new URL(request.url).pathname,area=request.headers.get('X-Delta-Area'),digest=request.headers.get('X-Delta-Digest'),multi=multipartRoute.exec(path);
  const role=multi?.[1]|| (path==='/rollback-seal'?'seal':path==='/compact'?'compact':'read');
  try{
   if(!this.settings||!areas.includes(area)||!this.allowed(area,digest,role))return json(401,{error:'unauthorized'});
   if(request.method==='GET'){
    if(path==='/rollback-status')return json(200,{revision:this.head().revision,seal:this.seal()});
    if(path==='/rollback-receipt'){
     const key=this.settings.signKeys[area];if(!key)return json(404,{error:'receipt-disabled'});
     const seal=this.seal(),head=this.head(),row=this.last(1);
     if(!seal||head.revision!==1||head.anchorRevision!==1||head.count!==1||row?.kind!=='anchor')return json(409,{error:'not-sealed'});
     const stored=JSON.parse(row.serialized);
     let anchorCommitment;
     if(stored.multipart){
      const m=normalizeAnchorManifest(stored.multipart);
      if(!m||m.kind!=='anchor'||m.expectedRevision!==0||await anchorUploadId(m)!==stored.uploadId)return json(503,{error:'invalid-anchor'});
      anchorCommitment='multipart:'+stored.uploadId;
     }else anchorCommitment=await singleDeltaAnchorCommitment(stored);
     // No unseal route exists. Recheck authorization after asynchronous crypto.
     const receipt=await signRollbackReceipt({area,migrationId:seal.migrationId,anchorCommitment},key);
     if(!this.allowed(area,digest,'read'))return json(401,{error:'unauthorized'});
     return json(200,receipt);
    }
    if(path==='/head'){
     const h=this.head();return json(200,{revision:h.revision,anchorRevision:h.anchorRevision,count:h.count,bytes:h.bytes,maxEntries:MAX_DELTA_ENTRIES+1,maxBytes:MAX_LEDGER_BYTES,keyEpoch:this.credentials(area).epoch});
    }
    const part=partRoute.exec(path);
    if(part){
     const revision=Number(part[1]),index=Number(part[2]),row=this.sql.exec('SELECT data FROM anchor_parts WHERE revision=? AND part=?',revision,index).toArray()[0];
     if(row)return json(200,{revision,index,data:row.data});
     const h=this.head();return h.anchorRevision&&revision<h.anchorRevision?json(410,{error:'compacted',anchorRevision:h.anchorRevision}):json(404,{error:'part'});
    }
    const m=/^\/revision\/([1-9]\d{0,14})$/.exec(path);
    if(!m)return json(404,{error:'route'});
    const row=this.sql.exec('SELECT revision,kind,envelope FROM revisions WHERE revision=?',Number(m[1])).toArray()[0];
    if(row){const e=JSON.parse(row.envelope);return json(200,{revision:row.revision,kind:row.kind,...(e.multipart?e:{envelope:e})});}
    const h=this.head();return h.anchorRevision&&Number(m[1])<h.anchorRevision?json(410,{error:'compacted',anchorRevision:h.anchorRevision}):json(404,{error:'revision'});
   }
   if(request.method==='PUT'&&path==='/rollback-seal'){
    const input=await request.json();
    if(!exact(input,['expectedRevision','migrationId'])||input.expectedRevision!==1||typeof input.migrationId!=='string'||!migrationId.test(input.migrationId))return json(400,{error:'packet'});
    return this.storage.transactionSync(()=>{
     if(!this.allowed(area,digest,'seal'))return json(401,{error:'unauthorized'});
     const h=this.head(),old=this.seal();
     if(old)return old.migrationId===input.migrationId?json(200,{revision:h.revision,seal:old}):json(423,{error:'rollback-sealed'});
     // Never discard a committed delta, compaction or rotation. The seal races
     // all other commits inside the same synchronous transaction.
     if(h.revision!==1||h.anchorRevision!==1||h.count!==1||this.credentials(area).epoch!==0)return json(409,{error:'destination-already-used'});
     const staged=this.stage();if(staged)this.clearStage(staged.id);
     this.sql.exec('INSERT INTO rollback_seal(id,migration_id,revision) VALUES(1,?,1)',input.migrationId);
     return json(200,{revision:1,seal:this.seal()});
    });
   }
   if(request.method==='PUT'&&multi){
    if(this.seal())return json(423,{error:'rollback-sealed'});
    return await this.multipart(multi,await request.json(),area,digest);
   }
   if(request.method!=='PUT'||!['/anchor','/append','/compact'].includes(path))return json(404,{error:'route'});
   const packet=normalizeDeltaWrite(await request.json()),kind=path==='/anchor'?'anchor':path==='/compact'?'compact':'delta';
   if(!packet)return json(400,{error:'packet'});
   const result=this.storage.transactionSync(()=>{
    if(!this.allowed(area,digest,role))return {status:401,error:'unauthorized'};
    if(this.seal())return {status:423,error:'rollback-sealed'};
    const h=this.head(),last=this.last(h.revision);this.pruneStage(h);
    const decision=decideDeltaWrite(h,kind,packet,last);
    if(decision.status===201){
     // Both the new anchor and removal of its superseded chain are atomic.
     this.sql.exec('INSERT INTO revisions(revision,kind,envelope,bytes) VALUES(?,?,?,?)',decision.revision,decision.compact?'anchor':kind,packet.serialized,packet.bytes);
     if(decision.compact)this.pruneHistory(decision.revision);
     this.pruneStage(this.head());
    }
    return decision;
   });
   return json(result.status,result.error?{error:result.error}:{revision:result.revision,replayed:result.replayed});
  }catch{return json(503,{error:'storage'});}
 }
}
