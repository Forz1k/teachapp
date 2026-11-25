import test from 'node:test';
import assert from 'node:assert/strict';
import {signRollbackReceipt,verifyRollbackReceipt,normalizeReceiptKeys} from '../server/migration-receipt.mjs';
import {migrationAnchorCommitment,splitDeltaAnchor,singleDeltaAnchorCommitment} from '../js/delta-anchor.js';
const fields={area:'school',migrationId:'12345678-1234-4000-8000-123456789abc',anchorCommitment:'single:'+'a'.repeat(64)};
test('seal receipt verifies only pinned key, exact contour, migration ID and ciphertext commitment',async()=>{
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),pub=await crypto.subtle.exportKey('jwk',pair.publicKey),priv=await crypto.subtle.exportKey('jwk',pair.privateKey);
 const other=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const receipt=await signRollbackReceipt(fields,priv);
 assert.equal(await verifyRollbackReceipt(receipt,fields,pub),true);
 assert.equal(await verifyRollbackReceipt(receipt,{...fields,area:'coach'},pub),false);
 assert.equal(await verifyRollbackReceipt(receipt,{...fields,anchorCommitment:'single:'+'b'.repeat(64)},pub),false);
 assert.equal(await verifyRollbackReceipt({...receipt,signature:'A'.repeat(86)},fields,pub),false);
 assert.equal(await verifyRollbackReceipt({...receipt,revision:2},fields,pub),false);
 assert.equal(await verifyRollbackReceipt({...receipt,extra:true},fields,pub),false);
 assert.equal(await verifyRollbackReceipt(receipt,fields,await crypto.subtle.exportKey('jwk',other.publicKey)),false);
 assert.equal(normalizeReceiptKeys({school:pub,coach:pub}),null);
 assert.equal(normalizeReceiptKeys({school:priv}),null);
});
test('destination commitment matches exact single envelope or deterministic multipart anchor manifest',async()=>{
 const envelope={app:'teachapp-encrypted',version:1,kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:'A'.repeat(22)+'==',iv:'A'.repeat(16),data:'A'.repeat(24)};
 assert.equal(await migrationAnchorCommitment(envelope),await singleDeltaAnchorCommitment(envelope));
 assert.notEqual(await migrationAnchorCommitment({...envelope,data:'B'.repeat(24)}),await migrationAnchorCommitment(envelope));
 const large={...envelope,data:'A'.repeat(2*1024*1024)};
 assert.equal(await migrationAnchorCommitment(large),'multipart:'+(await splitDeltaAnchor(large)).uploadId);
});
