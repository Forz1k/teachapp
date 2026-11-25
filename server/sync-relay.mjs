/* Optional, self-hosted, opaque relay. Run behind a TLS reverse proxy. */
import http from 'node:http';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {mkdir,readFile,open,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const areas=['school','coach'],limit=90*1024*1024;
const tokenPattern=/^[A-Za-z0-9_-]{32,256}$/;
const migrationIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validFence=(f,revision)=>f&&Object.keys(f).sort().join(',')==='migrationId,revision'&&migrationIdPattern.test(f.migrationId)&&f.revision===revision;
const hash=s=>createHash('sha256').update(s).digest();
const json=(res,status,body)=>{const data=JSON.stringify(body);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(data),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);};
function envelopeValid(e){
 return e&&typeof e==='object'&&!Array.isArray(e)&&Object.keys(e).sort().join(',')==='app,cipher,data,iterations,iv,kdf,salt,version'&&e.app==='teachapp-encrypted'&&e.version===1&&e.kdf==='PBKDF2-SHA256'&&e.iterations===600000&&e.cipher==='AES-256-GCM'&&typeof e.salt==='string'&&/^[A-Za-z0-9+/]{22}==$/.test(e.salt)&&typeof e.iv==='string'&&/^[A-Za-z0-9+/]{16}$/.test(e.iv)&&typeof e.data==='string'&&e.data.length>=24&&e.data.length<=limit&&e.data.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(e.data);
}
async function readBody(req,maxBytes=limit){
 const size=Number(req.headers['content-length']||0);
 if(!Number.isFinite(size)||size<0||size>maxBytes)throw Object.assign(Error(),{status:413});
 let total=0,parts=[];
 for await(const part of req){total+=part.length;if(total>maxBytes)throw Object.assign(Error(),{status:413});parts.push(part);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Object.assign(Error(),{status:400});}
}
export async function createRelay({directory,tokens,allowedOrigin,migrationFenceTokens,migrationRollbackTargets}){
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
 // Explicit constructor-only LAB configuration, never enabled by the normal CLI.
 const fenceDigests={};
 if(migrationFenceTokens!==undefined){
  const u=new URL(origin);
  if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!migrationFenceTokens||typeof migrationFenceTokens!=='object'||Array.isArray(migrationFenceTokens)||Object.keys(migrationFenceTokens).some(a=>!areas.includes(a)))throw Error('Migration fencing is loopback LAB only');
  for(const [area,t] of Object.entries(migrationFenceTokens)){
   if(typeof t!=='string'||!tokenPattern.test(t)||all.has(t)||!digests[area].length)throw Error('Configure separate migration fence tokens');
   all.add(t);fenceDigests[area]=hash(t);
  }
 }
 const rollbackTargets={};
 if(migrationRollbackTargets!==undefined){
  if(!migrationRollbackTargets||typeof migrationRollbackTargets!=='object'||Array.isArray(migrationRollbackTargets)||Object.keys(migrationRollbackTargets).some(a=>!areas.includes(a)))throw Error('Invalid rollback targets');
  for(const [area,target] of Object.entries(migrationRollbackTargets)){
   const u=new URL(target?.endpoint);
   if(!fenceDigests[area]||!target||Object.keys(target).sort().join(',')!=='endpoint,token'||u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.origin!==target.endpoint||!u.port||typeof target.token!=='string'||!tokenPattern.test(target.token)||all.has(target.token))throw Error('Configure distinct pinned loopback rollback target');
   all.add(target.token);rollbackTargets[area]={endpoint:u.origin,token:target.token};
  }
 }
 async function verifiedRollbackSeal(area,id){
  const target=rollbackTargets[area];
  if(!target)return false;
  try{
   const r=await fetch(target.endpoint+'/v1/delta/'+area+'/rollback-status',{headers:{Authorization:'Bearer '+target.token},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!r.ok||!r.body)return false;
   const reader=r.body.getReader();let size=0;const parts=[];
   try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();return false;}parts.push(value);}}finally{reader.releaseLock();}
   const v=JSON.parse(Buffer.concat(parts).toString('utf8'));
   return v&&Object.keys(v).sort().join(',')==='revision,seal'&&v.revision===1&&validFence(v.seal,1)&&v.seal.migrationId===id;
  }catch{return false;}
 }
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
  if(Object.hasOwn(data,'fence')&&!validFence(data.fence,data.revision))throw Error('Invalid stored migration fence');
  if(Object.hasOwn(data,'rollback')&&(data.fence||!Number.isSafeInteger(data.rollback?.revision)||data.rollback.revision<1||data.rollback.revision>data.revision||!validFence(data.rollback,data.rollback.revision)))throw Error('Invalid stored migration rollback');
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
   // A normal scoped device may verify an existing freeze without receiving the administrative key.
   const fenceStatus=/^\/v1\/migration-fence-status\/(school|coach)$/.exec(req.url||'');
   if(fenceStatus){
    const area=fenceStatus[1];
    if(req.method==='OPTIONS'){
     if(requestOrigin!==origin){json(res,403,{error:'origin'});return;}
     res.writeHead(204,{'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Authorization','Access-Control-Max-Age':'300','Cache-Control':'no-store'});res.end();return;
    }
    if(!authorize(req,area)){json(res,401,{error:'unauthorized'});return;}
    if(req.method!=='GET'){json(res,405,{error:'method'});return;}
    const current=await serial(area,()=>get(area));
    if(!fenceDigests[area]&&!current.fence){json(res,404,{error:'route'});return;}
    json(res,200,{revision:current.revision,fence:current.fence??null});return;
   }
   const rollbackMatch=/^\/v1\/migration-rollback\/(school|coach)$/.exec(req.url||'');
   if(rollbackMatch){
    const area=rollbackMatch[1],digest=fenceDigests[area];
    if(!digest||!rollbackTargets[area]){json(res,404,{error:'route'});return;}
    if(req.method==='OPTIONS'){
     if(requestOrigin!==origin){json(res,403,{error:'origin'});return;}
     res.writeHead(204,{'Access-Control-Allow-Methods':'PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300','Cache-Control':'no-store'});res.end();return;
    }
    const auth=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization||'');
    if(!auth||!timingSafeEqual(hash(auth[1]),digest)){json(res,401,{error:'unauthorized'});return;}
    if(req.method!=='PUT'){json(res,405,{error:'method'});return;}
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){json(res,415,{error:'content-type'});return;}
    const body=await readBody(req,4096);
    if(!body||Object.keys(body).sort().join(',')!=='expectedRevision,migrationId'||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1||typeof body.migrationId!=='string'||!migrationIdPattern.test(body.migrationId)){json(res,400,{error:'packet'});return;}
    const result=await serial(area,async()=>{
     const current=await get(area);
     if(current.rollback?.migrationId===body.migrationId&&current.rollback.revision===body.expectedRevision)return {status:200,body:{revision:current.revision,fence:null}};
     if(current.revision!==body.expectedRevision||current.fence?.migrationId!==body.migrationId)return {status:409,body:{error:'fence-mismatch'}};
     // The destination address/token are pinned by the operator, never supplied by
     // the requesting device. A permanent seal cannot race with source release.
     if(!await verifiedRollbackSeal(area,body.migrationId))return {status:409,body:{error:'destination-not-sealed'}};
     const {fence,...snapshot}=current;
     await write(area,{...snapshot,rollback:fence});
     return {status:200,body:{revision:current.revision,fence:null}};
    });
    json(res,result.status,result.body);return;
   }
   const fenceMatch=/^\/v1\/migration-fence\/(school|coach)$/.exec(req.url||'');
   if(fenceMatch){
    const area=fenceMatch[1],digest=fenceDigests[area];
    if(!digest){json(res,404,{error:'route'});return;}
    if(req.method==='OPTIONS'){
     if(requestOrigin!==origin){json(res,403,{error:'origin'});return;}
     res.writeHead(204,{'Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300','Cache-Control':'no-store'});res.end();return;
    }
    const auth=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization||'');
    if(!auth||!timingSafeEqual(hash(auth[1]),digest)){json(res,401,{error:'unauthorized'});return;}
    if(req.method==='GET'){
     const state=await serial(area,()=>get(area));json(res,200,{revision:state.revision,fence:state.fence??null});return;
    }
    if(req.method!=='PUT'){json(res,405,{error:'method'});return;}
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){json(res,415,{error:'content-type'});return;}
    const body=await readBody(req,4096);
    if(!body||Object.keys(body).sort().join(',')!=='expectedRevision,migrationId'||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1||typeof body.migrationId!=='string'||!migrationIdPattern.test(body.migrationId)){json(res,400,{error:'packet'});return;}
    const result=await serial(area,async()=>{
     const current=await get(area);
     if(current.rollback)return {status:409,body:{error:'rollback-completed'}};
     if(current.fence){
      if(current.fence.revision===body.expectedRevision&&current.fence.migrationId===body.migrationId)return {status:200,body:{revision:current.revision,fence:current.fence}};
      return {status:423,body:{error:'migration-frozen'}};
     }
     if(current.revision!==body.expectedRevision)return {status:409,body:{error:'stale'}};
     const fence={revision:current.revision,migrationId:body.migrationId};
     // Same serialized, fsynced atomic record as the snapshot, including across restart.
     await write(area,{...current,fence});return {status:200,body:{revision:current.revision,fence}};
    });
    json(res,result.status,result.body);return;
   }
   const match=/^\/v1\/snapshot\/(school|coach)$/.exec(req.url||'');
   if(!match){json(res,404,{error:'route'});return;}
   const area=match[1];
   if(req.method==='OPTIONS'){
    if(requestOrigin!==origin){json(res,403,{error:'origin'});return;}
    res.writeHead(204,{'Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300','Cache-Control':'no-store'});res.end();return;
   }
   if(!authorize(req,area)){json(res,401,{error:'unauthorized'});return;}
   if(req.method==='GET'){const {revision,envelope}=await serial(area,()=>get(area));json(res,200,{revision,envelope});return;}
   if(req.method!=='PUT'){json(res,405,{error:'method'});return;}
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){json(res,415,{error:'content-type'});return;}
   const body=await readBody(req);
   if(!body||Object.keys(body).sort().join(',')!=='envelope,expectedRevision'||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!envelopeValid(body.envelope)){json(res,400,{error:'packet'});return;}
   const result=await serial(area,async()=>{
    const current=await get(area);
    if(current.fence)return {frozen:true};
    if(current.revision!==body.expectedRevision)return null;
    if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('Revision limit');
    const next={revision:current.revision+1,envelope:body.envelope,...(current.rollback?{rollback:current.rollback}:{})};
    await write(area,next);return next;
   });
   if(result?.frozen){json(res,423,{error:'migration-frozen'});return;}
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
