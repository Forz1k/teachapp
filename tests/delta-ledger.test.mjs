import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDeltaWrite,decideDeltaWrite,MAX_DELTA_ENTRIES,MAX_LEDGER_BYTES} from '../server/delta-ledger.mjs';
const envelope={app:'teachapp-encrypted',version:1,kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:'A'.repeat(22)+'==',iv:'A'.repeat(16),data:'A'.repeat(24)};
const packet=expectedRevision=>normalizeDeltaWrite({expectedRevision,envelope});
test('Opaque ledger validates shape, size and canonical key order',()=>{
 assert.ok(packet(0));assert.equal(packet(0).bytes,new TextEncoder().encode(JSON.stringify({expectedRevision:0,envelope})).length);
 assert.equal(normalizeDeltaWrite({expectedRevision:0,envelope:Object.fromEntries(Object.entries(envelope).reverse())}).serialized,packet(0).serialized);
 for(const e of [{...envelope,data:'A'.repeat(1024*1024)},{...envelope,data:'not base64!'},{...envelope,secret:'no'},{...envelope,iterations:1}])assert.equal(normalizeDeltaWrite({expectedRevision:0,envelope:e}),null);
 assert.equal(packet(-1),null);assert.equal(packet(Number.MAX_SAFE_INTEGER),null);
});
test('Opaque ledger append-only CAS, exact retry, anchor and storage limits',()=>{
 const empty={revision:0,count:0,bytes:0},head={revision:1,count:1,bytes:packet(0).bytes},last={revision:1,kind:'anchor',serialized:packet(0).serialized};
 assert.equal(decideDeltaWrite(empty,'delta',packet(0)).status,409);
 assert.deepEqual(decideDeltaWrite(empty,'anchor',packet(0)),{status:201,revision:1,replayed:false});
 assert.deepEqual(decideDeltaWrite(head,'anchor',packet(0),last),{status:200,revision:1,replayed:true});
 assert.equal(decideDeltaWrite(head,'delta',packet(0),last).status,409);
 assert.equal(decideDeltaWrite(head,'anchor',packet(1),last).status,409);
 assert.equal(decideDeltaWrite(head,'delta',packet(1),last).status,201);
 assert.equal(decideDeltaWrite({...head,count:MAX_DELTA_ENTRIES+1},'delta',packet(1),last).status,507);
 assert.equal(decideDeltaWrite({...head,bytes:MAX_LEDGER_BYTES},'delta',packet(1),last).status,507);
});

test('Privileged compaction advances revision even at capacity, preserves CAS and permits only an exact retry',()=>{
 const old={revision:3,count:3,bytes:MAX_LEDGER_BYTES},last={revision:3,kind:'delta',serialized:packet(2).serialized};
 assert.deepEqual(decideDeltaWrite(old,'compact',packet(3),last),{status:201,revision:4,replayed:false,compact:true});
 assert.equal(decideDeltaWrite(old,'compact',packet(2),last).status,409);
 assert.equal(decideDeltaWrite({revision:0,count:0,bytes:0},'compact',packet(0)).status,409);
 const compacted={revision:4,count:1,bytes:packet(3).bytes},anchor={revision:4,kind:'anchor',serialized:packet(3).serialized};
 assert.deepEqual(decideDeltaWrite(compacted,'compact',packet(3),anchor),{status:200,revision:4,replayed:true});
 assert.equal(decideDeltaWrite(compacted,'compact',packet(4),anchor).status,409);
 assert.equal(decideDeltaWrite(compacted,'delta',packet(3),anchor).status,409);
 assert.equal(decideDeltaWrite(compacted,'delta',packet(4),anchor).status,201);
});
