import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {defaultSettings} from '../js/model.js';
import {encryptBackup,decryptBackup} from '../js/privacy.js';
import {projectScope,buildSyncDelta,applySyncDelta,replaySyncDeltas,syncDeltaEstimate,combineScope,mergeScopes,deltaLabSyncAdapter,deltaLabClient,readDeltaLab} from '../js/sync.js';

const workspaceId='00000000-0000-4000-8000-000000000001',area='school',password='synthetic-only-long-passphrase';
const data=()=>({...Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]])),meta:[defaultSettings()],classes:[{id:'c',name:'7А'}],students:Array.from({length:100},(_,i)=>({id:'s'+i,classId:'c',fullName:'Синтетический ученик '+i,number:i+1})),coachTeams:[{id:'t',name:'Локальная команда',archived:false}]});
const ctx={area,workspaceId,baseRevision:1};
const scope=d=>projectScope(d,area);
test('Delta is deterministic, reconstructs additions, updates and deletions, and saves bytes',async()=>{
 const current=data(),base=scope(current),nextData=structuredClone(current);
 nextData.students[0].fullName='Изменённый 🏐';nextData.students.pop();
 nextData.students.push({id:'new',classId:'c',fullName:'Новый',number:100});
 const next=scope(nextData),original=structuredClone({base,next,current});
 const packet=await buildSyncDelta(base,next,ctx);
 assert.deepEqual(Object.keys(packet.changes),['students']);
 assert.equal(packet.changes.students.upserts.length,2);assert.deepEqual(packet.changes.students.deletes,['s99']);
 const estimate=syncDeltaEstimate(base,next,ctx);
 const envelope=await encryptBackup(packet,password);
 assert.equal(estimate.bytes,new TextEncoder().encode(JSON.stringify({expectedRevision:1,envelope})).length);
 assert.equal(estimate.changedRecords,3);assert.ok(estimate.bytes<estimate.fullBytes/3);
 const result=await applySyncDelta(base,await decryptBackup(envelope,password),{...ctx,current});
 assert.deepEqual(result,next);assert.deepEqual({base,next,current},original);
 assert.deepEqual(combineScope(current,result,area).coachTeams,current.coachTeams);
 const shuffled={...base,students:[...base.students].reverse()};
 assert.equal((await buildSyncDelta(shuffled,next,ctx)).baseHash,packet.baseHash);
 await assert.rejects(buildSyncDelta(base,base,ctx),/Нет изменений/);
});
test('Delta rejects wrong area, workspace, revision, base hash, result hash, duplicate and unknown changes',async()=>{
 const current=data(),base=scope(current),d=structuredClone(current);d.students[0].fullName='New';
 const packet=await buildSyncDelta(base,scope(d),ctx),apply=p=>applySyncDelta(base,p,{...ctx,current});
 for(const change of [{area:'coach'},{workspaceId:'00000000-0000-4000-8000-000000000002'},{revision:3},{baseHash:'f'.repeat(64)},{resultHash:'f'.repeat(64)},{extra:true}])await assert.rejects(apply({...packet,...change}));
 await assert.rejects(apply({...packet,changes:{...packet.changes,coachTeams:{upserts:[{id:'bad'}],deletes:[]}}}),/область/);
 await assert.rejects(apply({...packet,changes:{students:{upserts:[],deletes:['unknown']}}}),/удаление/);
 await assert.rejects(apply({...packet,changes:{students:{upserts:[packet.changes.students.upserts[0],packet.changes.students.upserts[0]],deletes:[]}}}),/Повторная/);
 await assert.rejects(applySyncDelta(scope(d),packet,{...ctx,current}),/Базовый снимок/);
 const invalid=structuredClone(d);invalid.students[0].classId='missing';
 const invalidPacket=await buildSyncDelta(base,scope(invalid),ctx);
 await assert.rejects(apply(invalidPacket));
});
test('Encrypted delta chain is contiguous and retains three-way merge semantics',async()=>{
 const current=data(),base=scope(current),a=structuredClone(current),b=structuredClone(current);
 a.students[0].fullName='Сервер 1';b.students[0].fullName='Сервер 1';b.students[1].fullName='Сервер 2';
 const s1=scope(a),s2=scope(b);
 const first={revision:2,envelope:await encryptBackup(await buildSyncDelta(base,s1,ctx),password)};
 const second={revision:3,envelope:await encryptBackup(await buildSyncDelta(s1,s2,{...ctx,baseRevision:2}),password)};
 const args={base,...ctx,password,current};
 const result=await replaySyncDeltas({...args,entries:[first,second]});
 assert.equal(result.revision,3);assert.deepEqual(result.snapshot,s2);
 await assert.rejects(replaySyncDeltas({...args,entries:[second]}),/Пропущена/);
 await assert.rejects(replaySyncDeltas({...args,entries:[first,first]}),/Пропущена/);
 await assert.rejects(replaySyncDeltas({...args,entries:[first,second],password:'wrong-password-for-test'}),/неверный пароль/);
 const local=structuredClone(current);local.students[2].fullName='Локальное изменение';
 const merged=mergeScopes(base,scope(local),result.snapshot,area);
 assert.equal(merged.conflicts.length,0);assert.equal(merged.snapshot.students.find(x=>x.id==='s2').fullName,'Локальное изменение');
 local.students[0].fullName='Конфликт';assert.equal(mergeScopes(base,scope(local),result.snapshot,area).conflicts.length,1);
});

