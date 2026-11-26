import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {BACKUP_VERSION} from '../js/backup.js';
import {encryptBackup,decryptBackup} from '../js/privacy.js';
import {projectScope,buildSyncDelta,exportDeltaCheckpointLab,openDeltaCheckpointLab,prepareDeltaCheckpointRestoreLab,restoreDeltaCheckpointLab} from '../js/sync.js';
const source='http://127.0.0.1:9876',destination='http://127.0.0.1:9877',area='coach';
const workspaceId='00000000-0000-4000-8000-000000000001',token='A'.repeat(43),destinationToken='B'.repeat(43),password='synthetic-source-password',backupPassword='synthetic-backup-password',destinationPassword='synthetic-target-password';
const fixture=()=>Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]]));
const head=(revision,count=revision)=>({revision,anchorRevision:revision?1:0,count,bytes:revision?100:0,maxEntries:129,maxBytes:16*1024*1024,keyEpoch:0});
test('Offline Delta checkpoint reconstructs the verified prefix and excludes server credentials',async()=>{
 const current=fixture(),base=projectScope(current,area),next=structuredClone(base);
 next.coachTeams.push({id:'t',name:'Synthetic team',archived:false});
 const anchor=await encryptBackup({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area,workspaceId,revision:1,snapshot:base},password);
 const delta=await encryptBackup(await buildSyncDelta(base,next,{area,workspaceId,baseRevision:1}),password);
 const calls=[],fetcher=async(url,init)=>{
  calls.push({url,method:init.method});assert.equal(init.method,'GET');assert.equal(init.headers.Authorization,'Bearer '+token);
  if(url.endsWith('/head'))return Response.json(head(2));
  if(url.endsWith('/revision/1'))return Response.json({revision:1,kind:'anchor',envelope:anchor});
  if(url.endsWith('/revision/2'))return Response.json({revision:2,kind:'delta',envelope:delta});
  throw Error('Unexpected request');
 };
 const args={endpoint:source,area,expectedWorkspaceId:workspaceId,expectedRevision:2,backupPassword,current,synthetic:true};
 const backup=await exportDeltaCheckpointLab({...args,token,password,fetcher});
 assert.equal(calls.length,3);assert.equal(backup.revision,2);assert.equal(backup.records,1);
 const opened=await openDeltaCheckpointLab({...args,file:backup.file});
 assert.deepEqual(opened.snapshot,next);assert.equal(opened.digest,backup.digest);
 const raw=await decryptBackup(backup.file,backupPassword);
 assert.doesNotMatch(JSON.stringify(raw),/synthetic-source-password|synthetic-backup-password|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/);
 assert.doesNotMatch(JSON.stringify(backup.file),/Synthetic team/);
 await assert.rejects(openDeltaCheckpointLab({...args,file:backup.file,expectedRevision:1}),/другого контура/);
 await assert.rejects(openDeltaCheckpointLab({...args,file:backup.file,endpoint:destination}),/другого контура/);
 await assert.rejects(openDeltaCheckpointLab({...args,file:backup.file,backupPassword:'incorrect-password'}),/неверный пароль/);
 const forged=await encryptBackup({...raw,digest:'0'.repeat(64)},backupPassword);
 await assert.rejects(openDeltaCheckpointLab({...args,file:forged}),/не совпадает/);
 const newer=await encryptBackup({...raw,backupVersion:BACKUP_VERSION+1},backupPassword);
 await assert.rejects(openDeltaCheckpointLab({...args,file:newer}),e=>e.code==='newer-backup-format');
 await assert.rejects(exportDeltaCheckpointLab({...args,token,password,fetcher,synthetic:false}),/синтетического/);
});
test('Delta checkpoint restore is offline-prepared, exact-replay safe and never overwrites a used destination',async()=>{
 const current=fixture(),snapshot=projectScope(current,area);snapshot.coachTeams.push({id:'t',name:'Synthetic team',archived:false});
 const original=await encryptBackup({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area,workspaceId,revision:1,snapshot},password);
 const args={endpoint:source,area,expectedWorkspaceId:workspaceId,expectedRevision:1,backupPassword,current,synthetic:true};
 const backup=await exportDeltaCheckpointLab({...args,token,password,fetcher:async url=>Response.json(url.endsWith('/head')?head(1):{revision:1,kind:'anchor',envelope:original})});
 const offline={...args,file:backup.file,destinationEndpoint:destination,destinationPassword};
 await assert.rejects(prepareDeltaCheckpointRestoreLab({...offline,destinationEndpoint:source}),/отдельный сервер/);
 const plan=await prepareDeltaCheckpointRestoreLab(offline);assert.notEqual(plan.workspaceId,workspaceId);
 let row=null,writes=0,lost=true,used=false;const requests=[];
 const fetcher=async(url,init)=>{
  requests.push(url);assert.ok(url.startsWith(destination+'/'));assert.equal(init.headers.Authorization,'Bearer '+destinationToken);
  if(url.endsWith('/head'))return Response.json(head(used?2:row?1:0));
  if(url.endsWith('/rollback-status'))return Response.json({revision:used?2:row?1:0,seal:null});
  if(url.endsWith('/revision/1'))return Response.json(row);
  if(url.endsWith('/anchor')){
   assert.equal(init.method,'PUT');assert.equal(row,null);writes++;
   const body=JSON.parse(init.body);assert.equal(body.expectedRevision,0);
   row={revision:1,kind:'anchor',envelope:body.envelope};
   if(lost){lost=false;throw new TypeError('Lost acknowledgement');}
   return Response.json({revision:1,replayed:false});
  }
  throw Error('Unexpected request');
 };
 const commit={...offline,plan,destinationToken,expectedDestinationWorkspaceId:plan.workspaceId,confirmed:true,backupVerified:true,fetcher};
 await assert.rejects(restoreDeltaCheckpointLab({...commit,confirmed:false}),/Подтвердите/);assert.equal(requests.length,0);
 await assert.rejects(restoreDeltaCheckpointLab(commit),/Lost acknowledgement/);
 assert.equal(writes,1);
 const restored=await restoreDeltaCheckpointLab(commit);assert.equal(restored.replayed,true);assert.equal(restored.cutoverAllowed,false);assert.equal(restored.revision,1);assert.equal(writes,1);
 const different=await prepareDeltaCheckpointRestoreLab(offline);
 await assert.rejects(restoreDeltaCheckpointLab({...commit,plan:different,expectedDestinationWorkspaceId:different.workspaceId}),/другой снимок/);assert.equal(writes,1);
 used=true;await assert.rejects(restoreDeltaCheckpointLab(commit),/уже используется/);assert.equal(writes,1);
});

