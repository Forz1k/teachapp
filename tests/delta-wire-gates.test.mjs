import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {BACKUP_VERSION} from '../js/backup.js';
import {projectScope,buildSyncDelta,applySyncDelta,deltaLabClient,deltaCandidateClient} from '../js/sync.js';

const endpoint='http://127.0.0.1:9876',token='A'.repeat(43),sealToken='B'.repeat(43);
const migrationId='00000000-0000-4000-8000-000000000001';
const envelope={app:'teachapp-encrypted',version:1,kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:'A'.repeat(22)+'==',iv:'A'.repeat(16),data:'A'.repeat(24)};
const head={revision:1,anchorRevision:1,count:1,bytes:100,maxEntries:129,maxBytes:16*1024*1024,keyEpoch:0};
const fixture=()=>Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]]));
function fake(response){return deltaLabClient(endpoint,'coach',token,{sealToken,fetcher:async()=>Response.json(response)});}
test('Delta wire rejects incomplete, foreign and malformed success responses',async()=>{
 assert.deepEqual(await fake(head).head(),head);
 for(const invalid of [null,{...head,unexpected:true},{...head,bytes:-1},{...head,maxEntries:130},{...head,keyEpoch:-1},{...head,revision:0,anchorRevision:0,count:0}])
  await assert.rejects(fake(invalid).head(),/Некорректная цепочка/);
 const ack={revision:2,replayed:false};assert.deepEqual(await fake(ack).append(1,envelope),ack);
 for(const invalid of [null,{revision:2},{...ack,unexpected:true},{...ack,revision:3},{...ack,replayed:'false'}])
  await assert.rejects(fake(invalid).append(1,envelope),/не подтвердил/);
 assert.deepEqual(await fake({revision:1,kind:'anchor',envelope}).getRevision(1),{revision:1,kind:'anchor',envelope});
 for(const invalid of [null,{revision:2,kind:'anchor',envelope},{revision:1,kind:'unknown',envelope},{revision:1,kind:'anchor',envelope,extra:true},{revision:1,kind:'anchor',envelope:null}])
  await assert.rejects(fake(invalid).getRevision(1),/ревизия|снимок/);
 assert.deepEqual(await fake({revision:1,seal:null}).rollbackStatus(),{revision:1,seal:null});
 for(const invalid of [null,{revision:1},{revision:2,seal:{migrationId,revision:1}},{revision:1,seal:{migrationId,revision:1,extra:true}}])
  await assert.rejects(fake(invalid).rollbackStatus(),/барьера/);
 await assert.rejects(fake({revision:1,seal:{revision:1,migrationId:'00000000-0000-4000-8000-000000000002'}}).sealRollback(migrationId),/не подтверждено/);
});
test('Malformed multipart begin or replay acknowledgement stops all subsequent writes',async()=>{
 const large={...envelope,data:'A'.repeat(1024*1024)};
 for(const response of [{revision:1,replayed:true,extra:true},{revision:2,replayed:true},{uploadId:'0'.repeat(64),expiresAt:1}]){
  const paths=[],client=deltaLabClient(endpoint,'coach',token,{fetcher:async url=>{paths.push(url);return Response.json(response);}});
  await assert.rejects(client.anchor(large),/не подтвердил/);assert.equal(paths.length,1);assert.match(paths[0],/\/begin$/);
 }
});
test('A newer authenticated delta format has a distinct update-required barrier',async()=>{
 const current=fixture(),base=projectScope(current,'coach'),next=structuredClone(base);
 next.coachTeams.push({id:'t',name:'Synthetic',archived:false});
 const ctx={area:'coach',workspaceId:migrationId,baseRevision:1,current};
 const packet=await buildSyncDelta(base,next,ctx);
 await assert.rejects(applySyncDelta(base,{...packet,backupVersion:BACKUP_VERSION+1},ctx),e=>e.code==='newer-backup-format');
 assert.deepEqual(await applySyncDelta(base,packet,ctx),next);
});

import {deltaMode,deltaRequestAllowed} from '../server/delta-mode.mjs';
test('Delta v3 configuration is separate, HTTPS exact-origin and fail-closed',()=>{
 const env={TEACHAPP_DELTA_CANDIDATE:'true',TEACHAPP_DELTA_ORIGIN:'https://app.example.com',TEACHAPP_DELTA_ENDPOINT:'https://delta.example.com'};
 const mode=deltaMode(env);assert.equal(mode.pathVersion,'v3');assert.equal(deltaRequestAllowed(mode,new URL('https://delta.example.com/v3/delta/coach/head')),true);
 for(const url of ['http://delta.example.com','https://evil.example.com','https://delta.example.com:444'])assert.equal(deltaRequestAllowed(mode,new URL(url)),false);
 for(const bad of [{...env,TEACHAPP_DELTA_SYNTHETIC:'true'},{...env,TEACHAPP_DELTA_ENDPOINT:'http://localhost:80'},{...env,TEACHAPP_DELTA_ORIGIN:env.TEACHAPP_DELTA_ENDPOINT},{...env,TEACHAPP_DELTA_ENDPOINT:'https://delta.example.com/path'},{...env,TEACHAPP_DELTA_CANDIDATE:'false'}])assert.equal(deltaMode(bad),null);
});
test('Delta v3 checks protocol before writes and never tries v1',async()=>{
 const origin='https://delta.example.com',calls=[];
 assert.throws(()=>deltaCandidateClient(origin,'coach',token),/Подтвердите/);
 assert.throws(()=>deltaCandidateClient(endpoint,'coach',token,{confirmed:true}),/HTTPS/);
 const client=deltaCandidateClient(origin,'coach',token,{confirmed:true,fetcher:async(url,init)=>{calls.push([url,init.method]);return Response.json(head);}});
 await assert.rejects(client.append(1,envelope),/версия/);assert.deepEqual(calls,[[origin+'/v3/delta/coach/head','GET']]);
 calls.length=0;
 const ok=deltaCandidateClient(origin,'coach',token,{confirmed:true,fetcher:async(url,init)=>{calls.push([url,init.method]);return Response.json(init.method==='GET'?{...head,protocolVersion:3}:{revision:2,replayed:false});}});
 assert.deepEqual(await ok.append(1,envelope),{revision:2,replayed:false});assert.deepEqual(calls,[[origin+'/v3/delta/coach/head','GET'],[origin+'/v3/delta/coach/append','PUT']]);
});