test('Laboratory adapter requires opt-in and loopback, and a checkpoint avoids replaying old records',async()=>{
 assert.throws(()=>deltaLabSyncAdapter({endpoint:'http://127.0.0.1:8099',area,token:'a'.repeat(43),password,readData:()=>data()}),/синтетических/);
 assert.throws(()=>deltaLabClient('https://example.com',area,'a'.repeat(43)),/localhost/);
 assert.throws(()=>deltaLabClient('http://127.0.0.1:8099',area,'a'.repeat(43),{compactToken:'a'.repeat(43)}),/отдельные/);
 const current=data(),base=scope(current),d=structuredClone(current);d.students[0].fullName='New';
 const next=scope(d),packet=await buildSyncDelta(base,next,ctx),envelope=await encryptBackup(packet,password);
 let reads=[];const client={head:async()=>({revision:2,anchorRevision:1,count:2}),getRevision:async revision=>{reads.push(revision);assert.equal(revision,2);return {revision,kind:'delta',envelope};}};
 const checkpoint={revision:2,workspaceId,snapshot:next};
 const remote=await readDeltaLab({client,area,password,current,checkpoint});
 assert.deepEqual(remote.snapshot,next);assert.deepEqual(reads,[2]);
 await assert.rejects(readDeltaLab({client,area,password,current,checkpoint:{...checkpoint,snapshot:base}}),/ранее принятой/);
 await assert.rejects(readDeltaLab({client:{...client,head:async()=>({revision:1,anchorRevision:1,count:1})},area,password,current,checkpoint}),/устаревшую/);
});

test('New release reads v21 encrypted anchors/deltas, rejects future format before merge',async()=>{
 const current=data(),base=scope(current),nextData=structuredClone(current);nextData.students[0].fullName='Новая запись';
 const next=scope(nextData),packet=await buildSyncDelta(base,next,ctx);assert.equal(packet.backupVersion,22);
 assert.deepEqual(await applySyncDelta(base,{...packet,backupVersion:21},{...ctx,current}),next);
 await assert.rejects(applySyncDelta(base,{...packet,backupVersion:23},{...ctx,current}),/Несовместимый/);
 const {verifySyncSnapshot}=await import('../js/sync.js');
 for(const backupVersion of [19,20,21,22]){
  const envelope=await encryptBackup({app:'teachapp-sync',version:1,backupVersion,area,workspaceId,revision:1,snapshot:base},password);
  assert.deepEqual(await verifySyncSnapshot({revision:1,envelope},password,area),{revision:1,empty:false});
 }
 const future=await encryptBackup({app:'teachapp-sync',version:1,backupVersion:23,area,workspaceId,revision:1,snapshot:base},password);
 await assert.rejects(verifySyncSnapshot({revision:1,envelope:future},password,area),e=>e.code==='newer-backup-format');
});
