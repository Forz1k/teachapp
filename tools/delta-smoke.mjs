/* Real local workerd; exclusively synthetic data, no production deployment. */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer as httpServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
import {digestToken} from '../server/cloudflare-protocol.mjs';
import {createRelay} from '../server/sync-relay.mjs';
import 'fake-indexeddb/auto';
import * as db from '../js/db.js';
import {SCHEMA} from '../js/db.js';
import {defaultSettings} from '../js/model.js';
import {BACKUP_VERSION} from '../js/backup.js';
import {encryptBackup,decryptBackup} from '../js/privacy.js';
import {splitDeltaAnchor} from '../js/delta-anchor.js';
import {projectScope,buildSyncDelta,replaySyncDeltas,verifySyncSnapshot,syncDeltaEstimate,deltaLabClient,readDeltaLab,compactDeltaLab,mergeScopes,deltaLabSyncAdapter,prepareSync,executeSync,previewSync,prepareDeltaRotation,openDeltaRecovery,commitDeltaRotation,createDeltaDeviceRecovery,openDeltaDeviceRecovery,rebindDeltaDevice,relayClient,deltaMigrationFenceClient,deltaMigrationFenceStatus,cutoverDeltaMigrationDevice,sealDeltaMigrationRollback,rollbackDeltaMigrationDevice,prepareDeltaMigration,openDeltaMigration,inspectDeltaMigrationDevice,commitDeltaMigration} from '../js/sync.js';

