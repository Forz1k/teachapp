/* Real local workerd; exclusively synthetic data, no production deployment. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
import {digestToken} from '../server/cloudflare-protocol.mjs';
import {SCHEMA} from '../js/db.js';
import {defaultSettings} from '../js/model.js';
import {BACKUP_VERSION} from '../js/backup.js';
import {encryptBackup,decryptBackup} from '../js/privacy.js';
import {projectScope,buildSyncDelta,replaySyncDeltas,verifySyncSnapshot,syncDeltaEstimate} from '../js/sync.js';

const a='A'.repeat(43),b='B'.repeat(43),c='C'.repeat(43),origin='http://127.0.0.1:8099',area='school',password='synthetic-delta-test-password';
const workspaceId='00000000-0000-4000-8000-000000000001';
const state=await mkdtemp(join(tmpdir(),'teachapp-delta-')),socket=createServer();
await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const endpoint='http://127.0.0.1:'+port;let proc,output='';
async function start(){
 const hashes={school:[await digestToken(a),await digestToken(b)],coach:[await digestToken(c)]};
 proc=spawn('npx',['--yes','wrangler@4.161.0','dev','--config','wrangler.delta-dev.jsonc','--local','--ip','127.0.0.1','--port',String(port),'--persist-to',state,'--var','TEACHAPP_DELTA_SYNTHETIC:true','--var','TEACHAPP_DELTA_ORIGIN:'+origin,'--var','TEACHAPP_DELTA_TOKEN_HASHES:'+JSON.stringify(hashes)],{env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe'],detached:true});
 proc.stdout.on('data',x=>output=(output+x).slice(-8000));proc.stderr.on('data',x=>output=(output+x).slice(-8000));
 for(let i=0;i<150;i++){if(proc.exitCode!==null)throw Error(output);try{if((await fetch(endpoint+'/healthz',{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await sleep(500);}
 throw Error('Startup timeout '+output);
}
async function stop(){
 const p=proc;proc=null;if(!p||p.exitCode!==null)return;const exit=once(p,'exit');
 try{process.kill(-p.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
 await Promise.race([exit,sleep(5000)]);if(p.exitCode===null&&p.signalCode===null){process.kill(-p.pid,'SIGKILL');await exit;}
}
async function call(path,token=a,method='GET',body,scope=area,source=origin){
 const r=await fetch(endpoint+'/v1/delta/'+scope+'/'+path,{method,headers:{Authorization:'Bearer '+token,Origin:source,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 return {status:r.status,...await r.json()};
}
const data=()=>({...Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]])),meta:[defaultSettings()],classes:[{id:'c',name:'7А'}],students:Array.from({length:100},(_,i)=>({id:'s'+i,classId:'c',fullName:'Синтетический ученик '+i,number:i+1}))});
const baseData=data(),base=projectScope(baseData,area);
const anchor=await encryptBackup({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area,workspaceId,revision:1,snapshot:base},password);
const nextData=structuredClone(baseData);nextData.students[0].fullName='Изменённый ученик 🏐';const next=projectScope(nextData,area);
const delta=await encryptBackup(await buildSyncDelta(base,next,{area,workspaceId,baseRevision:1}),password);
const alternative=structuredClone(baseData);alternative.students[1].fullName='Другая версия';const other=projectScope(alternative,area);
const competing=await encryptBackup(await buildSyncDelta(base,other,{area,workspaceId,baseRevision:1}),password);
try{
 await start();
 assert.equal((await call('head')).revision,0);assert.equal((await call('revision/1')).status,404);
 assert.equal((await call('head',c)).status,401);assert.equal((await call('head',a,'GET',undefined,'coach')).status,401);
 assert.equal((await call('head',a,'GET',undefined,area,'https://wrong.example')).status,403);
 assert.equal((await call('append',a,'PUT',{expectedRevision:0,envelope:delta})).status,409);
 const initialized=await call('anchor',a,'PUT',{expectedRevision:0,envelope:anchor});assert.equal(initialized.status,201);assert.equal(initialized.revision,1);
 assert.deepEqual(await call('anchor',b,'PUT',{expectedRevision:0,envelope:anchor}),{status:200,revision:1,replayed:true});
 assert.equal((await call('anchor',a,'PUT',{expectedRevision:1,envelope:anchor})).status,409);
 const race=await Promise.all([call('append',a,'PUT',{expectedRevision:1,envelope:delta}),call('append',b,'PUT',{expectedRevision:1,envelope:competing})]);
 assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);
 const winning=race[0].status===201?delta:competing,expected=race[0].status===201?next:other;
 assert.deepEqual(await call('append',b,'PUT',{expectedRevision:1,envelope:winning}),{status:200,revision:2,replayed:true});
 const latestData=structuredClone(baseData);latestData.students=structuredClone(expected.students);latestData.students=latestData.students.filter(s=>s.id!=='s99');
 const latest=projectScope(latestData,area),third=await encryptBackup(await buildSyncDelta(expected,latest,{area,workspaceId,baseRevision:2}),password);
 assert.equal((await call('append',b,'PUT',{expectedRevision:2,envelope:third})).status,201);
 assert.equal((await call('append',a,'PUT',{expectedRevision:3,envelope:{...third,data:'A'.repeat(1024*1024)}})).status,413);
 assert.equal((await call('append',a,'PUT',{expectedRevision:3,envelope:{...third,unexpected:'x'}})).status,400);
 assert.equal((await call('head',c,'GET',undefined,'coach')).revision,0);
 await stop();await start();
 const head=await call('head',b);assert.equal(head.revision,3);assert.equal(head.anchorRevision,1);assert.equal(head.count,3);
 const first=await call('revision/1',b);assert.equal(first.kind,'anchor');await verifySyncSnapshot({revision:1,envelope:first.envelope},password,area);
 const initial=await decryptBackup(first.envelope,password);assert.equal(initial.workspaceId,workspaceId);
 const entries=[];for(let i=2;i<=head.revision;i++){const row=await call('revision/'+i,b);assert.equal(row.kind,'delta');entries.push({revision:row.revision,envelope:row.envelope});}
 const reconstructed=await replaySyncDeltas({base:initial.snapshot,baseRevision:1,area,workspaceId,entries,password,current:baseData});
 assert.deepEqual(reconstructed.snapshot,latest);assert.equal(reconstructed.revision,3);
 await assert.rejects(replaySyncDeltas({base:initial.snapshot,baseRevision:1,area,workspaceId,entries,password:'wrong-password-for-test',current:baseData}),/неверный пароль/);
 const sizes=syncDeltaEstimate(base,next,{area,workspaceId,baseRevision:1});assert.ok(sizes.bytes<sizes.fullBytes);
 console.log('DELTA SIZE '+JSON.stringify(sizes));
 console.log('DELTA WORKER PASS: real workerd, opaque encrypted anchor and deltas, two scoped devices, CAS race and exact retry, bounds, isolation, restart persistence and verified reconstruction');
}finally{await stop();await rm(state,{recursive:true,force:true});}
