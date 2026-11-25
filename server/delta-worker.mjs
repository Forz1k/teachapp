/* Isolated local-only delta relay. No production routes or snapshot bindings. */
import {DurableObject} from 'cloudflare:workers';
import {LIMIT,digestToken} from './cloudflare-protocol.mjs';
import {normalizeDeltaWrite,decideDeltaWrite,MAX_DELTA_ENTRIES,MAX_LEDGER_BYTES} from './delta-ledger.mjs';
const areas=['school','coach'],loopback=['127.0.0.1','localhost','[::1]'];
const H={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8'};
const json=(status,body,cors={})=>new Response(JSON.stringify(body),{status,headers:{...H,...cors}});
function config(env,url){
 try{
  const origin=new URL(env.TEACHAPP_DELTA_ORIGIN),hashes=JSON.parse(env.TEACHAPP_DELTA_TOKEN_HASHES||'{}'),compactors=JSON.parse(env.TEACHAPP_DELTA_COMPACT_HASHES||'{}'),seen=new Set();
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
  return readCount?{origin:origin.origin,hashes,compactors}:null;
 }catch{return null;}
}
function equal(a,b){let d=0;for(let i=0;i<64;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
async function authorized(req,hashes){
 const token=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.get('Authorization')||'');
 if(!token)return false;
 const digest=await digestToken(token[1]);let ok=0;for(const h of hashes)ok|=Number(equal(digest,h));return Boolean(ok);
}
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
 if(u.pathname==='/healthz'&&request.method==='GET')return json(settings?200:503,{status:settings?'synthetic-ready':'disabled'});
 if(!settings)return json(503,{error:'disabled'});
 const route=/^\/v1\/delta\/(school|coach)\/(head|anchor|append|compact|revision\/[1-9]\d{0,14})$/.exec(u.pathname);
 if(!route||u.search)return json(404,{error:'route'});
 const [,area,path]=route,origin=request.headers.get('Origin'),cors=origin===settings.origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
 if(origin&&origin!==settings.origin)return json(403,{error:'origin'});
 if(request.method==='OPTIONS')return origin===settings.origin?new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}}):json(403,{error:'origin'});
 const write=['anchor','append','compact'].includes(path);
 if(request.method!==(write?'PUT':'GET'))return json(405,{error:'method'},cors);
 try{
  if(!await authorized(request,path==='compact'?[settings.compactors[area]].filter(Boolean):settings.hashes[area]))return json(401,{error:'unauthorized'},cors);
  const input=write?await bodyOf(request):{body:null};
  if(input.error)return json(input.error,{error:'packet'},cors);
  const stub=env.DELTA_LEDGERS.get(env.DELTA_LEDGERS.idFromName(area));
  const res=await stub.fetch(new Request('https://internal/'+path,{method:request.method,...(write?{headers:{'Content-Type':'application/json'},body:JSON.stringify(input.body)}:{})}));
  return new Response(res.body,{status:res.status,headers:{...H,...cors}});
 }catch{return json(503,{error:'unavailable'},cors);}
}};
export class DeltaLedger extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.storage=ctx.storage;this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS revisions (revision INTEGER PRIMARY KEY, kind TEXT NOT NULL, envelope TEXT NOT NULL, bytes INTEGER NOT NULL)');}
 head(){return this.sql.exec('SELECT COALESCE(MAX(revision),0) AS revision, COALESCE(MIN(revision),0) AS anchorRevision, COUNT(*) AS count, COALESCE(SUM(bytes),0) AS bytes FROM revisions').toArray()[0];}
 async fetch(request){
  const path=new URL(request.url).pathname;
  try{
   if(request.method==='GET'){
    if(path==='/head'){
     const h=this.head();return json(200,{revision:h.revision,anchorRevision:h.anchorRevision,count:h.count,bytes:h.bytes,maxEntries:MAX_DELTA_ENTRIES+1,maxBytes:MAX_LEDGER_BYTES});
    }
    const m=/^\/revision\/([1-9]\d{0,14})$/.exec(path);
    if(!m)return json(404,{error:'route'});
    const row=this.sql.exec('SELECT revision,kind,envelope FROM revisions WHERE revision=?',Number(m[1])).toArray()[0];
    if(row)return json(200,{revision:row.revision,kind:row.kind,envelope:JSON.parse(row.envelope)});
    const h=this.head();return h.anchorRevision&&Number(m[1])<h.anchorRevision?json(410,{error:'compacted',anchorRevision:h.anchorRevision}):json(404,{error:'revision'});
   }
   if(request.method!=='PUT'||!['/anchor','/append','/compact'].includes(path))return json(404,{error:'route'});
   const packet=normalizeDeltaWrite(await request.json()),kind=path==='/anchor'?'anchor':path==='/compact'?'compact':'delta';
   if(!packet)return json(400,{error:'packet'});
   const result=this.storage.transactionSync(()=>{
    const h=this.head(),last=this.sql.exec('SELECT revision,kind,envelope AS serialized FROM revisions WHERE revision=?',h.revision).toArray()[0];
    const decision=decideDeltaWrite(h,kind,packet,last);
    if(decision.status===201){
     // Both the new anchor and removal of its superseded chain are atomic.
     this.sql.exec('INSERT INTO revisions(revision,kind,envelope,bytes) VALUES(?,?,?,?)',decision.revision,decision.compact?'anchor':kind,packet.serialized,packet.bytes);
     if(decision.compact)this.sql.exec('DELETE FROM revisions WHERE revision<?',decision.revision);
    }
    return decision;
   });
   return json(result.status,result.error?{error:result.error}:{revision:result.revision,replayed:result.replayed});
  }catch{return json(503,{error:'storage'});}
 }
}