const a='A'.repeat(43),b='B'.repeat(43),c='C'.repeat(43),admin='D'.repeat(43),coachAdmin='E'.repeat(43),rotator='F'.repeat(43),coachRotator='G'.repeat(43),sealKey='K'.repeat(43),coachSealKey='L'.repeat(43),area='school',password='synthetic-delta-test-password';
const workspaceId='00000000-0000-4000-8000-000000000001';
const webRoot=process.cwd(),site=httpServer(async(req,res)=>{try{const u=new URL(req.url,'http://127.0.0.1'),path=resolve(webRoot,'.'+decodeURIComponent(u.pathname));if(!path.startsWith(webRoot+sep))throw Error();const bytes=await readFile(path);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);}catch{if(!res.headersSent)res.writeHead(404);res.end();}});
await new Promise(r=>site.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+site.address().port;
const state=await mkdtemp(join(tmpdir(),'teachapp-delta-')),socket=createServer();
await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const endpoint='http://127.0.0.1:'+port;let proc,output='',workerState=join(state,'primary');
async function start(){
 const hashes={school:[await digestToken(a),await digestToken(b)],coach:[await digestToken(c)]};
 proc=spawn('npx',['--yes','wrangler@4.161.0','dev','--config','wrangler.delta-dev.jsonc','--local','--ip','127.0.0.1','--port',String(port),'--persist-to',workerState,'--var','TEACHAPP_DELTA_SYNTHETIC:true','--var','TEACHAPP_DELTA_ORIGIN:'+origin,'--var','TEACHAPP_DELTA_TOKEN_HASHES:'+JSON.stringify(hashes),'--var','TEACHAPP_DELTA_COMPACT_HASHES:'+JSON.stringify({school:await digestToken(admin),coach:await digestToken(coachAdmin)}),'--var','TEACHAPP_DELTA_ROTATE_HASHES:'+JSON.stringify({school:await digestToken(rotator),coach:await digestToken(coachRotator)}),'--var','TEACHAPP_DELTA_SEAL_HASHES:'+JSON.stringify({school:await digestToken(sealKey),coach:await digestToken(coachSealKey)})],{env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe'],detached:true});
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
 assert.equal((await call('rollback-seal',a,'PUT',{expectedRevision:1,migrationId:workspaceId})).status,401);
 assert.equal((await call('rollback-seal',sealKey,'PUT',{expectedRevision:1,migrationId:workspaceId})).status,409);
 assert.equal((await call('rollback-status',a)).seal,null);
 await stop();await start();
 const head=await call('head',b);assert.equal(head.revision,3);assert.equal(head.anchorRevision,1);assert.equal(head.count,3);
 const first=await call('revision/1',b);assert.equal(first.kind,'anchor');await verifySyncSnapshot({revision:1,envelope:first.envelope},password,area);
 const initial=await decryptBackup(first.envelope,password);assert.equal(initial.workspaceId,workspaceId);
 const entries=[];for(let i=2;i<=head.revision;i++){const row=await call('revision/'+i,b);assert.equal(row.kind,'delta');entries.push({revision:row.revision,envelope:row.envelope});}
 const reconstructed=await replaySyncDeltas({base:initial.snapshot,baseRevision:1,area,workspaceId,entries,password,current:baseData});
 assert.deepEqual(reconstructed.snapshot,latest);assert.equal(reconstructed.revision,3);
 await assert.rejects(replaySyncDeltas({base:initial.snapshot,baseRevision:1,area,workspaceId,entries,password:'wrong-password-for-test',current:baseData}),/неверный пароль/);
 // The old checkpoint remains separate from dirty local edits.
 const client=deltaLabClient(endpoint,area,a,{compactToken:admin}),otherClient=deltaLabClient(endpoint,area,b);
 const params={client,area,password,current:baseData},known={revision:3,workspaceId,snapshot:latest};
 const requested=[],tracking={head:()=>client.head(),getRevision:rev=>{requested.push(rev);return client.getRevision(rev);}};
 assert.deepEqual((await readDeltaLab({...params,client:tracking,checkpoint:known})).snapshot,latest);
 assert.deepEqual(requested,[3]);requested.length=0;
 assert.deepEqual((await readDeltaLab({...params,client:tracking,checkpoint:{revision:2,workspaceId,snapshot:expected}})).snapshot,latest);
 assert.deepEqual(requested,[2,3]);
 await assert.rejects(readDeltaLab({...params,checkpoint:{...known,snapshot:base}}),/ранее принятой/);
 await assert.rejects(compactDeltaLab({...params,expectedRevision:3}),/Подтвердите/);
 await assert.rejects(compactDeltaLab({...params,expectedRevision:2,confirmed:true}),/История изменилась/);
 const compactEnvelope=await encryptBackup({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area,workspaceId,revision:4,snapshot:latest},password);
 assert.equal((await call('compact',a,'PUT',{expectedRevision:3,envelope:compactEnvelope})).status,401);
 assert.equal((await call('head',admin)).status,401);
 assert.equal((await call('compact',admin,'PUT',{expectedRevision:3,envelope:compactEnvelope},'coach')).status,401);
 // Race an actual delta against compaction; both use the same expected revision.
 const updatedData=structuredClone(latestData);updatedData.students[0].fullName='После гонки';const updated=projectScope(updatedData,area);
 const fourth=await encryptBackup(await buildSyncDelta(latest,updated,{area,workspaceId,baseRevision:3}),password);
 const race2=await Promise.all([call('compact',admin,'PUT',{expectedRevision:3,envelope:compactEnvelope}),call('append',b,'PUT',{expectedRevision:3,envelope:fourth})]);
 assert.deepEqual(race2.map(x=>x.status).sort(),[201,409]);
 let compacted,finalSnapshot;
 if(race2[0].status===201){
  compacted={revision:4,envelope:compactEnvelope};finalSnapshot=latest;
 }else{
  finalSnapshot=updated;
  // Local data is deliberately different; compaction must use remote state.
  const dirty=structuredClone(baseData);dirty.students[2].fullName='Локальное изменение';
  compacted=await compactDeltaLab({...params,current:dirty,checkpoint:known,expectedRevision:4,confirmed:true});
  assert.deepEqual(compacted.snapshot,updated);
 }
 assert.deepEqual(await call('compact',admin,'PUT',{expectedRevision:compacted.revision-1,envelope:compacted.envelope}),{status:200,revision:compacted.revision,replayed:true});
 const compactHead=await client.head();assert.equal(compactHead.count,1);assert.equal(compactHead.anchorRevision,compacted.revision);
 assert.equal((await call('revision/1')).status,410);
 assert.equal((await call('revision/'+(compacted.revision+1))).status,404);
 assert.equal((await call('append',b,'PUT',{expectedRevision:3,envelope:fourth})).status,409);
 const fresh=await readDeltaLab({...params,client:otherClient});assert.deepEqual(fresh.snapshot,finalSnapshot);
 const stale=await readDeltaLab({...params,client:otherClient,checkpoint:{revision:1,workspaceId,snapshot:base}});
 assert.equal(stale.compactedPastCheckpoint,true);assert.deepEqual(stale.snapshot,finalSnapshot);
 const local=structuredClone(baseData);local.students[2].fullName='Локальное изменение';
 const merged=mergeScopes(base,projectScope(local,area),stale.snapshot,area);
 assert.equal(merged.conflicts.length,0);assert.equal(merged.snapshot.students.find(s=>s.id==='s2').fullName,'Локальное изменение');
 const afterData={...structuredClone(baseData),students:structuredClone(finalSnapshot.students)};afterData.students[3].fullName='Новая запись';
 const after=projectScope(afterData,area),later=await encryptBackup(await buildSyncDelta(finalSnapshot,after,{area,workspaceId,baseRevision:compacted.revision}),password);
 assert.equal((await otherClient.append(compacted.revision,later)).revision,compacted.revision+1);
 await stop();await start();
 const persisted=await readDeltaLab({...params,client:otherClient});assert.deepEqual(persisted.snapshot,after);assert.equal(persisted.revision,compacted.revision+1);
 assert.equal((await client.head()).count,2);
 // Simulate compaction during a reader's old-head traversal: a typed 410 restarts at the new anchor.
 let calls=0;
 const racingClient={head:async()=>++calls===1?head:client.head(),getRevision:rev=>client.getRevision(rev)};
 assert.deepEqual((await readDeltaLab({...params,client:racingClient})).snapshot,after);assert.equal(calls,2);
 console.log('DELTA COMPACTION PASS: separate privilege, CAS race, exact retry, stale-reader restart, stale checkpoint merge, post-compaction append and durable fresh-device recovery');

 // Use the same actual prepare/preview/execute functions as the ordinary app,
 // but two synthetic IndexedDB snapshots and an isolated laboratory transport.
 const freshDb=()=>({...Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]])),meta:[defaultSettings()]});
 const adapter=(token,options={})=>deltaLabSyncAdapter({endpoint,area,token,password,readData:()=>db.dumpAll(),synthetic:true,...options});
 const syncArgs={endpoint,area,password};
 const exchange=async(client,choices={})=>executeSync({plan:await prepareSync({...syncArgs,client}),choices,password,client,confirmed:true,reuseRemote:true});
 const devA=adapter(a),devB=adapter(b);
 await db.replaceAll(freshDb());
 const joinedA=await exchange(devA);assert.equal(joinedA.revision,persisted.revision);
 let localA=await db.dumpAll();assert.deepEqual(projectScope(localA,area),after);
 await db.replaceAll(freshDb());
 const joinedB=await exchange(devB);assert.equal(joinedB.revision,persisted.revision);
 let localB=await db.dumpAll();assert.equal((await client.head()).revision,persisted.revision);
 // Independent offline edits merge; only changed records travel in each PUT.
 await db.replaceAll(localA);await db.put('students',{...await db.get('students','s4'),fullName:'Изменение устройства A'});
 const sentA=await exchange(devA);assert.equal(sentA.revision,persisted.revision+1);
 localA=await db.dumpAll();
 const deltaA=await client.getRevision(sentA.revision),decodedA=await decryptBackup(deltaA.envelope,password);
 assert.equal(deltaA.kind,'delta');assert.deepEqual(decodedA.changes.students.upserts.map(x=>x.id),['s4']);
 await db.replaceAll(localB);await db.put('students',{...await db.get('students','s5'),fullName:'Изменение устройства B'});
 const sentB=await exchange(devB);assert.equal(sentB.revision,sentA.revision+1);
 assert.equal((await db.get('students','s4')).fullName,'Изменение устройства A');
 const deltaB=await client.getRevision(sentB.revision),decodedB=await decryptBackup(deltaB.envelope,password);
 assert.deepEqual(decodedB.changes.students.upserts.map(x=>x.id),['s5']);
 localB=await db.dumpAll();await db.replaceAll(localA);assert.equal((await exchange(devA)).revision,sentB.revision);
 assert.equal((await db.get('students','s5')).fullName,'Изменение устройства B');
 localA=await db.dumpAll();
 // Compaction with a verified snapshot, while the other device is offline.
 const latestRemote=await readDeltaLab({...params,current:localA});
 const compactedAgain=await compactDeltaLab({...params,current:localA,checkpoint:{revision:latestRemote.revision,workspaceId:latestRemote.workspaceId,snapshot:latestRemote.snapshot},expectedRevision:latestRemote.revision,confirmed:true});
 assert.equal((await client.head()).count,1);
 await db.replaceAll(localB);await db.put('students',{...await db.get('students','s6'),fullName:'Несинхронизированное изменение'});
 await assert.rejects(prepareSync({...syncArgs,client:devB}),/История уплотнена/);
 assert.equal((await db.get('students','s6')).fullName,'Несинхронизированное изменение');
 const agreed=adapter(b,{acceptCompactedHistory:true});
 const accepted=await exchange(agreed);assert.equal(accepted.revision,compactedAgain.revision+1);
 assert.equal((await db.get('students','s4')).fullName,'Изменение устройства A');
 assert.equal((await db.get('students','s6')).fullName,'Несинхронизированное изменение');
 localB=await db.dumpAll();
 // Conflicting edits are not silently overwritten; explicit existing merge choices.
 await db.replaceAll(localA);const agreedA=adapter(a,{acceptCompactedHistory:true});await exchange(agreedA);
 await db.put('students',{...await db.get('students','s7'),fullName:'Конфликт A'});
 const conflictA=await exchange(agreedA);
 await db.replaceAll(localB);await db.put('students',{...await db.get('students','s7'),fullName:'Конфликт B'});
 const plan=await prepareSync({...syncArgs,client:agreed});
 assert.equal(plan.conflicts.length,1);assert.equal(plan.conflicts[0].store,'students');
 await assert.rejects(executeSync({plan,choices:{},password,client:agreed,confirmed:true,reuseRemote:true}),/конфликт/);
 assert.equal((await client.head()).revision,conflictA.revision);
 const choices={[plan.conflicts[0].key]:'remote'};
 assert.equal(previewSync(await db.dumpAll(),plan,choices).conflicts.length,0);
 assert.equal((await executeSync({plan,choices,password,client:agreed,confirmed:true,reuseRemote:true})).revision,conflictA.revision);
 assert.equal((await db.get('students','s7')).fullName,'Конфликт A');
 assert.equal((await client.head()).revision,conflictA.revision);
 console.log('DELTA SYNC INTEGRATION PASS: actual IndexedDB prepare/preview/execute, independent device edits, delta-only PUT, pull without revision churn, explicit compacted-history review and conflict resolution');
 // Large initial anchor, staged parts invisible until atomic commit; real
 // persisted chunk rows survive a worker restart and privileged compaction.
 const largeData=freshDb();largeData.coachTeams=Array.from({length:3500},(_,i)=>({id:'large-team-'+i,name:'Синтетическая команда '+i+' '+('Т'.repeat(160)),archived:false}));
 const scope='coach',large=projectScope(largeData,scope);
 const largeAnchor=await encryptBackup({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area:scope,workspaceId,revision:1,snapshot:large},password);
 assert.ok(new TextEncoder().encode(JSON.stringify({expectedRevision:0,envelope:largeAnchor})).length>1024*1024);
 const split=await splitDeltaAnchor(largeAnchor),prefix='multipart/anchor/'+split.uploadId+'/';
 const request=(path,method='GET',body,token=c)=>call(path,token,method,body,scope);
 assert.equal((await request(prefix+'begin','PUT',{manifest:split.manifest},a)).status,401);
 assert.equal((await request(prefix+'begin','PUT',{manifest:split.manifest},coachAdmin)).status,401);
 assert.equal((await request(prefix+'begin','PUT',{manifest:split.manifest})).status,201);
 assert.equal((await request(prefix+'part/0','PUT',{data:split.chunks[0]})).status,201);
 assert.equal((await request(prefix+'part/0','PUT',{data:split.chunks[0]})).replayed,true);
 assert.equal((await request(prefix+'part/0','PUT',{data:'A'.repeat(split.chunks[0].length)})).status,400);
 assert.equal((await request(prefix+'commit','PUT',{})).status,409);
 assert.equal((await request('head')).revision,0);
 assert.equal((await request('revision/1/part/0')).status,404);
 await stop();await start();
 // Same ciphertext resumes staged upload, not a second revision.
 const coachClient=deltaLabClient(endpoint,scope,c,{compactToken:coachAdmin});
 assert.deepEqual(await coachClient.anchor(largeAnchor),{revision:1,replayed:false});
 assert.deepEqual(await coachClient.anchor(largeAnchor),{revision:1,replayed:true});
 assert.deepEqual((await readDeltaLab({client:coachClient,area:scope,password,current:freshDb()})).snapshot,large);
 const largeNext=structuredClone(largeData);largeNext.coachTeams[0].name='Изменение большой базы';
 const nextLarge=projectScope(largeNext,scope),largeDelta=await encryptBackup(await buildSyncDelta(large,nextLarge,{area:scope,workspaceId,baseRevision:1}),password);
 assert.equal((await coachClient.append(1,largeDelta)).revision,2);
 const compEnvelope=await encryptBackup({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area:scope,workspaceId,revision:3,snapshot:nextLarge},password);
 const comp=await splitDeltaAnchor(compEnvelope,{kind:'compact',expectedRevision:2});
 assert.equal((await request('multipart/compact/'+comp.uploadId+'/begin','PUT',{manifest:comp.manifest})).status,401);
 const compactedLarge=await compactDeltaLab({client:coachClient,area:scope,password,current:freshDb(),expectedRevision:2,confirmed:true});
 assert.equal(compactedLarge.revision,3);assert.equal((await coachClient.head()).count,1);
 assert.equal((await request('revision/1/part/0')).status,410);
 await stop();await start();
 const recoveredLarge=await readDeltaLab({client:coachClient,area:scope,password,current:freshDb()});
 assert.deepEqual(recoveredLarge.snapshot,nextLarge);assert.equal(recoveredLarge.revision,3);
 const largeAfter=structuredClone(largeNext);largeAfter.coachTeams[1].name='После компактизации';
 const afterLarge=projectScope(largeAfter,scope),afterDelta=await encryptBackup(await buildSyncDelta(nextLarge,afterLarge,{area:scope,workspaceId,baseRevision:3}),password);
 assert.equal((await coachClient.append(3,afterDelta)).revision,4);
 assert.deepEqual((await readDeltaLab({client:coachClient,area:scope,password,current:freshDb()})).snapshot,afterLarge);
 console.log('DELTA MULTIPART PASS: '+split.chunks.length+' parts, '+largeAnchor.data.length+' ciphertext characters; staged invisibility, exact retry, auth separation, restart/resume, atomic compaction, old part removal and post-compaction delta.');
 // Rotate the large coach anchor after compaction and a subsequent delta.
 // Save an old authenticated checkpoint on a separate offline device at rev 3.
 await db.replaceAll(freshDb());
 const offlineAdapter=deltaLabSyncAdapter({endpoint,area:scope,token:c,password,synthetic:true,readData:()=>db.dumpAll()});
 // Rev 4 is current; join with the genuine old encrypted rev-3 checkpoint
 // obtained from the retained compaction anchor, not with a guessed base.
 const oldRow=await coachClient.getRevision(3);
 const offlineState={...freshDb(),coachTeams:structuredClone(nextLarge.coachTeams)};
 offlineState.meta.push({id:'sync-checkpoint-'+scope,endpoint,workspaceId,revision:3,envelope:oldRow.envelope});
 await db.replaceAll(offlineState);
 await db.put('coachTeams',{...await db.get('coachTeams','large-team-3'),name:'Локальное изменение офлайн'});
 await db.put('coachTeams',{...await db.get('coachTeams','large-team-1'),name:'Конфликт офлайн'});
 // Independent school data must survive rebind.
 await db.put('classes',{id:'offline-school',name:'8А'});
 const beforeRebind=await db.dumpAll();
 const recoveryPassword='synthetic-separate-recovery-password';
 const rotateClient=deltaLabClient(endpoint,scope,c,{compactToken:coachAdmin,rotateToken:coachRotator});
 const args={endpoint,client:rotateClient,area:scope,password,current:freshDb(),recoveryPassword,synthetic:true};
 const prepared=await prepareDeltaRotation({...args,expectedRevision:4});
 const opened=await openDeltaRecovery({...args,recovery:prepared.recovery});
 assert.deepEqual(opened.snapshot,afterLarge);
 const rotateArgs={...args,recovery:prepared.recovery,confirmed:true,backupVerified:true};
 await assert.rejects(commitDeltaRotation({...rotateArgs,backupVerified:false}));
 await assert.rejects(openDeltaRecovery({...args,recovery:prepared.recovery,recoveryPassword:'incorrect-recovery-password'}));
 const rotation=await splitDeltaAnchor(opened.envelope,{kind:'rotate',expectedRevision:4,rotation:opened.rotation}),rp='multipart/rotate/'+rotation.uploadId+'/';
 assert.equal((await request(rp+'begin','PUT',{manifest:rotation.manifest})).status,401);
 assert.equal((await request(rp+'begin','PUT',{manifest:rotation.manifest},coachAdmin)).status,401);
 assert.equal((await request(rp+'begin','PUT',{manifest:rotation.manifest},coachRotator)).status,201);
 assert.equal((await request(rp+'part/0','PUT',{data:rotation.chunks[0]},coachRotator)).status,201);
 assert.equal((await request(rp+'commit','PUT',{},coachRotator)).status,409);
 assert.equal((await coachClient.head()).revision,4);
 await stop();await start();
 const rotated=await commitDeltaRotation(rotateArgs);assert.deepEqual(rotated,{revision:5,replayed:false});
 assert.deepEqual(await commitDeltaRotation(rotateArgs),{revision:5,replayed:true});
 assert.equal((await request('head')).status,401);
 assert.equal((await request('append','PUT',{expectedRevision:5,envelope:afterDelta})).status,401);
 assert.equal((await request('compact','PUT',{expectedRevision:5,envelope:largeDelta},coachAdmin)).status,401);
 assert.equal((await request('head','GET',undefined,coachRotator)).status,401);
 const freshClient=deltaLabClient(endpoint,scope,opened.readTokens[0],{compactToken:opened.compactToken});
 const secondClient=deltaLabClient(endpoint,scope,opened.readTokens[1]);
 assert.equal((await freshClient.head()).keyEpoch,1);
 assert.equal((await request('revision/4','GET',undefined,opened.readTokens[0])).status,410);
 await assert.rejects(readDeltaLab({client:freshClient,area:scope,password,current:freshDb()}),/неверный пароль/);
 assert.deepEqual((await readDeltaLab({client:secondClient,area:scope,password:opened.newPassword,current:freshDb()})).snapshot,afterLarge);
 const nextRotated=structuredClone(largeAfter);nextRotated.coachTeams[2].name='После ротации';
 const rotatedScope=projectScope(nextRotated,scope),rotatedDelta=await encryptBackup(await buildSyncDelta(afterLarge,rotatedScope,{area:scope,workspaceId,baseRevision:5}),opened.newPassword);
 assert.equal((await freshClient.append(5,rotatedDelta)).revision,6);
 await stop();await start();
 assert.deepEqual((await readDeltaLab({client:secondClient,area:scope,password:opened.newPassword,current:freshDb()})).snapshot,rotatedScope);
 assert.equal((await request('head')).status,401);assert.equal((await client.head()).revision,conflictA.revision);
 console.log('DELTA ROTATION PASS: large encrypted recovery, atomic new anchor and token replacement, old password and tokens rejected, exact retry, restart, new delta and independent school scope.');
 // Re-enrol the offline device with a narrowly scoped encrypted file.
 const devicePassword='synthetic-device-file-password';
 const deviceFile=await createDeltaDeviceRecovery({...rotateArgs,index:1,devicePassword});
 const deviceArgs={endpoint,area:scope,file:deviceFile,devicePassword,oldPassword:password,synthetic:true};
 const device=await openDeltaDeviceRecovery(deviceArgs);
 assert.equal(device.token,opened.readTokens[1]);assert.equal(device.password,opened.newPassword);
 assert.ok(!Object.hasOwn(device,'compactToken')&&!Object.hasOwn(device,'readTokens')&&!Object.hasOwn(device,'rotateToken'));
 await assert.rejects(openDeltaDeviceRecovery({...deviceArgs,area:'school'}));
 await assert.rejects(rebindDeltaDevice({...deviceArgs,oldPassword:'incorrect-old-password'}));
 await assert.rejects(prepareSync({area:scope,endpoint,password,client:offlineAdapter}));
 assert.deepEqual(await db.dumpAll(),beforeRebind);
 const review=await rebindDeltaDevice(deviceArgs);
 assert.equal(review.status,'preview');assert.equal(review.historicalBase,true);assert.equal(review.localRevision,3);assert.equal(review.remoteRevision,6);assert.equal(review.conflicts,1);
 assert.deepEqual(await db.dumpAll(),beforeRebind);
 const confirmedRebind={...deviceArgs,confirmed:true,expectedRemoteRevision:review.remoteRevision,expectedLocalRevision:review.localRevision};
 await assert.rejects(rebindDeltaDevice(confirmedRebind),/явного согласования/);
 await assert.rejects(rebindDeltaDevice({...confirmedRebind,expectedRemoteRevision:5,acceptHistoricalBase:true}),/Ревизии изменились/);
 assert.deepEqual(await db.dumpAll(),beforeRebind);
 const rebound=await rebindDeltaDevice({...confirmedRebind,acceptHistoricalBase:true});assert.equal(rebound.status,'rebound');
 const afterRebind=await db.dumpAll();
 assert.deepEqual(projectScope(afterRebind,scope),projectScope(beforeRebind,scope));assert.deepEqual(afterRebind.classes,beforeRebind.classes);
 const cp=afterRebind.meta.find(r=>r.id==='sync-checkpoint-'+scope);
 assert.equal(cp.revision,3);assert.deepEqual((await decryptBackup(cp.envelope,device.password)).snapshot,nextLarge);
 await assert.rejects(decryptBackup(cp.envelope,password));
 const newOptions={endpoint,area:scope,token:device.token,password:device.password,synthetic:true,readData:()=>db.dumpAll()};
 await assert.rejects(prepareSync({...newOptions,client:deltaLabSyncAdapter(newOptions)}),/История уплотнена/);
 const newAdapter=deltaLabSyncAdapter({...newOptions,acceptCompactedHistory:true});
 const rejoin=await prepareSync({...newOptions,client:newAdapter});assert.equal(rejoin.conflicts.length,1);
 const conflictChoices={[rejoin.conflicts[0].key]:'remote'};
 await assert.rejects(executeSync({plan:rejoin,choices:{},password:device.password,client:newAdapter,confirmed:true,reuseRemote:true}),/конфликт/);
 assert.equal((await secondClient.head()).revision,6);
 assert.equal((await executeSync({plan:rejoin,choices:conflictChoices,password:device.password,client:newAdapter,confirmed:true,reuseRemote:true})).revision,7);
 assert.equal((await db.get('coachTeams','large-team-3')).name,'Локальное изменение офлайн');
 assert.equal((await db.get('coachTeams','large-team-1')).name,'После компактизации');
 assert.equal((await db.get('coachTeams','large-team-2')).name,'После ротации');
 assert.ok(await db.get('classes','offline-school'));
 assert.deepEqual((await readDeltaLab({client:secondClient,area:scope,password:device.password,current:await db.dumpAll()})).snapshot,projectScope(await db.dumpAll(),scope));
 console.log('DELTA DEVICE REBIND PASS: scoped encrypted device file, old checkpoint re-encrypted only after explicit review, offline edit preserved, conflict choice, new remote edits, school isolation, verified merged revision.');
 // Browser workflow on school contour. No ordinary DB storage is opened.
 const binary=['google-chrome','google-chrome-stable','chromium','chromium-browser'].map(x=>spawnSync('which',[x],{encoding:'utf8'})).find(r=>r.status===0)?.stdout.trim();assert.ok(binary,'Chromium required');
 const browser=await chromium.launch({executablePath:binary,args:['--no-sandbox']});
 try{
  const errors=[],ownerContext=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),ownerPage=await ownerContext.newPage();
  ownerPage.on('pageerror',e=>errors.push(e.message));
  await ownerPage.goto(origin+'/delta-dev/index.html');
  const fill=async(label,v)=>ownerPage.getByLabel(label,{exact:true}).fill(v);
  const click=async name=>ownerPage.getByRole('button',{name,exact:true}).click();
  await fill('Адрес тестового Worker',endpoint);await fill('Ключ доступа',a);await fill('Пароль шифрования',password);await fill('Ключ компактизации',admin);await fill('Ключ ротации',rotator);
  await ownerPage.getByLabel('Подтверждаю: только синтетические данные',{exact:true}).check();
  await click('Подключиться');await ownerPage.getByRole('heading',{name:'Диагностика · Школа'}).waitFor();
  await click('Проверить зашифрованный снимок');await ownerPage.getByText(/Снимок проверен · записей/).waitFor();
  await fill('Пароль файла владельца','browser-owner-recovery-password');await click('Подготовить ротацию');await ownerPage.getByRole('heading',{name:'Подготовленная ротация'}).waitFor();
  assert.equal((await client.head()).revision,conflictA.revision);
  const ownerDownload=ownerPage.waitForEvent('download');await click('Скачать файл владельца');const ownerFile=await ownerDownload,ownerPath=await ownerFile.path();
  await click('Сменить ключи');await ownerPage.getByText('Сначала проверьте файл и подтвердите отзыв',{exact:true}).waitFor();
  assert.equal((await client.head()).revision,conflictA.revision);
  await ownerPage.getByLabel('Сохранённый файл владельца',{exact:true}).setInputFiles(ownerPath);
  await click('Проверить сохранённый файл');await ownerPage.getByText('Сохранённый файл проверен',{exact:true}).waitFor();
  await ownerPage.getByLabel('Я сохранил и проверил файл; понимаю, что старые ключи будут отозваны',{exact:true}).check();
  await click('Сменить ключи');await ownerPage.getByRole('heading',{name:'Файлы устройств'}).waitFor();
  assert.equal((await call('head')).status,401);
  await ownerPage.getByLabel('Устройство',{exact:true}).selectOption('1');await fill('Пароль файла устройства','browser-device-recovery-password');
  const deviceDownload=ownerPage.waitForEvent('download');await click('Скачать файл устройства');const devicePath=await (await deviceDownload).path();
  const deviceContext=await browser.newContext({viewport:{width:390,height:844}}),devicePage=await deviceContext.newPage();devicePage.on('pageerror',e=>errors.push(e.message));
  await devicePage.goto(origin+'/delta-dev/index.html');
  await devicePage.getByLabel('Адрес тестового Worker',{exact:true}).fill(endpoint);await devicePage.getByLabel('Подтверждаю: только синтетические данные',{exact:true}).check();
  await devicePage.getByLabel('Файл восстановления',{exact:true}).setInputFiles(devicePath);await devicePage.getByLabel('Пароль файла',{exact:true}).fill('browser-device-recovery-password');
  await devicePage.getByRole('button',{name:'Войти по файлу',exact:true}).click();await devicePage.getByRole('heading',{name:'Диагностика · Школа'}).waitFor();
  await devicePage.getByRole('button',{name:'Проверить зашифрованный снимок',exact:true}).click();await devicePage.getByText(/Снимок проверен · записей/).waitFor();
  assert.equal(await devicePage.getByRole('heading',{name:'Смена ключей'}).count(),0);assert.equal(await devicePage.getByRole('heading',{name:'Уплотнение истории'}).count(),0);
  assert.ok(await devicePage.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=2));
  for(const page of [ownerPage,devicePage])assert.deepEqual(await page.evaluate(async()=>[localStorage.length,sessionStorage.length,(await indexedDB.databases()).length]),[0,0,0]);
  await devicePage.getByRole('button',{name:'Отключиться'}).click();await devicePage.getByRole('heading',{name:'Подключение',exact:true}).waitFor();assert.equal(await devicePage.getByLabel('Ключ доступа',{exact:true}).inputValue(),'');
  await click('Отключиться');await ownerPage.getByRole('heading',{name:'Подключение',exact:true}).waitFor();
  // Restore owner session from downloaded encrypted file, without old tokens.
  await fill('Адрес тестового Worker',endpoint);await ownerPage.getByLabel('Подтверждаю: только синтетические данные',{exact:true}).check();await ownerPage.getByLabel('Тип файла',{exact:true}).selectOption('owner');await ownerPage.getByLabel('Файл восстановления',{exact:true}).setInputFiles(ownerPath);await fill('Пароль файла','browser-owner-recovery-password');
  await click('Войти по файлу');await ownerPage.getByRole('heading',{name:'Файлы устройств'}).waitFor();
  assert.deepEqual(errors,[]);await ownerContext.close();await deviceContext.close();
  console.log('DELTA LAB BROWSER PASS: real Worker, verified diagnostic, explicit saved owner file, rotation, scoped device download/login, owner recovery, mobile overflow and zero browser credential/DB storage.');
 }finally{await browser.close();}
 // Migration rehearsal: separate fresh Worker storage and a real legacy
 // snapshot relay. Source is read-only to the migration helpers.
 await stop();workerState=join(state,'migration');await start();
 const sourceSchool='H'.repeat(43),sourceCoach='I'.repeat(43),oldPass='synthetic-legacy-password',newPass='synthetic-destination-password',backupPassword='synthetic-migration-backup-password';
 const sourceFenceToken='J'.repeat(43);
 const legacy=await createRelay({directory:join(state,'legacy'),tokens:{school:[sourceSchool],coach:[sourceCoach]},allowedOrigin:origin,migrationFenceTokens:{coach:sourceFenceToken},migrationRollbackTargets:{coach:{endpoint,token:c}}});
 await new Promise((resolve,reject)=>{legacy.once('error',reject);legacy.listen(0,'127.0.0.1',resolve);});
 try{
  const sourceEndpoint='http://127.0.0.1:'+legacy.address().port,legacyCoach=relayClient(sourceEndpoint,'coach',sourceCoach),legacySchool=relayClient(sourceEndpoint,'school',sourceSchool);
  const sourceEnvelope=async(snapshot,area,revision)=>encryptBackup({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area,workspaceId,revision,snapshot},oldPass);
  const src1=await legacyCoach.put(0,await sourceEnvelope(large,'coach',1));
  const srcSchool1=await legacySchool.put(0,await sourceEnvelope(base,'school',1));
  const target=deltaLabClient(endpoint,'coach',c),sourceCurrent=structuredClone(largeData);
  sourceCurrent.meta.push({id:'sync-checkpoint-coach',endpoint:sourceEndpoint,workspaceId,revision:1,envelope:src1.envelope});
  const args={sourceEndpoint,destinationEndpoint:endpoint,sourceToken:sourceCoach,destinationToken:c,sourcePassword:oldPass,destinationPassword:newPass,backupPassword,area:'coach',current:sourceCurrent,synthetic:true};
  await assert.rejects(prepareDeltaMigration({...args,synthetic:false}));
  await assert.rejects(prepareDeltaMigration({...args,destinationEndpoint:sourceEndpoint}));
  await assert.rejects(prepareDeltaMigration({...args,destinationEndpoint:'https://example.invalid'}));
  const plan=await prepareDeltaMigration(args);
  assert.equal(plan.sourceRevision,1);assert.ok(plan.encryptedBytes>1024*1024);assert.equal((await target.head()).revision,0);
  assert.deepEqual(await legacyCoach.get(),src1);
  const ready=await inspectDeltaMigrationDevice({...args,file:plan.file});assert.equal(ready.status,'clean-source');assert.equal(ready.ready,true);
  const dirty=structuredClone(sourceCurrent);dirty.coachTeams[0].name='Офлайн-изменение источника';
  assert.equal((await inspectDeltaMigrationDevice({...args,current:dirty,file:plan.file})).status,'local-changes');
  assert.equal((await inspectDeltaMigrationDevice({...args,current:freshDb(),file:plan.file})).status,'fresh-device');
  await assert.rejects(openDeltaMigration({...args,file:plan.file,backupPassword:'wrong-migration-password'}));
  await assert.rejects(openDeltaMigration({...args,file:plan.file,area:'school'}));
  const commitArgs={...args,file:plan.file,confirmed:true,backupVerified:true,sourceFrozen:true};
  await assert.rejects(commitDeltaMigration({...commitArgs,sourceFrozen:false}));
  await assert.rejects(commitDeltaMigration({...commitArgs,backupVerified:false}));
  assert.equal((await target.head()).revision,0);
  const src2=await legacyCoach.put(1,await sourceEnvelope(nextLarge,'coach',2));
  await assert.rejects(commitDeltaMigration(commitArgs),/Источник изменился/);
  assert.equal((await target.head()).revision,0);
  const latest=await prepareDeltaMigration(args);
  assert.equal((await inspectDeltaMigrationDevice({...args,file:latest.file})).status,'stale-checkpoint');
  const exact={...args,file:latest.file,confirmed:true,backupVerified:true,sourceFrozen:true};
  const sourceFenceId=latest.migrationId,fencedArgs={...exact,sourceFenceToken,sourceFenceId};
  const fence=deltaMigrationFenceClient(fencedArgs);
  await assert.rejects(commitDeltaMigration(fencedArgs),/не заблокирован/);
  assert.equal((await target.head()).revision,0);
  await assert.rejects(fence.freeze({expectedRevision:1,migrationId:sourceFenceId,confirmed:true,backupVerified:true}),/409/);
  const frozen=await fence.freeze({expectedRevision:2,migrationId:sourceFenceId,confirmed:true,backupVerified:true});
  assert.deepEqual(frozen,{revision:2,fence:{revision:2,migrationId:sourceFenceId}});
  assert.deepEqual(await fence.freeze({expectedRevision:2,migrationId:sourceFenceId,confirmed:true,backupVerified:true}),frozen);
  await assert.rejects(legacyCoach.put(2,await sourceEnvelope(large,'coach',3)),e=>e.code==='migration-frozen');
  const copied=await commitDeltaMigration(fencedArgs);
  assert.equal(copied.status,'verified-fenced-copy');assert.equal(copied.cutoverAllowed,false);assert.equal(copied.replayed,false);
  assert.deepEqual(await legacyCoach.get(),src2);
  const destination=await readDeltaLab({client:target,area:'coach',password:newPass,current:freshDb()});
  assert.equal(destination.revision,1);assert.notEqual(destination.workspaceId,workspaceId);assert.deepEqual(destination.snapshot,nextLarge);
  assert.deepEqual(await commitDeltaMigration(fencedArgs),{...copied,replayed:true});
  await assert.rejects(commitDeltaMigration({...fencedArgs,sourceFenceId:workspaceId}),/ID барьера/);
  await assert.rejects(prepareDeltaMigration(args),/должен быть пустым/);
  await assert.rejects(readDeltaLab({client:target,area:'coach',password:oldPass,current:freshDb()}));
  // Independent local device cutover: no privileged token, no saved credentials.
  const cleanSource=structuredClone(sourceCurrent);
  cleanSource.coachTeams=structuredClone(nextLarge.coachTeams);
  cleanSource.classes=structuredClone(baseData.classes);cleanSource.students=structuredClone(baseData.students);
  cleanSource.meta=cleanSource.meta.filter(r=>r.id!=='sync-checkpoint-coach');
  cleanSource.meta.push({id:'sync-checkpoint-coach',endpoint:sourceEndpoint,workspaceId,revision:2,envelope:src2.envelope},{id:'sync-checkpoint-school',endpoint:sourceEndpoint,workspaceId,revision:1,envelope:srcSchool1.envelope},{id:'sync-checkpoint-status-coach',endpoint:sourceEndpoint,workspaceId,revision:2,successfulAt:new Date().toISOString()});
  await db.replaceAll(cleanSource);
  const deviceArgs={...args,file:latest.file,confirmed:false};
  assert.deepEqual(await deltaMigrationFenceStatus(deviceArgs),frozen);
  await assert.rejects(deltaMigrationFenceStatus({...deviceArgs,sourceToken:sourceSchool}),/401/);
  const localBefore=await db.dumpAll(),preview=await cutoverDeltaMigrationDevice(deviceArgs);
  assert.deepEqual(preview,{area:'coach',migrationId:sourceFenceId,sourceRevision:2,destinationRevision:1,replayed:false,status:'cutover-preview'});
  assert.deepEqual(await db.dumpAll(),localBefore);
  const confirmation={...deviceArgs,confirmed:true,backupVerified:true,expectedMigrationId:sourceFenceId,expectedSourceRevision:2};
  await assert.rejects(cutoverDeltaMigrationDevice({...confirmation,expectedSourceRevision:1}),/Подтвердите/);
  await assert.rejects(cutoverDeltaMigrationDevice({...confirmation,sourceFenceToken}),/административный/);
  // A local edit arriving during network verification invalidates the atomic cutover.
  let touched=false;
  const localRace=async(url,init)=>{
   const response=await fetch(url,init);
   if(!touched&&String(url)===endpoint+'/v1/delta/coach/head'){
    touched=true;await db.put('coachTeams',{...nextLarge.coachTeams[0],name:'Локальное изменение в процессе перехода'});
   }
   return response;
  };
  await assert.rejects(cutoverDeltaMigrationDevice({...confirmation,fetcher:localRace}),/Локальные данные изменились/);
  assert.equal(touched,true);
  assert.equal((await db.get('meta','sync-checkpoint-coach')).revision,2);
  assert.equal(await db.get('meta','sync-checkpoint-migration-coach'),undefined);
  await assert.rejects(cutoverDeltaMigrationDevice(confirmation),/Локальные изменения/);
  await db.replaceAll(localBefore);
  const switched=await cutoverDeltaMigrationDevice(confirmation);
  assert.equal(switched.status,'cutover-completed');assert.equal(switched.replayed,false);
  const afterSwitch=await db.dumpAll(),bound=await db.get('meta','sync-checkpoint-migration-coach'),checkpoint=await db.get('meta','sync-checkpoint-coach');
  assert.equal(bound.migrationId,sourceFenceId);assert.equal(bound.protocol,'delta-lab-v1');
  assert.equal(checkpoint.endpoint,endpoint);assert.equal(checkpoint.workspaceId,sourceFenceId);assert.equal(checkpoint.revision,1);
  assert.equal(await db.get('meta','sync-checkpoint-status-coach'),undefined);
  assert.deepEqual(await db.get('meta','sync-checkpoint-school'),localBefore.meta.find(r=>r.id==='sync-checkpoint-school'));
  for(const name of Object.keys(SCHEMA).filter(n=>n!=='meta'))assert.deepEqual(afterSwitch[name],localBefore[name]);
  assert.deepEqual(await cutoverDeltaMigrationDevice(confirmation),{...switched,replayed:true});
  assert.deepEqual(await db.dumpAll(),afterSwitch);
  // The new adapter uses the new authenticated ancestor and never writes an unchanged snapshot.
  const switchedAdapter=deltaLabSyncAdapter({endpoint,area:'coach',token:c,password:newPass,synthetic:true,readData:()=>db.dumpAll()});
  const newPlan=await prepareSync({area:'coach',endpoint,password:newPass,client:switchedAdapter});
  assert.equal(newPlan.revision,1);assert.equal(newPlan.workspaceId,sourceFenceId);assert.equal(newPlan.conflicts.length,0);
  assert.equal((await executeSync({plan:newPlan,choices:{},password:newPass,client:switchedAdapter,confirmed:true,reuseRemote:true})).revision,1);
  assert.equal((await target.head()).revision,1);
  await assert.rejects(prepareSync({area:'coach',endpoint:sourceEndpoint,password:oldPass,client:legacyCoach}),/другим сервером/);
  // Verify no source privileged token or password is persisted in the binding.
  for(const secret of [sourceFenceToken,sourceCoach,c,oldPass,newPass,backupPassword])assert.ok(!JSON.stringify(bound).includes(secret));
  console.log('DELTA CUTOVER PASS: device-scoped read-only fence, preview, local edit race, atomic checkpoint/binding, exact retry, isolated school, preserved records and no redundant destination write.');

  const resume={expectedRevision:2,migrationId:sourceFenceId,confirmed:true,backupVerified:true,allDevicesReconciled:true};
  await assert.rejects(fence.resumeSource(resume),/409/);
  await assert.rejects(rollbackDeltaMigrationDevice(confirmation),/барьера назначения/);
  const ownerRollback={...confirmation,current:await db.dumpAll(),destinationSealToken:coachSealKey};
  await assert.rejects(sealDeltaMigrationRollback({...ownerRollback,destinationSealToken:c}),/отдельный ключ/);
  const sealed=await sealDeltaMigrationRollback(ownerRollback);
  assert.equal(sealed.status,'rollback-sealed');assert.equal(sealed.replayed,false);
  assert.deepEqual(await sealDeltaMigrationRollback(ownerRollback),{...sealed,replayed:true});
  assert.equal((await target.rollbackStatus()).seal.migrationId,sourceFenceId);
  const unusedDelta=await encryptBackup(await buildSyncDelta(nextLarge,large,{area:'coach',workspaceId:sourceFenceId,baseRevision:1}),newPass);
  await assert.rejects(target.append(1,unusedDelta),e=>e.status===423);
  const privileged=deltaLabClient(endpoint,'coach',c,{compactToken:coachAdmin,rotateToken:coachRotator});
  await assert.rejects(privileged.compact(1,(await target.getRevision(1)).envelope),e=>e.status===423);
  await assert.rejects(target.anchor((await target.getRevision(1)).envelope),e=>e.status===423);
  assert.equal((await call('multipart/rotate/'+'a'.repeat(64)+'/begin',coachRotator,'PUT',{},'coach')).status,423);
  await assert.rejects(commitDeltaMigration(fencedArgs),/закрыто для отката/);
  await assert.rejects(cutoverDeltaMigrationDevice(confirmation),/закрыто/);
  const beforeRollback=await db.dumpAll();
  const rollbackPreview=await rollbackDeltaMigrationDevice({...confirmation,confirmed:false});
  assert.equal(rollbackPreview.status,'rollback-preview');assert.deepEqual(await db.dumpAll(),beforeRollback);
  await db.put('coachTeams',{...nextLarge.coachTeams[0],name:'Несогласованная правка после перехода'});
  await assert.rejects(rollbackDeltaMigrationDevice(confirmation),/локальные изменения/);
  assert.equal((await db.get('meta','sync-checkpoint-coach')).endpoint,endpoint);
  await db.replaceAll(beforeRollback);
  const rollback=await rollbackDeltaMigrationDevice(confirmation);
  assert.equal(rollback.status,'rollback-completed');assert.equal(rollback.replayed,false);
  assert.deepEqual(await rollbackDeltaMigrationDevice(confirmation),{...rollback,replayed:true});
  const reverted=await db.dumpAll();
  assert.equal((await db.get('meta','sync-checkpoint-coach')).endpoint,sourceEndpoint);
  assert.equal((await db.get('meta','sync-checkpoint-coach')).revision,2);
  assert.equal(await db.get('meta','sync-checkpoint-migration-coach'),undefined);
  assert.deepEqual(await db.get('meta','sync-checkpoint-school'),localBefore.meta.find(r=>r.id==='sync-checkpoint-school'));
  for(const name of Object.keys(SCHEMA).filter(n=>n!=='meta'))assert.deepEqual(reverted[name],localBefore[name]);
  await assert.rejects(fence.resumeSource({...resume,allDevicesReconciled:false}),/возврат всех устройств/);
  await stop();await start();
  assert.deepEqual(await target.rollbackStatus(),{revision:1,seal:{migrationId:sourceFenceId,revision:1}});
  await assert.rejects(target.append(1,unusedDelta),e=>e.status===423);
  assert.deepEqual(await fence.resumeSource(resume),{revision:2,fence:null});
  assert.deepEqual(await fence.resumeSource(resume),{revision:2,fence:null});
  const resumed=await legacyCoach.put(2,await sourceEnvelope(nextLarge,'coach',3));
  assert.equal(resumed.revision,3);
  assert.deepEqual(await fence.resumeSource(resume),{revision:3,fence:null});
  await assert.rejects(fence.freeze({expectedRevision:3,migrationId:sourceFenceId,confirmed:true,backupVerified:true}),/409/);
  console.log('DELTA ROLLBACK PASS: unused destination permanently sealed, all writes rejected, dirty device preserved, atomic checkpoint return, restart persistence, pinned destination verification and source resumed exactly once.');


  // Simulate a late source write while the target's initial anchor commits.
  const schoolArgs={...args,sourceToken:sourceSchool,destinationToken:a,area:'school',current:baseData};
  const schoolPlan=await prepareDeltaMigration(schoolArgs);
  let raced=false;
  const raceFetcher=async(url,init)=>{
   const response=await fetch(url,init);
   if(!raced&&String(url)===endpoint+'/v1/delta/school/anchor'&&init.method==='PUT'&&response.ok){
    raced=true;await legacySchool.put(1,await sourceEnvelope(next,'school',2));
   }
   return response;
  };
  const late=await commitDeltaMigration({...schoolArgs,file:schoolPlan.file,confirmed:true,backupVerified:true,sourceFrozen:true,fetcher:raceFetcher});
  assert.equal(raced,true);assert.equal(late.status,'source-changed');assert.equal(late.observedSourceRevision,2);assert.equal(late.cutoverAllowed,false);
  assert.equal((await legacySchool.get()).revision,2);assert.equal(srcSchool1.revision,1);
  const schoolTarget=deltaLabClient(endpoint,'school',a);
  assert.deepEqual((await readDeltaLab({client:schoolTarget,area:'school',password:newPass,current:freshDb()})).snapshot,base);
  const repeated=await commitDeltaMigration({...schoolArgs,file:schoolPlan.file,confirmed:true,backupVerified:true,sourceFrozen:true});
  assert.equal(repeated.status,'source-changed');assert.equal(repeated.replayed,true);
  const schoolDelta=await encryptBackup(await buildSyncDelta(base,next,{area:'school',workspaceId:schoolPlan.migrationId,baseRevision:1}),newPass);
  const sealRace=await Promise.all([call('append',a,'PUT',{expectedRevision:1,envelope:schoolDelta}),call('rollback-seal',sealKey,'PUT',{expectedRevision:1,migrationId:schoolPlan.migrationId})]);
  assert.ok(sealRace[0].status===201&&sealRace[1].status===409||sealRace[0].status===423&&sealRace[1].status===200);
  const racedHead=await schoolTarget.head();
  assert.equal(racedHead.revision,sealRace[0].status===201?2:1);
  assert.deepEqual((await readDeltaLab({client:schoolTarget,area:'school',password:newPass,current:freshDb()})).snapshot,sealRace[0].status===201?next:base);
  await stop();await start();
  assert.deepEqual((await readDeltaLab({client:target,area:'coach',password:newPass,current:freshDb()})).snapshot,nextLarge);
  assert.equal((await legacyCoach.get()).revision,3);
  console.log('DELTA MIGRATION PASS: real legacy relay to isolated fresh Worker; large encrypted file, distinct workspace/password, dirty/stale preflight, source race before/after copy, no source writes or overwrite, exact retry, restart and independent scope verification.');
 }finally{await new Promise(resolve=>legacy.close(resolve));}
 const sizes=syncDeltaEstimate(base,next,{area,workspaceId,baseRevision:1});assert.ok(sizes.bytes<sizes.fullBytes);
 console.log('DELTA SIZE '+JSON.stringify(sizes));
 console.log('DELTA WORKER PASS: real workerd, opaque encrypted anchor and deltas, two scoped devices, CAS race and exact retry, bounds, isolation, restart persistence and verified reconstruction');
}finally{await stop();await rm(state,{recursive:true,force:true});await new Promise(r=>site.close(r));}
