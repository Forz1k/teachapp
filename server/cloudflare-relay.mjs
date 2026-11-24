/* Optional Cloudflare relay for synthetic data. No default credentials. */
const areas=['school','coach'];
export const LIMIT=1024*1024;
const tokenPattern=/^[A-Za-z0-9_-]{32,256}$/;
const digestPattern=/^[0-9a-f]{64}$/;
const encoder=new TextEncoder();
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function json(status,body,extra={}){
 return new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8',...extra}});
}
function config(env){
 let origin,hashes;
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
  if(!seen.size)throw Error();
 }catch{return null;}
 return {origin,hashes};
}
export async function digestToken(token){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
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
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/healthz'&&request.method==='GET'){
  // No data, credentials, or revision information is disclosed.
  return json(config(env)?200:503,{status:config(env)?'ready':'not-configured'});
 }
 const match=/^\/v1\/snapshot\/(school|coach)$/.exec(url.pathname);
 if(!match||url.search)return json(404,{error:'route'});
 const settings=config(env);
 if(!settings)return json(503,{error:'not-configured'});
 const origin=request.headers.get('Origin'),cors=origin===settings.origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
 if(origin&&origin!==settings.origin)return json(403,{error:'origin'});
 if(request.method==='OPTIONS'){
  if(origin!==settings.origin)return json(403,{error:'origin'});
  return new Response(null,{status:204,headers:{...headers,...cors,'Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}});
 }
 try{
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
export class SyncSnapshot{
 constructor(ctx){
  this.storage=ctx.storage;
  this.sql=ctx.storage.sql;
  this.sql.exec('CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, envelope TEXT NOT NULL)');
 }
 get(){
  const row=this.sql.exec('SELECT revision, envelope FROM snapshot WHERE id=1').toArray()[0];
  if(!row)return {revision:0,envelope:null};
  if(!Number.isSafeInteger(row.revision)||row.revision<1)throw Error('Invalid revision');
  const envelope=JSON.parse(row.envelope);
  if(!envelopeValid(envelope))throw Error('Invalid envelope');
  return {revision:row.revision,envelope};
 }
 async fetch(request){
  try{
   if(request.method==='GET')return json(200,this.get());
   if(request.method!=='PUT')return json(405,{error:'method'});
   const packet=await readPacket(request);
   if(packet.error)return json(packet.error,{error:packet.error===413?'too-large':'packet'});
   const {expectedRevision,envelope}=packet.body;
   const next=this.storage.transactionSync(()=>{
    const current=this.get();
    if(current.revision!==expectedRevision)return null;
    if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('Revision limit');
    const revision=current.revision+1;
    this.sql.exec('INSERT INTO snapshot (id, revision, envelope) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, envelope=excluded.envelope',revision,JSON.stringify(envelope));
    return {revision,envelope};
   });
   return next?json(200,next):json(409,{error:'stale'});
  }catch{return json(503,{error:'storage-unavailable'});}
 }
}
