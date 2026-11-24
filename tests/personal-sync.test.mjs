import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalCode,parsePersonalCode,personalCredentials,personalTokenHashes,readPersonalCode,savePersonalCode,forgetPersonalCode} from '../js/personal-sync.js';
const endpoint='https://sync.example.test';
test('same personal code gives stable separated credentials and only hashes for deployment',async()=>{
 const code=createPersonalCode(endpoint);
 assert.notEqual(code,createPersonalCode(endpoint));
 assert.equal(parsePersonalCode(code).endpoint,endpoint);
 const a=await personalCredentials(code,'school'),b=await personalCredentials(code,'coach');
 assert.deepEqual(a,await personalCredentials(code,'school'));
 assert.equal(new Set([a.token,a.password,b.token,b.password]).size,4);
 for(const value of [a.token,a.password,b.token,b.password])assert.match(value,/^[A-Za-z0-9_-]{43}$/);
 const hashes=await personalTokenHashes(code);
 for(const scope of ['school','coach'])assert.match(hashes[scope][0],/^[0-9a-f]{64}$/);
 assert.notEqual(hashes.school[0],hashes.coach[0]);
 assert.ok(!JSON.stringify(hashes).includes(a.password));
});
test('storage remembers one code, forgets without touching database, rejects replacement',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const code=createPersonalCode(endpoint);
 assert.equal(readPersonalCode(storage),null);
 savePersonalCode(code,storage);assert.equal(readPersonalCode(storage),code);
 assert.throws(()=>savePersonalCode(createPersonalCode(endpoint),storage),/старый/);
 forgetPersonalCode(storage);assert.equal(readPersonalCode(storage),null);
});
test('malformed or insecure personal codes are rejected',async()=>{
 for(const code of ['', 'TAP1.abc.xyz','TAP2.a.b','TAP1.'+'a'.repeat(801)])assert.throws(()=>parsePersonalCode(code));
 assert.throws(()=>createPersonalCode('http://localhost:8787'));
 const code=createPersonalCode(endpoint);
 await assert.rejects(personalCredentials(code,'invalid'));
});
