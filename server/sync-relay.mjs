/* Optional, self-hosted, opaque relay. Run behind a TLS reverse proxy. */
import http from 'node:http';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {mkdir,readFile,open,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const areas=['school','coach'],limit=90*1024*1024;
const tokenPattern=/^[A-Za-z0-9_-]{32,256}$/;
const hash=s=>createHash('sha256').update(s).digest();
const json=(res,status,body)=>{const data=JSON.stringify(body);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(data),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);};
function envelopeValid(e){
 return e&&typeof e==='object'&&!Array.isArray(e)&&Object.keys(e).sort().join(',')==='app,cipher,data,iterations,iv,kdf,salt,version'&&e.app==='teachapp-encrypted'&&e.version===1&&e.kdf==='PBKDF2-SHA256'&&e.iterations===600000&&e.cipher==='AES-256-GCM'&&typeof e.salt==='string'&&/^[A-Za-z0-9+/]{22}==$/.test(e.salt)&&typeof e.iv==='string'&&/^[A-Za-z0-9+/]{16}$/.test(e.iv)&&typeof e.data==='string'&&e.data.length>=24&&e.data.length<=limit&&e.data.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(e.data);
}
async function readBody(req){
 const size=Number(req.headers['content-length']||0);
 if(!Number.isFinite(size)||size<0||size>limit)throw Object.assign(Error(),{status:413});
 let total=0,parts=[];
 for await(const part of req){total+=part.length;if(total>limit)throw Object.assign(Error(),{status:413});parts.push(part);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Object.assign(Error(),{status:400});}
}
export async function createRelay({directory,tokens,allowedOrigin}){
 if(typeof directory!=='string'||!directory)throw Error('Configure a private storage directory');
 let origin;
 try{const u=new URL(allowedOrigin);if(u.origin!==allowedOrigin||!['https:','http:'].includes(u.protocol)||u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error();origin=u.origin;}catch{throw Error('Configure exact HTTPS client origin (loopback HTTP only for tests)');}
 const digests={},all=new Set();
 for(const area of areas){
  const list=tokens?.[area]??[];
  if(!Array.isArray(list)||list.length>32||list.some(t=>typeof t!=='string'||!tokenPattern.test(t)||all.has(t)))throw Error('Configure unique, random per-device access tokens');
  for(const t of list){if(all.has(t))throw Error('Duplicate access token');all.add(t);}
  digests[area]=list.map(hash);
 }
 if(!all.size)throw Error('No enabled sync areas');
 directory=resolve(directory);
 await mkdir(directory,{recursive:true,mode:0o700});
 const lockPath=join(directory,'.relay-lock'),lock=await open(lockPath,'wx',0o600);
 await lock.close();
 const queues=new Map();
 function authorize(req,area){
  const match=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization||'');
  if(!match)return false;
  const value=hash(match[1]);
  let allowed=0;for(const digest of digests[area])allowed|=Number(timingSafeEqual(value,digest));
  return Boolean(allowed);
 }
 function serial(area,fn){
  const prior=queues.get(area)||Promise.resolve(),next=prior.catch(()=>{}).then(fn);
  queues.set(area,next);return next;
 }
 async function get(area){
  let data;
  try{data=JSON.parse(await readFile(join(directory,area+'.json'),'utf8'));}
  catch(e){if(e.code==='ENOENT')return {revision:0,envelope:null};throw e;}
  if(!Number.isSafeInteger(data.revision)||data.revision<1||!envelopeValid(data.envelope))throw Error('Invalid stored revision');
  return data;
 }
 async function write(area,data){
  const path=join(directory,area+'.json'),temp=join(directory,area+'-'+randomUUID()+'.tmp');
  try{
   const file=await open(temp,'wx',0o600);
   try{await file.writeFile(JSON.stringify(data),'utf8');await file.sync();}finally{await file.close();}
   await rename(temp,path);
   // Persist the directory rename on supported POSIX systems.
   if(process.platform!=='win32'){
    const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
   }
  }finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 const server=http.createServer({requestTimeout:60000,headersTimeout:10000,maxHeaderSize:8192},async(req,res)=>{
  try{
   const requestOrigin=req.headers.origin;
   if(requestOrigin&&requestOrigin!==origin){json(res,403,{error:'origin'});return;}
   if(requestOrigin===origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
   const match=/^\/v1\/snapshot\/(school|coach)$/.exec(req.url||'');
   if(!match){json(res,404,{error:'route'});return;}
   const area=match[1];
   if(req.method==='OPTIONS'){
    if(requestOrigin!==origin){json(res,403,{error:'origin'});return;}
    res.writeHead(204,{'Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300','Cache-Control':'no-store'});res.end();return;
   }
   if(!authorize(req,area)){json(res,401,{error:'unauthorized'});return;}
   if(req.method==='GET'){json(res,200,await serial(area,()=>get(area)));return;}
   if(req.method!=='PUT'){json(res,405,{error:'method'});return;}
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){json(res,415,{error:'content-type'});return;}
   const body=await readBody(req);
   if(!body||Object.keys(body).sort().join(',')!=='envelope,expectedRevision'||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!envelopeValid(body.envelope)){json(res,400,{error:'packet'});return;}
   const result=await serial(area,async()=>{
    const current=await get(area);
    if(current.revision!==body.expectedRevision)return null;
    if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('Revision limit');
    const next={revision:current.revision+1,envelope:body.envelope};
    await write(area,next);return next;
   });
   if(!result){json(res,409,{error:'stale'});return;}
   json(res,200,result);
  }catch(e){if(!res.headersSent&&!res.destroyed)json(res,e.status||500,{error:e.status?'request':'storage'});else if(!res.destroyed)res.destroy();}
 });
 server.maxConnections=32;
 server.once('close',()=>{unlink(lockPath).catch(()=>{});});
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const server=await createRelay({directory:process.env.TEACHAPP_SYNC_DIR,tokens:JSON.parse(process.env.TEACHAPP_SYNC_TOKENS||'{}'),allowedOrigin:process.env.TEACHAPP_SYNC_ORIGIN});
  const port=Number(process.env.PORT||8787);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
  server.listen(port,'127.0.0.1',()=>console.log('TeachApp relay listening on loopback; configure TLS reverse proxy.'));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
 }catch(e){console.error('Relay startup failed:',e.message);process.exitCode=1;}
}
