import test from 'node:test';import assert from 'node:assert/strict';
import {encryptBackup,decryptBackup} from '../js/privacy.js';
import {splitDeltaAnchor,joinDeltaAnchor,normalizeAnchorManifest,verifyAnchorPart,anchorUploadId,DELTA_PART_SIZE,DELTA_MAX_DATA} from '../js/delta-anchor.js';
const password='synthetic-only-multipart-password';
test('Multipart preserves original authenticated envelope, bounds requests and deterministic retry ID',async()=>{
 const plain={app:'synthetic',text:'🏐Тест'.repeat(95000)},envelope=await encryptBackup(plain,password);
 const built=await splitDeltaAnchor(envelope),again=await splitDeltaAnchor(envelope);
 assert.ok(built.chunks.length>=3);assert.equal(built.uploadId,again.uploadId);
 for(const chunk of built.chunks)assert.ok(new TextEncoder().encode(JSON.stringify({data:chunk})).length<1024*1024);
 assert.ok(built.chunks.slice(0,-1).every(x=>x.length===DELTA_PART_SIZE));
 assert.deepEqual(await joinDeltaAnchor(built.manifest,built.uploadId,i=>built.chunks[i]),envelope);
 assert.deepEqual(await decryptBackup(await joinDeltaAnchor(built.manifest,built.uploadId,i=>built.chunks[i]),password),plain);
 await assert.rejects(decryptBackup(envelope,'wrong-synthetic-password'));
 assert.notEqual((await splitDeltaAnchor(envelope,{kind:'compact',expectedRevision:5})).uploadId,built.uploadId);
});
test('Multipart rejects tampered, missing, reordered, oversized and invalid revision data before reconstruction',async()=>{
 const envelope=await encryptBackup({text:'x'.repeat(900000)},password),{manifest,uploadId,chunks}=await splitDeltaAnchor(envelope);
 assert.equal(normalizeAnchorManifest({...manifest,expectedRevision:1}),null);
 assert.equal(normalizeAnchorManifest({...manifest,dataLength:DELTA_MAX_DATA+4}),null);
 assert.equal(normalizeAnchorManifest({...manifest,parts:[...manifest.parts,{size:4,hash:'a'.repeat(64)}]}),null);
 assert.equal(normalizeAnchorManifest({...manifest,header:{...manifest.header,token:'secret'}}),null);
 await assert.rejects(joinDeltaAnchor(manifest,'f'.repeat(64),i=>chunks[i]),/манифест/i);
 await assert.rejects(joinDeltaAnchor(manifest,uploadId,i=>chunks[i+1]),/часть|части/i);
 await assert.rejects(joinDeltaAnchor(manifest,uploadId,i=>i===0?(chunks[i][0]==='A'?'B':'A')+chunks[i].slice(1):chunks[i]),/сумма/);
 await assert.rejects(verifyAnchorPart(manifest,99,'AAAA'));
 await assert.rejects(splitDeltaAnchor({...envelope,data:'A'.repeat(DELTA_MAX_DATA+4)}));
 await assert.rejects(splitDeltaAnchor(envelope,{kind:'compact',expectedRevision:0}));
 const reversed=Object.fromEntries(Object.entries(manifest).reverse());assert.equal(await anchorUploadId(reversed),uploadId);
});
