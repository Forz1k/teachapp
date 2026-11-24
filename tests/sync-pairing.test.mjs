import test from 'node:test';
import assert from 'node:assert/strict';
import {createPairingCode,readPairingCode} from '../js/sync-pairing.js';
import {encryptBackup} from '../js/privacy.js';
const password='synthetic-only-long-passphrase';
const profile={endpoint:'https://example.test/relay',area:'coach',token:'a'.repeat(43)};
test('pairing round trip, no readable token or password, fresh random encryption',async()=>{
 const code=await createPairingCode({...profile,endpoint:profile.endpoint+'/'},password);
 assert.match(code,/^TA1\.[A-Za-z0-9_-]+$/);
 assert.ok(!code.includes(profile.token)&&!code.includes(password));
 assert.notEqual(code,await createPairingCode(profile,password));
 assert.deepEqual(await readPairingCode(' '+code+' ',password),profile);
 await assert.rejects(readPairingCode(code,'wrong-password-1234'),/неверный пароль/);
});
test('invalid input, unsupported formats and insecure endpoints fail closed',async()=>{
 for(const value of ['', 'TA2.abc','TA1.!!!','TA1.'+'a'.repeat(8192)])await assert.rejects(readPairingCode(value,password),/код подключения/i);
 for(const options of [{...profile,endpoint:'http://localhost:8787'},{...profile,endpoint:'https://user:pass@example.test'},{...profile,area:'other'},{...profile,token:'short'}])await assert.rejects(createPairingCode(options,password));
 await assert.rejects(createPairingCode(profile,'short'));
});
test('encrypted backup of a different type cannot be used as a pairing code',async()=>{
 const envelope=await encryptBackup({app:'teachapp',version:1},password);
 const code='TA1.'+Buffer.from(JSON.stringify(envelope)).toString('base64url');
 await assert.rejects(readPairingCode(code,password),/не код подключения/);
});
