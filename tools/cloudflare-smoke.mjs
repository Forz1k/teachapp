/* Real local Cloudflare workerd, with throwaway synthetic data only. Linux CI. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
import {digestToken,LIMIT} from '../server/cloudflare-protocol.mjs';
import {encryptBackup,decryptBackup} from '../js/privacy.js';
import {relayClient} from '../js/sync.js';
import {createPersonalCode,personalCredentials,personalTokenHashes} from '../js/personal-sync.js';
const origin='https://synthetic.example';
const A='A'.repeat(43),B='B'.repeat(43),C='C'.repeat(43);
const pass='synthetic-cloudflare-password';
const personalCode=createPersonalCode('https://synthetic-worker.example');
const personalSchool=await personalCredentials(personalCode,'school'),personalCoach=await personalCredentials(personalCode,'coach');
const personalHashes=await personalTokenHashes(personalCode);
const hashes={school:[await digestToken(A),await digestToken(B),...personalHashes.school],coach:[await digestToken(C),...personalHashes.coach]};
const state=await mkdtemp(join(tmpdir(),'teachapp-worker-'));
const server=createServer();
await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port;
await new Promise(resolve=>server.close(resolve));
const base='http://127.0.0.1:'+port;
let processHandle=null,output='';
async function start(list){
 output='';
 processHandle=spawn('npx',['--yes','wrangler@4.161.0','dev','--local','--ip','127.0.0.1','--port',String(port),'--persist-to',state,'--var','TEACHAPP_SYNC_ORIGIN:'+origin,'--var','TEACHAPP_SYNC_TOKEN_HASHES:'+JSON.stringify(list)],{env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe'],detached:true});
 processHandle.stdout.on('data',d=>{output=(output+d).slice(-10000);});
 processHandle.stderr.on('data',d=>{output=(output+d).slice(-10000);});
 for(let n=0;n<150;n++){
  if(processHandle.exitCode!==null)throw Error('Wrangler exited: '+output);
  try{const r=await fetch(base+'/healthz',{signal:AbortSignal.timeout(1000)});if(r.status===200)return;}catch{}
  await sleep(500);
 }
 throw Error('Wrangler startup timed out: '+output);
}
async function stop(){
 const p=processHandle;processHandle=null;if(!p||p.exitCode!==null)return;
 const exit=once(p,'exit');
 try{process.kill(-p.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
 await Promise.race([exit,sleep(5000)]);
 if(p.exitCode===null&&p.signalCode===null){try{process.kill(-p.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}await exit;}
}
try{
 await start(hashes);
 const school=relayClient(base,'school',A),other=relayClient(base,'school',B),coach=relayClient(base,'coach',C);
 assert.deepEqual(await school.get(),{revision:0,envelope:null});
 assert.equal((await fetch(base+'/v1/snapshot/school')).status,401);
 assert.equal((await fetch(base+'/v1/snapshot/coach',{headers:{Authorization:'Bearer '+A}})).status,401);
 assert.equal((await fetch(base+'/v1/snapshot/school',{headers:{Origin:'https://wrong.example',Authorization:'Bearer '+A}})).status,403);
 const cors=await fetch(base+'/v1/snapshot/school',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PUT'}});
 assert.equal(cors.status,204);assert.equal(cors.headers.get('Access-Control-Allow-Origin'),origin);
 const envelope=await encryptBackup({sample:'Synthetic test only'},pass);
 const p=await school.put(0,envelope);
 assert.equal(p.revision,1);assert.deepEqual(await decryptBackup(p.envelope,pass),{sample:'Synthetic test only'});
 assert.deepEqual(await other.get(),p);
 assert.deepEqual(await relayClient(base,'school',personalSchool.token).get(),p);
 assert.deepEqual(await relayClient(base,'coach',personalCoach.token).get(),{revision:0,envelope:null});
 await assert.rejects(relayClient(base,'coach',personalSchool.token).get(),/отказал в доступе/);
 assert.deepEqual(await coach.get(),{revision:0,envelope:null});
 await assert.rejects(school.put(0,envelope),/новая ревизия/);
 const races=await Promise.allSettled([school.put(1,envelope),other.put(1,envelope)]);
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(races.filter(r=>r.status==='rejected').length,1);
 const bad=await fetch(base+'/v1/snapshot/school',{method:'PUT',headers:{Authorization:'Bearer '+A,'Content-Type':'application/json'},body:'{"expectedRevision":2,"envelope":{"data":"plaintext"}}'});
 assert.equal(bad.status,400);
 const oversized=await fetch(base+'/v1/snapshot/school',{method:'PUT',headers:{Authorization:'Bearer '+A,'Content-Type':'application/json'},body:'x'.repeat(LIMIT+1)});
 assert.equal(oversized.status,413);
 const snapshot=await other.get();assert.equal(snapshot.revision,2);
 assert.ok(!JSON.stringify(snapshot).includes('Synthetic test only'));
 const {createDeviceInvite,redeemDeviceInvite}=await import('../js/device-invite.js');
 const route=(url,init)=>fetch(base+new URL(url).pathname,init);
 const invitation=await createDeviceInvite(personalCode,route);
 const attempts=await Promise.allSettled([redeemDeviceInvite(invitation,route),redeemDeviceInvite(invitation,route)]);
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(attempts.find(x=>x.status==='fulfilled').value,personalCode);
 const prior=await createDeviceInvite(personalCode,route),newer=await createDeviceInvite(personalCode,route);
 await assert.rejects(redeemDeviceInvite(prior,route),/истёк/);
 assert.equal(await redeemDeviceInvite(newer,route),personalCode);
 console.log('CLOUDFLARE INVITE PASS: encrypted single-use redemption and replacement');
 await stop();await start({school:[hashes.school[1]],coach:hashes.coach});
 await assert.rejects(school.get(),/отказал в доступе/);
 assert.deepEqual(await other.get(),snapshot);
 console.log('CLOUDFLARE PASS: workerd SQLite persistence, real encryption, isolation, CORS, CAS race, oversized packets, restart and token revocation');
}finally{await stop();await rm(state,{recursive:true,force:true});}