test('Delta checkpoint restore refuses torn destination status, old key epoch and changes during final verification',async()=>{
 const current=fixture(),snapshot=projectScope(current,area);
 const original=await encryptBackup({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area,workspaceId,revision:1,snapshot},password);
 const args={endpoint:source,area,expectedWorkspaceId:workspaceId,expectedRevision:1,backupPassword,current,synthetic:true};
 const backup=await exportDeltaCheckpointLab({...args,token,password,fetcher:async url=>Response.json(url.endsWith('/head')?head(1):{revision:1,kind:'anchor',envelope:original})});
 const offline={...args,file:backup.file,destinationEndpoint:destination,destinationPassword},plan=await prepareDeltaCheckpointRestoreLab(offline);
 const commit={...offline,plan,destinationToken,expectedDestinationWorkspaceId:plan.workspaceId,confirmed:true,backupVerified:true};
 let mode='torn',writes=0,heads=0,checks=0,row=null;
 const fetcher=async(url,init)=>{
  if(url.endsWith('/head')){
   heads++;return Response.json({...head(mode==='advance'&&heads>=4?2:row?1:0),keyEpoch:mode==='epoch'?1:0});
  }
  if(url.endsWith('/rollback-status')){
   checks++;return Response.json({revision:mode==='torn'?1:mode==='status-advance'&&checks>=2?2:row?1:0,seal:null});
  }
  if(url.endsWith('/anchor')){writes++;row={revision:1,kind:'anchor',envelope:JSON.parse(init.body).envelope};return Response.json({revision:1,replayed:false});}
  if(url.endsWith('/revision/1'))return Response.json(row);
  throw Error('Unexpected request');
 };
 await assert.rejects(restoreDeltaCheckpointLab({...commit,fetcher}),/изменилось при проверке/);assert.equal(writes,0);
 mode='epoch';heads=checks=0;await assert.rejects(restoreDeltaCheckpointLab({...commit,fetcher}),/ротации/);assert.equal(writes,0);
 mode='advance';heads=checks=0;await assert.rejects(restoreDeltaCheckpointLab({...commit,fetcher}),/изменилось во время подтверждения/);assert.equal(writes,1);
 mode='status-advance';heads=checks=0;await assert.rejects(restoreDeltaCheckpointLab({...commit,fetcher}),/изменилось во время подтверждения/);assert.equal(writes,1);
 mode='stable';heads=checks=0;const restored=await restoreDeltaCheckpointLab({...commit,fetcher});assert.equal(restored.replayed,true);assert.equal(restored.cutoverAllowed,false);assert.equal(writes,1);
});
