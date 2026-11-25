import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRelay} from '../server/sync-relay.mjs';
import {createServer} from 'node:http';

const origin='http://127.0.0.1:8099',coach='C'.repeat(43),school='S'.repeat(43),admin='F'.repeat(43);
const id='12345678-1234-4000-8000-123456789abc',other='22345678-1234-4000-8000-123456789abc';
const envelope={app:'teachapp-encrypted',version:1,kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:'A'.repeat(22)+'==',iv:'A'.repeat(16),data:'A'.repeat(24)};
async function close(server,dir){
 await new Promise(resolve=>server.close(resolve));
 for(let i=0;i<100;i++){try{await access(join(dir,'.relay-lock'));}catch(e){if(e.code==='ENOENT')return;throw e;}await new Promise(r=>setTimeout(r,10));}
 throw Error('Relay lock not released');
}
test('Node LAB migration fence is scoped, privileged, CAS-serialized, durable and keeps normal GET compatible',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'teachapp-fence-'));let server;
 async function start(enabled=true){
  server=await createRelay({directory:dir,tokens:{coach:[coach],school:[school]},allowedOrigin:origin,...(enabled?{migrationFenceTokens:{coach:admin}}:{})});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 }
 async function request(path,token,body,method=body===undefined?'GET':'PUT'){
  const res=await fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,body:await res.json()};
 }
 const snapshot='/v1/snapshot/coach',fence='/v1/migration-fence/coach',put=(expectedRevision)=>({expectedRevision,envelope}),freeze=(expectedRevision,migrationId=id)=>({expectedRevision,migrationId});
 try{
  await start();
  assert.equal((await request(fence,coach)).status,401);
  assert.equal((await request(snapshot,admin)).status,401);
  assert.equal((await request('/v1/migration-fence/school',admin)).status,404);
  assert.deepEqual(await request(fence,admin),{status:200,body:{revision:0,fence:null}});
  const status='/v1/migration-fence-status/coach';
  assert.deepEqual(await request(status,coach),{status:200,body:{revision:0,fence:null}});
  assert.equal((await request(status,school)).status,401);
  assert.equal((await request(status,admin)).status,401);
  assert.equal((await request(status,coach,freeze(1))).status,405);
  assert.equal((await request(fence,admin,freeze(1))).status,409);
  assert.equal((await request(snapshot,coach,put(0))).status,200);
  assert.equal((await request(fence,admin,freeze(1,'invalid'))).status,400);
  const [w,f]=await Promise.all([request(snapshot,coach,put(1)),request(fence,admin,freeze(1))]);
  assert.ok(w.status===200&&f.status===409||w.status===423&&f.status===200);
  const revision=(await request(snapshot,coach)).body.revision;
  const frozen={revision,fence:{revision,migrationId:id}};
  assert.deepEqual(await request(fence,admin,freeze(revision)),{status:200,body:frozen});
  assert.deepEqual(await request(fence,admin,freeze(revision)),{status:200,body:frozen});
  assert.equal((await request(fence,admin,freeze(revision,other))).status,423);
  assert.equal((await request(fence,admin,undefined,'DELETE')).status,405);
  assert.equal((await request(snapshot,coach,put(revision))).status,423);
  assert.equal((await request(snapshot,coach,put(revision-1))).status,423);
  assert.deepEqual(await request(snapshot,coach),{status:200,body:{revision,envelope}});
  assert.equal((await request('/v1/snapshot/school',school,put(0))).status,200);
  await close(server,dir);server=null;
  await start(false);
  assert.equal((await request(fence,admin)).status,404);
  assert.deepEqual(await request(status,coach),{status:200,body:frozen});
  assert.equal((await request(snapshot,coach,put(revision))).status,423);
  assert.deepEqual(await request(snapshot,coach),{status:200,body:{revision,envelope}});
  assert.equal((await request('/v1/snapshot/school',school,put(1))).status,200);
  await close(server,dir);server=null;
  await start();
  assert.deepEqual(await request(fence,admin),{status:200,body:frozen});
 }finally{if(server)await close(server,dir);await rm(dir,{recursive:true,force:true});}
});
test('fence configuration rejects shared keys, non-loopback origin and cross-scope reuse',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'teachapp-fence-config-'));
 const base={directory:dir,tokens:{coach:[coach],school:[school]},allowedOrigin:origin};
 try{
  await assert.rejects(createRelay({...base,migrationFenceTokens:{coach:coach}}),/separate/);
  await assert.rejects(createRelay({...base,migrationFenceTokens:{coach:admin,school:admin}}),/separate/);
  await assert.rejects(createRelay({...base,allowedOrigin:'https://example.invalid',migrationFenceTokens:{coach:admin}}),/loopback/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('source rollback release requires pinned sealed target, is scoped and survives restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'teachapp-resume-'));let source,target,mode='unsealed',seen=0;
 const readToken='R'.repeat(43);
 const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 async function request(path,token,body){
  const res=await fetch('http://127.0.0.1:'+source.address().port+path,{method:body===undefined?'GET':'PUT',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,body:await res.json()};
 }
 const snapshot='/v1/snapshot/coach',fence='/v1/migration-fence/coach',resume='/v1/migration-rollback/coach',freeze={expectedRevision:1,migrationId:id},put=n=>({expectedRevision:n,envelope});
 try{
  target=createServer((req,res)=>{
   seen++;
   assert.equal(req.url,'/v1/delta/coach/rollback-status');assert.equal(req.headers.authorization,'Bearer '+readToken);
   if(mode==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1:9/'});res.end();return;}
   res.writeHead(200,{'Content-Type':'application/json'});
   res.end(JSON.stringify({revision:mode==='advanced'?2:1,seal:mode==='unsealed'?null:{migrationId:mode==='wrong-id'?other:id,revision:1}}));
  });
  await listen(target);const endpoint='http://127.0.0.1:'+target.address().port;
  const options={directory:dir,tokens:{coach:[coach],school:[school]},allowedOrigin:origin,migrationFenceTokens:{coach:admin},migrationRollbackTargets:{coach:{endpoint,token:readToken}}};
  source=await createRelay(options);await listen(source);
  assert.equal((await request(snapshot,coach,put(0))).status,200);
  assert.equal((await request(fence,admin,freeze)).status,200);
  assert.equal((await request(resume,coach,freeze)).status,401);assert.equal(seen,0);
  assert.equal((await request('/v1/migration-rollback/school',admin,freeze)).status,404);
  for(const m of ['unsealed','wrong-id','advanced','redirect']){
   mode=m;assert.equal((await request(resume,admin,freeze)).status,409);
   assert.equal((await request(snapshot,coach,put(1))).status,423);
  }
  mode='sealed';
  assert.deepEqual(await request(resume,admin,freeze),{status:200,body:{revision:1,fence:null}});
  assert.equal((await request(snapshot,coach,put(1))).status,200);
  await close(source,dir);source=null;
  source=await createRelay(options);await listen(source);
  assert.deepEqual(await request(resume,admin,freeze),{status:200,body:{revision:2,fence:null}});
  assert.equal((await request(fence,admin,{expectedRevision:2,migrationId:other})).status,409);
  assert.equal((await request(snapshot,coach,put(2))).status,200);
  assert.deepEqual(await request(snapshot,coach),{status:200,body:{revision:3,envelope}});
 }finally{if(source)await close(source,dir);if(target)await new Promise(r=>target.close(r));await rm(dir,{recursive:true,force:true});}
});
